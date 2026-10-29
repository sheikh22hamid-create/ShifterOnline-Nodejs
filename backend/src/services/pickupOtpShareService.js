const prisma = require("../config/db");
const logger = require("../utils/logger");
const { getPickupOtpTimeoutMinutes } = require("../utils/pickupOtpTimeout");
const dispatchManager = require("./dispatchManager");

// Pickup OTP share: the customer sends the pickup OTP to the assigned driver's app (spec 2026-10-29). Sharing never
// verifies the OTP (driverTripService 'verify_otp' still does); it only records that the customer was ready and
// gets the OTP onto the driver's screen. The OTP only travels over the authenticated driver API, never in a socket
// event: the socket event is just a nudge to fetch it.

const MSG = {
  SENT: "OTP sent to driver successfully.",
  NOT_ARRIVED: "You can send the OTP once the driver reaches the pickup location.",
  UNAVAILABLE: "OTP sharing is currently unavailable. Please try again.",
  FAILED: "Unable to send OTP to driver. Please try again.",
  VERIFIED: "Pickup OTP has already been verified.",
};
const ACK_WAIT_MS = 6000;
const ACK_POLL_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where this order's pickup OTP stands. `active` means the driver has reached the pickup and is waiting for the OTP
 * (order at Pickup, driver assigned, wait clock running, not verified, admin timeout not used up).
 * state: 'not_arrived' | 'verified' | 'active' | 'unavailable'.
 */
async function sessionOf(order, now = Date.now()) {
  if (!order || !(Number(order.rid) > 0)) return { state: "unavailable" };
  const status = String(order.o_status || "");
  if (status === "Cancelled" || status === "Completed" || Number(order.order_status) >= 4) return { state: "unavailable" };
  const [timer, progress] = await Promise.all([
    prisma.pkg_order_wait_timer.findFirst({ where: { order_id: order.id, rid: order.rid } }),
    prisma.driver_trip_progress.findUnique({ where: { order_id: order.id } }),
  ]);
  if (progress?.otp_verified_at) return { state: "verified", timer };
  if (Number(order.order_status) === 1) return { state: "not_arrived", timer };
  const waiting = Number(order.order_status) === 2 && status === "Pickup" && timer?.pickup_wait_start && !timer.pickup_wait_end;
  if (!waiting) return { state: Number(order.order_status) === 2 ? "not_arrived" : "unavailable", timer };
  const timeoutMs = (await getPickupOtpTimeoutMinutes()) * 60000;
  const elapsedMs = now - new Date(timer.pickup_wait_start).getTime() + (Number(timer.pickup_wait_banked_seconds) || 0) * 1000;
  if (elapsedMs >= timeoutMs) return { state: "unavailable", timer };
  return { state: "active", timer };
}

/** The latest share row of this waiting cycle (requested after the wait clock last started), or null. */
async function currentShare(orderId, timer) {
  const since = timer?.pickup_wait_start ? new Date(timer.pickup_wait_start) : null;
  return prisma.pickup_otp_share.findFirst({
    where: { order_id: orderId, ...(since ? { requested_at: { gte: since } } : {}) },
    orderBy: { id: "desc" },
  });
}

/** What the customer app needs to draw the button: can_send / shared / delivered / verified. */
async function statusForCustomer(order) {
  const session = await sessionOf(order);
  const share = session.state === "active" || session.state === "verified" ? await currentShare(order.id, session.timer) : null;
  return {
    can_send: session.state === "active",
    verified: session.state === "verified",
    shared: Boolean(share),
    delivered: share?.status === "delivered",
  };
}

async function waitForDelivery(shareId) {
  const deadline = Date.now() + ACK_WAIT_MS;
  while (Date.now() < deadline) {
    const row = await prisma.pickup_otp_share.findUnique({ where: { id: shareId } });
    if (row?.status === "delivered") return true;
    await sleep(ACK_POLL_MS);
  }
  return false;
}

