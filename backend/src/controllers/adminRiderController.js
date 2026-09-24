const prisma = require("../config/db");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");
const { evaluateDriverApproval } = require("../utils/driverApproval");
const { uniqueRefferCode } = require("./riderAuthController");

// Legacy convention shared by every doc-status column touched here
// (tbl_personal_doc.*_status, tbl_vehicle_details.status, tbl_bank_account.status,
// tbl_kit.kit_status): 0 = pending, 1 = approved, 2 = rejected.
const DOC_STATUS = { PENDING: 0, APPROVED: 1, REJECTED: 2 };

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function riderName(r) {
  return r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
}

function isScopedOut(req, riderCityId) {
  return req.user.role !== "superadmin" && riderCityId !== parseInt(req.user.city_id, 10);
}

async function attachCityNames(rows) {
  const cityIds = [...new Set(rows.map((r) => r.city_id).filter(Boolean))];
  if (cityIds.length === 0) return rows.map((r) => ({ ...r, city_name: null }));
  const cities = await prisma.tbl_city.findMany({ where: { id: { in: cityIds } }, select: { id: true, title: true } });
  const nameById = Object.fromEntries(cities.map((c) => [c.id, c.title]));
  return rows.map((r) => ({ ...r, city_name: r.city_id ? nameById[r.city_id] || null : null }));
}

