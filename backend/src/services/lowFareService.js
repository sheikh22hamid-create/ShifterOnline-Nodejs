const prisma = require("../config/db");
const logger = require("../utils/logger");
const dispatchManager = require("./dispatchManager");
const lowFareRules = require("./lowFareRules");

// Low Fare Booking, driver side (spec 2026-10-27). A low_fare order is open to drivers of its vehicle category from the
// customer's window start until the window end. Exactly one driver wins an accept: a conditional UPDATE on the server
// clock claims the order, then the existing acceptOrder path does pricing, advance payment and notifications. Of any
// number of simultaneous accepts one proceeds; the rest answer "Already Attended".
// tripLifecycle is required lazily: it reaches back into services that load this module.
const tripLifecycle = () => require("./tripLifecycle");

const EXPIRE_REASON = "No driver accepted in the booking window";
const LIST_FIELDS = {
  id: true, category: true, paddress: true, daddress: true, plat: true, plong: true, dlat: true, dlong: true,
  distance: true, total_dcharge: true, description: true, pick_name: true, drop_name: true, schedule_date_time: true,
  next_day_live_at: true, next_day_live_until: true, next_day_model1_fare: true, next_day_discount_percent: true,
  package_weight: true, odate: true,
};

const fail = (msg) => ({ ok: false, msg });
const openWhere = (now) => ({
  booking_type: 3, next_day_stage: "low_fare", rid: 0, order_status: 0, o_status: "Pending",
  next_day_live_at: { lte: now }, next_day_live_until: { gt: now },
});

/** The rider, if they may take Low Fare orders at all (approved and active). */
async function eligibleRider(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) } });
  if (!rider || rider.status !== 1 || rider.verification_status !== "approved") return null;
  return rider;
}

async function cancelledByRider(riderId, orderIds) {
  if (!orderIds.length) return new Set();
  const rows = await prisma.order_status_history.findMany({
    where: { rider_id: Number(riderId), status: "Driver Cancelled", order_id: { in: orderIds } },
    select: { order_id: true },
  });
  return new Set(rows.map((r) => r.order_id));
}

/** Orders this driver may see right now: open window, their vehicle category, not one they cancelled before. */
async function visibleOrders(rider, now) {
  const orders = await prisma.pkg_order.findMany({
    where: { ...openWhere(now), category: String(rider.vehicle || "").trim() },
    select: LIST_FIELDS,
    orderBy: { next_day_live_until: "asc" },
  });
  const excluded = await cancelledByRider(rider.id, orders.map((o) => o.id));
  return orders.filter((o) => !excluded.has(o.id) && lowFareRules.isOpenNow({ ...o, next_day_stage: "low_fare" }, now));
}

async function listForDriver(riderId, now = new Date()) {
  const rider = await eligibleRider(riderId);
  if (!rider) return [];
  const orders = await visibleOrders(rider, now);
  const seen = await prisma.low_fare_view.findMany({ where: { rider_id: rider.id, order_id: { in: orders.map((o) => o.id) } }, select: { order_id: true } });
  const seenIds = new Set(seen.map((s) => s.order_id));
  return orders.map((o) => ({ ...o, unread: !seenIds.has(o.id) }));
}

/** Unread = listed to this driver and not yet opened. Fails closed to 0. */
async function countForDriver(riderId, now = new Date()) {
  try {
    return (await listForDriver(riderId, now)).filter((o) => o.unread).length;
  } catch (err) {
    logger.warn(`lowFare.count: rider ${riderId} treated as 0 (${err.message})`);
    return 0;
  }
}

async function markSeen(riderId, orderIds) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { ok: true };
  await prisma.low_fare_view.createMany({ data: ids.map((order_id) => ({ rider_id: Number(riderId), order_id })), skipDuplicates: true });
  return { ok: true };
}

async function accept(orderId, riderId, now = new Date()) {
  orderId = Number(orderId);
  riderId = Number(riderId);
  const rider = await eligibleRider(riderId);
  if (!rider) return fail("Your account cannot take this order");
  if (rider.a_status !== 1) return fail("Go online to accept this order");

  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!order || order.booking_type !== 3 || order.next_day_stage !== "low_fare") return fail("This order is no longer available");
  if (String(order.category).trim().toLowerCase() !== String(rider.vehicle || "").trim().toLowerCase()) return fail("This order is for a different vehicle");
  if ((await cancelledByRider(riderId, [orderId])).has(orderId)) return fail("You cancelled this order earlier");

  const busy = await prisma.pkg_order.count({
    where: { rid: riderId, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
  });
  if (busy) return fail("You already have an active trip");

  // The claim: only a still-unassigned, still-open order can be won, and only once.
  const claimed = await prisma.$executeRaw`
    UPDATE pkg_order SET rid = ${riderId}, order_status = 1, o_status = 'Processing', accept_time = ${now}
    WHERE id = ${orderId} AND rid = 0 AND order_status = 0 AND o_status = 'Pending' AND booking_type = 3
      AND next_day_stage = 'low_fare' AND next_day_live_at <= ${now} AND next_day_live_until > ${now}`;
  if (claimed !== 1) {
    const current = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { rid: true, o_status: true } });
    if (current && current.rid !== 0 && current.rid !== riderId) return fail("Already Attended");
    if (current && current.rid === riderId) return { ok: true, order_id: orderId };
    return fail("This order is no longer available");
  }

  try {
    const accepted = await tripLifecycle().acceptOrder(orderId, riderId);
    if (!accepted.success) throw new Error(accepted.msg || "could not assign");
  } catch (err) {
    // Hand the order back so another driver can still take it.
    await prisma.$executeRaw`UPDATE pkg_order SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL WHERE id = ${orderId} AND rid = ${riderId} AND order_status = 1`;
    logger.error(`lowFare.accept: order ${orderId} rider ${riderId} reverted:`, err);
    return fail("Could not complete the booking, please try again");
  }
  notifyTaken(order, riderId).catch((err) => logger.error(`lowFare.accept: notifyTaken failed for ${orderId}:`, err));
  return { ok: true, order_id: orderId };
}

