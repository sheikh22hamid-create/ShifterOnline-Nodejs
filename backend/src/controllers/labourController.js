// Loading/Unloading labour HTTP handlers (spec 2026-11-24, Phase 1).
// Ids come in the body, matching the existing order/trip endpoints' convention.

const logger = require("../utils/logger");
const labourExtraService = require("../services/labourExtraService");

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
    const { order_id, uid } = req.body;
    if (!order_id) return res.status(400).json({ Result: false, msg: "order_id is required" });
    const r = await labourExtraService.approveExtra({ orderId: order_id, uid });
    return res.status(200).json({ Result: true, ...r });
  } catch (err) {
    return fail(res, err, "labour.approveExtra");
  }
}

module.exports = { proposeExtra, approveExtra };
