const prisma = require("../config/db");
const logger = require("../utils/logger");

// Append-only fare log behind the customer's "View full breakdown". It records
// what the existing pricing already computed - it never prices anything - and
// every write is best-effort: a missing table (migration not applied yet) or a
// failed insert is logged and swallowed so booking, driver assignment and the
// pickup/drop/stop edits behave exactly as before.

const KIND = {
  ORIGINAL: "original",
  DRIVER_ASSIGNED: "driver_assigned",
  PICKUP_CHANGE: "pickup_change",
  DROP_CHANGE: "drop_change",
  STOP_ADDED: "stop_added",
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The fare booked at confirmation. Only the first call per order writes. */
async function recordOriginal(orderId, fare, client = prisma) {
  try {
    const existing = await client.pkg_order_fare_history.findFirst({ where: { order_id: orderId }, select: { id: true } });
    if (existing) return;
    await client.pkg_order_fare_history.create({
      data: { order_id: orderId, kind: KIND.ORIGINAL, reason: "Original booking fare", amount_diff: 0, new_total: round2(fare) },
    });
  } catch (err) {
    logger.error(`orderFareHistory.recordOriginal failed for order ${orderId}:`, err);
  }
}

/**
 * One fare change. [oldFare] is the fare before the change; if the order has no
 * history yet (created before this feature) it becomes the "original" row so the
 * list still adds up. A zero-difference driver assignment is not worth a row.
 */
async function recordChange({ orderId, kind, reason, oldFare, newFare, client = prisma }) {
  try {
    const diff = round2(Number(newFare) - Number(oldFare));
    if (kind === KIND.DRIVER_ASSIGNED && diff === 0) return;
    await recordOriginal(orderId, oldFare, client);
    await client.pkg_order_fare_history.create({
      data: { order_id: orderId, kind, reason: String(reason || kind).slice(0, 255), amount_diff: diff, new_total: round2(newFare) },
    });
  } catch (err) {
    logger.error(`orderFareHistory.recordChange failed for order ${orderId} (${kind}):`, err);
  }
}

/** Chronological entries for the customer app; [] when there are none. */
async function getHistory(orderId, client = prisma) {
  try {
    const rows = await client.pkg_order_fare_history.findMany({ where: { order_id: orderId }, orderBy: { id: "asc" } });
    return rows.map((r) => ({
      kind: r.kind,
      reason: r.reason,
      amount_diff: Number(r.amount_diff),
      new_total: Number(r.new_total),
      created_at: r.created_at,
    }));
  } catch (err) {
    logger.error(`orderFareHistory.getHistory failed for order ${orderId}:`, err);
    return [];
  }
}

module.exports = { KIND, recordOriginal, recordChange, getHistory };
