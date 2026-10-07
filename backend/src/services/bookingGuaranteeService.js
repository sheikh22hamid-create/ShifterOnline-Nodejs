const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const adminSocket = require("../sockets/adminSocket");
const walletNotifier = require("./walletNotifier");
const pushNotifier = require("./pushNotifier");
const walletPrepayment = require("./walletPrepaymentRefund");
const { refundReferralPointsForOrder } = require("./referralPointsRefund");
const rules = require("./bookingGuaranteeRules");
const settings = require("./bookingGuaranteeSettings");

// Booking Guarantee (spec 2026-10-07). dispatchManager requires this module, so it is required lazily
// here (same reason dispatchManager lazy-requires freeBookingService).
const dispatchManager = () => require("./dispatchManager");

const STATUS = { OPEN: "open", ASSIGNED: "resolved_assigned", EXPIRED: "expired_compensated", CANCELLED: "cancelled" };
const ALERT_MESSAGE = "BOOKING GUARANTEE – MANUAL DRIVER ASSIGNMENT REQUIRED";
const PACKAGE_SELECT = { id: true, sort_order: true, no_driver_compensation: true };
const BATCH = 50;
const REPAIR_AFTER_MS = 60 * 1000;

const toIds = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

async function writeAudit(client, caseRow, event, { adminId = null, meta = null } = {}) {
  await client.booking_guarantee_audit.create({
    data: { case_id: caseRow.id, order_id: caseRow.order_id, event, admin_id: adminId, meta: meta ? JSON.stringify(meta) : null },
  });
}

/**
 * Called when the dispatch cascade is exhausted for an unassigned order. true = the order is being held
 * for the admin window (the caller must NOT cancel it); false = no guarantee applies, cancel as before.
 */
async function openForExhaustedOrder(order, selectedIds) {
  const existing = await prisma.booking_guarantee_case.findUnique({ where: { order_id: order.id } });
  if (existing) return existing.status === STATUS.OPEN;

  const ids = toIds(selectedIds);
  const packages = ids.length ? await prisma.tbl_package.findMany({ where: { id: { in: ids } }, select: PACKAGE_SELECT }) : [];
  const { packageId, amount } = rules.computeGuaranteeCompensation(packages);
  const minutes = await settings.getAssignWindowMinutes();
  const deadline = new Date(Date.now() + minutes * 60 * 1000);

  let row;
  try {
    row = await prisma.booking_guarantee_case.create({
      data: {
        order_id: order.id, uid: order.uid, status: STATUS.OPEN, selected_package_ids: JSON.stringify(ids),
        compensation_package_id: packageId, compensation_amount: amount, deadline_at: deadline,
      },
    });
  } catch (err) {
    if (err && err.code === "P2002") return true; // another worker opened it first
    throw err;
  }
  await writeAudit(prisma, row, "opened", { meta: { amount, packageId, minutes, selected: ids } });

  try {
    adminSocket.notifyDispatchAlert(order.id, order.city_id, ALERT_MESSAGE, {
      kind: "booking_guarantee", amount, deadline_at: deadline.toISOString(),
    });
    await writeAudit(prisma, row, "admin_alerted");
  } catch (err) {
    logger.error(`bookingGuarantee: admin alert failed for order ${order.id}:`, err);
  }
  try {
    dispatchManager().emitCustomerEvent(order.uid, "order:guarantee_pending", {
      order_id: String(order.id), amount, deadline_at: deadline.toISOString(),
    });
  } catch (err) {
    logger.error(`bookingGuarantee: customer notify failed for order ${order.id}:`, err);
  }
  return true;
}

async function closeWith(orderId, status, event, adminId, extraData = {}) {
  const res = await prisma.booking_guarantee_case.updateMany({
    where: { order_id: Number(orderId), status: STATUS.OPEN },
    data: { status, closed_at: new Date(), ...extraData },
  });
  if (res.count === 0) return false;
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (row) await writeAudit(prisma, row, event, { adminId });
  return true;
}

/** Admin assigned a driver: close as resolved, no compensation. */
const closeOnAssign = (orderId, adminId) =>
  closeWith(orderId, STATUS.ASSIGNED, "admin_assigned", adminId, { resolved_by_admin_id: adminId ?? null });

/** Customer or admin cancelled during the window: close, no compensation. */
const closeOnCancel = (orderId, event, adminId = null) => closeWith(orderId, STATUS.CANCELLED, event, adminId);

/**
 * Phase B of an expiry: the idempotent refunds, then tell the customer. Safe to repeat (every helper it
 * calls is idempotent); refunds_done_at stops the sweeper's repair pass once it has completed.
 */
async function finishExpiry(row) {
  if (row.refunds_done_at) return;
  const order = await prisma.pkg_order.findUnique({ where: { id: row.order_id } });
  if (order) {
    await walletPrepayment.refundIfWalletPaid(order, { note: "no driver found" });
    await refundReferralPointsForOrder(order.id);
  }
  await writeAudit(prisma, row, "refunds_processed");
  await prisma.booking_guarantee_case.update({ where: { id: row.id }, data: { refunds_done_at: new Date() } });

  const paid = row.wallet_history_id ? Number(row.compensation_amount) || 0 : 0;
  dispatchManager().emitCustomerEvent(row.uid, "order:no_driver_found", { order_id: String(row.order_id), compensation_amount: paid });
  try {
    const customer = await prisma.tbl_user.findUnique({ where: { id: row.uid }, select: { fcm_token: true } });
    await pushNotifier.notifyCustomerNoDriverFound(customer?.fcm_token, row.order_id, paid);
  } catch (err) {
    logger.error(`bookingGuarantee: push failed for order ${row.order_id}:`, err);
  }
}