async function list(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query.status !== undefined) where.status = parseInt(req.query.status, 10);
    if (req.query.a_status !== undefined) where.a_status = parseInt(req.query.a_status, 10);
    if (req.query.verification_status) where.verification_status = req.query.verification_status;
    if (req.query.search) {
      where.OR = [
        { full_name: { contains: req.query.search } },
        { fmobile: { contains: req.query.search } },
        { vehicle_no: { contains: req.query.search } },
      ];
    }

    const [rows, totalDrivers, onlineDrivers, pendingKyc] = await Promise.all([
      prisma.tbl_rider.findMany({ where, orderBy: { id: "desc" } }),
      prisma.tbl_rider.count({ where }),
      prisma.tbl_rider.count({ where: { ...where, a_status: 1 } }),
      prisma.tbl_rider.count({ where: { ...where, verification_status: "pending" } }),
    ]);

    const withCity = await attachCityNames(rows);
    const riderIds = rows.map((r) => r.id);
    const deliveryTypes = await prisma.tbl_rider_delivery_type.findMany({
      where: { rider_id: { in: riderIds }, status: 1 },
    });
    const packageIds = [...new Set(deliveryTypes.map((d) => Number(d.delivery_type)))];
    const packages = await prisma.tbl_package.findMany({ where: { id: { in: packageIds } }, select: { id: true, title: true } });
    const packageTitleById = Object.fromEntries(packages.map((p) => [p.id, p.title]));
    const categoriesByRider = {};
    for (const dt of deliveryTypes) {
      const title = packageTitleById[Number(dt.delivery_type)];
      if (!title) continue;
      (categoriesByRider[dt.rider_id] ||= []).push(title);
    }

    const data = withCity.map((r) => ({
      id: r.id,
      full_name: riderName(r),
      fmobile: r.fmobile,
      email: r.email,
      vehicle: r.vehicle,
      vehicle_no: r.vehicle_no,
      city_id: r.city_id,
      city_name: r.city_name,
      a_status: r.a_status,
      status: r.status,
      wallet_balance: r.wallet_balance,
      verification_status: r.verification_status,
      all_verify: r.all_verify,
      payment_complete: Number(r.payment_complete) === 1,
      active_categories: categoriesByRider[r.id] || [],
    }));

    return res.status(200).json({
      success: true,
      meta: { total_drivers: totalDrivers, online_drivers: onlineDrivers, pending_kyc: pendingKyc },
      total: data.length,
      data,
    });
  } catch (err) {
    return internalError(res, err, "riders.list");
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const categories = await prisma.pkg_category.findMany();
    const riderVehicle = String(rider.vehicle || "").toLowerCase().trim();
    const matchedCategory = categories.find((c) => {
      const cName = String(c.cat_name || "").toLowerCase().trim();
      return cName === riderVehicle || cName.includes(riderVehicle) || riderVehicle.includes(cName);
    });

    const [
      cityName,
      personalDoc,
      vehicleDetails,
      bankAccounts,
      emergencyContact,
      kit,
      training,
      deliveryTypes,
      packages,
      monthlyContract,
    ] = await Promise.all([
      rider.city_id ? prisma.tbl_city.findUnique({ where: { id: rider.city_id }, select: { title: true } }) : null,
      prisma.tbl_personal_doc.findFirst({ where: { rider_id: id } }),
      prisma.tbl_vehicle_details.findMany({ where: { rider_id: id } }),
      prisma.tbl_bank_account.findMany({ where: { rider_id: id } }),
      prisma.tbl_eme_contact.findFirst({ where: { rider_id: id } }),
      prisma.tbl_kit.findFirst({ where: { rider_id: id } }),
      prisma.driver_training_progress.findUnique({ where: { rider_id: id } }),
      prisma.tbl_rider_delivery_type.findMany({ where: { rider_id: id } }),
      matchedCategory
        ? prisma.tbl_package.findMany({ where: { cat_id: matchedCategory.id, status: 1 }, orderBy: { sort_order: "asc" } })
        : prisma.tbl_package.findMany({ where: { status: 1 }, orderBy: { sort_order: "asc" } }),
      prisma.monthly_driver_contract.findUnique({ where: { rider_id: id } }),
    ]);

    const deliveryStatusMap = new Map(deliveryTypes.map((dt) => [String(dt.delivery_type), dt.status === 1]));
    const models = packages.map((pkg) => ({
      package_id: pkg.id,
      title: pkg.title,
      user_title: pkg.user_title || pkg.title,
      driver_title: pkg.driver_title || pkg.title,
      min_charge: Number(pkg.min_charge),
      per_km_charge: Number(pkg.per_km_charge),
      enabled: deliveryStatusMap.has(String(pkg.id)) ? deliveryStatusMap.get(String(pkg.id)) : true,
    }));

    return res.status(200).json({
      success: true,
      data: {
        id: rider.id,
        full_name: riderName(rider),
        fmobile: rider.fmobile,
        smobile: rider.smobile,
        email: rider.email,
        dob: rider.dob,
        nationality: rider.nationality,
        full_address: rider.full_address,
        profile_picture: rider.profile_picture,
        city_id: rider.city_id,
        city_name: cityName ? cityName.title : null,
        vehicle: rider.vehicle,
        vehicle_no: rider.vehicle_no,
        a_status: rider.a_status,
        status: rider.status,
        all_verify: rider.all_verify,
        verification_status: rider.verification_status,
        verification_type: rider.verification_type,
        payment_complete: Number(rider.payment_complete) === 1,
        wallet_balance: rider.wallet_balance,
        account_name: rider.account_name,
        account_number: rider.account_number,
        ifsc: rider.ifsc,
        upi_id: rider.upi_id,
        working_hours: rider.working_hours,
        plan_type: rider.plan_type,
        monthly_plan: rider.monthly_plan || 0,
        monthly_contract: monthlyContract,
        rdate: rider.rdate,
        rlats: rider.rlats,
        rlongs: rider.rlongs,
        models,
        personal_doc: personalDoc,
        vehicle_details: vehicleDetails,
        bank_accounts: bankAccounts,
        emergency_contact: emergencyContact,
        kit,
        training: training
          ? {
              is_completed: training.is_completed,
              watch_progress: training.watch_progress,
              current_position_seconds: training.current_position_seconds,
              total_duration_seconds: training.total_duration_seconds,
              completed_at: training.completed_at,
              updated_at: training.updated_at,
            }
          : null,
      },
    });
  } catch (err) {
    return internalError(res, err, "riders.getOne");
  }
}

// Read-only ledger view for the driver detail drawer - lets admin see which
// UPI id / bank account a withdrawal actually went to (customerWalletController
// .withdrawWallet now tags this onto the remark) without needing DB access.
async function walletHistory(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id }, select: { id: true, city_id: true, wallet_balance: true } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const rows = await prisma.tbl_wallet_history.findMany({
      where: { user_id: id, wallet_type: "driver" },
      orderBy: { id: "desc" },
      take: 100,
    });

    return res.status(200).json({
      success: true,
      data: {
        wallet_balance: rider.wallet_balance,
        transactions: rows.map((r) => ({
          id: r.id,
          amount: r.amount,
          type: r.type,
          remark: r.remark,
          order_id: r.order_id,
          created_at: r.created_at,
        })),
      },
    });
  } catch (err) {
    return internalError(res, err, "riders.walletHistory");
  }
}

