/**
 * In-memory global driver lock map: one driver can hold at most one active
 * popup at a time, across every concurrent dispatch search. See spec §4.1.
 * rider_id -> { orderId, expiresAt }
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
 * Minimal promise-chain mutex serializing driver-selection critical
 * sections so two concurrent order searches never pick the same driver
 * (spec §4.2). Not a queue with fairness guarantees beyond FIFO chaining,
 * which is sufficient for a single-process Node server.
 */
let tail = Promise.resolve();

function withSelectionLock(fn) {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

module.exports = {
  isLocked,
  acquireLock,
  releaseLock,
  getLock,
  peekLock,
  getLockedRidersForOrder,
  getAllLockedRiderIds,
  withSelectionLock,
};
