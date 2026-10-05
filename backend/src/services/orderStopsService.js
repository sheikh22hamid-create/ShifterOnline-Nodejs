const prisma = require("../config/db");
const pricingEngine = require("./pricingEngine");
const dispatchManager = require("./dispatchManager");
const pushNotifier = require("./pushNotifier");
const adminSocket = require("../sockets/adminSocket");
const { getDriverRealDistanceKm, computeRouteDistanceKm } = require("./orderRouteRepricing");
const logger = require("../utils/logger");
const { reconcileRideDiscountToFare } = require("./referralPointsRefund");

// Same window as pickup-change: a stop can be added any time before the
// goods are actually picked up, never once the trip is on-route (the
// driver may already have passed some stops by then).
const STOP_EDITABLE_STATUSES = [0, 1, 2];

function isValidCoord(val, min, max) {
  const num = Number(val);
  return Number.isFinite(num) && num >= min && num <= max;
}

function sanitizeAddress(addr) {
  if (typeof addr !== "string") return "";
  return addr.trim().slice(0, 500);
}

function assertUsable({ orderId, uid, lat, lng }) {
  const numericOrderId = Number(orderId);
  const numericUid = Number(uid);

  if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
    throw new Error("INVALID_ORDER_ID");
  }
  if (!Number.isSafeInteger(numericUid) || numericUid <= 0) {
    throw new Error("INVALID_UID");
  }
  if (!isValidCoord(lat, -90, 90) || !isValidCoord(lng, -180, 180)) {
    throw new Error("INVALID_COORDINATES");
  }
  return { numericOrderId, numericUid };
}

function assertOrderEditable(order, numericUid) {
  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }
  if (order.uid !== numericUid) {
    throw new Error("FORBIDDEN");
  }
  if (!STOP_EDITABLE_STATUSES.includes(order.order_status) || order.o_status === "Completed" || order.o_status === "Cancelled") {
    throw new Error("ORDER_NOT_ACTIVE");
  }
}

async function priceWithStop(order, existingStops, newStop) {
  const stops = [...existingStops, newStop];
  const newDistanceKm = await computeRouteDistanceKm({
    plat: order.plat, plong: order.plong, stops, dlat: order.dlat, dlong: order.dlong,
  });
  // Pickup itself hasn't moved — same real driver-to-pickup distance basis
  // destination/pickup-change use, never radius_range.
  const radiusKm = await getDriverRealDistanceKm(order.rid, order.plat, order.plong);
  const stopSettings = await pricingEngine.getAddStopSettings(order.category);
  const newExtraMileCharge = (Number(order.extra_mile_charge) || 0) + stopSettings.extraStopCharge;
  const packageId = Number(order.delivery_type) || 1;

  const priced = await pricingEngine.priceForPackageId(packageId, newDistanceKm, radiusKm, newExtraMileCharge, order.uid);
  return { newDistanceKm, newExtraMileCharge, stopSettings, ...priced };
}

/**
 * Previews adding a stop and calculates the resulting distance/fare without
 * writing to the DB. Mirrors orderDestinationService.previewDestinationChange.
 */
async function previewAddStop({ uid, orderId, lat, lng, address, hno, landmark, contact_name, contact_number }) {
  const { numericOrderId, numericUid } = assertUsable({ orderId, uid, lat, lng });

  const order = await prisma.pkg_order.findUnique({ where: { id: numericOrderId } });
  assertOrderEditable(order, numericUid);

  const existingStops = await prisma.pkg_order_stops.findMany({
    where: { order_id: numericOrderId }, orderBy: { sequence: "asc" },
  });
  const stopSettingsCheck = await pricingEngine.getAddStopSettings(order.category);
  if (existingStops.length >= stopSettingsCheck.maxExtraStops) {
    throw new Error("MAX_STOPS_EXCEEDED");
  }

  const cleanAddress = sanitizeAddress(address);
  const newStop = { lat: Number(lat), lng: Number(lng) };
  const { newDistanceKm, fare, driverEarning, commission } = await priceWithStop(order, existingStops, newStop);

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
    stop_address: cleanAddress,
  };
}

/**
 * Confirms adding a stop inside a database transaction: inserts the stop
 * row, bumps extra_mile_charge by the admin-configured per-stop rate (same
 * convention createOrderCore uses for stops added at booking time), and
 * reprices the order off the new multi-stop route.
 */