// Editable driver-profile fields - deliberately excludes status/verification
// columns (those go through toggleStatus/kycDecision/setPaymentComplete so
// they stay audited + trigger the right side effects), wallet_balance (would
// bypass customerWalletController-style audit trail), and system-managed
// columns (device_id, fcm_token, referral codes, model1_miss_streak, etc).
const PROFILE_FIELDS = [
  "full_name",
  "email",
  "fmobile",
  "smobile",
  "dob",
  "nationality",
  "full_address",
  "city_id",
  "vehicle",
  "vehicle_no",
  "account_name",
  "account_number",
  "ifsc",
  "upi_id",
  "plan_type",
  "monthly_plan",
  "working_hours",
];
const PROFILE_INT_FIELDS = new Set(["city_id", "monthly_plan", "working_hours"]);

async function updateProfile(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const data = {};
    for (const field of PROFILE_FIELDS) {
      if (req.body[field] === undefined) continue;
      const val = req.body[field];
      if (PROFILE_INT_FIELDS.has(field)) {
        data[field] = val === "" || val === null ? null : parseInt(val, 10);
      } else {
        data[field] = val === null ? null : String(val).trim();
      }
    }

    // Documents and RC details live on tbl_personal_doc and tbl_vehicle_details
    const rcOwnerName = req.body.rc_owner_name;
    const rcOwnerAadhaarNumber = req.body.rc_owner_aadhar_number;
    const aadharId = req.body.aadhar_id;
    const panId = req.body.pan_id;
    const licId = req.body.lic_id;
    const rcNumber = req.body.rc_number !== undefined ? req.body.rc_number : req.body.reg_num;

    const hasDocFields =
      rcOwnerName !== undefined ||
      rcOwnerAadhaarNumber !== undefined ||
      aadharId !== undefined ||
      panId !== undefined ||
      licId !== undefined ||
      rcNumber !== undefined;

    if (hasDocFields) {
      const docRow = await prisma.tbl_personal_doc.findFirst({ where: { rider_id: id } });
      const docData = {};
      if (rcOwnerName !== undefined) docData.rc_owner_name = rcOwnerName === null ? null : String(rcOwnerName).trim();
      if (rcOwnerAadhaarNumber !== undefined) docData.rc_owner_aadhar_number = rcOwnerAadhaarNumber === null ? null : String(rcOwnerAadhaarNumber).trim();
      if (aadharId !== undefined) docData.aadhar_id = aadharId === null ? null : String(aadharId).trim();
      if (panId !== undefined) docData.pan_id = panId === null ? null : String(panId).trim();
      if (licId !== undefined) docData.lic_id = licId === null ? null : String(licId).trim();
      if (rcNumber !== undefined) docData.residence_id = rcNumber === null ? null : String(rcNumber).trim();

      if (docRow) {
        await prisma.tbl_personal_doc.update({ where: { id: docRow.id }, data: docData });
      } else {
        await prisma.tbl_personal_doc.create({ data: { rider_id: id, status: 0, ...docData } });
      }

      if (rcNumber !== undefined) {
        const vDetail = await prisma.tbl_vehicle_details.findFirst({ where: { rider_id: id } });
        if (vDetail) {
          await prisma.tbl_vehicle_details.update({
            where: { id: vDetail.id },
            data: { reg_num: rcNumber === null ? "" : String(rcNumber).trim() },
          });
        }
      }
    }

    if (Object.keys(data).length === 0 && !hasDocFields) {
      return res.status(400).json({ success: false, message: "No editable fields provided" });
    }

    const updated = Object.keys(data).length ? await prisma.tbl_rider.update({ where: { id }, data }) : rider;
    return res.status(200).json({ success: true, message: "Driver profile updated", data: { id: updated.id, full_name: riderName(updated) } });
  } catch (err) {
    return internalError(res, err, "riders.updateProfile");
  }
}

