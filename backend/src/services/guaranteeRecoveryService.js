const prisma = require("../config/db");
const logger = require("../utils/logger");
const queueSettings = require("./guaranteeQueueSettings");
const orderSearchSettings = require("./orderSearchSettings");
const orderSearchRules = require("./orderSearchRules");
const guaranteeQueue = require("./guaranteeQueueService");

// Booking Guarantee driver-cancel recovery (spec 2026-10-14). dispatchManager and bookingGuaranteeService both
// require modules that reach back here, so they are required lazily (same reason bookingGuaranteeService does).
const dispatchManager = () => require("./dispatchManager");
const bookingGuarantee = () => require("./bookingGuaranteeService");

// An assigned order that has not been picked up yet: Pending (0), Processing (1), Pickup (2).
const PRE_PICKUP_STATUS = new Set([0, 1, 2]);
const PRE_PICKUP_O_STATUS = new Set(["pending", "processing", "pickup"]);

class NotReopenable extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * The order's city when recovery may be attempted, else null. Fail closed: a missing city, a switch that is off,
 * the guarantee being off or ANY read error means "do not recover", so the caller takes today's terminal path.
 * Read BEFORE any transaction (settings use the global client).
 */
async function recoveryCityFor(orderId) {
  try {
    const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { city_id: true } });
    const cityId = Number(order?.city_id);
    if (!Number.isInteger(cityId) || cityId <= 0) return null;
    const queue = await queueSettings.getQueueSettings(cityId);
    if (!queue.recoverOnDriverCancel) return null;
    const city = await orderSearchSettings.getCitySettings(cityId);
    return city.guaranteeEnabled ? cityId : null;
  } catch (err) {
    logger.warn(`guaranteeRecovery.recoveryCityFor: order ${orderId} not eligible (${err.message})`);
    return null;
  }
}

const clampSearchDeadline = (deadline, caseDeadline) =>
  new Date(Math.min(new Date(deadline).getTime(), new Date(caseDeadline).getTime()));

/**
 * Reopens the case inside the caller's transaction (compare-and-swap on status and deadline). deadline_at and
 * opened_at are never written. Throws NotReopenable (rolling the transaction back) when the case cannot reopen.
 */
async function reopenCase(tx, { orderId, cityId, source, riderId }) {
  const swapped = await tx.booking_guarantee_case.updateMany({
    where: { order_id: orderId, status: "resolved_assigned", deadline_at: { gt: new Date() } },
    data: {
      status: "open", closed_at: null, resolved_by_admin_id: null,
      owner_admin_id: null, owner_assigned_at: null, queue_state: null, unassigned_reason: null,
      first_action_at: null, last_action_at: null, reminded_at: null, escalated_at: null, last_alerted_at: null,
    },
  });
  if (swapped.count !== 1) throw new NotReopenable("case_not_reopenable");
  const caseRow = await tx.booking_guarantee_case.findUnique({ where: { order_id: orderId } });
  if (!caseRow || Number(caseRow.city_id) !== Number(cityId)) throw new NotReopenable("city_mismatch");
  // The ownership period normally ended when the case closed; end a leftover one so the queue can assign again.
  await guaranteeQueue.endActiveAssignment(caseRow.id, "resolved", tx);
  await tx.booking_guarantee_audit.create({
    data: {
      case_id: caseRow.id, order_id: orderId, event: "reopened_after_driver_cancel", admin_id: null,
      meta: JSON.stringify({
        rider_id: riderId, source,
        remaining_seconds: Math.max(0, Math.round((new Date(caseRow.deadline_at).getTime() - Date.now()) / 1000)),
      }),
    },
  });
  return caseRow;
}

/**
 * The driver cancelled an assigned order: ONE transaction that locks the order, reopens the case, returns the order
 * to the held state (rid 0, Pending) and runs `inTx(tx, order)` for the caller's driver-side effects. Any failure
 * (ineligible, a thrown error, a lost race) rolls everything back and returns { reopened: false }; it never throws.
 */
