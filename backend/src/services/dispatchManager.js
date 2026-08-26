const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const lockManager = require("./lockManager");
const pricingEngine = require("./pricingEngine");
const logger = require("../utils/logger");
const {
  POPUP_TIMEOUT_MS,
  BATCH_GAP_MS,
  MAX_DRIVERS_PER_BATCH,
  SEARCH_RADIUS_KM,
} = require("../config/constants");

/** orderId -> { timers: Set<Timeout>, tiers: number[] } */
const activeDispatches = new Map();

let ioRef = null;

function init(io) {
  ioRef = io;
}

function requireIo() {
  if (!ioRef) {
    throw new Error("dispatchManager.init(io) must be called before dispatching orders");
  }
  return ioRef;
}

/**
 * Nearest eligible, non-locked drivers for one dispatch tier: matching
 * vehicle/category, enabled for this package_id, online & approved, within
 * the order's own radius_range km (haversine computed in SQL, per-order
 * since pkg_order.radius_range is set at creation — falls back to
 * SEARCH_RADIUS_KM only for legacy rows that never set it), favorites
 * ranked first (spec §4.4).
 */
async function selectEligibleDrivers(order, packageId, excludeRiderIds) {
  const exclude = excludeRiderIds.length > 0 ? excludeRiderIds.map(Number) : [0];
  const radiusKm = Number(order.radius_range) || SEARCH_RADIUS_KM;

  const rows = await prisma.$queryRaw`
    SELECT
      r.id AS rider_id,
      r.rlats AS rlats,
      r.rlongs AS rlongs,
      r.fcm_token AS fcm_token,
      (6371 * ACOS(
        LEAST(1, GREATEST(-1,
          COS(RADIANS(${Number(order.plat)})) * COS(RADIANS(CAST(r.rlats AS DECIMAL(10,6)))) *
          COS(RADIANS(CAST(r.rlongs AS DECIMAL(10,6))) - RADIANS(${Number(order.plong)})) +
          SIN(RADIANS(${Number(order.plat)})) * SIN(RADIANS(CAST(r.rlats AS DECIMAL(10,6))))
        ))
      )) AS distance_km,
      CASE WHEN fav.id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
    FROM tbl_rider r
    INNER JOIN tbl_rider_delivery_type dt
      ON dt.rider_id = r.id AND dt.delivery_type = ${String(packageId)} AND dt.status = 1
    LEFT JOIN tbl_favorite_driver fav
      ON fav.rider_id = r.id AND fav.user_id = ${Number(order.uid)} AND fav.status = 1
    WHERE r.a_status = 1
      AND r.status = 1
      AND r.vehicle = ${order.category}
      AND r.rlats IS NOT NULL AND r.rlats != ''
      AND r.rlongs IS NOT NULL AND r.rlongs != ''
      AND r.id NOT IN (${Prisma.join(exclude)})
    HAVING distance_km <= ${radiusKm}
    ORDER BY is_favorite DESC, distance_km ASC
    LIMIT ${MAX_DRIVERS_PER_BATCH}
  `;

  return rows;
}

function buildOrderRequestPayload(order, packageId, distanceKm, driverEarning) {
  return {
    order_id: String(order.id),
    package_id: String(packageId),
    category: order.category,
    customer_name: order.pick_name,
    customer_phone: order.pmobile,
    pickup_address: order.paddress,
    pickup_latitude: order.plat,
    pickup_longitude: order.plong,
    delivery_address: order.daddress,
    delivery_latitude: order.dlat,
    delivery_longitude: order.dlong,
    distance_km: String(distanceKm),
    driver_earning: String(driverEarning),
    popup_duration: POPUP_TIMEOUT_MS / 1000,
  };
}

async function runBatch(orderId, tierIndex) {
  const state = activeDispatches.get(orderId);
  if (!state) return; // stopDispatch already ran (accepted/cancelled)

  const packageId = state.tiers[tierIndex];
  if (packageId === undefined) return;

  await lockManager.withSelectionLock(async () => {
    const currentOrder = await prisma.pkg_order.findUnique({ where: { id: orderId } });
    if (!currentOrder || currentOrder.rid !== 0 || currentOrder.order_status !== 0) {
      return; // already accepted or cancelled by the time this tier fired
    }

    const excludeRiderIds = lockManager.getAllLockedRiderIds();
    const drivers = await selectEligibleDrivers(currentOrder, packageId, excludeRiderIds);

    const distanceKm = Number(currentOrder.distance) || 0;
    const { fare, driverEarning, commission } = await pricingEngine.priceForPackageId(packageId, distanceKm);

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { d_charge: fare, total_dcharge: fare, commission, delivery_type: Number(packageId) },
    });

    const lockedRiderIds = [];
    for (const driver of drivers) {
      const riderId = Number(driver.rider_id);
      if (!lockManager.acquireLock(riderId, orderId, POPUP_TIMEOUT_MS)) continue;

      lockedRiderIds.push(riderId);
      await prisma.tbl_order_requests.create({
        data: {
          order_id: orderId,
          rider_id: riderId,
          package_id: Number(packageId),
          status: "sent",
          lat: driver.rlats ? String(driver.rlats) : null,
          lng: driver.rlongs ? String(driver.rlongs) : null,
        },
      });

      requireIo()
        .to(`driver_${riderId}`)
        .emit("order:request", buildOrderRequestPayload(currentOrder, packageId, distanceKm.toFixed(1), driverEarning));
    }

    scheduleExpiry(orderId, tierIndex, lockedRiderIds);
  });
}

