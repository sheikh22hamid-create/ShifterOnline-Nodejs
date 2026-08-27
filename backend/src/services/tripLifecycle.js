const prisma = require("../config/db");
const dispatchManager = require("./dispatchManager");
const lockManager = require("./lockManager");
const pricingEngine = require("./pricingEngine");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");

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
 * Atomic first-come-first-served acceptance (spec §4.5). The conditional
 * UPDATE is the single source of truth for who won the race — affectedRows
 * tells us, never a prior SELECT.
 */
async function acceptOrder(orderId, riderId) {
  const affectedRows = await prisma.$executeRaw`
    UPDATE pkg_order
    SET rid = ${riderId},
        order_status = 1,
        o_status = 'Processing',
        accept_time = NOW()
    WHERE id = ${orderId} AND rid = 0 AND order_status = 0 AND o_status != 'Cancelled'
  `;

  if (affectedRows === 0) {
    return { success: false, msg: "Order already taken or cancelled" };
  }

  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  const { pkg, driverEarning, commission } = await pricingEngine.priceForPackageId(
    order.delivery_type,
    Number(order.distance) || 0
  );

  await prisma.pkg_order.update({
    where: { id: orderId },
    data: { driver_earning: driverEarning, commission },
  });

  await prisma.tbl_order_requests.updateMany({
    where: { order_id: orderId, rider_id: riderId },
    data: { status: "accepted" },
  });

  // Release this rider's own popup lock, then dismiss every OTHER driver
  // still holding a popup for this order and cancel remaining timers.
  lockManager.releaseLock(riderId);
  dispatchManager.stopDispatch(orderId, "accepted_by_other");

  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  notifyAdminStatus(order);

  return {
    success: true,
    order: { ...order, driver_earning: driverEarning, package: pkg },
    rider,
  };
}

async function rejectOrder(orderId, riderId) {
  lockManager.releaseLock(riderId);
  await prisma.tbl_order_requests.updateMany({
    where: { order_id: orderId, rider_id: riderId, status: "sent" },
    data: { status: "10" },
  });
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

    if (order.transaction_id === "cash_payment" && Number(order.commission) > 0) {
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