const DOC_TYPE_HANDLERS = {
  aadhar: { table: "tbl_personal_doc", statusField: "aadhar_status", keyedByRider: true },
  pan: { table: "tbl_personal_doc", statusField: "pan_status", keyedByRider: true },
  address: { table: "tbl_personal_doc", statusField: "address_status", keyedByRider: true },
  residence: { table: "tbl_personal_doc", statusField: "residence_status", keyedByRider: true },
  license: { table: "tbl_personal_doc", statusField: "lic_status", keyedByRider: true },
  // The live schema has one status per tbl_vehicle_details row (no separate
  // RC vs. photo columns), so both spec doc types resolve to the same field.
  rc: { table: "tbl_vehicle_details", statusField: "status", keyedByRider: false },
  vehicle_photo: { table: "tbl_vehicle_details", statusField: "status", keyedByRider: false },
  bank: { table: "tbl_bank_account", statusField: "status", keyedByRider: false },
  kit: { table: "tbl_kit", statusField: "kit_status", keyedByRider: false },
};

async function kycDecision(req, res) {
  try {
    const riderId = parseInt(req.params.id, 10);
    const { document_type, record_id, is_approve, rejection_reason } = req.body;

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const handler = DOC_TYPE_HANDLERS[document_type];
    if (!handler) {
      return res.status(400).json({
        success: false,
        message: `document_type must be one of ${Object.keys(DOC_TYPE_HANDLERS).join(", ")}`,
      });
    }
    if (is_approve !== 0 && is_approve !== 1) {
      return res.status(400).json({ success: false, message: "is_approve must be 0 or 1" });
    }

    const newStatus = is_approve ? DOC_STATUS.APPROVED : DOC_STATUS.REJECTED;
    const model = prisma[handler.table];
    let updated;

    if (handler.keyedByRider) {
      const existing = await model.findFirst({ where: { rider_id: riderId } });
      if (!existing) {
        return res.status(404).json({ success: false, message: `No ${handler.table} record found for this driver` });
      }
      updated = await model.update({ where: { id: existing.id }, data: { [handler.statusField]: newStatus } });
    } else {
      if (!record_id) {
        return res.status(400).json({ success: false, message: `record_id is required for document_type "${document_type}"` });
      }
      const existing = await model.findUnique({ where: { id: parseInt(record_id, 10) } });
      if (!existing || existing.rider_id !== riderId) {
        return res.status(404).json({ success: false, message: `${handler.table} record ${record_id} not found for this driver` });
      }
      updated = await model.update({ where: { id: existing.id }, data: { [handler.statusField]: newStatus } });
    }

    await prisma.tbl_rnoti.create({
      data: {
        rid: riderId,
        title: is_approve ? "Document approved" : "Document rejected",
        msg: is_approve
          ? `Your ${document_type.replace("_", " ")} document has been approved.`
          : `Your ${document_type.replace("_", " ")} document was rejected${rejection_reason ? `: ${rejection_reason}` : "."}`,
        type: "kyc",
        date: new Date(),
      },
    });

    adminSocket.notifyDriverKycUpdate(riderId, rider.city_id, {
      document_type,
      status: newStatus,
      is_approved: is_approve,
    });

    return res.status(200).json({
      success: true,
      message: is_approve ? "Document approved" : "Document rejected",
      data: updated,
    });
  } catch (err) {
    return internalError(res, err, "riders.kycDecision");
  }
}

