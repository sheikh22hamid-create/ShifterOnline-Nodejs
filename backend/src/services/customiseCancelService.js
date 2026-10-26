const prisma = require("../config/db");
const logger = require("../utils/logger");
const dispatchManager = require("./dispatchManager");
const pushNotifier = require("./pushNotifier");
const orderService = require("./customiseOrderService");
const cancelPolicy = require("./customiseCancelPolicy");

// The Customise Order side of a cancelled ride (spec 2026-10-26, sections 13-14). The ride itself is cancelled by
// tripLifecycle with the usual refunds; this module (a) tells it which penalty applies, (b) writes the audit row, and
// (c) moves the negotiation: a driver cancel puts the SAME order back in the normal list for other drivers (the
// cancelling driver is dismissed from it), a customer cancel closes it for good. Nothing here throws.

const num = (v) => (v == null ? 0 : Number(v));

/** { customiseOrderId, agreedFare, cityId } when this ride came from a Customise Order, else null. */
async function rideInfo(rideId) {
  try {
    const ride = await prisma.pkg_order.findUnique({ where: { id: Number(rideId) }, select: { customise_order_id: true, total_dcharge: true, city_id: true } });
    if (!ride || ride.customise_order_id == null) return null;
    return { customiseOrderId: Number(ride.customise_order_id), agreedFare: num(ride.total_dcharge), cityId: ride.city_id ?? null };
  } catch (err) {
    logger.error(`customiseCancel.rideInfo(${rideId}) failed, treating as a normal ride:`, err);
    return null;
  }
}

/** { special: false } = keep the rate-card fee; otherwise the Special penalty and its split. */
async function feeFor({ side, ride }) {
  const policy = await cancelPolicy.getPolicy(side, ride.cityId);
  if (policy.mode !== "special") return { special: false };
  return { special: true, fixed: policy.fixed, percent: policy.percent, ...cancelPolicy.penaltyOf(policy, ride.agreedFare) };
}

/** One audit row per (ride, side); a repeat is ignored. Runs on the caller's client so it joins their transaction. */
async function recordFee(client, f) {
  try {
    await client.customise_cancel_fee.create({
      data: {
        order_id: f.orderId, ride_id: f.rideId, side: f.side, mode: f.mode, payer_id: f.payerId, recipient_id: f.recipientId ?? null,
        agreed_fare: f.agreedFare, fixed: f.fixed, percent: f.percent, charge: f.charge, admin_share: f.adminShare,
        recipient_amount: f.recipientAmount, reason: f.reason ? String(f.reason).slice(0, 255) : null,
      },
    });
  } catch (err) {
    if (err?.code !== "P2002") logger.error(`customiseCancel.recordFee ride ${f.rideId}/${f.side} failed:`, err);
  }
}

const lockOrder = async (tx, id) => (await tx.$queryRaw`SELECT * FROM customise_order WHERE id = ${Number(id)} FOR UPDATE`)[0] || null;

/** The ride that was assigned from this order is the one being cancelled (guards double taps and stale calls). */
const isCurrentRide = (order, rideId, riderId) =>
  order && order.status === "converted" && Number(order.pkg_order_id) === Number(rideId) && (riderId == null || Number(order.agreed_rider_id) === Number(riderId));

async function afterDriverCancel({ customiseOrderId, riderId, rideId, reason, now = new Date() }) {
  try {
    let order = null;
    let relisted = false;
    const applied = await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, customiseOrderId);
      if (!isCurrentRide(locked, rideId, riderId)) return false;
      order = locked;
      relisted = now.getTime() < new Date(locked.expires_at).getTime();
      if (relisted) {
        const key = { order_id: Number(customiseOrderId), rider_id: Number(riderId) };
        await tx.customise_dismissal.upsert({ where: { order_id_rider_id: key }, create: key, update: {} });
        await tx.customise_order.update({
          where: { id: Number(customiseOrderId) },
          data: { status: "open", agreed_fare: null, agreed_rider_id: null, agreed_offer_id: null, pkg_order_id: null },
        });
      } else {
        await tx.customise_order.update({ where: { id: Number(customiseOrderId) }, data: { status: "expired" } });
      }
      await orderService.logEvent(tx, Number(customiseOrderId), "driver_cancelled", Number(riderId), {
        pkg_order_id: Number(rideId), fare: num(locked.agreed_fare), relisted, reason: reason || null,
      });
      return true;
    });
    if (!applied) return { ok: false, relisted: false };

    if (relisted) {
      notifyRelisted(order, now).catch((err) => logger.error(`customiseCancel: relist notify for order ${customiseOrderId} failed:`, err));
    }
    return { ok: true, relisted };
  } catch (err) {
    logger.error(`customiseCancel.afterDriverCancel order ${customiseOrderId} failed:`, err);
    return { ok: false, relisted: false };
  }
}

async function notifyRelisted(order, now) {
  dispatchManager.emitCustomerEvent(order.uid, "customise:relisted", { order_id: order.id });
  const user = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
  if (user?.fcm_token) await pushNotifier.notifyCustomerCustomiseRelisted(user.fcm_token, { orderId: order.id });
  const round = await prisma.customise_event.count({ where: { order_id: order.id, type: "driver_cancelled" } });
  await orderService.notifyEligible({ ...order, status: "open", agreed_rider_id: null, pkg_order_id: null }, { now, round });
}

async function afterCustomerCancel({ customiseOrderId, rideId, now = new Date() }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, customiseOrderId);
      if (!isCurrentRide(locked, rideId, null)) return { ok: false };
      await tx.customise_order.update({ where: { id: Number(customiseOrderId) }, data: { status: "cancelled" } });
      await orderService.logEvent(tx, Number(customiseOrderId), "customer_cancelled_after_assignment", Number(locked.agreed_rider_id), {
        pkg_order_id: Number(rideId), fare: num(locked.agreed_fare),
      });
      return { ok: true };
    });
  } catch (err) {
    logger.error(`customiseCancel.afterCustomerCancel order ${customiseOrderId} failed:`, err);
    return { ok: false };
  }
}

module.exports = { rideInfo, feeFor, recordFee, afterDriverCancel, afterCustomerCancel };
