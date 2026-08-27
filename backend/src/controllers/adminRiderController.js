const prisma = require("../config/db");
const logger = require("../utils/logger");

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

    const [cityName, personalDoc, vehicleDetails, bankAccounts, emergencyContact, kit] = await Promise.all([
      rider.city_id ? prisma.tbl_city.findUnique({ where: { id: rider.city_id }, select: { title: true } }) : null,
      prisma.tbl_personal_doc.findFirst({ where: { rider_id: id } }),
      prisma.tbl_vehicle_details.findMany({ where: { rider_id: id } }),
      prisma.tbl_bank_account.findMany({ where: { rider_id: id } }),
      prisma.tbl_eme_contact.findFirst({ where: { rider_id: id } }),
      prisma.tbl_kit.findFirst({ where: { rider_id: id } }),
    ]);

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
        wallet_balance: rider.wallet_balance,
        plan_type: rider.plan_type,
        rdate: rider.rdate,
        rlats: rider.rlats,
        rlongs: rider.rlongs,
        personal_doc: personalDoc,
        vehicle_details: vehicleDetails,
        bank_accounts: bankAccounts,
        emergency_contact: emergencyContact,
        kit,
      },
    });
  } catch (err) {
    return internalError(res, err, "riders.getOne");
  }
}

const DOC_TYPE_HANDLERS = {
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

    return res.status(200).json({ success: true, message: "Driver status updated", data: { id: updated.id, status: updated.status, a_status: updated.a_status } });
  } catch (err) {
    return internalError(res, err, "riders.toggleStatus");
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

    return res.status(200).json({ success: true, message: "Driver deleted" });
  } catch (err) {
    return internalError(res, err, "riders.remove");
  }
}

module.exports = { list, getOne, kycDecision, toggleStatus, remove };
