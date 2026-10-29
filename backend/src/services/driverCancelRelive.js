const prisma = require("../config/db");
const logger = require("../utils/logger");
const orderSearchSettings = require("./orderSearchSettings");
const orderSearchRules = require("./orderSearchRules");

// Re-live an order after its driver cancelled (spec 2026-10-27). Instead of ending the booking, the SAME order goes
// back to Pending and is searched again for other drivers: same order id, same pickup/drop/vehicle/radius, and the
// customer's payment stays on the order (nothing is refunded and re-charged). The cancelling driver keeps their
// cancellation fee and is never offered this order again (their request row becomes "10", which the dispatch
// cascade treats as a reject). This mirrors what an admin-approved cancel already does for Free/Daily drivers.
// dispatchManager is required lazily: it reaches back into tripLifecycle.
const dispatchManager = () => require("./dispatchManager");

const SETTING_KEY = "driver_cancel_relive_enabled";
const MAX_RELIVES_PER_ORDER = 3; // after this many driver cancels the booking ends the normal way (with its refund)
// Assigned but goods not on board yet: Processing (1) or Pickup (2). Once the trip is on its way (3) nothing is re-searched.
const PRE_PICKUP_STATUS = new Set([1, 2]);
const PRE_PICKUP_O_STATUS = new Set(["processing", "pickup"]);

class NotReliveable extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** On unless an admin sets app_settings `driver_cancel_relive_enabled` to 0/false/off. Fails closed on any read error. */
async function isEnabled() {
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: SETTING_KEY } });
    const v = String(row?.setting_value ?? "").trim().toLowerCase();
    return !["0", "false", "off", "no"].includes(v);
  } catch (err) {
    logger.warn(`driverCancelRelive.isEnabled: treating as off (${err.message})`);
    return false;
  }
}

/**
 * ONE transaction: lock the order, check it is still assigned to this driver and before pickup, put it back to the
 * unassigned Pending state and run `inTx(tx, order)` for the caller's driver-side effects (fee, request row, trip
 * state). Any failure rolls everything back and resolves { relived: false, reason }; it never throws.
 */
async function reopenForRelive({ orderId, riderId, inTx, maxRelives = MAX_RELIVES_PER_ORDER }) {
  orderId = Number(orderId);
  riderId = Number(riderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const order = (await tx.$queryRaw`
        SELECT id, uid, rid, order_status, o_status, delivery_type, city_id, search_system, search_deadline_at
        FROM pkg_order WHERE id = ${orderId} FOR UPDATE`)[0];
      if (!order || Number(order.rid) !== riderId) throw new NotReliveable("not_assigned_driver");
      if (!PRE_PICKUP_STATUS.has(Number(order.order_status)) || !PRE_PICKUP_O_STATUS.has(String(order.o_status || "").trim().toLowerCase())) {
        throw new NotReliveable("not_before_pickup");
      }
      const earlier = await tx.order_status_history.count({ where: { order_id: orderId, status: "Driver Cancelled" } });
      if (earlier >= maxRelives) throw new NotReliveable("relive_limit_reached");
      const moved = await tx.$executeRaw`
        UPDATE pkg_order SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL
        WHERE id = ${orderId} AND rid = ${riderId} AND o_status NOT IN ('Completed', 'Cancelled')`;
      if (moved !== 1) throw new NotReliveable("order_changed");
      if (inTx) await inTx(tx, order);
      return { relived: true, order };
    });
  } catch (err) {
    if (!(err instanceof NotReliveable)) logger.error(`driverCancelRelive: order ${orderId} not relived, taking the normal cancel path:`, err);
    return { relived: false, reason: err instanceof NotReliveable ? err.reason : "error" };
  }
}

/**
 * After the reopen commits: tell the customer, give a System 2 search a fresh window, and start the driver search
 * again. Best-effort: the reopen already stands, so each step is logged on failure and never thrown.
 */
async function afterRelive({ orderId, riderId, reason }) {
  let order = null;
  try {
    order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  } catch (err) {
    logger.error(`driverCancelRelive.afterRelive: order ${orderId} unreadable:`, err);
  }
  if (!order) return;
  try {
    dispatchManager().emitCustomerEvent(order.uid, "order:driver_cancelled", {
      order_id: orderId,
      rider_id: riderId,
      refund_amount: 0,
      refund_status: "order_relive",
      reason: reason || "Driver cancelled the ride",
      order_status: 0,
      o_status: "Pending",
      searching_for_new_driver: true,
    });
  } catch (err) {
    logger.error(`driverCancelRelive.afterRelive: customer event for order ${orderId} failed:`, err);
  }
  if (orderSearchRules.isSystem2Order(order)) {
    try {
      const city = await orderSearchSettings.getCitySettings(order.city_id);
      const deadline = orderSearchRules.searchDeadline(new Date(), city.driverSearchSeconds);
      await prisma.pkg_order.update({ where: { id: Number(orderId) }, data: { search_deadline_at: deadline } });
      order = { ...order, search_deadline_at: deadline };
    } catch (err) {
      logger.error(`driverCancelRelive.afterRelive: search window for order ${orderId} not refreshed:`, err);
    }
  }
  try {
    await dispatchManager().startDispatch(order, null);
  } catch (err) {
    logger.error(`driverCancelRelive.afterRelive: driver search for order ${orderId} not restarted:`, err);
  }
}

module.exports = { isEnabled, reopenForRelive, afterRelive, MAX_RELIVES_PER_ORDER, SETTING_KEY };