async function toggleStatus(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, reason } = req.body;
    if (status !== 0 && status !== 1) {
      return res.status(400).json({ success: false, message: "status must be 0 or 1" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const data = { status };
    if (status === 0) data.a_status = 0; // a blocked driver can't stay visible as online

    const updated = await prisma.tbl_rider.update({ where: { id }, data });

    await prisma.tbl_rnoti.create({
      data: {
        rid: id,
        title: status === 1 ? "Account reactivated" : "Account blocked",
        msg: status === 1 ? "Your driver account has been reactivated." : `Your driver account was blocked${reason ? `: ${reason}` : "."}`,
        type: "account_status",
        date: new Date(),
      },
    });

    adminSocket.notifyDriverStatusUpdate(id, rider.city_id, {
      status: updated.status,
      a_status: updated.a_status,
      online: updated.a_status === 1,
      active: updated.status === 1,
    });

    return res.status(200).json({ success: true, message: "Driver status updated", data: { id: updated.id, status: updated.status, a_status: updated.a_status } });
  } catch (err) {
    return internalError(res, err, "riders.toggleStatus");
  }
}

// Manual override for the driver-registration auto-verification charge -
// lets an admin mark a driver's payment_complete directly (e.g. they paid
// by another channel, or a Razorpay webhook was missed) without the driver
// having to redo anything in the app. Re-runs the same approval check the
// payment-verify endpoint uses, so a driver whose docs were already
// verified flips to "approved" immediately once marked paid.
async function setPaymentComplete(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { payment_complete } = req.body;
    if (payment_complete !== 0 && payment_complete !== 1) {
      return res.status(400).json({ success: false, message: "payment_complete must be 0 or 1" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    await prisma.tbl_rider.update({ where: { id }, data: { payment_complete } });
    const { isAllVerified } = await evaluateDriverApproval(id);

    await prisma.tbl_rnoti.create({
      data: {
        rid: id,
        title: payment_complete ? "Verification payment confirmed" : "Verification payment reset",
        msg: payment_complete
          ? "Your verification payment has been confirmed."
          : "Your verification payment status was reset to pending.",
        type: "account_status",
        date: new Date(),
      },
    });

    const updated = await prisma.tbl_rider.findUnique({ where: { id } });
    adminSocket.notifyDriverStatusUpdate(id, rider.city_id, {
      status: updated.status,
      a_status: updated.a_status,
      online: updated.a_status === 1,
      active: updated.status === 1,
    });

    return res.status(200).json({
      success: true,
      message: "Payment status updated",
      data: {
        id: updated.id,
        payment_complete: Number(updated.payment_complete) === 1,
        verification_status: updated.verification_status,
        is_all_verified: isAllVerified,
      },
    });
  } catch (err) {
    return internalError(res, err, "riders.setPaymentComplete");
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    // o_status is checked alongside order_status because cancel() never
    // resets order_status, only o_status — see adminOrderController.js.
    const activeOrderCount = await prisma.pkg_order.count({
      where: { rid: id, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
    });
    if (activeOrderCount) {
      return res.status(409).json({ success: false, message: "Cannot delete a driver with an active trip in progress" });
    }

    await prisma.$transaction([
      prisma.tbl_personal_doc.deleteMany({ where: { rider_id: id } }),
      prisma.tbl_eme_contact.deleteMany({ where: { rider_id: id } }),
      prisma.tbl_rider_delivery_type.deleteMany({ where: { rider_id: id } }),
      prisma.tbl_vehicle_details.deleteMany({ where: { rider_id: id } }),
      prisma.tbl_bank_account.deleteMany({ where: { rider_id: id } }),
      prisma.tbl_kit.deleteMany({ where: { rider_id: id } }),
      prisma.tbl_rider.delete({ where: { id } }),
    ]);

    adminSocket.notifyDriverStatusUpdate(id, rider.city_id, {
      deleted: true,
      status: 0,
      a_status: 0,
    });

    return res.status(200).json({ success: true, message: "Driver deleted" });
  } catch (err) {
    return internalError(res, err, "riders.remove");
  }
}

// Drivers currently locked out of Model 1 offers (see
// dispatchManager.recordModel1Outcome / selectEligibleDrivers) — lets an
// admin see who tripped the reliability suspension and, if warranted, lift
// it early via unsuspendModel1.
async function listModel1Suspended(req, res) {
  try {
    const where = { model1_suspended_until: { gt: new Date() } };
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    const rows = await prisma.tbl_rider.findMany({
      where,
      orderBy: { model1_suspended_until: "desc" },
      select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, city_id: true, model1_suspended_until: true },
    });

    const withCity = await attachCityNames(rows);
    const data = withCity.map((r) => ({
      id: r.id,
      full_name: riderName(r),
      fmobile: r.fmobile,
      city_name: r.city_name,
      model1_suspended_until: r.model1_suspended_until,
    }));

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "riders.listModel1Suspended");
  }
}

// Admin override to lift a Model 1 suspension before it naturally expires —
// clears both the suspension and the miss streak that led to it, so the
// driver doesn't start back at 4/5 misses the moment they're re-eligible.
async function unsuspendModel1(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }
    if (!rider.model1_suspended_until || rider.model1_suspended_until <= new Date()) {
      return res.status(400).json({ success: false, message: "Driver is not currently suspended from Model 1" });
    }

    await prisma.tbl_rider.update({
      where: { id },
      data: { model1_suspended_until: null, model1_miss_streak: 0 },
    });

    await prisma.tbl_rnoti.create({
      data: {
        rid: id,
        title: "Model 1 rides resumed",
        msg: "An admin has lifted your Model 1 suspension. You can receive Model 1 ride offers again.",
        type: "account_status",
        date: new Date(),
      },
    });

    return res.status(200).json({ success: true, message: "Model 1 suspension removed" });
  } catch (err) {
    return internalError(res, err, "riders.unsuspendModel1");
  }
}

