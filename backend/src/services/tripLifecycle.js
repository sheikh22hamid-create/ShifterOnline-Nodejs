const prisma = require("../config/db");
const dispatchManager = require("./dispatchManager");
const lockManager = require("./lockManager");
const pricingEngine = require("./pricingEngine");
const pushNotifier = require("./pushNotifier");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");
const { POPUP_TIMEOUT_MS } = require("../config/constants");

function notifyAdminStatus(order) {
  try {
    adminSocket.notifyOrderStatusUpdate(order);
  } catch (err) {
    logger.error(`notifyAdminStatus failed for order ${order?.id}:`, err);
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Thrown inside acceptOrder's transaction to trigger a rollback and select
 * which clean failure message to return. Never escapes acceptOrder itself.
 */
class OfferNotFreshError extends Error {}
class OrderAlreadyTakenError extends Error {}

/**
 * Atomic first-come-first-served acceptance (spec §4.5), gated on the
 * accepted offer's own freshness — never the in-memory setTimeout, which is
 * lost on crash/restart. Two atomic conditional UPDATEs run inside one DB
 * transaction, so either both apply or neither does:
 *   1. tbl_order_requests: claims THIS rider's offer for THIS order, only if
 *      it is still 'sent' and less than POPUP_TIMEOUT_MS old — per MySQL's
 *      own NOW(), not the Node process clock, so a crashed/restarted server
 *      can never make a stale offer acceptable again.
 *   2. pkg_order: claims the booking, only if still unassigned/searchable.
 * Whichever UPDATE's WHERE clause a concurrent expiry-sweep or a competing
 * accept fails to match affects 0 rows — InnoDB's row lock on the same
 * request row is what makes "accept vs. expiry at the same instant"
 * deterministic, with no extra app-level locking needed.
 */
async function acceptOrder(orderId, riderId) {
  const popupSeconds = POPUP_TIMEOUT_MS / 1000;
  let acceptedPackageId = null;

  try {
    await prisma.$transaction(async (tx) => {
      const requestAffected = await tx.$executeRaw`
        UPDATE tbl_order_requests
        SET status = 'accepted'
        WHERE order_id = ${orderId}
          AND rider_id = ${riderId}
          AND status = 'sent'
          AND created_at > (NOW() - INTERVAL ${popupSeconds} SECOND)
      `;
      if (requestAffected === 0) {
        throw new OfferNotFreshError();
      }

      // The offer we just claimed carries the exact package/model the
      // driver actually saw — pkg_order.delivery_type may have since been
      // overwritten by a later tier's batch, so it is never used here.
      const acceptedRequest = await tx.tbl_order_requests.findFirst({
        where: { order_id: orderId, rider_id: riderId, status: "accepted" },
        orderBy: { id: "desc" },
      });
      acceptedPackageId = acceptedRequest.package_id;

      const orderAffected = await tx.$executeRaw`
        UPDATE pkg_order
        SET rid = ${riderId},
            order_status = 1,
            o_status = 'Processing',
            accept_time = NOW()
        WHERE id = ${orderId} AND rid = 0 AND order_status = 0 AND o_status != 'Cancelled'
      `;
      if (orderAffected === 0) {
        throw new OrderAlreadyTakenError();
      }
    });
  } catch (err) {
    if (err instanceof OfferNotFreshError) {
      // Non-authoritative — only to produce a more specific message than
      // the rollback alone gives us. Correctness never depends on this read.
      const requestRow = await prisma.tbl_order_requests.findFirst({
        where: { order_id: orderId, rider_id: riderId },
        orderBy: { id: "desc" },
      });
      if (requestRow && requestRow.status === "sent") {
        return { success: false, msg: "Offer expired" };
      }
      return { success: false, msg: "Order already taken or cancelled" };
    }
    if (err instanceof OrderAlreadyTakenError) {
      return { success: false, msg: "Order already taken or cancelled" };
    }
    throw err;
  }

  // Only reached once the transaction above has actually committed — an
  // accept that lost the race (OrderAlreadyTakenError) never reaches here,
  // so this can't wrongly reset the streak for an attempt that didn't
  // really succeed.
  await dispatchManager.recordModel1Outcome(riderId, acceptedPackageId, "accept");

  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  const { pkg, fare, driverEarning, commission } = await pricingEngine.priceForPackageId(
    acceptedPackageId,
    Number(order.distance) || 0
  );

  const priced = { d_charge: fare, total_dcharge: fare, delivery_type: Number(acceptedPackageId), driver_earning: driverEarning, commission };
  await prisma.pkg_order.update({ where: { id: orderId }, data: priced });

  // Release this rider's own popup lock, then dismiss every OTHER driver
  // still holding a popup for this order and cancel remaining timers.
  lockManager.releaseLock(riderId);
  dispatchManager.stopDispatch(orderId, "accepted_by_other");

  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  notifyAdminStatus(order);

  const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
  await pushNotifier.notifyCustomerOrderAssigned(customer?.fcm_token, {
    order_id: orderId,
    rider_name: `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
    rider_phone: rider.fmobile,
    vehicle_no: rider.vehicle_no,
    otp: order.otp,
  });

  return {
    success: true,
    order: { ...order, ...priced, package: pkg },
    rider,
  };
}

async function rejectOrder(orderId, riderId) {
  // Scoped to the rider's CURRENT lock's own packageId, not just orderId: a
  // rider can legitimately move on to a newer tier of this same order
  // before an in-flight reject for an OLDER tier's popup gets processed
  // here (client/network latency, a reconnect resend, an app that fires
  // its own delayed dismiss). Matching only orderId — as an earlier version
  // of this code did — let a stale reject wrongly flip the NEWER tier's
  // still-legitimately-'sent' row to rejected, permanently excluding the
  // rider from every later tier over an offer they never actually saw
  // (confirmed live on order #1503: a rider's Model 1 reject landed after
  // they'd already been offered Model 2, and both showed dispatchManager
  // behavior consistent with the DB row for the wrong tier being touched).
  const lock = lockManager.peekLock(riderId);
  if (!lock || lock.orderId !== orderId) {
    // Stale: this rider has already moved on — a newer tier, a different
    // order, or nothing at all — by the time this reject arrived. There is
    // nothing of theirs for THIS order left to touch.
    return { success: true };
  }
  const packageId = lock.packageId;

  // DB write before lock release, not after: releasing the lock first makes
  // this rider immediately eligible for the cascade's next tier, which can
  // fire (and even complete) before this status write lands.
  const result = await prisma.tbl_order_requests.updateMany({
    where: { order_id: orderId, rider_id: riderId, package_id: Number(packageId), status: "sent" },
    data: { status: "10" },
  });
  if (result.count > 0) {
    await dispatchManager.recordModel1Outcome(riderId, packageId, "miss");
  }
  lockManager.releaseLock(riderId);
  return { success: true };
}

async function updateStatus(orderId, riderId, status) {
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!order) {
    return { success: false, msg: "Order not found" };
  }
  if (order.rid !== riderId) {
    return { success: false, msg: "Not authorized for this order" };
  }

  if (status === "arrived") {
    const now = new Date();
    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { order_status: 2, o_status: "Pickup" },
    });
    await prisma.pkg_order_wait_timer.upsert({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
      create: { order_id: orderId, rid: riderId, pickup_wait_start: now, created_at: now },
      update: { pickup_wait_start: now, updated_at: now },
    });
    notifyAdminStatus({ id: orderId, city_id: order.city_id, order_status: 2, o_status: "Pickup", rid: riderId });
    return { success: true, order_status: 2, o_status: "Pickup" };
  }

  if (status === "pickup") {
    const now = new Date();
    const waitTimer = await prisma.pkg_order_wait_timer.findUnique({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
    });
    const pickupWaitSeconds = waitTimer?.pickup_wait_start
      ? Math.max(0, Math.round((now - new Date(waitTimer.pickup_wait_start)) / 1000))
      : 0;

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { order_status: 3, o_status: "On_Route", pickup_time: now },
    });
    await prisma.pkg_order_wait_timer.update({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
      data: { pickup_wait_end: now, pickup_wait_seconds: pickupWaitSeconds, updated_at: now },
    });
    notifyAdminStatus({ id: orderId, city_id: order.city_id, order_status: 3, o_status: "On_Route", rid: riderId });
    return { success: true, order_status: 3, o_status: "On Route" };
  }

  if (status === "complete") {
    const now = new Date();
    const waitTimer = await prisma.pkg_order_wait_timer.findUnique({
      where: { order_id_rid: { order_id: orderId, rid: riderId } },
    });

    const freeWaitSeconds = parseFloat(order.free_waiting_time) || 0;
    const totalWaitSeconds = waitTimer?.pickup_wait_seconds || 0;
    const chargeableWaitSeconds = Math.max(0, totalWaitSeconds - freeWaitSeconds);
    const waitingChargeRate = Number(order.wating_charge) || 0;
    const waitingCharge = round2((chargeableWaitSeconds / 60) * waitingChargeRate);

    const finalTotal = round2(Number(order.total_dcharge) + waitingCharge);

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: {
        order_status: 5,
        o_status: "Completed",
        ddate: now,
        drop_time: now,
        total_dcharge: finalTotal,
      },
    });

    if (waitTimer) {
      await prisma.pkg_order_wait_timer.update({
        where: { order_id_rid: { order_id: orderId, rid: riderId } },
        data: {
          drop_wait_end: now,
          total_wait_seconds: totalWaitSeconds,
          updated_at: now,
        },
      });
    }

    if (order.trans_id === "cash_payment" && Number(order.commission) > 0) {
      // order.commission is a percentage (matches the legacy PHP DB
      // convention — see pricingEngine.js), not a ₹ amount — convert before
      // touching real money.
      const commission = pricingEngine.commissionAmount(order.d_charge, order.commission);
      await prisma.tbl_rider.update({
        where: { id: riderId },
        data: { wallet_balance: { decrement: commission } },
      });
      await prisma.tbl_wallet_history.create({
        data: {
          user_id: riderId,
          amount: commission,
          type: "debit",
          remark: `Admin commission for order #${orderId}`,
          wallet_type: "driver",
          order_id: orderId,
          created_at: now,
        },
      });
    }

    notifyAdminStatus({ id: orderId, city_id: order.city_id, order_status: 5, o_status: "Completed", rid: riderId });
    return { success: true, order_status: 5, o_status: "Completed" };
  }

  return { success: false, msg: `Unknown status transition: ${status}` };
}