/**
 * Phase A of an expiry — ONE transaction: flip the case (conditional, so only one worker wins), cancel the
 * order, credit the compensation (idempotency key on the wallet row). Phase B (finishExpiry) follows.
 */
async function expireCase(caseId) {
  const claimed = await prisma.$transaction(async (tx) => {
    const flipped = await tx.booking_guarantee_case.updateMany({
      where: { id: caseId, status: STATUS.OPEN },
      data: { status: STATUS.EXPIRED, closed_at: new Date() },
    });
    if (flipped.count === 0) return null;
    const row = await tx.booking_guarantee_case.findUnique({ where: { id: caseId } });

    const cancelled = await tx.pkg_order.updateMany({
      where: { id: row.order_id, rid: 0, order_status: 0, o_status: { notIn: ["Cancelled", "Completed"] } },
      data: { o_status: "Cancelled", cancel_reason: "No driver found", order_status: 4 },
    });
    if (cancelled.count === 0) {
      // Assigned or cancelled by another path in the meantime: nothing to compensate.
      await tx.booking_guarantee_case.update({ where: { id: caseId }, data: { status: STATUS.CANCELLED } });
      await writeAudit(tx, row, "order_already_closed");
      return null;
    }
    await writeAudit(tx, row, "expired");

    const amount = Number(row.compensation_amount) || 0;
    let credit = null;
    let walletHistoryId = row.wallet_history_id;
    if (amount > 0) {
      const key = `booking_guarantee_credit:${row.order_id}`;
      const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
      if (!duplicate) {
        const remark = `Booking Guarantee compensation for order #${row.order_id}`;
        await tx.tbl_user.update({ where: { id: row.uid }, data: { wallet: { increment: amount } } });
        const history = await tx.tbl_wallet_history.create({
          data: { user_id: row.uid, amount, type: "credit", remark, wallet_type: "user", order_id: row.order_id, payment_id: key, created_at: istNow() },
        });
        await tx.booking_guarantee_case.update({ where: { id: caseId }, data: { wallet_history_id: history.id } });
        await writeAudit(tx, row, "wallet_credited", { meta: { amount, wallet_history_id: history.id } });
        walletHistoryId = history.id;
        credit = { amount, remark };
      }
    }
    return { row: { ...row, status: STATUS.EXPIRED, wallet_history_id: walletHistoryId }, credit };
  });
  if (!claimed) return false;

  if (claimed.credit) {
    Promise.resolve(walletNotifier.notifyCustomerWalletTransaction(claimed.row.uid, { type: "credit", amount: claimed.credit.amount, remark: claimed.credit.remark }))
      .catch((err) => logger.error(`bookingGuarantee: wallet notify failed for user ${claimed.row.uid}:`, err));
  }
  await finishExpiry(claimed.row);
  return true;
}

/** Sweeper entry point: expire overdue cases, then finish refunds for expiries that crashed half-way. */
async function expireDue(now = new Date()) {
  const due = await prisma.booking_guarantee_case.findMany({
    where: { status: STATUS.OPEN, deadline_at: { lte: now } }, select: { id: true }, take: BATCH,
  });
  for (const { id } of due) {
    try {
      await expireCase(id);
    } catch (err) {
      logger.error(`bookingGuarantee: expiring case ${id} failed:`, err);
    }
  }
  const repair = await prisma.booking_guarantee_case.findMany({
    where: { status: STATUS.EXPIRED, refunds_done_at: null, closed_at: { lte: new Date(now.getTime() - REPAIR_AFTER_MS) } },
    take: BATCH,
  });
  for (const row of repair) {
    try {
      await finishExpiry(row);
    } catch (err) {
      logger.error(`bookingGuarantee: finishing refunds for case ${row.id} failed:`, err);
    }
  }
}

/** Display amount for a set of package ids (the live "if no driver is found" line). */
async function quote(packageIds) {
  const ids = toIds(packageIds);
  if (!ids.length) return { packageId: null, amount: 0 };
  const packages = await prisma.tbl_package.findMany({ where: { id: { in: ids }, status: 1 }, select: PACKAGE_SELECT });
  return rules.computeGuaranteeCompensation(packages);
}

/** The `guarantee` block of the customer order-details response. Never throws. */
async function getView(order) {
  try {
    const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(order.id) } });
    if (row) {
      return {
        state: rules.guaranteeStateFor(row),
        amount: Number(row.compensation_amount) || 0,
        deadline_at: row.status === STATUS.OPEN ? new Date(row.deadline_at).toISOString() : null,
      };
    }
    let amount = 0;
    if (Number(order.rid) === 0 && Number(order.order_status) === 0 && order.allowed_delivery_types) {
      amount = (await quote(JSON.parse(order.allowed_delivery_types))).amount;
    }
    return { state: "none", amount, deadline_at: null };
  } catch (err) {
    logger.warn(`bookingGuarantee.getView failed for order ${order?.id}: ${err.message}`);
    return { state: "none", amount: 0, deadline_at: null };
  }
}

module.exports = {
  STATUS, ALERT_MESSAGE, openForExhaustedOrder, closeOnAssign, closeOnCancel, expireCase, expireDue, quote, getView,
};
