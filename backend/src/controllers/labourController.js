// Loading/Unloading labour HTTP handlers (spec 2026-11-24, Phase 1).
// Ids come in the body, matching the existing order/trip endpoints' convention.

const logger = require("../utils/logger");
const labourExtraService = require("../services/labourExtraService");
const labourDisputeService = require("../services/labourDisputeService");

function fail(res, err, where) {
  const code = err.statusCode || 500;
  if (code >= 500) logger.error(`${where} failed:`, err);
  return res.status(code).json({ Result: false, msg: err.message || "Internal server error" });
}

// Driver proposes an on-site extra: { order_id, rider_id, mode, heavyItem, legs:[...], photo }
async function proposeExtra(req, res) {
  try {
    const { order_id, rider_id, mode, heavyItem, legs, photo } = req.body;
    if (!order_id) return res.status(400).json({ Result: false, msg: "order_id is required" });
    const r = await labourExtraService.proposeExtra({ orderId: order_id, riderId: rider_id, mode, heavyItem, legs, photo });
    return res.status(200).json({ Result: true, ...r });
  } catch (err) {
    return fail(res, err, "labour.proposeExtra");
  }
}

// Customer approves the pending extra: { order_id, uid }
async function approveExtra(req, res) {
  try {
    const { order_id, uid, expected_amount } = req.body;
    if (!order_id) return res.status(400).json({ Result: false, msg: "order_id is required" });
    const r = await labourExtraService.approveExtra({
      orderId: order_id,
      uid,
      expectedAmount: expected_amount == null ? null : Number(expected_amount),
    });
    return res.status(200).json({ Result: true, ...r });
  } catch (err) {
    return fail(res, err, "labour.approveExtra");
  }
}

// Customer or driver raises a labour dispute: { order_id, raised_by, raiser_id, reason }
async function raiseDispute(req, res) {
  try {
    const { order_id, raised_by, raiser_id, reason } = req.body;
    if (!order_id) return res.status(400).json({ Result: false, msg: "order_id is required" });
    const r = await labourDisputeService.raiseDispute({ orderId: order_id, raisedBy: raised_by, raiserId: raiser_id, reason });
    return res.status(200).json({ Result: true, ...r });
  } catch (err) {
    return fail(res, err, "labour.raiseDispute");
  }
}

// Executive queue (admin, req.user). Executives see their own city; admin/superadmin may pass city_id.
async function listDisputes(req, res) {
  try {
    const role = req.user?.role;
    // Only a superadmin may choose/omit the city filter; everyone else is bound to their own city.
    let cityId;
    if (role === "superadmin") {
      cityId = req.query?.city_id ?? null;
    } else {
      cityId = req.user?.city_id;
      if (cityId == null) return res.status(403).json({ Result: false, msg: "No city scope" });
    }
    const rows = await labourDisputeService.listForExecutive({ cityId });
    return res.status(200).json({ Result: true, disputes: rows });
  } catch (err) {
    return fail(res, err, "labour.listDisputes");
  }
}

// Executive resolves: POST :id/resolve { action: release|refund|split, driver_amount?, note }
async function resolveDispute(req, res) {
  try {
    const { action, driver_amount, note } = req.body;
    const r = await labourDisputeService.resolveDispute({
      disputeId: req.params.id, executiveId: req.user?.id, actorRole: req.user?.role, actorCityId: req.user?.city_id,
      action, driverAmount: driver_amount, note,
    });
    return res.status(200).json({ Result: true, ...r });
  } catch (err) {
    return fail(res, err, "labour.resolveDispute");
  }
}

module.exports = { proposeExtra, approveExtra, raiseDispute, listDisputes, resolveDispute };
