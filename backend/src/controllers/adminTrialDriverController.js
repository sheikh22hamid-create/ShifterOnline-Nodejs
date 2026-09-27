const prisma = require("../config/db");
const logger = require("../utils/logger");
const { assignDefaultDeliveryTypes } = require("../utils/assignDefaultDeliveryTypes");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function riderName(r) {
  return r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
}

// --- List all riders currently on the trial roster (any status other than
// "none" - includes exhausted/blocked/upgraded so admin retains history). ---
async function list(req, res) {
  try {
    const rows = await prisma.tbl_rider.findMany({
      where: { trial_status: { not: "none" } },
      orderBy: { id: "desc" },
    });
    const data = rows.map((r) => ({
      id: r.id,
      full_name: riderName(r),
      fmobile: r.fmobile,
      vehicle: r.vehicle,
      trial_status: r.trial_status,
      trial_orders_allowed: r.trial_orders_allowed,
      trial_orders_completed: r.trial_orders_completed,
      verification_status: r.verification_status,
    }));
    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "trialDrivers.list");
  }
}

// --- Add a driver to the trial roster by name + mobile, find-or-create by
// mobile (same lookup shape as driverKycStatusController.verifyDriverDocument). ---
async function create(req, res) {
  try {
    const { full_name, fmobile, vehicle, city_id, trial_orders_allowed } = req.body || {};

    const trimmedName = String(full_name || "").trim();
    const trimmedMobile = String(fmobile || "").trim();
    const trimmedVehicle = String(vehicle || "").trim();
    const allowedCount = Number(trial_orders_allowed);

    if (!trimmedName) return res.status(400).json({ success: false, message: "Driver full name is required" });
    if (!trimmedMobile) return res.status(400).json({ success: false, message: "Mobile number is required" });
    if (!trimmedVehicle) return res.status(400).json({ success: false, message: "Vehicle category is required" });
    if (!Number.isInteger(allowedCount) || allowedCount <= 0) {
      return res.status(400).json({ success: false, message: "trial_orders_allowed must be a positive whole number" });
    }

    const existing = await prisma.tbl_rider.findFirst({ where: { fmobile: trimmedMobile } });

    if (existing && existing.trial_status === "active") {
      return res.status(400).json({
        success: false,
        message: `${riderName(existing) || trimmedMobile} is already on an active trial (#${existing.id})`,
      });
    }

    if (existing) {
      const updated = await prisma.tbl_rider.update({
        where: { id: existing.id },
        data: {
          full_name: trimmedName,
          vehicle: trimmedVehicle,
          trial_status: "active",
          trial_orders_allowed: allowedCount,
          trial_orders_completed: 0,
        },
      });
      await assignDefaultDeliveryTypes(existing.id);
      return res.status(200).json({
        success: true,
        message: `${riderName(updated)} activated for trial`,
        data: { id: updated.id, full_name: riderName(updated), fmobile: updated.fmobile },
      });
    }

    const targetCityId = parseInt(city_id || req.scopedCityId || req.user?.city_id, 10) || 1;
    const created = await prisma.tbl_rider.create({
      data: {
        full_name: trimmedName,
        fmobile: trimmedMobile,
        vehicle: trimmedVehicle,
        city_id: targetCityId,
        verification_type: "manual",
        verification_status: "pending",
        all_verify: 0,
        a_status: 0,
        status: 1,
        payment_complete: 0,
        password: "",
        profile_picture: "",
        fcm_token: "",
        device_id: "",
        rdate: new Date(),
        trial_status: "active",
        trial_orders_allowed: allowedCount,
        trial_orders_completed: 0,
      },
    });
    await assignDefaultDeliveryTypes(created.id);
    logger.info(`adminTrialDriverController.create: added trial driver #${created.id} by admin #${req.user?.id || "unknown"}`);
    return res.status(201).json({
      success: true,
      message: `${riderName(created)} added to trial`,
      data: { id: created.id, full_name: riderName(created), fmobile: created.fmobile },
    });
  } catch (err) {
    return internalError(res, err, "trialDrivers.create");
  }
}

async function findRiderOr404(req, res) {
  const id = parseInt(req.params.id, 10);
  const rider = await prisma.tbl_rider.findUnique({ where: { id } });
  if (!rider) {
    res.status(404).json({ success: false, message: "Driver not found" });
    return null;
  }
  return rider;
}

// --- Block: immediately end the trial and take the driver offline. ---
async function block(req, res) {
  try {
    const rider = await findRiderOr404(req, res);
    if (!rider) return;
    await prisma.tbl_rider.update({ where: { id: rider.id }, data: { trial_status: "blocked", a_status: 0 } });
    return res.status(200).json({ success: true, message: "Driver removed from trial and blocked" });
  } catch (err) {
    return internalError(res, err, "trialDrivers.block");
  }
}

// --- Remove: take the driver off the trial roster (reverts to needing
// normal KYC before they're dispatch-eligible again). ---
async function remove(req, res) {
  try {
    const rider = await findRiderOr404(req, res);
    if (!rider) return;
    await prisma.tbl_rider.update({ where: { id: rider.id }, data: { trial_status: "none", a_status: 0 } });
    return res.status(200).json({ success: true, message: "Driver removed from trial" });
  } catch (err) {
    return internalError(res, err, "trialDrivers.remove");
  }
}

// --- Upgrade: same manual-approval shape as adminRiderController.create's
// isApproved branch - marks KYC approved directly, no document review.
// a_status is left untouched (trial drivers already reach dispatch
// eligibility through the normal online/offline toggle - see riderController.setStatus). ---
async function upgrade(req, res) {
  try {
    const rider = await findRiderOr404(req, res);
    if (!rider) return;
    await prisma.tbl_rider.update({
      where: { id: rider.id },
      data: { verification_status: "approved", all_verify: 1, payment_complete: 1, trial_status: "upgraded" },
    });
    await assignDefaultDeliveryTypes(rider.id);
    return res.status(200).json({ success: true, message: "Driver upgraded to fully verified" });
  } catch (err) {
    return internalError(res, err, "trialDrivers.upgrade");
  }
}

module.exports = { list, create, block, remove, upgrade };
