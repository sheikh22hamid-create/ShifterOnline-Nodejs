const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const lockManager = require("./lockManager");
const pricingEngine = require("./pricingEngine");
const pushNotifier = require("./pushNotifier");
const adminSocket = require("../sockets/adminSocket");
const logger = require("../utils/logger");
const {
  POPUP_TIMEOUT_MS,
  BATCH_GAP_MS,
  MAX_DRIVERS_PER_BATCH,
  MAX_TOPUP_ROUNDS,
  SEARCH_RADIUS_KM,
  STARTUP_RECOVERY_BUFFER_SECONDS,
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
 * Riders who explicitly rejected this order (tbl_order_requests status
 * "10"), in any tier — excluded for the rest of this order's cascade
 * regardless of which model they reject. A rider whose offer merely timed
 * out is NOT included here: once their popup lock is free (see
 * lockManager.getAllLockedRiderIds), they become eligible again in a later
 * tier's batch. Active-popup exclusion (currently locked) is handled
 * separately via lockManager — this function only covers the permanent,
 * explicit-decline case.
 */
async function getRejectedRiderIds(orderId) {
  const rows = await prisma.tbl_order_requests.findMany({
    where: { order_id: orderId, status: "10" },
    select: { rider_id: true },
    distinct: ["rider_id"],
  });
  return rows.map((r) => Number(r.rider_id)).filter((id) => Number.isFinite(id));
}

/**
 * Nearest eligible, non-locked drivers for one dispatch tier: matching
 * vehicle/category, enabled for this package_id, online & approved, within
 * the order's own radius_range km (haversine computed in SQL, per-order
 * since pkg_order.radius_range is set at creation — falls back to
 * SEARCH_RADIUS_KM only for legacy rows that never set it), favorites
 * ranked first (spec §4.4). excludeRiderIds already includes both
 * currently-locked riders (active popup elsewhere) and every rider who
 * explicitly rejected this order (see getRejectedRiderIds) — a rider whose
 * earlier offer on this order simply timed out is free to reappear here
 * once their lock has lapsed.
 */
async function selectEligibleDrivers(order, packageId, excludeRiderIds, limit = MAX_DRIVERS_PER_BATCH + 1) {
  const excludeSet = new Set(excludeRiderIds.map(Number));
  const exclude = excludeSet.size > 0 ? [...excludeSet] : [0];
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
    LIMIT ${limit}
  `;

  // Belt-and-suspenders: the SQL's own NOT IN already excludes these riders,
  // but re-checking in JS means the exclusion is guaranteed by this
  // function's return value regardless of how the query was built.
  return rows.filter((row) => !excludeSet.has(Number(row.rider_id)));
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

async function checkCascadeTermination(orderId) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  // Exhausted once a full round-robin cycle (one turn per tier) has come
  // back with zero new drivers locked in every tier, and nobody is still
  // holding an active popup that could yet accept/reject.
  const isExhausted = state.consecutiveEmptyTurns >= state.tiers.length && (state.activeExpiryTimers || 0) === 0;
  if (!isExhausted) return;

  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (order && order.rid === 0 && order.order_status === 0) {
    try {
      adminSocket.notifyDispatchAlert(orderId, order.city_id);
    } catch (adminErr) {
      logger.error(`dispatchManager: admin socket notify failed for order ${orderId}:`, adminErr);
    }

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { o_status: "Cancelled", cancel_reason: "No driver found" },
    });
    requireIo().to(`customer_${order.uid}`).emit("order:no_driver_found", {
      order_id: String(orderId),
    });
    activeDispatches.delete(orderId);
  }
}

/**
 * Dispatches one batch (one tier's turn) of up to MAX_DRIVERS_PER_BATCH
 * drivers. Uses Round-Robin Tier Rotation:
 * - Every turn queries exactly one tier — state.tierCursor mod tiers.length
 *   — offers up to MAX_DRIVERS_PER_BATCH candidates from it, then always
 *   advances the cursor to the next tier for the next turn, whether or not
 *   this tier still has un-notified candidates left over.
 * - A tier with leftover candidates (more eligible than fit in one batch)
 *   gets revisited on its next turn once the cursor cycles back around —
 *   by then, some previously-locked riders elsewhere may also have freed up
 *   (see getRejectedRiderIds) and be re-offered too.
 * - The within-turn while-loop below is unrelated to tier rotation: it's a
 *   bounded retry against concurrent-order lock contention for this same
 *   tier's candidates (see MAX_TOPUP_ROUNDS), not tier exhaustion.
 */
async function runBatch(orderId) {
  const state = activeDispatches.get(orderId);
  if (!state) return; // stopDispatch already ran (accepted/cancelled)

  const tierIndex = state.tierCursor % state.tiers.length;
  const packageId = state.tiers[tierIndex];
  if (packageId === undefined) {
    await checkCascadeTermination(orderId);
    return;
  }

  const precomputed = (tierIndex === 0 && !state.hasRunTier0) ? state.tier0Precomputed : null;
  state.hasRunTier0 = true;

  const currentOrder = precomputed ? precomputed.order : await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!currentOrder || currentOrder.rid !== 0 || currentOrder.order_status !== 0) {
    return; // already accepted or cancelled by the time this tier fired
  }

  const rejectedRiderIds = await getRejectedRiderIds(orderId);

  const distanceKm = Number(currentOrder.distance) || 0;
  let fare, driverEarning, commission;
  if (precomputed) {
    ({ fare, driverEarning, commission } = precomputed);
  } else {
    ({ fare, driverEarning, commission } = await pricingEngine.priceForPackageId(packageId, distanceKm));
    // Asynchronous update so we don't block driver dispatch by 400-800ms of remote DB latency
    prisma.pkg_order.update({
      where: { id: orderId },
      data: { d_charge: fare, total_dcharge: fare, commission, delivery_type: Number(packageId) },
    }).catch((err) => logger.error("dispatchManager: async pkg_order update failed:", err));
  }

  logger.info(`dispatchManager: order=${orderId} tier=${tierIndex} batch started`);

  const consideredThisBatch = new Set();
  const lockedRiderIds = [];
  let round = 0;

  while (lockedRiderIds.length < MAX_DRIVERS_PER_BATCH && round <= MAX_TOPUP_ROUNDS) {
    // Re-check on every round: an accept (or cancel) that lands mid-batch
    // tears down activeDispatches synchronously via stopDispatch, and no
    // further round of this batch should lock/notify anyone once that's
    // happened, even though this call is already past the top-of-function
    // check above.
    if (!activeDispatches.has(orderId)) break;

    const excludeRiderIds = [...new Set([...lockManager.getAllLockedRiderIds(), ...rejectedRiderIds, ...consideredThisBatch])];
    const candidates = await selectEligibleDrivers(currentOrder, packageId, excludeRiderIds, MAX_DRIVERS_PER_BATCH + 1);

    const eligibleBatch = candidates.slice(0, MAX_DRIVERS_PER_BATCH - lockedRiderIds.length);
    let lockedThisRound = 0;
    const lockedThisRoundDrivers = [];

    for (const driver of eligibleBatch) {
      if (lockedRiderIds.length >= MAX_DRIVERS_PER_BATCH) break;
      const riderId = Number(driver.rider_id);
      consideredThisBatch.add(riderId);
      if (!lockManager.acquireLock(riderId, orderId, POPUP_TIMEOUT_MS)) continue; // lost the race to a concurrent order

      lockedRiderIds.push(riderId);
      lockedThisRound++;
      lockedThisRoundDrivers.push(driver);
    }

    if (lockedThisRoundDrivers.length > 0) {
      const payload = buildOrderRequestPayload(currentOrder, packageId, distanceKm.toFixed(1), driverEarning);
      await Promise.all(
        lockedThisRoundDrivers.map(async (driver) => {
          const riderId = Number(driver.rider_id);
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

          requireIo().to(`driver_${riderId}`).emit("order:request", payload);
          await pushNotifier.notifyDriverOrderRequest(driver.fcm_token, payload);
        })
      );
    }

    logger.info(
      `dispatchManager: order=${orderId} tier=${tierIndex} round=${round} candidates=${candidates.length} locked_this_round=${lockedThisRound} total_locked=${lockedRiderIds.length}`
    );

    if (candidates.length < MAX_DRIVERS_PER_BATCH) break;
    round++;
  }

  logger.info(`dispatchManager: order=${orderId} tier=${tierIndex} batch complete offered=${lockedRiderIds.length}`);

  if (lockedRiderIds.length > 0) {
    scheduleExpiry(orderId, tierIndex, lockedRiderIds);
    state.consecutiveEmptyTurns = 0;
  } else {
    state.consecutiveEmptyTurns = (state.consecutiveEmptyTurns || 0) + 1;
  }

  // Round-robin: always hand the next turn to the next tier, whether or not
  // this tier still has un-notified candidates waiting for a future turn.
  state.tierCursor++;

  if (state.consecutiveEmptyTurns >= state.tiers.length) {
    // A full cycle came back empty in every tier — nobody left to try.
    await checkCascadeTermination(orderId);
    return;
  }

  // Tier Progression:
  // To compensate for remote MySQL network query and socket emit overhead (~1.5-2.0s),
  // we wait 3000ms so that the next batch popup arrives on the driver's phone
  // exactly ~5 seconds after the first batch (when the first batch's timer has ~10s remaining)!
  // If 0 drivers were found this turn, skip straight to the next tier without waiting.
  const delayMs = lockedRiderIds.length === 0 ? 0 : 3000;

  const timer = setTimeout(() => {
    state.timers.delete(timer);
    runBatch(orderId).catch((err) =>
      logger.error(`dispatchManager: next batch failed for order ${orderId}:`, err)
    );
  }, delayMs);
  state.timers.add(timer);
}

function scheduleExpiry(orderId, tierIndex, riderIds) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  state.activeExpiryTimers = (state.activeExpiryTimers || 0) + 1;

  const timer = setTimeout(async () => {
    state.timers.delete(timer);
    state.activeExpiryTimers = Math.max(0, (state.activeExpiryTimers || 1) - 1);

    try {
      const stillPendingRiderIds = riderIds.filter((riderId) => {
        const lock = lockManager.peekLock(riderId);
        return lock && lock.orderId === orderId;
      });

      for (const riderId of stillPendingRiderIds) {
        lockManager.releaseLock(riderId);
        const result = await prisma.tbl_order_requests.updateMany({
          where: { order_id: orderId, rider_id: riderId, status: "sent" },
          data: { status: "timeout" },
        });
        if (result.count === 0) continue;
        requireIo().to(`driver_${riderId}`).emit("order:dismiss", {
          order_id: String(orderId),
          reason: "timeout",
        });
      }

      await checkCascadeTermination(orderId);
    } catch (err) {
      logger.error(`dispatchManager expiry handler failed for order ${orderId}, tier ${tierIndex}:`, err);
    }
  }, POPUP_TIMEOUT_MS);

  state.timers.add(timer);
}

/**
 * Kicks off the overlapping batch cascade for a freshly created order.
 * Uses Round-Robin Tier Rotation:
 * - Batches run sequentially with BATCH_GAP_MS stagger.
 * - Each batch draws from exactly one tier, then always moves on to the
 *   next tier next turn — cycling back to earlier tiers (which may have
 *   leftover or newly-freed candidates) once every tier has had a turn.
 */
async function startDispatch(order, tier0Pricing) {
  if (activeDispatches.has(order.id)) {
    logger.warn(`dispatchManager: startDispatch called again for order ${order.id} while a cascade is already active — ignoring`);
    return;
  }

  let tiers;
  try {
    const parsed = JSON.parse(order.allowed_delivery_types);
    tiers = Array.isArray(parsed) && parsed.length > 0 ? parsed : [order.delivery_type];
  } catch {
    tiers = [order.delivery_type];
  }

  const state = {
    timers: new Set(),
    tiers,
    tierCursor: 0,
    consecutiveEmptyTurns: 0,
    tier0Precomputed: tier0Pricing ? { order, ...tier0Pricing } : null,
    hasRunTier0: false,
    activeExpiryTimers: 0,
  };
  activeDispatches.set(order.id, state);

  runBatch(order.id).catch((err) =>
    logger.error(`dispatchManager: batch 0 failed for order ${order.id}:`, err)
  );
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

    if (ioRef) {
      ioRef.to(`driver_${riderId}`).emit("order:dismiss", {
        order_id: String(orderId),
        reason,
      });
    }
  }

  if (riderIds.length > 0) {
    prisma.tbl_order_requests
      .updateMany({
        where: { order_id: orderId, rider_id: { in: riderIds }, status: "sent" },
        data: { status: newRequestStatus },
      })
      .catch((err) => logger.error(`stopDispatch: failed updating tbl_order_requests for order ${orderId}:`, err));
  }
}

/**
 * One-shot startup cleanup — not a recovery system, just closes out the
 * mess a crash/restart leaves behind: 'sent' offers whose in-memory expiry
 * timer died with the old process (acceptance is already safe against these
 * per tripLifecycle's own freshness check; this just fixes their reporting
 * status), and orders that never resolved because their whole cascade died
 * with the process. Both conditions are generous and self-contained single
 * UPDATEs — never touches anything a live cascade could still be using.
 */
async function reconcileStaleOffersOnStartup() {
  try {
    const popupSeconds = POPUP_TIMEOUT_MS / 1000;
    const staleRequests = await prisma.$executeRaw`
      UPDATE tbl_order_requests
      SET status = 'timeout'
      WHERE status = 'sent' AND created_at <= (NOW() - INTERVAL ${popupSeconds} SECOND)
    `;
    if (staleRequests > 0) {
      logger.warn(`dispatchManager: startup reconciliation flipped ${staleRequests} stale 'sent' request(s) to 'timeout'`);
    }

    const staleOrders = await prisma.$executeRaw`
      UPDATE pkg_order
      SET o_status = 'Cancelled', cancel_reason = 'No driver found (recovered after restart)'
      WHERE o_status = 'Pending' AND rid = 0 AND order_status = 0
        AND odate <= (NOW() - INTERVAL ${STARTUP_RECOVERY_BUFFER_SECONDS} SECOND)
    `;
    if (staleOrders > 0) {
      logger.warn(`dispatchManager: startup reconciliation cancelled ${staleOrders} orphaned Pending order(s)`);
    }
  } catch (err) {
    logger.error("dispatchManager: startup reconciliation failed:", err);
  }
}

module.exports = {
  init,
  startDispatch,
  stopDispatch,
  selectEligibleDrivers,
  reconcileStaleOffersOnStartup,
};
