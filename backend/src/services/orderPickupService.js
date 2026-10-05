const prisma = require("../config/db");
const pickupEtaService = require("./pickupEtaService");
const pricingEngine = require("./pricingEngine");
const dispatchManager = require("./dispatchManager");
const pushNotifier = require("./pushNotifier");
const adminSocket = require("../sockets/adminSocket");
const { getDriverRealDistanceKm, computeRouteDistanceKm } = require("./orderRouteRepricing");
const { getPickupRelocateSettings } = require("../utils/pickupRelocateSettings");
const { haversineKm } = require("../utils/geoDistance");
const logger = require("../utils/logger");
const { reconcileRideDiscountToFare } = require("./referralPointsRefund");

// Pickup can move while the order is still pending (0), while the driver is
// en route to it (1), or even after the driver has already arrived and is
// waiting for the OTP (2, handled specially below) — but never once the
// goods are actually picked up (3+), since there's no physical pickup left
// to move.
const PICKUP_EDITABLE_STATUSES = [0, 1, 2];

function isValidCoord(val, min, max) {
  const num = Number(val);
  return Number.isFinite(num) && num >= min && num <= max;
}

function sanitizeAddress(addr) {
  if (typeof addr !== "string") return "";
  return addr.trim().slice(0, 500);
}

async function computeNewRouteDistance(order, newPlat, newPlong) {
  const stops = await prisma.pkg_order_stops.findMany({
    where: { order_id: Number(order.id) },
    orderBy: { sequence: "asc" },
  });

  return computeRouteDistanceKm({
    plat: newPlat, plong: newPlong, stops, dlat: order.dlat, dlong: order.dlong,
  });
}

function assertUsable({ orderId, uid, newPlat, newPlong, newPaddress }) {
  const numericOrderId = Number(orderId);
  const numericUid = Number(uid);

  if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
    throw new Error("INVALID_ORDER_ID");
  }
  if (!Number.isSafeInteger(numericUid) || numericUid <= 0) {
    throw new Error("INVALID_UID");
  }
  if (!isValidCoord(newPlat, -90, 90) || !isValidCoord(newPlong, -180, 180)) {
    throw new Error("INVALID_COORDINATES");
  }
  const cleanAddress = sanitizeAddress(newPaddress);
  if (!cleanAddress || cleanAddress.length < 3) {
    throw new Error("INVALID_ADDRESS");
  }
  return { numericOrderId, numericUid, cleanAddress };
}

function assertOrderEditable(order, numericUid) {
  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }
  if (order.uid !== numericUid) {
    throw new Error("FORBIDDEN");
  }
  if (!PICKUP_EDITABLE_STATUSES.includes(order.order_status) || order.o_status === "Completed" || order.o_status === "Cancelled") {
    throw new Error("ORDER_NOT_ACTIVE");
  }
}

/**
 * Previews a pickup-location change and calculates distance/fare difference
 * without updating DB. Mirrors orderDestinationService.previewDestinationChange.
 */
async function previewPickupChange({ uid, orderId, newPlat, newPlong, newPaddress }) {
  const { numericOrderId, numericUid, cleanAddress } = assertUsable({ orderId, uid, newPlat, newPlong, newPaddress });

  const order = await prisma.pkg_order.findUnique({ where: { id: numericOrderId } });
  assertOrderEditable(order, numericUid);

  const newDistanceKm = await computeNewRouteDistance(order, newPlat, newPlong);
  const radiusKm = await getDriverRealDistanceKm(order.rid, newPlat, newPlong);
  const packageId = Number(order.delivery_type) || 1;

  const { fare, driverEarning, commission } = await pricingEngine.priceForPackageId(
    packageId,
    newDistanceKm,
    radiusKm,
    Number(order.extra_mile_charge) || 0,
    numericUid
  );

  const oldFare = Math.round(Number(order.total_dcharge) > 0 ? Number(order.total_dcharge) : Number(order.d_charge) || 0);
  const newFare = Math.round(fare);
  const oldDistance = Math.round((Number(order.distance) || 0) * 100) / 100;
  const newDistance = Math.round(newDistanceKm * 100) / 100;

  return {
    order_id: numericOrderId,
    old_distance: oldDistance,
    new_distance: newDistance,
    distance_diff: Math.round((newDistance - oldDistance) * 100) / 100,
    old_fare: oldFare,
    new_fare: newFare,
    fare_diff: newFare - oldFare,
    driver_earning: Math.round(driverEarning),
    commission: Math.round(commission * 100) / 100,
    new_plat: String(newPlat),
    new_plong: String(newPlong),
    new_paddress: cleanAddress,
  };
}

