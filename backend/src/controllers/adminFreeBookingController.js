const logger = require("../utils/logger");
const admin = require("../services/freeBookingAdminService");
const freeBookingService = require("../services/freeBookingService");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminFreeBooking.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
const cityOf = (req) => admin.resolveCityId(req.user, req.query, req.body);
// A city-bound admin always has a city; a superadmin has one only if they picked it.
const scopeCity = (req) => (req.user.role === "superadmin" ? null : cityOf(req));

const getSettings = async (req, res) => {
  try { return res.json({ success: true, data: await admin.getSettings(cityOf(req)) }); } catch (e) { return fail(res, e, "getSettings"); }
};
const saveSettings = async (req, res) => {
  try {
    await admin.saveSettings({
      cityId: cityOf(req), enabled: req.body.enabled, offerStart: req.body.offer_start, offerEnd: req.body.offer_end, adminId: req.user?.id,
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
  try { return res.json({ success: true, data: await admin.listOrders({ cityId: cityOf(req), status: req.query.status }) }); } catch (e) { return fail(res, e, "listOrders"); }
};
const voidOrder = async (req, res) => {
  try {
    // A city-bound admin may only void bookings of their own city; a superadmin is unrestricted.
    const scope = scopeCity(req);
    if (scope) {
      const rows = await admin.listOrders({ cityId: scope });
      if (!rows.some((r) => String(r.id) === String(req.params.id))) return res.status(404).json({ success: false, message: "Booking not found" });
    }
    const ok = await freeBookingService.voidOrder(req.params.id);
    if (!ok) return res.status(409).json({ success: false, message: "This booking is no longer open" });
    return res.json({ success: true, message: "Free booking voided" });
  } catch (e) { return fail(res, e, "voidOrder"); }
};
const setLock = (locked) => async (req, res) => {
  try {
    await admin.assertUserInCity(req.params.userId, scopeCity(req));
    await freeBookingService.setUserLock(req.params.userId, locked);
    return res.json({ success: true, message: locked ? "Free Booking locked for this customer" : "Free Booking unlocked for this customer" });
  } catch (e) { return fail(res, e, locked ? "lock" : "unlock"); }
};

module.exports = {
  getSettings, saveSettings, listPool, listCandidates, addToPool, updatePool, removeFromPool,
  listOrders, voidOrder, lockUser: setLock(true), unlockUser: setLock(false),
};
