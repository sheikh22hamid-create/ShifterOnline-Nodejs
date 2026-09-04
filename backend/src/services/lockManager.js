/**
 * In-memory global driver lock map: one driver can hold at most one active
 * popup at a time, across every concurrent dispatch search. See spec §4.1.
 * rider_id -> { orderId, expiresAt }
 *
 * acquireLock() below is the sole concurrency primitive for driver
 * reservation — a synchronous check-and-set with no `await` inside it, so
 * Node's single-threaded run-to-completion semantics make it atomic on
 * their own: two orders racing for the same rider always resolve to
 * exactly one winner, deterministically, with no additional locking.
 *
 * SINGLE-INSTANCE ONLY: this Map lives in one Node process's memory. It
 * gives no cross-process guarantee — if this service is ever horizontally
 * scaled to multiple instances without a shared store, two different
 * instances could each believe they'd won the same rider. A distributed
 * reservation mechanism (e.g. a DB-level unique constraint, or a shared
 * cache) would be required before that becomes safe. Not needed for the
 * current single-instance deployment.
 */
const activePopups = new Map();

function isLocked(riderId) {
  const lock = activePopups.get(riderId);
  if (!lock) return false;
  if (lock.expiresAt <= Date.now()) {
    activePopups.delete(riderId);
    return false;
  }
  return true;
}

function acquireLock(riderId, orderId, durationMs) {
  if (isLocked(riderId)) return false;
  activePopups.set(riderId, { orderId, expiresAt: Date.now() + durationMs });
  return true;
}

function releaseLock(riderId) {
  activePopups.delete(riderId);
}

function getLock(riderId) {
  if (!isLocked(riderId)) return undefined;
  return activePopups.get(riderId);
}

/**
 * Raw lookup that does NOT treat an exactly-elapsed lock as already
 * expired. A batch's own 15s expiry timer fires at the same virtual
 * instant its lock's expiresAt is reached, so that timer must be able to
 * recognize "this is still my lock" instead of racing isLocked's `<=`
 * check and seeing it as already gone.
 */
function peekLock(riderId) {
  return activePopups.get(riderId);
}

/**
 * Riders currently locked to a specific order (used to release/dismiss
 * everyone still pending when that order is accepted/cancelled/exhausted).
 */
function getLockedRidersForOrder(orderId) {
  const riderIds = [];
  for (const [riderId, lock] of activePopups.entries()) {
    if (lock.orderId === orderId && lock.expiresAt > Date.now()) {
      riderIds.push(riderId);
    }
  }
  return riderIds;
}

/**
 * All riders currently holding any active popup, regardless of which order
 * it belongs to — a driver locked on one search is unavailable to every
 * other concurrent search (spec §4.1).
 */
function getAllLockedRiderIds() {
  const riderIds = [];
  for (const [riderId, lock] of activePopups.entries()) {
    if (lock.expiresAt > Date.now()) {
      riderIds.push(riderId);
    }
  }
  return riderIds;
}

/**
 * Riders locked by any order OTHER than orderId. Used by dispatchManager to
 * tell "this tier is genuinely empty" apart from "the only real candidate is
 * mid-popup on a different tier of this same order" — a rider locked by
 * their own order's earlier tier is still a real candidate for this tier,
 * just temporarily busy, and must not make the cascade think the tier is
 * exhausted.
 */
function getLockedRiderIdsExcludingOrder(orderId) {
  const riderIds = [];
  for (const [riderId, lock] of activePopups.entries()) {
    if (lock.expiresAt > Date.now() && lock.orderId !== orderId) {
      riderIds.push(riderId);
    }
  }
  return riderIds;
}

module.exports = {
  isLocked,
  acquireLock,
  releaseLock,
  getLock,
  peekLock,
  getLockedRidersForOrder,
  getAllLockedRiderIds,
  getLockedRiderIdsExcludingOrder,
};