/** Tell the eligible, online drivers (except the ones who cancelled this order) that an order is open. */
async function notifyNew(order) {
  const riders = await prisma.tbl_rider.findMany({
    where: { status: 1, a_status: 1, verification_status: "approved", vehicle: String(order.category || "").trim() },
    select: { id: true },
  });
  const cancelled = await prisma.order_status_history.findMany({ where: { order_id: order.id, status: "Driver Cancelled" }, select: { rider_id: true } });
  const skip = new Set(cancelled.map((c) => c.rider_id));
  new Set(riders.map((r) => r.id)).forEach((id) => {
    if (!skip.has(id)) dispatchManager.emitDriverEvent(id, "lowfare:new", { order_id: order.id });
  });
}

async function notifyTaken(order, winnerId) {
  const riders = await prisma.tbl_rider.findMany({
    where: { status: 1, verification_status: "approved", vehicle: String(order.category || "").trim() },
    select: { id: true },
  });
  riders.forEach((r) => {
    if (r.id !== Number(winnerId)) dispatchManager.emitDriverEvent(r.id, "lowfare:closed", { order_id: order.id, reason: "taken" });
  });
}

/** True for a low_fare order whose booking window has not ended: a driver cancel then reopens it instead of ending it. */
async function isOpenLowFareOrder(orderId, now = new Date()) {
  try {
    const order = await prisma.pkg_order.findUnique({
      where: { id: Number(orderId) },
      select: { booking_type: true, next_day_stage: true, next_day_live_until: true },
    });
    return Boolean(order && order.booking_type === 3 && order.next_day_stage === "low_fare" && order.next_day_live_until && new Date(order.next_day_live_until) > now);
  } catch (err) {
    logger.warn(`lowFare.isOpenLowFareOrder: order ${orderId} treated as a normal order (${err.message})`);
    return false;
  }
}

/** After the cancelling driver was dropped and the order put back to Pending: tell the customer, then the other drivers. */
async function afterReopen({ orderId, riderId, reason }) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  if (!order) return;
  try {
    dispatchManager.emitCustomerEvent(order.uid, "order:driver_cancelled", {
      order_id: order.id, rider_id: riderId, refund_amount: 0, refund_status: "order_relive",
      reason: reason || "Driver cancelled the ride", order_status: 0, o_status: "Pending", searching_for_new_driver: true,
    });
  } catch (err) {
    logger.error(`lowFare.afterReopen: customer event for order ${orderId} failed:`, err);
  }
  await notifyNew(order).catch((err) => logger.error(`lowFare.afterReopen: drivers of order ${orderId} not notified:`, err));
}

/** Cancel every low_fare order whose window ended with nobody assigned; each is cancelled once. */
async function expireDue(now = new Date()) {
  const due = await prisma.pkg_order.findMany({
    where: { booking_type: 3, next_day_stage: "low_fare", rid: 0, order_status: 0, o_status: "Pending", next_day_live_until: { lte: now } },
    select: { id: true, uid: true, category: true },
  });
  let expired = 0;
  for (const order of due) {
    const moved = await prisma.$executeRaw`
      UPDATE pkg_order SET o_status = 'Cancelled', order_status = 4, cancel_reason = ${EXPIRE_REASON}
      WHERE id = ${order.id} AND rid = 0 AND order_status = 0 AND o_status = 'Pending' AND next_day_stage = 'low_fare'`;
    if (moved !== 1) continue;
    expired += 1;
    try {
      dispatchManager.emitCustomerEvent(order.uid, "order:cancelled", { order_id: order.id, o_status: "Cancelled", reason: EXPIRE_REASON });
    } catch (err) {
      logger.error(`lowFare.expireDue: customer notify failed for order ${order.id}:`, err);
    }
  }
  return expired;
}

module.exports = { listForDriver, countForDriver, markSeen, accept, notifyNew, notifyTaken, isOpenLowFareOrder, afterReopen, expireDue, EXPIRE_REASON };