/** Customer taps "Send OTP to Driver". Resolves { ok, msg } with the exact customer-facing message. */
async function share({ uid, orderId }) {
  const numericUid = Number(uid);
  const numericOrderId = Number(orderId);
  if (!Number.isSafeInteger(numericUid) || numericUid <= 0 || !Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
    return { ok: false, msg: MSG.UNAVAILABLE };
  }
  const order = await prisma.pkg_order.findUnique({ where: { id: numericOrderId } });
  // Another customer's order looks exactly like a missing one.
  if (!order || order.uid !== numericUid) return { ok: false, msg: MSG.UNAVAILABLE };

  const session = await sessionOf(order);
  if (session.state === "verified") return { ok: false, msg: MSG.VERIFIED };
  if (session.state === "not_arrived") return { ok: false, msg: MSG.NOT_ARRIVED };
  if (session.state !== "active" || !order.otp) return { ok: false, msg: MSG.UNAVAILABLE };

  // One row per waiting cycle: a repeated tap re-nudges and re-waits on the same row (no duplicate record).
  let row = await currentShare(order.id, session.timer);
  if (row && row.rider_id !== order.rid) row = null;
  if (!row) {
    row = await prisma.pickup_otp_share.create({ data: { order_id: order.id, rider_id: order.rid, uid: numericUid } });
  } else if (row.status !== "delivered") {
    row = await prisma.pickup_otp_share.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, status: "pending" } });
  }

  if (row.status !== "delivered") {
    try {
      dispatchManager.emitDriverEvent(order.rid, "pickup_otp:shared", { order_id: order.id, share_id: row.id });
    } catch (err) {
      logger.error(`pickupOtpShare: nudge to driver ${order.rid} failed for order ${order.id}:`, err);
    }
    if (!(await waitForDelivery(row.id))) {
      await prisma.pickup_otp_share.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "failed" } });
      return { ok: false, msg: MSG.FAILED };
    }
  }
  return { ok: true, msg: MSG.SENT };
}

/** Driver app asks for the OTP the customer shared. Only the order's own assigned driver gets it, and only while the session is open. */
async function pendingForDriver({ riderId, orderId }) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  if (!order || Number(order.rid) !== Number(riderId) || !order.otp) return null;
  const session = await sessionOf(order);
  if (session.state !== "active") return null;
  const row = await currentShare(order.id, session.timer);
  if (!row || row.rider_id !== Number(riderId)) return null;
  // The server itself observes this delivery: the driver's app asked for the OTP and is being given it. That counts as
  // delivered (the app's later ack only confirms it is on screen), so the outcome never rests on the ack alone.
  if (row.status !== "delivered") {
    await prisma.pickup_otp_share.updateMany({ where: { id: row.id, status: { not: "delivered" } }, data: { status: "delivered", delivered_at: new Date() } });
  }
  return { share_id: row.id, order_id: order.id, otp: String(order.otp), delivered: true };
}

/** Driver app confirms the OTP is on screen. Idempotent; a late ack still turns a failed row into delivered (fetching it already did). */
async function acknowledge({ riderId, orderId, shareId }) {
  const row = await prisma.pickup_otp_share.findUnique({ where: { id: Number(shareId) } });
  if (!row || row.order_id !== Number(orderId) || row.rider_id !== Number(riderId)) return false;
  if (row.status !== "delivered") {
    await prisma.pickup_otp_share.updateMany({ where: { id: row.id, status: { not: "delivered" } }, data: { status: "delivered", delivered_at: new Date() } });
  }
  return true;
}

// A driver who was only handed the OTP moments before the timeout had no real chance to verify it.
const DRIVER_GRACE_AFTER_DELIVERY_MS = 60000;

/**
 * What the customer did about the OTP in this waiting cycle, for the pickup timeout. The customer is never penalised
 * once they tried to share it; who bears the cost depends on what is actually known:
 *   'delivered_to_driver'  the driver's app confirmed it had the OTP, and long enough before the timeout to act: driver-side timeout
 *   'attempted'            tried, but delivery unconfirmed or too close to the timeout: neutral, nobody is charged
 *   null                   never tried: the existing customer no-show rule applies
 * Only this order's own driver's shares count. A read error answers 'attempted' (neutral, never a guess against anyone).
 */
async function shareOutcomeThisCycle(orderId, timer, riderId, now = Date.now()) {
  try {
    const row = await currentShare(Number(orderId), timer);
    if (!row || (riderId && row.rider_id !== Number(riderId))) return null;
    const delivered = row.status === "delivered" && row.delivered_at;
    if (delivered && now - new Date(row.delivered_at).getTime() >= DRIVER_GRACE_AFTER_DELIVERY_MS) return "delivered_to_driver";
    return "attempted";
  } catch (err) {
    logger.error(`pickupOtpShare: could not check shares for order ${orderId}, treating as a neutral attempt:`, err);
    return "attempted";
  }
}

module.exports = { share, pendingForDriver, acknowledge, statusForCustomer, shareOutcomeThisCycle, sessionOf, MSG };
