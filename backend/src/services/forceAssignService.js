const prisma = require("../config/db");
const dispatchManager = require("./dispatchManager");
const tripLifecycle = require("./tripLifecycle");
const pushNotifier = require("./pushNotifier");
const logger = require("../utils/logger");

// Just long enough for claimOrderForRider's freshness check to pass right
// after we insert it - this is an admin-forced assignment, not a real offer
// the driver could still be racing someone else for, so the window only
// needs to survive the few milliseconds until the claim below.
const FORCE_ASSIGN_REQUEST_TTL_MS = 60 * 1000;

/**
 * Admin force-assigns a specific scheduled order to a specific driver ahead
 * of its normal dispatch time (spec section 11). Reuses the same
 * claimOrderForRider + finalizeAcceptedOrder path a normal driver accept
 * goes through (so pricing, advance payment, and driver-payload notification
 * all behave exactly like the normal booking flow - spec section 12), rather
 * than writing pkg_order directly. finalizeAcceptedOrder already calls
 * dispatchManager.stopDispatch, which dismisses every other driver still
 * holding a popup for this order (spec section 10) - the extra
 * pkg_order_interest cleanup below covers riders who registered interest for
 * a later priority round but never got an active popup yet.
 */
async function forceAssignScheduledOrder({ orderId, riderId, adminId }) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  if (!order) throw new Error("Order not found");
  if (Number(order.booking_type) !== 2) throw new Error("Force assign is only for scheduled bookings");
  if (order.o_status !== "Pending") throw new Error("Order is no longer pending assignment");

  const rider = await prisma.tbl_rider.findFirst({
    where: { id: Number(riderId), a_status: 1, status: 1 },
  });
  if (!rider) throw new Error("Driver not found or not eligible");
  if (rider.vehicle !== order.category) throw new Error("Driver's vehicle category does not match this order");

  const activeOrder = await prisma.pkg_order.findFirst({
    where: { rid: Number(riderId), o_status: { in: ["Processing", "On_Route", "Pickup"] } },
    select: { id: true },
  });
  if (activeOrder) throw new Error("Driver already has an active order in progress");

  await dispatchManager.insertOrderRequest({
    orderId: order.id,
    riderId: Number(riderId),
    packageId: Number(order.delivery_type) || 1,
    lat: rider.rlats ? String(rider.rlats) : null,
    lng: rider.rlongs ? String(rider.rlongs) : null,
    ttlMs: FORCE_ASSIGN_REQUEST_TTL_MS,
  });

  const claim = await tripLifecycle.claimOrderForRider(order.id, Number(riderId));
  if (!claim.success) throw new Error(claim.msg || "Could not assign order to driver");

  await tripLifecycle.finalizeAcceptedOrder(order.id, Number(riderId), claim.acceptedPackageId);

  // finalizeAcceptedOrder's stopDispatch only clears riders with a live
  // tbl_order_requests row; pkg_order_interest is the separate ahead-of-time
  // "I'm interested in this scheduled slot" list read later by
  // offerToInterestedRiders. Now that the order is assigned, nobody's
  // interest can result in a popup for it any more.
  await prisma.pkg_order_interest.deleteMany({ where: { order_id: order.id } });

  await prisma.order_status_history
    .create({
      data: {
        order_id: order.id,
        rider_id: Number(riderId),
        status: "force_assigned",
        remark: `Force-assigned to driver #${riderId} by admin #${adminId}`,
      },
    })
    .catch((err) => logger.error(`forceAssignService: audit log write failed for order ${order.id}:`, err));

  pushNotifier
    .notifyDriverForceAssigned(rider.fcm_token, order.id)
    .catch((err) => logger.error(`forceAssignService: notify failed for order ${order.id}:`, err));

  return { success: true, orderId: order.id, riderId: Number(riderId) };
}

module.exports = { forceAssignScheduledOrder };
