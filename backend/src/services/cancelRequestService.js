const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./tierPenaltyRules");
const settings = require("./tieredDispatchSettings");
const orderStage = require("./orderStageService");
const tierPenalty = require("./tierPenaltyService");
const events = require("./driverOrderEventService");
const pushNotifier = require("./pushNotifier");
const orderSearchRules = require("./orderSearchRules");
const orderSearchSettings = require("./orderSearchSettings");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/**
 * Decides what a driver-initiated cancel does (spec 3.1). "direct" = existing behaviour; "blocked" = after
 * pickup a Free/Daily driver cannot cancel; "requested" = a pending request was created (or already exists).
 */
async function gateDriverCancel({ orderId, riderId, reason }) {
  const s = await settings.getTierSettings();
  if (!s.tieredEnabled) return { mode: "direct" };

  const stage = await orderStage.getStage(orderId);
  if (!rules.isPenaltyTier(stage)) return { mode: "direct" };

  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { rid: true, uid: true, o_status: true } });
  // Not this driver's order, or already finished: let driverCancel produce its normal error / idempotent answer.
  if (!order || Number(order.rid) !== Number(riderId)) return { mode: "direct" };
  if (order.o_status === "Cancelled" || order.o_status === "Completed") return { mode: "direct" };
  if (order.o_status !== "Processing") return { mode: "blocked" };

  const pending = await prisma.order_cancel_request.findFirst({
    where: { order_id: Number(orderId), rider_id: Number(riderId), status: "pending" },
    select: { id: true },
  });
  if (pending) return { mode: "requested", requestId: pending.id, duplicate: true };

  const row = await prisma.order_cancel_request.create({
    data: { order_id: Number(orderId), rider_id: Number(riderId), tier: stage, reason: reason || null, status: "pending" },
  });
  await events.logEvent({ riderId, orderId, tier: stage, event: events.EVENTS.CANCEL_REQUESTED, reason });
  return { mode: "requested", requestId: row.id };
}

async function fcmTokenOf(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { fcm_token: true } }).catch(() => null);
  return rider?.fcm_token ?? null;
}

/** Admin approves: take the order off the driver, penalise, and re-dispatch from the next stage. */
async function approve({ requestId, adminId }) {
  const claimed = await prisma.order_cancel_request.updateMany({
    where: { id: Number(requestId), status: "pending" },
    data: { status: "approved", decided_by: adminId ?? null, decided_at: new Date() },
  });
  if (claimed.count !== 1) throw httpError(409, "This cancel request was already decided");

  const request = await prisma.order_cancel_request.findUnique({ where: { id: Number(requestId) } });
  if (!request) throw httpError(404, "Cancel request not found");
  const orderId = Number(request.order_id);
  const riderId = Number(request.rider_id);

  // Undo the accept: only while still assigned to this driver and before pickup.
  const affected = await prisma.$executeRaw`
    UPDATE pkg_order
    SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL
    WHERE id = ${orderId} AND rid = ${riderId} AND o_status = 'Processing'
  `;
  if (affected === 0) {
    await prisma.order_cancel_request.update({ where: { id: Number(requestId) }, data: { status: "stale" } });
    return { ok: false, reason: "order_state_changed" };
  }

  await prisma.driver_trip_progress.deleteMany({ where: { order_id: orderId } });
  // Marked as a reject so the cascade never offers this order to the same driver again.
  await prisma.tbl_order_requests.updateMany({ where: { order_id: orderId, rider_id: riderId, status: "accepted" }, data: { status: "10" } });

  const penalty = await tierPenalty.applyCancelPenalty({ orderId, riderId, tier: request.tier });
  if (penalty?.penalty?.id) {
    await prisma.order_cancel_request.update({ where: { id: Number(requestId) }, data: { penalty_id: penalty.penalty.id } });
  }

  if (request.tier === rules.TIER.FREE) {
    // The free vehicle did not take the trip: no refund.
    await prisma.free_booking_order.updateMany({
      where: { order_id: orderId, status: "FREE_BOOKING_CONFIRMED" },
      data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "vehicle_changed", accepted_in_pool: false, pool_rider_id: null },
    });
  }
  await events.logEvent({ riderId, orderId, tier: request.tier, event: events.EVENTS.CANCELLED, reason: "admin approved cancel request" });

  let order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  const dispatchManager = require("./dispatchManager");
  dispatchManager.emitCustomerEvent(order?.uid, "order:driver_unassigned", { order_id: String(orderId) });

  const nextStage = rules.nextStage(request.tier);
  const earlierStageRiderIds = await orderStage.offeredRiderIds(orderId);
  if (orderSearchRules.isSystem2Order(order)) {
    // System 2: the driver cancelled after the first window ended, so the order gets a fresh search window.
    try {
      const city = await orderSearchSettings.getCitySettings(order.city_id);
      const deadline = orderSearchRules.searchDeadline(new Date(), city.driverSearchSeconds);
      await prisma.pkg_order.update({ where: { id: orderId }, data: { search_deadline_at: deadline } });
      order = { ...order, search_deadline_at: deadline };
    } catch (err) {
      logger.error(`cancelRequestService.approve: could not refresh the search window for order ${orderId}:`, err);
    }
  }
  await dispatchManager.startDispatch(order, null, { stage: nextStage, earlierStageRiderIds });

  const token = await fcmTokenOf(riderId);
  Promise.resolve(pushNotifier.notifyDriverCancelDecision(token, { orderId, approved: true })).catch((err) =>
    logger.error(`cancelRequestService.approve: push failed for rider ${riderId}:`, err)
  );
  return { ok: true, nextStage, penalty };
}

