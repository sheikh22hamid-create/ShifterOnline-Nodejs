const prisma = require("../config/db");
const logger = require("../utils/logger");
const dispatchManager = require("./dispatchManager");
const pricingEngine = require("./pricingEngine");
const adminSocket = require("../sockets/adminSocket");
const { getIO } = require("../sockets/socketServer");
const bookingGuarantee = require("./bookingGuaranteeService");
const guaranteeQueue = require("./guaranteeQueueService");
const freeBookingService = require("./freeBookingService");

const fail = (status, message) => ({ ok: false, status, message });

/**
 * Assigns a still-open order to a driver: the checks, the atomic claim, pricing, guarantee/free-booking bookkeeping
 * and the driver/customer/admin notifications. Shared by the admin "assign rider" endpoint and the automatic
 * Trial Driver assignment so both behave identically.
 *
 * The caller has already loaded `order` and done its own access checks (city scope, executive ownership).
 *   isRiderForbidden(rider) -> true to refuse a driver outside the caller's scope (admin endpoint only)
 *   remark                  -> order_status_history text (default: "Manually assigned by admin ...")
 *   closeEvent / closeAdminId -> how the Booking Guarantee case is closed (defaults: "admin_assigned" by actor.id)
 * Returns { ok: true, order, pkg } or { ok: false, status, message }.
 */
async function assignRiderToOrder({ order, riderId, actor, isRiderForbidden, remark, closeEvent, closeAdminId }) {
  const orderId = order.id;
  if (order.rid !== 0 || order.order_status !== 0) {
    return fail(409, "Order is already assigned, completed, or cancelled");
  }
  if (!order.delivery_type) {
    return fail(400, "Order has no rate card assigned yet — cannot compute fare");
  }

  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  if (!rider) {
    return fail(404, "Driver not found");
  }
  if (isRiderForbidden && isRiderForbidden(rider)) {
    return fail(403, "Forbidden: driver is outside your assigned city");
  }
  if (rider.status !== 1) {
    return fail(400, "Driver is not approved");
  }
  if (rider.a_status !== 1) {
    return fail(400, "Driver is currently offline");
  }
  // order_status alone isn't reliable — cancel() (here and in tripLifecycle)
  // only ever updates o_status, never resets order_status, so a cancelled
  // order can still show order_status 1-3 forever. o_status is the
  // authoritative terminal-state signal.
  const riderBusy = await prisma.pkg_order.count({
    where: { rid: riderId, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
  });
  if (riderBusy) {
    return fail(409, "Driver already has an active trip");
  }

  const customerPlan = typeof pricingEngine.getActiveCustomerPlan === "function"
    ? await pricingEngine.getActiveCustomerPlan(order.uid)
    : null;
  const isNoAdvance = Boolean(
    customerPlan &&
    (customerPlan.noAdvancePayment === true ||
     customerPlan.noAdvancePayment === 1 ||
     String(customerPlan.noAdvancePayment) === "1" ||
     String(customerPlan.noAdvancePayment) === "true")
  );
  const paymentStatus = isNoAdvance ? 1 : (Number(order.payment_status) || 0);
  const advancePayment = isNoAdvance ? "0" : (order.advance_payment != null ? String(order.advance_payment) : "0");

  // Same atomic-conditional-UPDATE pattern as tripLifecycle.acceptOrder —
  // wins the race against the live dispatch cascade if it's still running.
  const affectedRows = await prisma.$executeRaw`
    UPDATE pkg_order
    SET rid = ${riderId}, order_status = 1, o_status = 'Processing', accept_time = NOW(),
        payment_status = ${paymentStatus}, advance_payment = ${advancePayment}
    WHERE id = ${orderId} AND rid = 0 AND order_status = 0 AND o_status != 'Cancelled'
  `;
  if (affectedRows === 0) {
    return fail(409, "Order was just taken or cancelled — refresh and retry");
  }

  // driver_earning stores the full gross fare, same as the dispatch
  // popup and pkg_order.driver_earning set at self-accept (see
  // tripLifecycle.acceptOrder) — the driver sees one consistent number
  // throughout, not a commission-deducted figure only here.
  const { pkg, fare, commission } = await pricingEngine.priceForPackageId(
    order.delivery_type,
    Number(order.distance) || 0,
    Number(order.radius_range) || 1,
    Number(order.extra_mile_charge) || 0,
    order.uid
  );
  await prisma.pkg_order.update({ where: { id: orderId }, data: { driver_earning: fare, commission } });

  dispatchManager.stopDispatch(orderId, "accepted_by_other");
  await guaranteeQueue.recordAssignmentAction({ orderId, adminId: actor.id, riderId });
  try {
    const closeArgs = [orderId, closeAdminId === undefined ? actor.id : closeAdminId];
    if (closeEvent) closeArgs.push(closeEvent);
    await bookingGuarantee.closeOnAssign(...closeArgs);
  } catch (guaranteeErr) {
    logger.error(`assignRider: booking guarantee close failed for order ${orderId}:`, guaranteeErr);
  }

  try {
    await freeBookingService.recordAcceptance(orderId, riderId);
  } catch (fbErr) {
    logger.error(`assignRider: free-booking recordAcceptance failed for order ${orderId}:`, fbErr);
  }

  await prisma.order_status_history.create({
    data: {
      order_id: orderId,
      rider_id: riderId,
      status: "Processing",
      remark: remark || `Manually assigned by admin #${actor.id} (${actor.username})`,
    },
  });

  const updatedOrder = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  const freeBookingView = await freeBookingService.getViewForOrder(updatedOrder.id);

  try {
    const io = getIO();
    io.to(`driver_${riderId}`).emit("order:assigned", {
      order_id: updatedOrder.id,
      pickup_address: updatedOrder.paddress,
      delivery_address: updatedOrder.daddress,
      driver_earning: String(fare),
    });
    dispatchManager.emitDirectAssign(riderId, updatedOrder);
    io.to(`customer_${updatedOrder.uid}`).emit("order:assigned", {
      order_id: updatedOrder.id,
      rider_id: rider.id,
      rider_name: rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
      rider_phone: rider.fmobile,
      vehicle_no: rider.vehicle_no,
      order_status: updatedOrder.order_status,
      o_status: updatedOrder.o_status,
      free_booking: freeBookingView,
    });
  } catch (socketErr) {
    logger.error(`assignRider: socket notify failed for order ${orderId}:`, socketErr);
  }
  try {
    adminSocket.notifyOrderStatusUpdate(updatedOrder);
  } catch (adminErr) {
    logger.error(`assignRider: admin socket notify failed for order ${orderId}:`, adminErr);
  }

  return { ok: true, order: updatedOrder, pkg };
}

module.exports = { assignRiderToOrder };