/**
 * Confirms a pickup-location change inside a database transaction. If the
 * driver had already arrived and was waiting for the OTP (order_status 2),
 * the already-elapsed wait time is banked, the trip reverts to "en route"
 * (order_status 1) so arrival-detection re-engages at the new point, and
 * the stale "arrived" milestone event is cleared so the driver's re-arrival
 * fires a fresh notification instead of a silent no-op.
 */
async function confirmPickupChange({ uid, orderId, newPlat, newPlong, newPaddress }) {
  const { numericOrderId, numericUid, cleanAddress } = assertUsable({ orderId, uid, newPlat, newPlong, newPaddress });

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pkg_order WHERE id = ${numericOrderId} FOR UPDATE`;

    const order = await tx.pkg_order.findUnique({ where: { id: numericOrderId } });
    assertOrderEditable(order, numericUid);

    const newDistanceKm = await computeNewRouteDistance(order, newPlat, newPlong);
    const radiusKm = await getDriverRealDistanceKm(order.rid, newPlat, newPlong);
    const packageId = Number(order.delivery_type) || 1;

    const { fare, driverEarning, commission } = await pricingEngine.priceForPackageId(
      packageId,
      newDistanceKm,
      radiusKm,
      Number(order.extra_mile_charge) || 0,
      numericUid
    );

    const oldFare = Math.round(Number(order.total_dcharge) > 0 ? Number(order.total_dcharge) : Number(order.d_charge) || 0);
    const newFare = Math.round(fare);
    const oldDistance = Math.round((Number(order.distance) || 0) * 100) / 100;
    const newDistance = Math.round(newDistanceKm * 100) / 100;
    const fareDiff = newFare - oldFare;

    let wasWaitingAtPickup = false;
    if (order.order_status === 2 && order.rid > 0) {
      const { smallMoveThresholdM } = await getPickupRelocateSettings();
      const oldLat = Number(order.plat), oldLng = Number(order.plong);
      const moveDistanceM = [oldLat, oldLng].every(Number.isFinite)
        ? haversineKm(oldLat, oldLng, Number(newPlat), Number(newPlong)) * 1000
        : Infinity; // missing/invalid old coordinates -> always treat as a large move
      wasWaitingAtPickup = moveDistanceM > smallMoveThresholdM;
    }
    const updateData = {
      plat: String(newPlat),
      plong: String(newPlong),
      paddress: cleanAddress,
      distance: newDistance,
      d_charge: newFare,
      total_dcharge: newFare,
      driver_earning: driverEarning,
      commission: commission,
    };

    if (wasWaitingAtPickup) {
      // Driver was parked at the OLD pickup point waiting for the OTP —
      // reverting to order_status 1 makes driverTripService's own
      // arrival-detection (which reads order.plat/plong fresh on every GPS
      // sync) re-target the new point automatically, and pauses
      // sweepOverduePickups' auto-cancel clock (it only acts on rows with
      // pickup_wait_start set) until the driver actually gets there.
      updateData.order_status = 1;
      updateData.o_status = "Processing";

      const timer = await tx.pkg_order_wait_timer.findUnique({
        where: { order_id_rid: { order_id: numericOrderId, rid: order.rid } },
      });
      if (timer?.pickup_wait_start && !timer.pickup_wait_end) {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(timer.pickup_wait_start).getTime()) / 1000));
        await tx.pkg_order_wait_timer.update({
          where: { order_id_rid: { order_id: numericOrderId, rid: order.rid } },
          data: {
            pickup_wait_start: null,
            pickup_wait_end: null,
            pickup_wait_seconds: 0,
            pickup_wait_banked_seconds: (Number(timer.pickup_wait_banked_seconds) || 0) + elapsedSeconds,
          },
        });
      }
      // Clear the stale arrival event so a genuine re-arrival at the new
      // point creates a fresh one (driver_trip_event.upsert's update:{} is
      // otherwise a silent no-op on an existing milestone row).
      await tx.driver_trip_event.deleteMany({ where: { order_id: numericOrderId, milestone: "arrived" } });
    }

    const updatedOrder = await tx.pkg_order.update({ where: { id: numericOrderId }, data: updateData });
    await reconcileRideDiscountToFare(numericOrderId, newFare, tx);

    if (order.rid && order.rid > 0) {
      // upsert, not create: driver_trip_event has a unique (order_id, milestone)
      // constraint, so a second pickup change on the same order would throw
      // on a plain .create() here.
      await tx.driver_trip_event.upsert({
        where: { order_id_milestone: { order_id: numericOrderId, milestone: "pickup_updated" } },
        create: {
          order_id: numericOrderId,
          rider_id: order.rid,
          user_id: numericUid,
          milestone: "pickup_updated",
          payload: {
            order_id: numericOrderId,
            old_address: order.paddress || "",
            old_lat: order.plat,
            old_lng: order.plong,
            new_address: cleanAddress,
            old_fare: oldFare,
            new_fare: newFare,
            fare_diff: fareDiff,
            old_distance: oldDistance,
            new_distance: newDistance,
            reverted_to_en_route: wasWaitingAtPickup,
            updated_at: new Date().toISOString(),
          },
        },
        update: {
          payload: {
            order_id: numericOrderId,
            old_address: order.paddress || "",
            old_lat: order.plat,
            old_lng: order.plong,
            new_address: cleanAddress,
            old_fare: oldFare,
            new_fare: newFare,
            fare_diff: fareDiff,
            old_distance: oldDistance,
            new_distance: newDistance,
            reverted_to_en_route: wasWaitingAtPickup,
            updated_at: new Date().toISOString(),
          },
        },
      });
    }

    return {
      updatedOrder,
      riderId: order.rid,
      oldFare,
      newFare,
      fareDiff,
      oldDistance,
      newDistance,
    };
  });

  const { updatedOrder, riderId, oldFare, newFare, fareDiff, oldDistance, newDistance } = result;

  // Re-plan (or retire) the pickup ETA deadline for the new pickup point.
  if (riderId && riderId > 0) await pickupEtaService.refreshAfterPickupChange(numericOrderId);

  const eventPayload = {
    order_id: String(numericOrderId),
    plat: String(newPlat),
    plong: String(newPlong),
    paddress: cleanAddress,
    pickup_address: cleanAddress,
    distance: String(newDistance),
    old_fare: String(oldFare),
    new_fare: String(newFare),
    fare: String(newFare),
    total: String(newFare),
    fare_diff: String(fareDiff),
    estimated_earning: String(updatedOrder.driver_earning),
    driver_earning: String(updatedOrder.driver_earning),
    order_status: updatedOrder.order_status,
    message: `Pickup location updated to ${cleanAddress}`,
  };

  if (riderId && riderId > 0) {
    dispatchManager.emitDriverEvent(riderId, "order:pickup_updated", eventPayload);

    prisma.tbl_rider
      .findUnique({ where: { id: riderId }, select: { fcm_token: true } })
      .then((rider) => {
        if (rider?.fcm_token) {
          pushNotifier
            .notifyDriverPickupUpdated(rider.fcm_token, numericOrderId, cleanAddress, newFare)
            .catch((err) => logger.error(`confirmPickupChange: FCM failed for rider ${riderId}:`, err));
        }
      })
      .catch((err) => logger.error(`confirmPickupChange: rider lookup failed for rider ${riderId}:`, err));
  }

  dispatchManager.emitCustomerEvent(numericUid, "order:pickup_updated", eventPayload);
  adminSocket.notifyOrderStatusUpdate(updatedOrder);

  logger.info(`Pickup updated for order ${numericOrderId}: oldFare=₹${oldFare}, newFare=₹${newFare}, fareDiff=₹${fareDiff}`);

  return {
    order_id: numericOrderId,
    old_distance: oldDistance,
    new_distance: newDistance,
    distance_diff: Math.round((newDistance - oldDistance) * 100) / 100,
    old_fare: oldFare,
    new_fare: newFare,
    fare_diff: fareDiff,
    driver_earning: Number(updatedOrder.driver_earning),
    new_plat: String(newPlat),
    new_plong: String(newPlong),
    new_paddress: cleanAddress,
  };
}

module.exports = {
  previewPickupChange,
  confirmPickupChange,
};