async function reject({ requestId, adminId }) {
  const claimed = await prisma.order_cancel_request.updateMany({
    where: { id: Number(requestId), status: "pending" },
    data: { status: "rejected", decided_by: adminId ?? null, decided_at: new Date() },
  });
  if (claimed.count !== 1) throw httpError(409, "This cancel request was already decided");
  const request = await prisma.order_cancel_request.findUnique({ where: { id: Number(requestId) } });
  if (request) {
    await events.logEvent({ riderId: request.rider_id, orderId: request.order_id, tier: request.tier, event: events.EVENTS.CANCEL_REJECTED });
    const token = await fcmTokenOf(request.rider_id);
    Promise.resolve(pushNotifier.notifyDriverCancelDecision(token, { orderId: request.order_id, approved: false })).catch((err) =>
      logger.error(`cancelRequestService.reject: push failed for rider ${request.rider_id}:`, err)
    );
  }
  return { ok: true };
}

/** Admin list; cityId null = every city (superadmin). */
async function listRequests({ status = "pending", cityId = null }) {
  if (cityId == null) {
    return prisma.$queryRaw`
      SELECT r.id, r.order_id, r.rider_id, r.tier, r.reason, r.status, r.created_at, r.decided_at, r.penalty_id,
             rd.full_name AS rider_name, o.city_id
      FROM order_cancel_request r
      JOIN pkg_order o ON o.id = r.order_id
      LEFT JOIN tbl_rider rd ON rd.id = r.rider_id
      WHERE r.status = ${status}
      ORDER BY r.id DESC LIMIT 200`;
  }
  return prisma.$queryRaw`
    SELECT r.id, r.order_id, r.rider_id, r.tier, r.reason, r.status, r.created_at, r.decided_at, r.penalty_id,
           rd.full_name AS rider_name, o.city_id
    FROM order_cancel_request r
    JOIN pkg_order o ON o.id = r.order_id
    LEFT JOIN tbl_rider rd ON rd.id = r.rider_id
    WHERE r.status = ${status} AND o.city_id = ${Number(cityId)}
    ORDER BY r.id DESC LIMIT 200`;
}

module.exports = { gateDriverCancel, approve, reject, listRequests };
