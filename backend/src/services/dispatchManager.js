const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const lockManager = require("./lockManager");
const pricingEngine = require("./pricingEngine");
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
 * Every rider who has already been sent an offer for this order, in any
 * tier, regardless of how it was resolved (sent/timeout/rejected/accepted).
 * Cross-tier dedup: a driver eligible for multiple selected models must
 * only ever see one offer per booking (no re-entry within the same order).
 */
async function getPreviouslyAttemptedRiderIds(orderId) {
  const rows = await prisma.tbl_order_requests.findMany({
    where: { order_id: orderId },
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
 * currently-locked riders and every rider previously attempted on this
 * order (see getPreviouslyAttemptedRiderIds) — no driver sees the same
 * booking twice.
 */
async function selectEligibleDrivers(order, packageId, excludeRiderIds) {
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
    LIMIT ${MAX_DRIVERS_PER_BATCH}
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

/**
 * Dispatches one tier's batch. Deliberately NOT serialized against other
 * orders (no global mutex) — independent bookings must select/lock/offer
 * concurrently. The only shared resource across orders is lockManager's
 * activePopups map, and acquireLock() is already atomic (synchronous
 * check-and-set, no await inside it), so two orders racing for the same
 * rider always resolve to exactly one winner with no extra locking needed.
 *
 * What the mutex actually used to paper over: two orders' eligibility
 * queries can legitimately return overlapping candidates (neither knows
 * about the other's not-yet-acquired locks), so whichever order loses a
 * given rider to the other must not just ship an under-filled batch — it
 * tops itself back up with a fresh query (excluding everyone now known
 * taken), bounded to MAX_TOPUP_ROUNDS extra rounds so a genuinely small
 * eligible pool still resolves immediately rather than retrying pointlessly.
 */
async function runBatch(orderId, tierIndex) {
  const state = activeDispatches.get(orderId);
  if (!state) return; // stopDispatch already ran (accepted/cancelled)

  const packageId = state.tiers[tierIndex];
  if (packageId === undefined) return;

  // Tier 0 only: startDispatch was handed the just-created order row and
  // its already-computed pricing (same package_id + distance createOrder
  // just validated and priced). Nothing external can have changed rid/
  // order_status/pricing in the sub-millisecond gap between the INSERT and
  // this call — reusing them skips two remote DB round trips (a re-fetch of
  // the row we already have, and a re-fetch+re-write of pricing the INSERT
  // already wrote correctly). Tier 1+ always re-fetch: real time has
  // passed, so the order's state may have legitimately changed.
  const precomputed = tierIndex === 0 ? state.tier0Precomputed : null;

  const currentOrder = precomputed ? precomputed.order : await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (!currentOrder || currentOrder.rid !== 0 || currentOrder.order_status !== 0) {
    return; // already accepted or cancelled by the time this tier fired
  }

  const attemptedRiderIds = await getPreviouslyAttemptedRiderIds(orderId);

  const distanceKm = Number(currentOrder.distance) || 0;
  let fare, driverEarning, commission;
  if (precomputed) {
    ({ fare, driverEarning, commission } = precomputed);
  } else {
    ({ fare, driverEarning, commission } = await pricingEngine.priceForPackageId(packageId, distanceKm));
    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { d_charge: fare, total_dcharge: fare, commission, delivery_type: Number(packageId) },
    });
  }

  logger.info(`dispatchManager: order=${orderId} tier=${tierIndex} batch started`);

  // Riders already tried in THIS batch (won or lost) — re-read fresh each
  // round via getAllLockedRiderIds() so a rider locked by a *different*
  // concurrent order between rounds is also excluded, not just our own.
  const consideredThisBatch = new Set();
  const lockedRiderIds = [];
  let round = 0;

  while (lockedRiderIds.length < MAX_DRIVERS_PER_BATCH && round <= MAX_TOPUP_ROUNDS) {
    const excludeRiderIds = [...new Set([...lockManager.getAllLockedRiderIds(), ...attemptedRiderIds, ...consideredThisBatch])];
    const candidates = await selectEligibleDrivers(currentOrder, packageId, excludeRiderIds);

    let lockedThisRound = 0;
    for (const driver of candidates) {
      if (lockedRiderIds.length >= MAX_DRIVERS_PER_BATCH) break;
      const riderId = Number(driver.rider_id);
      consideredThisBatch.add(riderId);
      if (!lockManager.acquireLock(riderId, orderId, POPUP_TIMEOUT_MS)) continue; // lost the race to a concurrent order

      lockedRiderIds.push(riderId);
      lockedThisRound++;

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

    logger.info(
      `dispatchManager: order=${orderId} tier=${tierIndex} round=${round} candidates=${candidates.length} locked_this_round=${lockedThisRound} total_locked=${lockedRiderIds.length}`
    );

    // Fewer candidates than the batch size means the eligible pool is
    // genuinely exhausted at these exclusions — another round can't find
    // more, so stop instead of retrying pointlessly.
    if (candidates.length < MAX_DRIVERS_PER_BATCH) break;
    round++;
  }

  logger.info(`dispatchManager: order=${orderId} tier=${tierIndex} batch complete offered=${lockedRiderIds.length}`);
  scheduleExpiry(orderId, tierIndex, lockedRiderIds);
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
        const result = await prisma.tbl_order_requests.updateMany({
          where: { order_id: orderId, rider_id: riderId, status: "sent" },
          data: { status: "timeout" },
        });
        // 0 rows means this offer was already resolved (accepted/rejected/
        // cancelled) by the time this sweep reached it — the timer here is
        // only for cleanup, never authoritative, so don't tell a driver who
        // already won (or otherwise resolved) that their offer timed out.
        if (result.count === 0) continue;
        requireIo().to(`driver_${riderId}`).emit("order:dismiss", {
          order_id: String(orderId),
          reason: "timeout",
        });
      }

      const isLastTier = tierIndex === state.tiers.length - 1;
      if (!isLastTier) return;

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
    } catch (err) {
      logger.error(`dispatchManager expiry handler failed for order ${orderId}, tier ${tierIndex}:`, err);
    }
  }, POPUP_TIMEOUT_MS);

  state.timers.add(timer);
}

/**
 * Kicks off the overlapping batch cascade for a freshly created order.
 * `order.allowed_delivery_types` is the JSON-text column listing package
 * IDs in tier order (spec §3.1). Idempotency guard: a duplicate call for an
 * order that already has a cascade running (retry, duplicate event, etc.)
 * is a no-op rather than starting a second overlapping set of timers.
 *
 * `tier0Pricing` (optional): `{fare, driverEarning, commission}` the caller
 * already computed for `order`'s first tier (e.g. createOrder, which prices
 * it to populate the INSERT) — lets runBatch's T=0 pass skip re-deriving
 * the same numbers. Omit to have tier 0 fetch/compute for itself as before.
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
    tier0Precomputed: tier0Pricing ? { order, ...tier0Pricing } : null,
  };
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