function scheduleExpiry(orderId, tierIndex, riderIds) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  const timer = setTimeout(async () => {
    state.timers.delete(timer);

    try {
      const stillPendingRiderIds = riderIds.filter((riderId) => {
        const lock = lockManager.peekLock(riderId);
        return lock && lock.orderId === orderId;
      });

      for (const riderId of stillPendingRiderIds) {
        lockManager.releaseLock(riderId);
        await prisma.tbl_order_requests.updateMany({
          where: { order_id: orderId, rider_id: riderId, status: "sent" },
          data: { status: "timeout" },
        });
        requireIo().to(`driver_${riderId}`).emit("order:dismiss", {
          order_id: String(orderId),
          reason: "timeout",
        });
      }

      const isLastTier = tierIndex === state.tiers.length - 1;
      if (!isLastTier) return;

      const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
      if (order && order.rid === 0 && order.order_status === 0) {
        await prisma.pkg_order.update({
          where: { id: orderId },
          data: { o_status: "Cancelled", cancel_reason: "No driver found" },
        });
        requireIo().to(`customer_${order.uid}`).emit("order:no_driver_found", {
          order_id: String(orderId),
        });
        activeDispatches.delete(orderId);
      }
    } catch (err) {
      logger.error(`dispatchManager expiry handler failed for order ${orderId}, tier ${tierIndex}:`, err);
    }
  }, POPUP_TIMEOUT_MS);

  state.timers.add(timer);
}

/**
 * Kicks off the overlapping batch cascade for a freshly created order.
 * `order.allowed_delivery_types` is the JSON-text column listing package
 * IDs in tier order (spec §3.1).
 */
async function startDispatch(order) {
  let tiers;
  try {
    const parsed = JSON.parse(order.allowed_delivery_types);
    tiers = Array.isArray(parsed) && parsed.length > 0 ? parsed : [order.delivery_type];
  } catch {
    tiers = [order.delivery_type];
  }

  const state = { timers: new Set(), tiers };
  activeDispatches.set(order.id, state);

  runBatch(order.id, 0).catch((err) =>
    logger.error(`dispatchManager: batch 0 failed for order ${order.id}:`, err)
  );

  for (let tierIndex = 1; tierIndex < tiers.length; tierIndex++) {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      runBatch(order.id, tierIndex).catch((err) =>
        logger.error(`dispatchManager: batch ${tierIndex} failed for order ${order.id}:`, err)
      );
    }, tierIndex * BATCH_GAP_MS);
    state.timers.add(timer);
  }
}

/**
 * Cancels every pending timer for an order and releases/dismisses every
 * driver still holding a popup for it. Reasons: 'accepted_by_other',
 * 'cancelled_by_user'.
 */
function stopDispatch(orderId, reason) {
  const state = activeDispatches.get(orderId);
  if (state) {
    for (const timer of state.timers) clearTimeout(timer);
    activeDispatches.delete(orderId);
  }

  const riderIds = lockManager.getLockedRidersForOrder(orderId);
  const newRequestStatus = reason === "accepted_by_other" ? "auto_rejected" : "timeout";

  for (const riderId of riderIds) {
    lockManager.releaseLock(riderId);

    prisma.tbl_order_requests
      .updateMany({
        where: { order_id: orderId, rider_id: riderId, status: "sent" },
        data: { status: newRequestStatus },
      })
      .catch((err) => logger.error(`stopDispatch: failed updating tbl_order_requests for order ${orderId}:`, err));

    if (ioRef) {
      ioRef.to(`driver_${riderId}`).emit("order:dismiss", {
        order_id: String(orderId),
        reason,
      });
    }
  }
}

module.exports = {
  init,
  startDispatch,
  stopDispatch,
  selectEligibleDrivers,
};