async function toggleModel(req, res) {
  try {
    const riderId = parseInt(req.params.id, 10);
    const packageId = parseInt(req.params.packageId, 10);
    const { enabled } = req.body;

    if (!riderId || !packageId || typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, message: "rider_id, package_id and enabled (boolean) are required" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    const status = enabled ? 1 : 0;
    const existing = await prisma.tbl_rider_delivery_type.findFirst({
      where: { rider_id: riderId, delivery_type: String(packageId) },
    });

    if (existing) {
      await prisma.tbl_rider_delivery_type.update({
        where: { id: existing.id },
        data: { status },
      });
    } else {
      await prisma.tbl_rider_delivery_type.create({
        data: { rider_id: riderId, delivery_type: String(packageId), status },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Model ${enabled ? "enabled" : "disabled"} for driver successfully`,
      enabled,
      package_id: packageId,
    });
  } catch (err) {
    return internalError(res, err, "riders.toggleModel");
  }
}

async function create(req, res) {
  try {
    const {
      full_name,
      fmobile,
      smobile,
      email,
      dob,
      nationality = "Indian",
      full_address,
      city_id,
      vehicle,
      vehicle_no,
      aadhar_id,
      pan_id,
      lic_id,
      rc_number,
      rc_owner_name,
      rc_owner_aadhar_number,
      account_name,
      account_number,
      ifsc,
      bank_name,
      branch_name,
      upi_id,
      working_hours,
      plan_type = "general",
      verification_status = "approved",
      payment_complete = 1,
      status = 1,
    } = req.body;

    const trimmedName = String(full_name || "").trim();
    const trimmedMobile = String(fmobile || "").trim();
    const trimmedVehicle = String(vehicle || "").trim();
    const trimmedPlate = String(vehicle_no || "").trim().toUpperCase();
    const targetCityId = parseInt(city_id || req.scopedCityId, 10);

    if (!trimmedName) {
      return res.status(400).json({ success: false, message: "Driver full name is required" });
    }
    if (!trimmedMobile) {
      return res.status(400).json({ success: false, message: "Mobile number is required" });
    }
    if (!trimmedVehicle) {
      return res.status(400).json({ success: false, message: "Vehicle category is required" });
    }
    if (!trimmedPlate) {
      return res.status(400).json({ success: false, message: "Vehicle plate number is required" });
    }
    if (!targetCityId || isNaN(targetCityId)) {
      return res.status(400).json({ success: false, message: "City is required" });
    }
    if (isScopedOut(req, targetCityId)) {
      return res.status(403).json({ success: false, message: "Forbidden: cannot create driver outside your assigned city" });
    }

    // Check duplicate mobile
    const existing = await prisma.tbl_rider.findFirst({
      where: { fmobile: trimmedMobile },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A driver with mobile number ${trimmedMobile} already exists (#${existing.id} - ${riderName(existing)})`,
      });
    }

    const isApproved = String(verification_status).toLowerCase() === "approved";
    const initialDocStatus = isApproved ? 1 : 0;
    const isPaymentPaid = payment_complete === 1 || payment_complete === true || isApproved;
    const refCode = await uniqueRefferCode(trimmedName || "RID");
    const now = new Date();

    // Find matching vehicle category for package enablements
    const categories = await prisma.pkg_category.findMany();
    const matchedCategory = categories.find((c) => {
      const cName = String(c.cat_name || "").toLowerCase().trim();
      const vName = trimmedVehicle.toLowerCase().trim();
      return cName === vName || cName.includes(vName) || vName.includes(cName);
    });

    const newRider = await prisma.$transaction(async (tx) => {
      // 1. tbl_rider
      const rider = await tx.tbl_rider.create({
        data: {
          full_name: trimmedName,
          fmobile: trimmedMobile,
          smobile: smobile ? String(smobile).trim() : null,
          email: email ? String(email).trim() : null,
          dob: dob ? String(dob).trim() : null,
          nationality: nationality ? String(nationality).trim() : "Indian",
          full_address: full_address ? String(full_address).trim() : null,
          city_id: targetCityId,
          vehicle: trimmedVehicle,
          vehicle_no: trimmedPlate,
          account_name: account_name ? String(account_name).trim() : null,
          account_number: account_number ? String(account_number).trim() : null,
          ifsc: ifsc ? String(ifsc).trim().toUpperCase() : null,
          upi_id: upi_id ? String(upi_id).trim() : null,
          working_hours: working_hours ? parseInt(working_hours, 10) : null,
          plan_type: plan_type || "general",
          verification_type: "manual",
          verification_status: isApproved ? "approved" : "pending",
          all_verify: isApproved ? 1 : 0,
          a_status: 0,
          status: status !== undefined ? parseInt(status, 10) : 1,
          payment_complete: isPaymentPaid ? 1 : 0,
          password: "",
          rdate: now,
          referral_code: refCode,
          reffer_code: refCode,
          refferal_code: refCode,
        },
      });

      // 2. tbl_personal_doc
      const finalRc = rc_number ? String(rc_number).trim() : trimmedPlate;
      await tx.tbl_personal_doc.create({
        data: {
          rider_id: rider.id,
          aadhar_id: aadhar_id ? String(aadhar_id).trim() : null,
          aadhar_status: aadhar_id ? initialDocStatus : 0,
          pan_id: pan_id ? String(pan_id).trim() : null,
          pan_status: pan_id ? initialDocStatus : 0,
          lic_id: lic_id ? String(lic_id).trim() : null,
          lic_status: lic_id ? initialDocStatus : 0,
          residence_id: finalRc,
          residence_status: initialDocStatus,
          status: initialDocStatus,
          address_status: initialDocStatus,
          rc_owner_name: rc_owner_name ? String(rc_owner_name).trim() : null,
          rc_owner_aadhar_number: rc_owner_aadhar_number ? String(rc_owner_aadhar_number).trim() : null,
        },
      });

      // 3. tbl_vehicle_details
      await tx.tbl_vehicle_details.create({
        data: {
          rider_id: rider.id,
          type_id: matchedCategory?.id || 0,
          reg_num: finalRc,
          v_pic: "",
          status: initialDocStatus,
        },
      });

      // 4. tbl_bank_account
      if (account_number || account_name || ifsc) {
        await tx.tbl_bank_account.create({
          data: {
            rider_id: rider.id,
            a_name: account_name ? String(account_name).trim() : trimmedName,
            iban_num: account_number ? String(account_number).trim() : "",
            ifsc_code: ifsc ? String(ifsc).trim().toUpperCase() : null,
            bank_name: bank_name ? String(bank_name).trim() : null,
            branch_name: branch_name ? String(branch_name).trim() : null,
            status: initialDocStatus,
          },
        });
      }

      // 5. Auto-enable vehicle models / delivery types
      if (matchedCategory) {
        const packages = await tx.tbl_package.findMany({
          where: { cat_id: matchedCategory.id, status: 1 },
          select: { id: true },
        });
        if (packages.length > 0) {
          await tx.tbl_rider_delivery_type.createMany({
            data: packages.map((pkg) => ({
              rider_id: rider.id,
              delivery_type: String(pkg.id),
              status: 1,
            })),
          });
        }
      }

      return rider;
    });

    logger.info(`adminRiderController.create: created driver #${newRider.id} (${newRider.full_name}) by admin #${req.user.id}`);

    return res.status(201).json({
      success: true,
      message: `Driver ${newRider.full_name} created successfully`,
      data: {
        id: newRider.id,
        full_name: riderName(newRider),
        fmobile: newRider.fmobile,
        vehicle: newRider.vehicle,
        vehicle_no: newRider.vehicle_no,
        verification_status: newRider.verification_status,
      },
    });
  } catch (err) {
    return internalError(res, err, "riders.create");
  }
}

module.exports = {
  list,
  getOne,
  create,
  kycDecision,
  toggleStatus,
  remove,
  toggleModel,
  setPaymentComplete,
  updateProfile,
  listModel1Suspended,
  unsuspendModel1,
  walletHistory,
};
