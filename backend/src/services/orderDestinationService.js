const prisma = require("../config/db");
const pricingEngine = require("./pricingEngine");
const dispatchManager = require("./dispatchManager");
const pushNotifier = require("./pushNotifier");
const adminSocket = require("../sockets/adminSocket");
const { getRoadDistanceKm, getMultiStopDistanceKm, haversineKm } = require("../utils/geoDistance");
const logger = require("../utils/logger");

function isValidCoord(val, min, max) {
  const num = Number(val);
  return Number.isFinite(num) && num >= min && num <= max;
}

function sanitizeAddress(addr) {
  if (typeof addr !== "string") return "";
  return addr.trim().slice(0, 500);
}

/**
 * Calculates road distance for an order given a new drop location.
 */
async function computeNewRouteDistance(order, newDlat, newDlong) {
  const stops = await prisma.pkg_order_stops.findMany({
    where: { order_id: Number(order.id) },
    orderBy: { sequence: "asc" },
  });

  const plat = Number(order.plat);
  const plong = Number(order.plong);
  const dlat = Number(newDlat);
  const dlong = Number(newDlong);

  if (stops.length > 0) {
    const points = [
      { lat: plat, lng: plong },
      ...stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })),
      { lat: dlat, lng: dlong },
    ];
    const multiResult = await getMultiStopDistanceKm(points);
    return Math.max(0.1, Number(multiResult.distanceKm) || 0.1);
  }

  const roadResult = await getRoadDistanceKm(plat, plong, dlat, dlong);
  let distanceKm = Number(roadResult.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    distanceKm = haversineKm(plat, plong, dlat, dlong) * 1.3;
  }
  return Math.max(0.1, Math.round(distanceKm * 100) / 100);
}

/**
 * Previews destination change and calculates distance/fare difference without updating DB.
 */
async function previewDestinationChange({ uid, orderId, newDlat, newDlong, newDaddress }) {
  const numericOrderId = Number(orderId);
  const numericUid = Number(uid);

  if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
    throw new Error("INVALID_ORDER_ID");
  }
  if (!Number.isSafeInteger(numericUid) || numericUid <= 0) {
    throw new Error("INVALID_UID");
  }
  if (!isValidCoord(newDlat, -90, 90) || !isValidCoord(newDlong, -180, 180)) {
    throw new Error("INVALID_COORDINATES");
  }

  const cleanAddress = sanitizeAddress(newDaddress);
  if (!cleanAddress || cleanAddress.length < 3) {
    throw new Error("INVALID_ADDRESS");
  }

  const order = await prisma.pkg_order.findUnique({
    where: { id: numericOrderId },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }
  if (order.uid !== numericUid) {
    throw new Error("FORBIDDEN");
  }

  const activeStatuses = [0, 1, 2, 3];
  if (!activeStatuses.includes(order.order_status) || order.o_status === "Completed" || order.o_status === "Cancelled") {
    throw new Error("ORDER_NOT_ACTIVE");
  }

  const newDistanceKm = await computeNewRouteDistance(order, newDlat, newDlong);
  const radiusKm = Number(order.pickup_distance_km) || Number(order.radius_range) || 1;
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
    new_dlat: String(newDlat),
    new_dlong: String(newDlong),
    new_daddress: cleanAddress,
  };
}

/**
 * Confirms destination change inside a database transaction, updates order,
 * emits real-time socket events to driver and customer, and sends FCM push to driver.
 */
