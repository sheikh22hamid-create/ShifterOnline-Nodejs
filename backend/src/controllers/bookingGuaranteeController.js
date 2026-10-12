const prisma = require("../config/db");
const logger = require("../utils/logger");
const bookingGuarantee = require("../services/bookingGuaranteeService");
const { resolvePickupCityId } = require("../services/pickupCityService");

const positiveInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The city the guarantee is judged by: the pickup's (same resolution as the vehicle list and order
 * creation), falling back to the customer's registered city. null when neither is known.
 */
async function resolveQuoteCityId(body, uid) {
  const lat = Number(body.pickup_lat);
  const lng = Number(body.pickup_lng);
  const hasPickup = body.pickup_lat !== undefined && body.pickup_lat !== null && body.pickup_lat !== ""
    && body.pickup_lng !== undefined && body.pickup_lng !== null && body.pickup_lng !== ""
    && Number.isFinite(lat) && Number.isFinite(lng);
  if (hasPickup) {
    const pickupCityId = await resolvePickupCityId(lat, lng).catch((err) => {
      logger.error("bookingGuarantee.quote: resolvePickupCityId failed, using the customer's city:", err);
      return null;
    });
    if (pickupCityId) return pickupCityId;
  }
  if (!uid) return null;
  const customer = await prisma.tbl_user.findUnique({ where: { id: uid }, select: { city_id: true } });
  return positiveInt(customer?.city_id);
}

/** POST /api/order/guarantee-quote — display-only "if no driver is found you get ₹X" for the toggled models. */
async function quote(req, res) {
  try {
    const body = req.body || {};
    const ids = body.package_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must be a non-empty array" });
    }
    if (ids.length > 20) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must have at most 20 entries" });
    }
    const uid = positiveInt(body.uid);
    const cityId = await resolveQuoteCityId(body, uid);
    const q = await bookingGuarantee.quote(ids, { cityId, uid });
    return res.json({ ResponseCode: "200", Result: "true", amount: q.amount, package_id: q.packageId });
  } catch (err) {
    logger.error("bookingGuarantee.quote failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { quote };
