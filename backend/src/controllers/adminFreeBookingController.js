const logger = require("../utils/logger");
const admin = require("../services/freeBookingAdminService");
const freeBookingService = require("../services/freeBookingService");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminFreeBooking.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
// Superadmin is unrestricted (city optional); every other role must be bound to a city or is refused.
const scopeOf = (req) => {
  if (req.user.role === "superadmin") return { unrestricted: true, cityId: admin.resolveCityId(req.user, req.query, req.body) };
  const cityId = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isFinite(cityId)) throw Object.assign(new Error("Your account is not assigned to a city"), { statusCode: 403 });
  return { unrestricted: false, cityId };
};
// Route ids must be positive integers: a bad one is a 400, never a NaN into Prisma (a 500).
const requireId = (v, label) => {
  if (!/^\d+$/.test(String(v ?? "").trim()) || Number(v) <= 0) throw Object.assign(new Error(`${label} must be a valid id`), { statusCode: 400 });
};
const cityOf = (req) => scopeOf(req).cityId;

const getSettings = async (req, res) => {
  try { return res.json({ success: true, data: await admin.getSettings(cityOf(req)) }); } catch (e) { return fail(res, e, "getSettings"); }
};
const saveSettings = async (req, res) => {
  try {
    await admin.saveSettings({
      cityId: cityOf(req), enabled: req.body.enabled, offerStart: req.body.offer_start, offerEnd: req.body.offer_end,
      referralsRequired: req.body.referrals_required, adminId: req.user?.id,
    });
    return res.json({ success: true, message: "Free Booking settings saved", data: await admin.getSettings(cityOf(req)) });
  } catch (e) { return fail(res, e, "saveSettings"); }
};
const listPool = async (req, res) => {
  try { return res.json({ success: true, data: await admin.listPool(cityOf(req)) }); } catch (e) { return fail(res, e, "listPool"); }
};
const listCandidates = async (req, res) => {
  try { return res.json({ success: true, data: await admin.listCandidates(cityOf(req), req.query.q) }); } catch (e) { return fail(res, e, "listCandidates"); }
};
const addToPool = async (req, res) => {
  try {
    const row = await admin.addToPool({
      cityId: cityOf(req), riderId: req.body.rider_id, validFrom: req.body.valid_from, validTo: req.body.valid_to, adminId: req.user?.id,
    });
    return res.status(201).json({ success: true, message: "Driver added to the offer pool", data: row });
  } catch (e) { return fail(res, e, "addToPool"); }
};
const updatePool = async (req, res) => {
  try {
    const row = await admin.updatePool(req.params.id, cityOf(req), req.body);
    return res.json({ success: true, message: "Pool entry updated", data: row });
  } catch (e) { return fail(res, e, "updatePool"); }
};
const removeFromPool = async (req, res) => {
  try { await admin.removeFromPool(req.params.id, cityOf(req)); return res.json({ success: true, message: "Removed from the offer pool" }); } catch (e) { return fail(res, e, "removeFromPool"); }
};
const listOrders = async (req, res) => {
  try { return res.json({ success: true, data: await admin.listOrders({ ...scopeOf(req), status: req.query.status }) }); } catch (e) { return fail(res, e, "listOrders"); }
};
const voidOrder = async (req, res) => {
  try {
    // A city-bound admin may only void bookings of their own city; a superadmin is unrestricted.
    const scope = scopeOf(req);
    requireId(req.params.id, "Booking id");
    if (!scope.unrestricted) {
      const order = await admin.findOrderInCity(req.params.id, scope.cityId);
      if (!order) return res.status(404).json({ success: false, message: "Booking not found" });
    }
    const ok = await freeBookingService.voidOrder(req.params.id);
    if (!ok) return res.status(409).json({ success: false, message: "This booking is no longer open" });
    logger.info(`free-booking void order=${req.params.id} by admin=${req.user.id}`);
    return res.json({ success: true, message: "Free booking voided" });
  } catch (e) { return fail(res, e, "voidOrder"); }
};
const setLock = (locked) => async (req, res) => {
  try {
    const scope = scopeOf(req);
    requireId(req.params.userId, "User id");
    await admin.assertUserInCity(req.params.userId, scope.cityId, scope.unrestricted);
    await freeBookingService.setUserLock(req.params.userId, locked);
    logger.info(`free-booking ${locked ? "lock" : "unlock"} user=${req.params.userId} by admin=${req.user.id}`);
    return res.json({ success: true, message: locked ? "Free Booking locked for this customer" : "Free Booking unlocked for this customer" });
  } catch (e) { return fail(res, e, locked ? "lock" : "unlock"); }
};

module.exports = {
  getSettings, saveSettings, listPool, listCandidates, addToPool, updatePool, removeFromPool,
  listOrders, voidOrder, lockUser: setLock(true), unlockUser: setLock(false),
};