/**
 * Customer-initiated cancel. The atomic conditional UPDATE is what decides
 * the race against a concurrent driver accept (spec §4.6) — if the driver's
 * accept already flipped o_status away from cancellable, affectedRows is 0.
 */
async function customerCancel(uid, orderId, comment) {
  const orderBefore = await prisma.pkg_order.findFirst({ where: { id: orderId, uid } });
  if (!orderBefore) {
    return { success: false, msg: "Order not found" };
  }

  const affectedRows = await prisma.$executeRaw`
    UPDATE pkg_order
    SET o_status = 'Cancelled', cancel_reason = ${comment || null}
    WHERE id = ${orderId} AND uid = ${uid} AND o_status NOT IN ('Completed', 'Cancelled')
  `;

  if (affectedRows === 0) {
    return { success: false, msg: "Order cannot be cancelled" };
  }

  if (orderBefore.rid !== 0) {
    const pkg = await pricingEngine.getPackageById(orderBefore.delivery_type);
    const cancellationCharge = Number(pkg?.cancellation_charge_customer) || 0;
    if (cancellationCharge > 0) {
      await prisma.tbl_wallet_history.create({
        data: {
          user_id: uid,
          amount: cancellationCharge,
          type: "debit",
          remark: `Cancellation charge for order #${orderId}`,
          wallet_type: "user",
          order_id: orderId,
          created_at: new Date(),
        },
      });
    }
  } else {
    dispatchManager.stopDispatch(orderId, "cancelled_by_user");
  }

  return { success: true };
}

async function rateOrder(uid, orderId, riderId, star, comment) {
  const result = await prisma.pkg_order.updateMany({
    where: { id: orderId, uid, rid: riderId },
    data: { is_rate: 1, cust_rate: star, cust_comment: comment || null },
  });

  if (result.count === 0) {
    return { success: false, msg: "Order not found for this customer/rider pair" };
  }

  return { success: true };
}

module.exports = {
  acceptOrder,
  rejectOrder,
  updateStatus,
  customerCancel,
  rateOrder,
};
