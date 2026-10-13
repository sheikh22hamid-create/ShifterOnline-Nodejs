const prisma = require("../config/db");
const logger = require("../utils/logger");
const offers = require("../services/nextDayOfferService");
const settings = require("../services/nextDaySettings");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminNextDayOffer.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// Fail closed: scopeFilter yields NaN for a non-superadmin without a city; never treat that as unscoped.
function assertCityAccess(req, order) {
  if (req.user?.role === "superadmin") return;
  if (!Number.isInteger(req.scopedCityId)) {
    throw Object.assign(new Error("Your account is not assigned to a city"), { statusCode: 403 });
  }
  if (Number(order.city_id) !== req.scopedCityId) {
    throw Object.assign(new Error("Forbidden: order is outside your assigned city"), { statusCode: 403 });
  }
}

// Loads the order and enforces: exists, is a next-day order, inside the admin's city.
async function loadOrder(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Invalid order id"), { statusCode: 400 });
  const order = await prisma.pkg_order.findUnique({ where: { id } });
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (Number(order.booking_type) !== 3) throw Object.assign(new Error("Not a next-day order"), { statusCode: 400 });
  assertCityAccess(req, order);
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

async function currentSettings() {
  return {
    offer_seconds: await settings.getOfferSeconds(),
    live_time: await settings.getLiveTime(),
    discount_percent: await settings.getDiscountPercent(),
  };
}

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: await currentSettings() });
  } catch (e) { return fail(res, e, "getSettings"); }
}

async function saveSettings(req, res) {
  try {
    // Validate everything supplied before writing anything (no half-apply).
    const hasOffer = req.body?.offer_seconds !== undefined;
    const hasLive = req.body?.live_time !== undefined;
    const offerSeconds = hasOffer ? settings.validateOfferSeconds(req.body.offer_seconds) : undefined;
    const liveTime = hasLive ? settings.validateLiveTime(req.body.live_time) : undefined;
    const hasDiscount = req.body?.discount_percent !== undefined;
    const discountPercent = hasDiscount ? settings.validateDiscountPercent(req.body.discount_percent) : undefined;
    const savedOffer = hasOffer ? await settings.setOfferSeconds(offerSeconds) : undefined;
    const savedLive = hasLive ? await settings.setLiveTime(liveTime) : undefined;
    const savedDiscount = hasDiscount ? await settings.setDiscountPercent(discountPercent) : undefined;
    return res.json({
      success: true,
      data: {
        offer_seconds: savedOffer ?? await settings.getOfferSeconds(),
        live_time: savedLive ?? await settings.getLiveTime(),
        discount_percent: savedDiscount ?? await settings.getDiscountPercent(),
      },
    });
  } catch (e) { return fail(res, e, "saveSettings"); }
}

module.exports = { listDailyDrivers, offer, listOffers, getSettings, saveSettings };
