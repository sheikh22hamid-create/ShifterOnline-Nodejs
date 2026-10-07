const logger = require("../utils/logger");
const freeBookingService = require("../services/freeBookingService");

const isFiniteNumber = (v) => v !== null && v !== "" && Number.isFinite(Number(v));

async function check(req, res) {
  try {
    const { uid, plat, plong, category, radius_km, city_id, booking_type } = req.body || {};
    if (!uid || !category || !isFiniteNumber(plat) || !isFiniteNumber(plong)) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "uid, category, plat and plong are required" });
    }
    // Optional inputs: absent means the default, but a supplied bad value is refused rather than ignored.
    const provided = (v) => v !== undefined && v !== null && v !== "";
    if (provided(radius_km) && !(isFiniteNumber(radius_km) && Number(radius_km) > 0)) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "radius_km must be a positive number" });
    }
    if (provided(booking_type) && ![1, 2, 3].includes(Number(booking_type))) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "booking_type must be 1, 2 or 3" });
    }
    const result = await freeBookingService.checkEligibility({
      uid: Number(uid), plat: Number(plat), plong: Number(plong), category,
      radiusKm: provided(radius_km) ? Number(radius_km) : 4, cityId: city_id ? Number(city_id) : undefined,
      bookingType: provided(booking_type) ? Number(booking_type) : 1,
    });
    return res.json({ ResponseCode: "200", Result: "true", outcome: result.outcome, message: result.message });
  } catch (err) {
    logger.error("freeBooking.check failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function status(req, res) {
  try {
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "uid is required" });
    const out = await freeBookingService.getUserStatus(Number(uid));
    return res.json({ ResponseCode: "200", Result: "true", state: out.state, message: out.message });
  } catch (err) {
    logger.error("freeBooking.status failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { check, status };
