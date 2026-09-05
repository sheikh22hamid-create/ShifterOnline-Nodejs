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
    LEFT JOIN tbl_rider_delivery_type dt
      ON dt.rider_id = r.id AND dt.delivery_type = ${String(packageId)}
    LEFT JOIN tbl_favorite_driver fav
      ON fav.rider_id = r.id AND fav.user_id = ${Number(order.uid)} AND fav.status = 1
    WHERE r.a_status = 1
      AND r.status = 1
      AND r.vehicle = ${order.category}
      AND (dt.status = 1 OR dt.status IS NULL)
      AND r.rlats IS NOT NULL AND r.rlats != ''
      AND r.rlongs IS NOT NULL AND r.rlongs != ''
      AND r.id NOT IN (${Prisma.join(exclude)})
      AND r.id NOT IN (
        SELECT rid FROM pkg_order
        WHERE order_status IN (1, 2, 3) AND rid > 0
          AND o_status NOT IN ('Completed', 'Cancelled')
      )
    HAVING distance_km <= ${radiusKm}
    ORDER BY is_favorite DESC, distance_km ASC
    LIMIT ${limit}
  `;

  // Belt-and-suspenders: the SQL's own NOT IN already excludes these riders,
  // but re-checking in JS means the exclusion is guaranteed by this
  // function's return value regardless of how the query was built.
  return rows.filter((row) => !excludeSet.has(Number(row.rider_id)));
}

const STANDARD_MODEL_TITLES = {
  6: "Model 1",
  7: "Model 2",
  21: "Model 3",
  33: "Model 4",
  34: "Model 5",
};

function buildOrderRequestPayload(order, packageId, distanceKm, driverEarning, tripTotal, packageTitle) {
  const modelName = STANDARD_MODEL_TITLES[Number(packageId)] || packageTitle || `Model ${packageId}`;
  return {
    type: "order",
    order_id: String(order.id),
    package_id: String(packageId),
    delivery_type: String(packageId),
    package_name: modelName,
    package_title: modelName,
    model_name: modelName,
    category: order.category,
    customer_name: order.pick_name || "Customer",
    customer_phone: order.pmobile || "",
    pickup_address: order.paddress || "",
    pickup_latitude: String(order.plat),
    pickup_longitude: String(order.plong),
    delivery_address: order.daddress || "",
    delivery_latitude: String(order.dlat),
    delivery_longitude: String(order.dlong),
    distance_km: String(distanceKm),
    distance: String(Math.round(Number(distanceKm) * 100) / 100),
    estimated_earning: String(tripTotal || driverEarning),
    driver_earning: String(tripTotal || driverEarning),
    trip_total: String(tripTotal || driverEarning),
    pickup_time: new Date().toISOString(),
    order_details: `${order.category || "Bike"} (${modelName}) - ${order.package_weight || 0}`,
    popup_duration: String(POPUP_TIMEOUT_MS / 1000),
  };
}

async function checkCascadeTermination(orderId) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  // Exhausted once either (a) a full round-robin cycle has come back with
  // zero new drivers locked in every tier, or (b) a full lap around every
  // tier just finished without adding a single rider this cascade hasn't
  // already tried before (staleLaps — see runBatch: without this, a lone
  // rider who only ever lets their popup time out, never rejecting, stays
  // "eligible again" after every timeout and would otherwise be re-offered
  // the same order's tiers forever, since (a) alone can never fire for them)
  // — and, either way, nobody is still holding an active popup that could
  // yet accept/reject.
  const isExhausted =
    (state.consecutiveEmptyTurns >= state.tiers.length || (state.staleLaps || 0) >= 1) &&
    (state.activeExpiryTimers || 0) === 0;
  if (!isExhausted) return;

  // A single expiry can independently trigger this from two places at once
  // — scheduleExpiry's own callback calls this directly, and also (without
  // awaiting it) kicks off runBatch, which can reach this same exhausted
  // state and call in again before the first call's own awaits below have
  // finished. This check-and-set is synchronous (no await before it), so
  // the second concurrent call always sees it set and bails out here.
  if (state.terminating) return;
  state.terminating = true;

  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (order && order.rid === 0 && order.order_status === 0) {
    try {
      adminSocket.notifyDispatchAlert(orderId, order.city_id);
    } catch (adminErr) {
      logger.error(`dispatchManager: admin socket notify failed for order ${orderId}:`, adminErr);
    }

    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { o_status: "Cancelled", cancel_reason: "No driver found", order_status: 4 },
    });
    requireIo().to(`customer_${order.uid}`).emit("order:no_driver_found", {
      order_id: String(orderId),
    });

    const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
    await pushNotifier.notifyCustomerNoDriverFound(customer?.fcm_token, orderId);
  }

  // Once a cascade is exhausted there is nothing left for it to do — release
  // its in-memory state regardless of which branch above ran (the order may
  // have been accepted or cancelled through a path that didn't call
  // stopDispatch, e.g. a race with the check above), so this map can never
  // accumulate entries for cascades that finished ambiguously.
  activeDispatches.delete(orderId);
}

/**
 * Dispatches one batch (one tier's turn) of up to MAX_DRIVERS_PER_BATCH
 * drivers. Uses Tier Exhaustion (see commit b158d5a — a deliberate change
 * from this function's earlier round-robin design):
 * - Every turn queries exactly one tier — state.tierCursor mod tiers.length.
 * - The cursor only advances to the next tier once this tier has no more
 *   un-notified eligible candidates left (hasMoreInCurrentTier is false) AND
 *   nobody else eligible for this exact tier is just temporarily busy on a
 *   different tier of this SAME order (sameOrderLockBlocking, further down)
 *   — so a tier with a large eligible pool, or with an eligible rider who's
 *   momentarily mid-popup on this order's own earlier tier, keeps getting
 *   turns (BATCH_GAP_MS apart) until every one of its eligible riders has
 *   actually been offered it, before the next tier's drivers are ever
 *   offered anything. Two drivers eligible for overlapping tiers each get a
 *   turn at every tier they're both eligible for, in lockstep, rather than
 *   one of them skipping a tier just because they were locked on an earlier
 *   one at the moment it was checked.
 * - The within-turn while-loop below is a separate concern from tier
 *   exhaustion: it's a bounded retry against concurrent-order lock
 *   contention for this same tier's candidates within a single turn (see
 *   MAX_TOPUP_ROUNDS).
 *
 * Not safe to run twice concurrently for the same order — see runBatch,
 * which is the only allowed entry point and serializes calls into this.
 */
async function runBatchInner(orderId) {
  const state = activeDispatches.get(orderId);
  if (!state) return; // stopDispatch already ran (accepted/cancelled)

  const tierIndex = state.tierCursor % state.tiers.length;
  const packageId = state.tiers[tierIndex];
  if (packageId === undefined) {
    await checkCascadeTermination(orderId);
    return;
  }

  // consecutiveEmptyTurns (below) only measures "did this turn lock nobody" —
  // it never accumulates when the SAME lone rider keeps timing out and
  // becoming re-eligible again, since re-offering them still counts as
  // "locked someone" each turn. Left unchecked, a single unresponsive rider
  // who never explicitly rejects would cycle through every tier forever,
  // re-offering the identical order indefinitely. staleLaps tracks real
  // progress instead: whenever the cursor genuinely ADVANCES back around to
  // tier 0 (not just retries there — sameOrderLockBlocking can pin tierIndex
  // at 0 across many back-to-back retries while state.tierCursor itself
  // stays unchanged, and each of those must NOT count as its own lap), a lap
  // that added no rider this cascade hasn't already tried before is stale —
  // see the termination check further down.
  if (tierIndex === 0 && state.tierCursor !== state.lastTierCursorAtLapCheck) {
    state.lastTierCursorAtLapCheck = state.tierCursor;
    state.lapsStarted = (state.lapsStarted || 0) + 1;
    if (state.lapsStarted > 1) {
      state.staleLaps = state.everLockedRiderIds.size === state.lapStartRiderCount ? (state.staleLaps || 0) + 1 : 0;
    }
    state.lapStartRiderCount = state.everLockedRiderIds.size;
  }

  // A stale lap means every rider this cascade could ever reach has already
  // been tried at least twice with no acceptance — stop making new offers.
  // Any popup still open from the lap that just finished is left to resolve
  // on its own via its own scheduleExpiry timer (which re-invokes runBatch
  // when it does); this call only avoids starting a fresh one.
  if ((state.staleLaps || 0) >= 1) {
    if ((state.activeExpiryTimers || 0) === 0) {
      await checkCascadeTermination(orderId);
    }
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
  let fare, driverEarning, commission, packageTitle;
  if (precomputed) {
    ({ fare, driverEarning, commission } = precomputed);
    // orderController.createOrderCore already had the package row in hand
    // when it priced tier 0, and passes its title straight through here —
    // no need for a second DB round-trip to re-fetch what we just fetched.
    packageTitle = precomputed.packageTitle || `Model ${packageId}`;
  } else {
    const priced = await pricingEngine.priceForPackageId(packageId, distanceKm);
    fare = priced.fare;
    driverEarning = priced.driverEarning;
    commission = priced.commission;
    packageTitle = priced.packageTitle || priced.pkg?.title || `Model ${packageId}`;

    // Asynchronous update so we don't block driver dispatch by 400-800ms of remote DB latency
    prisma.pkg_order.update({
      where: { id: orderId },
      data: { d_charge: fare, total_dcharge: fare, commission, delivery_type: Number(packageId) },
    }).catch((err) => logger.error("dispatchManager: async pkg_order update failed:", err));
  }

  logger.info(`dispatchManager: order=${orderId} tier=${tierIndex} batch started`);

  const consideredThisBatch = new Set();
  const lockedRiderIds = [];
  const lockedDrivers = [];
  let round = 0;

  let hasMoreInCurrentTier = false;
  while (lockedRiderIds.length < MAX_DRIVERS_PER_BATCH && round <= MAX_TOPUP_ROUNDS) {
    // Re-check on every round: an accept (or cancel) that lands mid-batch
    // tears down activeDispatches synchronously via stopDispatch, and no
    // further round of this batch should lock/notify anyone once that's
    // happened, even though this call is already past the top-of-function
    // check above.
    if (!activeDispatches.has(orderId)) break;

    const excludeRiderIds = [...new Set([...lockManager.getAllLockedRiderIds(), ...rejectedRiderIds, ...consideredThisBatch])];
    const candidates = await selectEligibleDrivers(currentOrder, packageId, excludeRiderIds, MAX_DRIVERS_PER_BATCH + 1);

    if (candidates.length > (MAX_DRIVERS_PER_BATCH - lockedRiderIds.length)) {
      hasMoreInCurrentTier = true;
    }

    const eligibleBatch = candidates.slice(0, MAX_DRIVERS_PER_BATCH - lockedRiderIds.length);
    let lockedThisRound = 0;
    let lockedThisRoundDrivers = [];

    for (const driver of eligibleBatch) {
      if (lockedRiderIds.length >= MAX_DRIVERS_PER_BATCH) break;
      const riderId = Number(driver.rider_id);
      consideredThisBatch.add(riderId);
      if (!lockManager.acquireLock(riderId, orderId, POPUP_TIMEOUT_MS)) continue; // lost the race to a concurrent order

      lockedRiderIds.push(riderId);
      lockedDrivers.push(driver);
      lockedThisRound++;
      lockedThisRoundDrivers.push(driver);
      state.everLockedRiderIds.add(riderId);
    }

    // Final guard against a reject that lands mid-batch: rejectedRiderIds was
    // snapshotted once at the top of this runBatch call, but
    // tripLifecycle.rejectOrder can commit its "10" write (and free the
    // rider's lock) at any point during this round's own awaits above — a
    // rider who rejected an earlier tier just seconds ago could otherwise
    // slip through as a "fresh" candidate and get re-offered a later tier of
    // the SAME order they already declined. Re-checked here, right before
    // the offer is actually committed, since this is the narrowest point in
    // the batch this can be verified at.
    if (lockedThisRoundDrivers.length > 0) {
      const rejectedNow = await prisma.tbl_order_requests.findMany({
        where: {
          order_id: orderId,
          status: "10",
          rider_id: { in: lockedThisRoundDrivers.map((d) => Number(d.rider_id)) },
        },
        select: { rider_id: true },
      });
      if (rejectedNow.length > 0) {
        const rejectedNowSet = new Set(rejectedNow.map((r) => Number(r.rider_id)));
        for (const riderId of rejectedNowSet) {
          lockManager.releaseLock(riderId);
        }
        lockedThisRoundDrivers = lockedThisRoundDrivers.filter((d) => !rejectedNowSet.has(Number(d.rider_id)));
        for (const riderId of rejectedNowSet) {
          const idx = lockedRiderIds.indexOf(riderId);
          if (idx !== -1) lockedRiderIds.splice(idx, 1);
        }
        for (const riderId of rejectedNowSet) {
          const idx = lockedDrivers.findIndex((d) => Number(d.rider_id) === riderId);
          if (idx !== -1) lockedDrivers.splice(idx, 1);
        }
        lockedThisRound -= rejectedNowSet.size;
        logger.warn(
          `dispatchManager: order=${orderId} tier=${tierIndex} skipped re-offering already-rejected rider(s) ${[...rejectedNowSet].join(",")} (rejected mid-batch)`
        );
      }
    }

    if (lockedThisRoundDrivers.length > 0) {
      // Tracked per (tier, rider), across every turn for this order's whole
      // lifetime — not just this batch — so a later sameOrderLockBlocking
      // recheck can tell "hasn't had a turn at this tier yet, just busy on
      // another tier right now" apart from "already got this exact tier,
      // just still mid-popup on it" (the latter must never be waited for
      // again, or a rider holding their own long-lived popup would block
      // this tier from ever advancing).
      if (!state.offeredRiderIdsByTier.has(packageId)) {
        state.offeredRiderIdsByTier.set(packageId, new Set());
      }
      const offeredThisTier = state.offeredRiderIdsByTier.get(packageId);
      for (const driver of lockedThisRoundDrivers) {
        offeredThisTier.add(Number(driver.rider_id));
      }

      const payload = buildOrderRequestPayload(
        currentOrder,
        packageId,
        distanceKm.toFixed(1),
        driverEarning,
        fare,
        packageTitle
      );
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

  logger.info(`dispatchManager: order=${orderId} tier=${tierIndex} batch complete offered=${lockedRiderIds.length} hasMore=${hasMoreInCurrentTier}`);

  if (lockedDrivers.length > 0) {
    scheduleExpiry(orderId, tierIndex, lockedDrivers);
    state.consecutiveEmptyTurns = 0;
  } else {
    // Only treat a turn as truly empty if nobody is holding an active popup.
    // When drivers are holding active popups, they will free up when their timers expire.
    if ((state.activeExpiryTimers || 0) === 0) {
      state.consecutiveEmptyTurns = (state.consecutiveEmptyTurns || 0) + 1;
    }
  }

  // This tier might look done even though another rider eligible for this
  // exact package_id is still a genuine candidate for it — just temporarily
  // mid-popup on a different tier of this SAME order (e.g. two drivers, one
  // enabled for models 2-5 and the other for all 5: whichever of them isn't
  // busy right now gets locked for this tier first, but the other shouldn't
  // be skipped past just because they happened to be offered an earlier
  // tier's popup a moment before this one ran). Re-check ignoring only this
  // order's own locks and whoever this batch already considered: if that
  // turns up someone new, this tier isn't actually exhausted yet — wait for
  // them to free up and get their own turn at it too, rather than advancing
  // past them the instant anyone else here succeeds. Skipped when
  // hasMoreInCurrentTier is already true (a real, not-busy-elsewhere
  // candidate pool bigger than this batch already keeps the cursor put on
  // its own), when this order only has one tier in the first place —
  // "busy on a different tier of this same order" can't apply then, so the
  // query would always come back empty — or when the cascade has already
  // been torn down (accept/cancel landed mid-batch, e.g. inside one of the
  // awaits above): nothing reads state.tierCursor again after this function
  // returns in that case, so checking is pure wasted work.
  //
  // Also excludes offeredRiderIdsByTier for THIS packageId: a rider who
  // already had their own turn at this exact tier (however that turn
  // resolved) must never hold it open again just because they're currently
  // mid-popup on some OTHER tier of this order — only riders who haven't
  // been offered this tier yet are worth waiting for.
  let sameOrderLockBlocking = false;
  if (!hasMoreInCurrentTier && state.tiers.length > 1 && activeDispatches.has(orderId)) {
    const excludeIgnoringOwnOrderLocks = [...new Set([
      ...lockManager.getLockedRiderIdsExcludingOrder(orderId),
      ...rejectedRiderIds,
      ...consideredThisBatch,
      ...(state.offeredRiderIdsByTier.get(packageId) || []),
    ])];
    const wouldBeCandidates = await selectEligibleDrivers(currentOrder, packageId, excludeIgnoringOwnOrderLocks, 1);
    sameOrderLockBlocking = wouldBeCandidates.length > 0;
  }

  logger.info(
    `dispatchManager: order=${orderId} tier=${tierIndex} cursor_decision locked=${lockedRiderIds.length} hasMore=${hasMoreInCurrentTier} sameOrderLockBlocking=${sameOrderLockBlocking} willAdvance=${!sameOrderLockBlocking && (!hasMoreInCurrentTier || lockedRiderIds.length === 0)}`
  );

  // Tier Exhaustion: Exhaust all eligible drivers of current model before moving to next model
  if (!sameOrderLockBlocking && (!hasMoreInCurrentTier || lockedRiderIds.length === 0)) {
    state.tierCursor++;
  }

  if (state.consecutiveEmptyTurns >= state.tiers.length && (state.activeExpiryTimers || 0) === 0) {
    // A full cycle came back empty in every tier and no active popups remain
    // (the staleLaps case — a lone rider cycling without ever being genuinely
    // new — is caught earlier, at the top of this function, before any of
    // this tier's own dispatching runs).
    await checkCascadeTermination(orderId);
    return;
  }

  // Tier Progression:
  // If drivers were locked or are currently holding popups, wait BATCH_GAP_MS.
  // If genuinely nobody was found and no popups are active, advance immediately.
  const delayMs = (lockedRiderIds.length === 0 && (state.activeExpiryTimers || 0) === 0) ? 0 : BATCH_GAP_MS;

  const timer = setTimeout(() => {
    state.timers.delete(timer);
    runBatch(orderId).catch((err) =>
      logger.error(`dispatchManager: next batch failed for order ${orderId}:`, err)
    );
  }, delayMs);
  state.timers.add(timer);
}

/**
 * Guarded entry point for runBatchInner — the only one any caller should
 * use. Serializes turns for a given order so two invocations can never run
 * runBatchInner concurrently.
 *
 * Without this, two independent triggers for the same order (the chained
 * setTimeout from the previous turn, and scheduleExpiry's own direct,
 * un-awaited call when a popup expires) could both start runBatchInner while
 * state.tierCursor still held the same value — each captures its own
 * `tierIndex` snapshot at the top of the function, does its own awaits, and
 * then independently decides to advance the cursor, so both increments land
 * and the cursor jumps by 2 in a single turn instead of 1 (silently skipping
 * a tier — e.g. straight from the last tier back to tier 0, never offering
 * the second-to-last one). This is not a rare edge case: BATCH_GAP_MS evenly
 * divides POPUP_TIMEOUT_MS, so with a single lone driver blocking every tier
 * behind their own popup, the retry cadence and the expiry land on the exact
 * same tick on a predictable schedule.
 *
 * A call that arrives while another is still in flight is simply dropped,
 * not queued to run right after — nothing it would have read is lost by
 * dropping it. Its only job would have been to re-examine the current tier
 * with fresh state, and the in-flight call already does exactly that; once
 * it finishes, its own runBatchInner schedules the next turn via the normal
 * setTimeout(delayMs) path same as any other turn. An earlier version fired
 * an immediate follow-up call here instead, which bypassed that setTimeout
 * pacing entirely — each dropped-then-retried collision let the cascade
 * advance a tier with ~0 delay instead of BATCH_GAP_MS, so tiers that should
 * each hold their own popup for a few seconds apart instead fired back to
 * back (confirmed live: Models 2-4 collapsed into under a second while
 * Models 1 and 5 held their normal duration).
 */
async function runBatch(orderId) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  if (state.batchInFlight) return;

  state.batchInFlight = true;
  try {
    await runBatchInner(orderId);
  } finally {
    state.batchInFlight = false;
  }
}

function scheduleExpiry(orderId, tierIndex, drivers) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  state.activeExpiryTimers = (state.activeExpiryTimers || 0) + 1;

  const armedAt = Date.now();
  const timer = setTimeout(async () => {
    state.timers.delete(timer);
    state.activeExpiryTimers = Math.max(0, (state.activeExpiryTimers || 1) - 1);

    try {
      const stillPendingDrivers = drivers.filter((driver) => {
        const lock = lockManager.peekLock(Number(driver.rider_id));
        return lock && lock.orderId === orderId;
      });

      logger.info(
        `dispatchManager: expiry fired order=${orderId} tier=${tierIndex} armed_ms_ago=${Date.now() - armedAt} riders=${drivers.map((d) => d.rider_id).join(",")} still_pending=${stillPendingDrivers.map((d) => d.rider_id).join(",")}`
      );

      // Runs every rider's release/DB-write/dismiss concurrently — sequential
      // awaits here previously queued each rider behind the last one's DB
      // round-trip, so on a remote DB the tail riders in a batch could sit
      // stuck on an expired ("0s") popup for several extra seconds waiting
      // their turn.
      await Promise.all(
        stillPendingDrivers.map(async (driver) => {
          const riderId = Number(driver.rider_id);
          lockManager.releaseLock(riderId);
          const result = await prisma.tbl_order_requests.updateMany({
            where: { order_id: orderId, rider_id: riderId, status: "sent" },
            data: { status: "timeout" },
          });
          if (result.count === 0) return;
          requireIo().to(`driver_${riderId}`).emit("order:dismiss", {
            order_id: String(orderId),
            reason: "timeout",
          });
          await pushNotifier.notifyDriverDismiss(driver.fcm_token, orderId, "timeout");
        })
      );

      // Once locks are freed, if cascade is still active, trigger next batch for newly freed drivers
      if (activeDispatches.has(orderId)) {
        state.consecutiveEmptyTurns = 0;
        runBatch(orderId).catch((err) =>
          logger.error(`dispatchManager: retry batch after expiry failed for order ${orderId}:`, err)
        );
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
 * Uses Tier Exhaustion (see runBatch): batches run BATCH_GAP_MS apart, each
 * drawing from one tier, and the cascade only moves to the next tier once
 * the current one has no eligible candidates left to offer.
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
    // Every rider ever locked for this order, across every tier and every
    // lap around the tier list — see the lap-progress check in runBatch.
    everLockedRiderIds: new Set(),
    // packageId -> Set of rider ids already offered that specific tier at
    // some point — see the offeredThisTier tracking further down and the
    // sameOrderLockBlocking recheck in runBatchInner.
    offeredRiderIdsByTier: new Map(),
    lapsStarted: 0,
    lapStartRiderCount: 0,
    staleLaps: 0,
    lastTierCursorAtLapCheck: null,
    // Guards against two concurrent runBatchInner executions for this order
    // racing each other — see the runBatch wrapper.
    batchInFlight: false,
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
      ioRef.to(`driver_${riderId}`).emit("order:dismiss", { order_id: String(orderId), reason });
    }
  }

  if (riderIds.length > 0) {
    prisma.tbl_rider
      .findMany({ where: { id: { in: riderIds } }, select: { id: true, fcm_token: true } })
      .then((riders) => Promise.all(riders.map((r) => pushNotifier.notifyDriverDismiss(r.fcm_token, orderId, reason))))
      .catch((err) => logger.error(`stopDispatch: failed pushing dismiss for order ${orderId}:`, err));

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

function _resetForTests() {
  for (const [id, state] of activeDispatches.entries()) {
    for (const t of state.timers) clearTimeout(t);
  }
  activeDispatches.clear();
}

module.exports = {
  init,
  startDispatch,
  stopDispatch,
  selectEligibleDrivers,
  reconcileStaleOffersOnStartup,
  _resetForTests,
  // Test-only: lets a test invoke the guarded runBatch entry point directly,
  // including concurrently, to exercise the batchInFlight/rerunRequested
  // serialization without needing to fight fake-timer scheduling.
  _runBatchForTests: runBatch,
};
