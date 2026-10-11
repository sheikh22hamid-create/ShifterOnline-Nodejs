const prisma = require("../config/db");
const logger = require("../utils/logger");
const settingsService = require("../services/tieredDispatchSettings");
const penaltyService = require("../services/tierPenaltyService");
const cancelService = require("../services/cancelRequestService");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminTierDispatch.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// Superadmin sees every city (optionally narrowed by ?city_id); everyone else is bound to their own city.
const cityScope = (req) => {
  if (req.user.role === "superadmin") {
    const raw = req.query.city_id;
    return raw != null && raw !== "" ? Number(raw) : null;
  }
  const cityId = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isFinite(cityId)) throw httpError(403, "Your account is not assigned to a city");
  return cityId;
};
const requireId = (v, label) => {
  if (!/^\d+$/.test(String(v ?? "").trim()) || Number(v) <= 0) throw httpError(400, `${label} must be a valid id`);
  return Number(v);
};
const TIERS = ["free", "daily"];

// A city admin may only act on rows of their own city; the superadmin is unrestricted.
async function assertCancelRequestInCity(req, requestId) {
  if (req.user.role === "superadmin") return;
  const cityId = cityScope(req);
  const rows = await prisma.$queryRaw`
    SELECT o.city_id FROM order_cancel_request r JOIN pkg_order o ON o.id = r.order_id WHERE r.id = ${requestId} LIMIT 1`;
  if (!rows[0] || Number(rows[0].city_id) !== cityId) throw httpError(403, "This request belongs to another city");
}
async function assertPenaltyInCity(req, penaltyId) {
  if (req.user.role === "superadmin") return;
  const cityId = cityScope(req);
  const rows = await prisma.$queryRaw`
    SELECT rd.city_id FROM driver_tier_penalty p JOIN tbl_rider rd ON rd.id = p.rider_id WHERE p.id = ${penaltyId} LIMIT 1`;
  if (!rows[0] || Number(rows[0].city_id) !== cityId) throw httpError(403, "This penalty belongs to another city");
}

const getSettings = async (req, res) => {
  try {
    return res.json({ success: true, data: await settingsService.getTierSettings({ fresh: true }) });
  } catch (e) { return fail(res, e, "getSettings"); }
};

// Global dispatch behaviour: only a superadmin may change it (a city admin would change every city).
const saveSettings = async (req, res) => {
  try {
    if (req.user.role !== "superadmin") throw httpError(403, "Only a superadmin can change dispatch settings");
    const b = req.body || {};
    const data = await settingsService.saveTierSettings({
      tieredEnabled: b.tiered_dispatch_enabled,
      penaltyEnabled: b.penalty_enabled,
      ladder: b.ladder,
      cancelPenaltyPct: b.cancel_penalty_pct,
    });
    return res.json({ success: true, message: "Dispatch settings saved", data });
  } catch (e) { return fail(res, e, "saveSettings"); }
};

const listPenalties = async (req, res) => {
  try {
    const cityId = cityScope(req);
    const tier = TIERS.includes(req.query.tier) ? req.query.tier : null;
    const status = ["pending_daily", "collected", "waived"].includes(req.query.status) ? req.query.status : null;
    const riderId = req.query.rider_id ? requireId(req.query.rider_id, "rider_id") : null;
    const rows = await prisma.$queryRaw`
      SELECT p.id, p.rider_id, rd.full_name AS rider_name, p.order_id, p.tier, p.kind, p.event, p.miss_no, p.pct,
             p.base_amount, p.amount, p.status, p.created_at, p.collected_at, p.waived_at
      FROM driver_tier_penalty p
      JOIN tbl_rider rd ON rd.id = p.rider_id
      WHERE (${cityId} IS NULL OR rd.city_id = ${cityId})
        AND (${tier} IS NULL OR p.tier = ${tier})
        AND (${status} IS NULL OR p.status = ${status})
        AND (${riderId} IS NULL OR p.rider_id = ${riderId})
      ORDER BY p.id DESC LIMIT 200`;
    return res.json({ success: true, data: rows });
  } catch (e) { return fail(res, e, "listPenalties"); }
};

const waivePenalty = async (req, res) => {
  try {
    const id = requireId(req.params.id, "penalty id");
    await assertPenaltyInCity(req, id);
    const data = await penaltyService.waive({ penaltyId: id, adminId: req.user.id });
    return res.json({ success: true, message: data.alreadyWaived ? "Already waived" : "Penalty waived", data });
  } catch (e) { return fail(res, e, "waivePenalty"); }
};

const resetCounter = async (req, res) => {
  try {
    const riderId = requireId(req.body?.rider_id, "rider_id");
    if (!TIERS.includes(req.body?.tier)) throw httpError(400, "tier must be free or daily");
    await penaltyService.resetCounter({ riderId, tier: req.body.tier, adminId: req.user.id });
    return res.json({ success: true, message: "Penalty counter reset" });
  } catch (e) { return fail(res, e, "resetCounter"); }
};

const listCancelRequests = async (req, res) => {
  try {
    const cityId = cityScope(req);
    const status = ["pending", "approved", "rejected", "stale"].includes(req.query.status) ? req.query.status : "pending";
    return res.json({ success: true, data: await cancelService.listRequests({ status, cityId }) });
  } catch (e) { return fail(res, e, "listCancelRequests"); }
};

const approveCancel = async (req, res) => {
  try {
    const id = requireId(req.params.id, "request id");
    await assertCancelRequestInCity(req, id);
    const data = await cancelService.approve({ requestId: id, adminId: req.user.id });
    return res.json({ success: data.ok, message: data.ok ? "Cancel approved; order sent to the next driver tier" : "The order changed state, nothing was re-dispatched", data });
  } catch (e) { return fail(res, e, "approveCancel"); }
};

const rejectCancel = async (req, res) => {
  try {
    const id = requireId(req.params.id, "request id");
    await assertCancelRequestInCity(req, id);
    await cancelService.reject({ requestId: id, adminId: req.user.id });
    return res.json({ success: true, message: "Cancel request rejected" });
  } catch (e) { return fail(res, e, "rejectCancel"); }
};

module.exports = { getSettings, saveSettings, listPenalties, waivePenalty, resetCounter, listCancelRequests, approveCancel, rejectCancel };