async function reopenAfterDriverCancel({ orderId, riderId, cityId, inTx = null }) {
  orderId = Number(orderId);
  riderId = Number(riderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const order = (await tx.$queryRaw`
        SELECT id, uid, rid, order_status, o_status, delivery_type FROM pkg_order WHERE id = ${orderId} FOR UPDATE`)[0];
      if (!order || Number(order.rid) !== riderId) throw new NotReopenable("not_assigned_driver");
      if (!PRE_PICKUP_STATUS.has(Number(order.order_status))
        || !PRE_PICKUP_O_STATUS.has(String(order.o_status || "").trim().toLowerCase())) {
        throw new NotReopenable("not_before_pickup");
      }
      const caseRow = await reopenCase(tx, { orderId, cityId, source: "driver_cancel", riderId });
      const moved = await tx.$executeRaw`
        UPDATE pkg_order SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL
        WHERE id = ${orderId} AND rid = ${riderId} AND o_status NOT IN ('Completed', 'Cancelled')`;
      if (moved !== 1) throw new NotReopenable("order_changed");
      if (inTx) await inTx(tx, order);
      return { reopened: true, caseRow, order };
    });
  } catch (err) {
    if (!(err instanceof NotReopenable)) logger.error(`guaranteeRecovery: order ${orderId} not recovered, taking the normal cancel path:`, err);
    return { reopened: false, reason: err instanceof NotReopenable ? err.reason : "error" };
  }
}

/** Case-only variant for cancelRequestService.approve, which already un-assigned the order itself. Never throws. */
async function reopenAfterApprovedCancel({ orderId, riderId, cityId }) {
  orderId = Number(orderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const caseRow = await reopenCase(tx, { orderId, cityId, source: "admin_approved_cancel", riderId: Number(riderId) });
      return { reopened: true, caseRow };
    });
  } catch (err) {
    if (!(err instanceof NotReopenable)) logger.error(`guaranteeRecovery: order ${orderId} case not reopened after approved cancel:`, err);
    return { reopened: false, reason: err instanceof NotReopenable ? err.reason : "error" };
  }
}

/**
 * After the reopen commits: shorten a System 2 search to the case deadline, tell the customer, restart auto-search
 * (the cancelling driver is excluded via their "10" request row) and announce the case to admins / the executive
 * queue. Every step is best-effort and logged; the reopen already stands.
 */
async function afterReopen({ orderId, caseRow, cityId }) {
  let order = null;
  try {
    order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  } catch (err) {
    logger.error(`guaranteeRecovery.afterReopen: order ${orderId} unreadable:`, err);
  }
  if (order) {
    if (orderSearchRules.isSystem2Order(order)) {
      try {
        const city = await orderSearchSettings.getCitySettings(cityId);
        const deadline = clampSearchDeadline(orderSearchRules.searchDeadline(new Date(), city.driverSearchSeconds), caseRow.deadline_at);
        await prisma.pkg_order.update({ where: { id: Number(orderId) }, data: { search_deadline_at: deadline } });
        order = { ...order, search_deadline_at: deadline };
      } catch (err) {
        logger.error(`guaranteeRecovery.afterReopen: search window for order ${orderId} not set:`, err);
      }
    }
    try {
      dispatchManager().emitCustomerEvent(order.uid, "order:driver_unassigned", { order_id: String(orderId) });
    } catch (err) {
      logger.error(`guaranteeRecovery.afterReopen: customer event for order ${orderId} failed:`, err);
    }
    try {
      await dispatchManager().startDispatch(order, null);
    } catch (err) {
      logger.error(`guaranteeRecovery.afterReopen: auto-search for order ${orderId} not restarted:`, err);
    }
  }
  try {
    await bookingGuarantee().announceOpened(caseRow, cityId);
  } catch (err) {
    logger.error(`guaranteeRecovery.afterReopen: announce for order ${orderId} failed:`, err);
  }
}

module.exports = {
  recoveryCityFor, reopenAfterDriverCancel, reopenAfterApprovedCancel, afterReopen, clampSearchDeadline,
};