async function confirmDestinationChange({ uid, orderId, newDlat, newDlong, newDaddress }) {
  const numericOrderId = Number(orderId);
  const numericUid = Number(uid);

  if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
    throw new Error("INVALID_ORDER_ID");
  }
  if (!Number.isSafeInteger(numericUid) || numericUid <= 0) {
    throw new Error("INVALID_UID");
  }
  if (!isValidCoord(newDlat, -90, 90) || !isValidCoord(newDlong, -180, 180)) {
    throw new Error("INVALID_COORDINATES");
  }

  const cleanAddress = sanitizeAddress(newDaddress);
  if (!cleanAddress || cleanAddress.length < 3) {
    throw new Error("INVALID_ADDRESS");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pkg_order WHERE id = ${numericOrderId} FOR UPDATE`;

    const order = await tx.pkg_order.findUnique({
      where: { id: numericOrderId },
    });

    if (!order) {
      throw new Error("ORDER_NOT_FOUND");
    }
    if (order.uid !== numericUid) {
      throw new Error("FORBIDDEN");
    }

    const activeStatuses = [0, 1, 2, 3];
    if (!activeStatuses.includes(order.order_status) || order.o_status === "Completed" || order.o_status === "Cancelled") {
      throw new Error("ORDER_NOT_ACTIVE");
    }

    const newDistanceKm = await computeNewRouteDistance(order, newDlat, newDlong);
    const radiusKm = Number(order.pickup_distance_km) || Number(order.radius_range) || 1;
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

    const updatedOrder = await tx.pkg_order.update({
      where: { id: numericOrderId },
      data: {
        dlat: String(newDlat),
        dlong: String(newDlong),
        daddress: cleanAddress,
        distance: newDistance,
        d_charge: newFare,
        total_dcharge: newFare,
        driver_earning: driverEarning,
        commission: commission,
      },
    });

    if (order.rid && order.rid > 0) {
      await tx.driver_trip_event.create({
        data: {
          order_id: numericOrderId,
          rider_id: order.rid,
          user_id: numericUid,
          milestone: "destination_updated",
          payload: {
            order_id: numericOrderId,
            old_address: order.daddress || "",
            new_address: cleanAddress,
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

    return {
      updatedOrder,
      riderId: order.rid,
      oldFare,
      newFare,
      fareDiff,
      oldDistance,
      newDistance,
      cleanAddress,
    };
  });

  const { updatedOrder, riderId, oldFare, newFare, fareDiff, oldDistance, newDistance } = result;

  const eventPayload = {
    order_id: String(numericOrderId),
    dlat: String(newDlat),
    dlong: String(newDlong),
    daddress: cleanAddress,
    delivery_address: cleanAddress,
    distance: String(newDistance),
    old_fare: String(oldFare),
    new_fare: String(newFare),
    fare: String(newFare),
    total: String(newFare),
    fare_diff: String(fareDiff),
    estimated_earning: String(updatedOrder.driver_earning),
    driver_earning: String(updatedOrder.driver_earning),
    message: `Drop location updated to ${cleanAddress}`,
  };

  if (riderId && riderId > 0) {
    dispatchManager.emitDriverEvent(riderId, "order:destination_updated", eventPayload);

    prisma.tbl_rider
      .findUnique({
        where: { id: riderId },
        select: { fcm_token: true },
      })
      .then((rider) => {
        if (rider?.fcm_token) {
          pushNotifier
            .notifyDriverDestinationUpdated(rider.fcm_token, numericOrderId, cleanAddress, newFare)
            .catch((err) => logger.error(`confirmDestinationChange: FCM failed for rider ${riderId}:`, err));
        }
      })
      .catch((err) => logger.error(`confirmDestinationChange: rider lookup failed for rider ${riderId}:`, err));
  }

  dispatchManager.emitCustomerEvent(numericUid, "order:destination_updated", eventPayload);
  adminSocket.notifyOrderStatusUpdate(updatedOrder);

  logger.info(`Destination updated for order ${numericOrderId}: oldFare=₹${oldFare}, newFare=₹${newFare}, fareDiff=₹${fareDiff}`);

  return {
    order_id: numericOrderId,
    old_distance: oldDistance,
    new_distance: newDistance,
    distance_diff: Math.round((newDistance - oldDistance) * 100) / 100,
    old_fare: oldFare,
    new_fare: newFare,
    fare_diff: fareDiff,
    driver_earning: Number(updatedOrder.driver_earning),
    new_dlat: String(newDlat),
    new_dlong: String(newDlong),
    new_daddress: cleanAddress,
  };
}

module.exports = {
  previewDestinationChange,
  confirmDestinationChange,
};
