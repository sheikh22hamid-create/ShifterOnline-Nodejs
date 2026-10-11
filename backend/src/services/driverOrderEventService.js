const prisma = require("../config/db");
const logger = require("../utils/logger");

const EVENTS = Object.freeze({
  OFFERED: "offered",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  SKIPPED: "skipped",
  SUPERSEDED: "superseded",
  COMPLETED: "completed",
  CANCEL_REQUESTED: "cancel_requested",
  CANCELLED: "cancelled",
  CANCEL_REJECTED: "cancel_rejected",
  PENALTY: "penalty",
  PENALTY_WAIVED: "penalty_waived",
  COUNTER_RESET: "counter_reset",
});

/**
 * Best-effort driver/order event for the Driver Performance report. Never throws: a failed log write
 * must not break dispatch, accept, reject or completion.
 */
async function logEvent({ riderId, orderId, tier = null, event, reason = null, penaltyPct = null, penaltyAmount = null, missNo = null }) {
  try {
    return await prisma.driver_order_event.create({
      data: {
        rider_id: Number(riderId),
        order_id: Number(orderId),
        tier: tier || "normal",
        event,
        reason: reason == null ? null : String(reason).slice(0, 255),
        penalty_pct: penaltyPct,
        penalty_amount: penaltyAmount,
        miss_no: missNo,
      },
    });
  } catch (err) {
    logger.error(`driverOrderEventService.logEvent failed (order ${orderId}, rider ${riderId}, ${event}):`, err);
    return null;
  }
}

module.exports = { EVENTS, logEvent };
