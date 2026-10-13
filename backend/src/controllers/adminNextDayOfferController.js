const prisma = require("../config/db");
const logger = require("../utils/logger");
const offers = require("../services/nextDayOfferService");
const settings = require("../services/nextDaySettings");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminNextDayOffer.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

function scopedOut(req, cityId) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role === "superadmin" || role === "super_admin") return false;
  if (!cityId || !req.user?.city_id) return false;
  return Number(cityId) !== parseInt(req.user.city_id, 10);
}

// Loads the order and enforces: exists, is a next-day order, inside the admin's city.
async function loadOrder(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Invalid order id"), { statusCode: 400 });
  const order = await prisma.pkg_order.findUnique({ where: { id } });
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (Number(order.booking_type) !== 3) throw Object.assign(new Error("Not a next-day order"), { statusCode: 400 });
  if (scopedOut(req, order.city_id)) throw Object.assign(new Error("Forbidden: order is outside your assigned city"), { statusCode: 403 });
  return order;
}

async function listDailyDrivers(req, res) {
  try {
    const order = await loadOrder(req);
    return res.json({ success: true, data: await offers.listAvailableDailyDrivers(order) });
  } catch (e) { return fail(res, e, "listDailyDrivers"); }
}

async function offer(req, res) {
  try {
    const order = await loadOrder(req);
    const riderId = Number(req.body?.rider_id);
    if (!Number.isInteger(riderId) || riderId <= 0) return res.status(400).json({ success: false, message: "rider_id is required" });
    const row = await offers.offerToDriver({ order, riderId, adminId: req.user?.id ?? null });
    return res.status(201).json({ success: true, message: "Offer sent to the driver", data: row });
  } catch (e) { return fail(res, e, "offer"); }
}

async function listOffers(req, res) {
  try {
    const order = await loadOrder(req);
    return res.json({ success: true, data: await offers.listOffers(order.id) });
  } catch (e) { return fail(res, e, "listOffers"); }
}

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: { offer_seconds: await settings.getOfferSeconds(), live_time: await settings.getLiveTime() } });
  } catch (e) { return fail(res, e, "getSettings"); }
}

async function saveSettings(req, res) {
  try {
    // Setters return the saved value; fall back to a read for fields not supplied.
    let offerSeconds;
    let liveTime;
    if (req.body?.offer_seconds !== undefined) offerSeconds = await settings.setOfferSeconds(req.body.offer_seconds);
    if (req.body?.live_time !== undefined) liveTime = await settings.setLiveTime(req.body.live_time);
    return res.json({
      success: true,
      data: { offer_seconds: offerSeconds ?? await settings.getOfferSeconds(), live_time: liveTime ?? await settings.getLiveTime() },
    });
  } catch (e) { return fail(res, e, "saveSettings"); }
}

module.exports = { listDailyDrivers, offer, listOffers, getSettings, saveSettings };