async function confirmAddStop({ uid, orderId, lat, lng, address, hno, landmark, contact_name, contact_number }) {
  const { numericOrderId, numericUid } = assertUsable({ orderId, uid, lat, lng });
  const cleanAddress = sanitizeAddress(address);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pkg_order WHERE id = ${numericOrderId} FOR UPDATE`;

    const order = await tx.pkg_order.findUnique({ where: { id: numericOrderId } });
    assertOrderEditable(order, numericUid);

    const existingStops = await tx.pkg_order_stops.findMany({
      where: { order_id: numericOrderId }, orderBy: { sequence: "asc" },
    });
    const stopSettingsCheck = await pricingEngine.getAddStopSettings(order.category);
    if (existingStops.length >= stopSettingsCheck.maxExtraStops) {
      throw new Error("MAX_STOPS_EXCEEDED");
    }

    const newStop = { lat: Number(lat), lng: Number(lng) };
    const { newDistanceKm, newExtraMileCharge, fare, driverEarning, commission } =
      await priceWithStop(order, existingStops, newStop);

    const oldFare = Math.round(Number(order.total_dcharge) > 0 ? Number(order.total_dcharge) : Number(order.d_charge) || 0);
    const newFare = Math.round(fare);
    const oldDistance = Math.round((Number(order.distance) || 0) * 100) / 100;
    const newDistance = Math.round(newDistanceKm * 100) / 100;
    const fareDiff = newFare - oldFare;

    await tx.pkg_order_stops.create({
      data: {
        order_id: numericOrderId,
        sequence: existingStops.length + 1,
        lat: String(lat),
        lng: String(lng),
        address: cleanAddress || null,
        hno: hno || null,
        landmark: landmark || null,
        contact_name: contact_name || null,
        contact_number: contact_number || null,
      },
    });

    const updatedOrder = await tx.pkg_order.update({
      where: { id: numericOrderId },
      data: {
        distance: newDistance,
        d_charge: newFare,
        total_dcharge: newFare,
        driver_earning: driverEarning,
        commission: commission,
        extra_mile_charge: newExtraMileCharge,
      },
    });
    await reconcileRideDiscountToFare(numericOrderId, newFare, tx);

    if (order.rid && order.rid > 0) {
      // Each stop gets its own milestone name (stop_added_<sequence>), not a
      // shared "stop_added" - driver_trip_event has a unique (order_id,
      // milestone) constraint, so a second stop on the same order would
      // throw on a shared milestone with a plain .create().
      await tx.driver_trip_event.create({
        data: {
          order_id: numericOrderId,
          rider_id: order.rid,
          user_id: numericUid,
          milestone: `stop_added_${existingStops.length + 1}`,
          payload: {
            order_id: numericOrderId,
            stop_address: cleanAddress,
            old_fare: oldFare,
            new_fare: newFare,
            fare_diff: fareDiff,
            old_distance: oldDistance,
            new_distance: newDistance,
            updated_at: new Date().toISOString(),
          },
        },
      });
    }

    return { updatedOrder, riderId: order.rid, oldFare, newFare, fareDiff, oldDistance, newDistance };
  });

  const { updatedOrder, riderId, oldFare, newFare, fareDiff, oldDistance, newDistance } = result;

  const eventPayload = {
    order_id: String(numericOrderId),
    stop_address: cleanAddress,
    distance: String(newDistance),
    old_fare: String(oldFare),
    new_fare: String(newFare),
    fare: String(newFare),
    total: String(newFare),
    fare_diff: String(fareDiff),
    estimated_earning: String(updatedOrder.driver_earning),
    driver_earning: String(updatedOrder.driver_earning),
    message: `Stop added: ${cleanAddress}`,
  };

  if (riderId && riderId > 0) {
    dispatchManager.emitDriverEvent(riderId, "order:stop_added", eventPayload);

    prisma.tbl_rider
      .findUnique({ where: { id: riderId }, select: { fcm_token: true } })
      .then((rider) => {
        if (rider?.fcm_token) {
          pushNotifier
            .notifyDriverStopAdded(rider.fcm_token, numericOrderId, cleanAddress, newFare)
            .catch((err) => logger.error(`confirmAddStop: FCM failed for rider ${riderId}:`, err));
        }
      })
      .catch((err) => logger.error(`confirmAddStop: rider lookup failed for rider ${riderId}:`, err));
  }

  dispatchManager.emitCustomerEvent(numericUid, "order:stop_added", eventPayload);
  adminSocket.notifyOrderStatusUpdate(updatedOrder);

  logger.info(`Stop added for order ${numericOrderId}: oldFare=₹${oldFare}, newFare=₹${newFare}, fareDiff=₹${fareDiff}`);

  return {
    order_id: numericOrderId,
    old_distance: oldDistance,
    new_distance: newDistance,
    distance_diff: Math.round((newDistance - oldDistance) * 100) / 100,
    old_fare: oldFare,
    new_fare: newFare,
    fare_diff: fareDiff,
    driver_earning: Number(updatedOrder.driver_earning),
    stop_address: cleanAddress,
  };
}

module.exports = {
  previewAddStop,
  confirmAddStop,
};
