module.exports = {
  POPUP_TIMEOUT_MS: 15000,
  // Inter-tier stagger inside dispatchManager.runBatch — tuned to compensate
  // for remote MySQL query + socket/push overhead so the next tier's popup
  // actually lands ~5s after the previous one in the real world (see the
  // comment at its one use site). Must match the value runBatch actually
  // uses; keep this a live import there, not a stale reference.
  BATCH_GAP_MS: 3000,
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

  // Model 1 reliability suspension — see dispatchManager's
  // recordModel1Outcome/isModel1Suspended.
  MODEL_1_PACKAGE_ID: 6,
  MODEL1_MISS_LIMIT: 5,
  MODEL1_SUSPENSION_HOURS: 24,

  ADMIN_ROLES: ["superadmin", "admin", "executive"],
  BCRYPT_SALT_ROUNDS: 10,
};
