const orderController = require("./orderController");
const logger = require("../utils/logger");
const { POPUP_TIMEOUT_MS } = require("../config/constants");

function parseDeliveryTypes(raw) {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw !== "string") return [];
  return raw
    .replace(/[[\]]/g, "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function resolveRadiusKm(body) {
  const radiusRange = Number(body.radius_range);
  if (Number.isFinite(radiusRange) && radiusRange > 0) return radiusRange;
  return Number(body.radius) || Number(body.search_radius) || Number(body.pickup_radius) || Number(body.driver_radius) || 10;
}

async function createOrder(req, res) {
  try {
    const raw = req.body;
    const deliveryTypeIds = parseDeliveryTypes(raw.delivery_type);

    if (deliveryTypeIds.length === 0) {
      return res.json({ Result: false, msg: "delivery_type required" });
    }

    const result = await orderController.createOrderCore({
      uid: raw.uid,
      category: raw.category,
      deliveryTypeIds,
      bookingType: raw.booking_type,
      plat: raw.plat,
      plong: raw.plong,
      paddress: raw.paddress,
      pickName: raw.pick_name,
      pmobile: raw.pmobile,
      pickType: raw.pick_type,
      dlat: raw.dlat,
      dlong: raw.dlong,
      daddress: raw.daddress,
      dropName: raw.drop_name,
      dmobile: raw.dmobile,
      dropType: raw.drop_type,
      packageWeight: raw.package_weight,
      packageCost: raw.package_cost,
      description: raw.description,
      pMethodId: raw.p_method_id,
      transactionId: raw.transaction_id,
      extraMileCharge: raw.extra_mile_charge,
      couId: raw.cou_id,
      couAmt: raw.cou_amt,
      radiusKm: resolveRadiusKm(raw),
      cityId: raw.city_id,
      photos: raw.photos || null,
    });

    if (!result.ok && result.code === "VALIDATION") {
      return res.json({ Result: false, msg: result.msg });
    }
    if (!result.ok && result.code === "INVALID_PACKAGES") {
      return res.json({ Result: false, msg: "No package found" });
    }

    const { order } = result;
    return res.json({
      order_id: order.id,
      booking_type: order.booking_type,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: order.booking_type === 3
        ? "Your order has been placed successfully. Delivery will be scheduled for the next day between 9:00 AM and 10:00 AM."
        : "Package Order Placed Successfully!!!",
      batch_no: 1,
      drivers_notified: 0,
      driver_ids: [],
      popup_duration: POPUP_TIMEOUT_MS / 1000,
      expires_at: "",
      next_batch_in: 5,
    });
  } catch (err) {
    logger.error("legacyController.createOrder failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { createOrder };
