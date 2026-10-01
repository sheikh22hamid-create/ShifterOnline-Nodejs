const prisma = require("../config/db");
const logger = require("../utils/logger");
const { resolveGoodsType } = require("../services/goodsTypeService");

const CUSTOMER_TYPES = new Set(["commercial", "home_shifting"]);
const RATING_FIELDS = {
  customer_rating: "customer_rating",
  pickup_location_rating: "pickup_location_rating",
  drop_location_rating: "drop_location_rating",
  route_rating: "route_rating",
};

function parseRating(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Driver's optional post-trip form: rate the customer / pickup location /
 * drop location / route, flag a no-entry zone, pick the customer type and
 * correct the goods type. Every field is optional; only what is sent is saved.
 */
async function submitDriverFeedback(req, res) {
  try {
    const orderId = Number(req.body?.order_id);
    const riderId = Number(req.body?.rider_id);
    if (!orderId || !riderId) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "order_id and rider_id are required" });
    }

    const order = await prisma.pkg_order.findFirst({ where: { id: orderId, rid: riderId } });
    if (!order) {
      return res.status(404).json({ ResponseCode: "404", Result: "false", ResponseMsg: "Order not found for this driver" });
    }
    if (order.o_status !== "Completed") {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Feedback can be given after the trip is completed" });
    }

    const data = {};
    for (const [bodyKey, column] of Object.entries(RATING_FIELDS)) {
      if (req.body?.[bodyKey] === undefined) continue;
      const parsed = parseRating(req.body[bodyKey]);
      if (!parsed.ok) {
        return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: `${bodyKey} must be between 1 and 5` });
      }
      data[column] = parsed.value;
    }
    if (req.body?.no_entry_zone !== undefined && req.body.no_entry_zone !== null && req.body.no_entry_zone !== "") {
      const v = req.body.no_entry_zone;
      data.no_entry_zone = v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true" || String(v).toLowerCase() === "yes";
    }
    if (req.body?.customer_type !== undefined && req.body.customer_type !== "") {
      const type = String(req.body.customer_type).toLowerCase();
      if (!CUSTOMER_TYPES.has(type)) {
        return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "customer_type must be commercial or home_shifting" });
      }
      data.customer_type = type;
    }

    const saved = await prisma.order_driver_feedback.upsert({
      where: { order_id: orderId },
      create: { order_id: orderId, rider_id: riderId, uid: order.uid, ...data },
      update: data,
    });

    // The driver can correct the goods type the customer picked.
    if (req.body?.goods_type_id !== undefined || req.body?.goods_type_other !== undefined) {
      const goods = await resolveGoodsType({ goodsTypeId: req.body.goods_type_id, goodsTypeOther: req.body.goods_type_other });
      if (!goods.ok) {
        return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: goods.msg });
      }
      await prisma.pkg_order.update({
        where: { id: orderId },
        data: { goods_type_id: goods.goods_type_id, goods_type_name: goods.goods_type_name, goods_type_other: goods.goods_type_other },
      });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Thanks for your feedback", data: saved });
  } catch (err) {
    logger.error("submitDriverFeedback failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Average / count of the customer->driver ratings a rider has received. */
async function getRiderRatingSummary(riderId) {
  const agg = await prisma.pkg_order.aggregate({
    where: { rid: Number(riderId), is_rate: 1 },
    _avg: { cust_rate: true },
    _count: { _all: true },
  });
  return {
    average: agg._avg.cust_rate != null ? Math.round(Number(agg._avg.cust_rate) * 10) / 10 : null,
    count: agg._count._all || 0,
  };
}

module.exports = { submitDriverFeedback, getRiderRatingSummary };
