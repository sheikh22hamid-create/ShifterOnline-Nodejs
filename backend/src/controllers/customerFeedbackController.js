const prisma = require("../config/db");
const logger = require("../utils/logger");

const RATING_FIELDS = {
  driver_rating: "driver_rating",
  delivery_rating: "delivery_rating",
  vehicle_rating: "vehicle_rating",
};

function parseRating(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Customer's post-trip feedback form: rate the driver, delivery speed, vehicle,
 * select quick tags, and leave an optional comment.
 */
async function submitCustomerFeedback(req, res) {
  try {
    const orderId = Number(req.body?.order_id);
    const uid = Number(req.body?.uid);
    let riderId = Number(req.body?.rider_id);

    if (!orderId || !uid) {
      return res.status(400).json({
        ResponseCode: "400",
        Result: "false",
        ResponseMsg: "order_id and uid are required",
      });
    }

    const order = await prisma.pkg_order.findFirst({
      where: { id: orderId, uid },
    });

    if (!order) {
      return res.status(404).json({
        ResponseCode: "404",
        Result: "false",
        ResponseMsg: "Order not found for this customer",
      });
    }

    if (!riderId) {
      riderId = Number(order.rid) || 0;
    }

    const data = {};
    for (const [bodyKey, column] of Object.entries(RATING_FIELDS)) {
      if (req.body?.[bodyKey] === undefined) continue;
      const parsed = parseRating(req.body[bodyKey]);
      if (!parsed.ok) {
        return res.status(400).json({
          ResponseCode: "400",
          Result: "false",
          ResponseMsg: `${bodyKey} must be between 1 and 5`,
        });
      }
      data[column] = parsed.value;
    }

    if (req.body?.feedback_tags !== undefined && req.body.feedback_tags !== null) {
      const tags = Array.isArray(req.body.feedback_tags)
        ? req.body.feedback_tags.filter(Boolean).join(", ")
        : String(req.body.feedback_tags).trim();
      data.feedback_tags = tags.slice(0, 255);
    }

    if (req.body?.comment !== undefined && req.body.comment !== null) {
      data.comment = String(req.body.comment).trim();
    }

    const saved = await prisma.order_customer_feedback.upsert({
      where: { order_id: orderId },
      create: {
        order_id: orderId,
        rider_id: riderId,
        uid: order.uid,
        ...data,
      },
      update: data,
    });

    // Also update pkg_order rating so legacy queries and rider rating summary stay in sync
    const starRate = data.driver_rating || order.cust_rate;
    const commentText = data.comment || order.cust_comment;
    await prisma.pkg_order.update({
      where: { id: orderId },
      data: {
        is_rate: 1,
        ...(starRate ? { cust_rate: starRate } : {}),
        ...(commentText ? { cust_comment: commentText } : {}),
      },
    });

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Thanks for your feedback!",
      data: saved,
    });
  } catch (err) {
    logger.error("submitCustomerFeedback failed:", err);
    return res.status(500).json({
      ResponseCode: "500",
      Result: "false",
      ResponseMsg: "Internal server error",
    });
  }
}

module.exports = { submitCustomerFeedback };
