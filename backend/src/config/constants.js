module.exports = {
  POPUP_TIMEOUT_MS: 15000,
  BATCH_GAP_MS: 5000,
  MAX_DRIVERS_PER_BATCH: 4,
  SEARCH_RADIUS_KM: 10,
  // Bounded top-up retries when concurrent orders contend for the same
  // candidates: after the initial selection round, at most this many extra
  // rounds re-query (excluding riders now known taken) to fill a shortfall.
  // A round that returns fewer than MAX_DRIVERS_PER_BATCH candidates means
  // the eligible pool is genuinely exhausted, not just contended, and stops
  // retrying immediately regardless of this cap.
  MAX_TOPUP_ROUNDS: 2,
  // Startup reconciliation only: how old an unresolved "Pending" order must
  // be before it's assumed to be orphaned from a crashed/restarted process
  // (comfortably beyond the longest real cascade: 5 tiers × 5s stagger +
  // 15s popup ≈ 35s) rather than a cascade still legitimately in flight.
  STARTUP_RECOVERY_BUFFER_SECONDS: 120,
  ROAD_DISTANCE_FUDGE_FACTOR: 1.3,
  ASSUMED_URBAN_SPEED_KMH: 30,
  RIDER_LOCATION_WRITE_THROTTLE_MS: 5000,

  ADMIN_ROLES: ["superadmin", "admin", "executive"],
  BCRYPT_SALT_ROUNDS: 10,
};
