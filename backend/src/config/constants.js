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
  // A driver's rlats/rlongs older than this are treated as stale and
  // excluded from dispatch/availability, rather than trusted as-is - covers
  // the gap between "went online" and the first fresh GPS ping landing, and
  // the case of an app killed in the background without ever going offline.
  RIDER_LOCATION_FRESHNESS_MS: 2 * 60 * 1000,

  // When no vehicle is available at the customer's chosen search_radius_km,
  // orderAvailabilityController checks once more out to this cap before
  // suggesting "widen your search radius" - so the suggestion is never shown
  // for a driver that isn't actually there to find (see
  // memory/radius_no_driver_suggestion.md).
  RADIUS_SUGGESTION_MAX_KM: 20,

  // Model 1 reliability suspension — see dispatchManager's
  // recordModel1Outcome/isModel1Suspended.
  MODEL_1_PACKAGE_ID: 6,
  MODEL1_MISS_LIMIT: 5,
  MODEL1_SUSPENSION_HOURS: 24,

  ADMIN_ROLES: ["superadmin", "admin", "executive"],
  BCRYPT_SALT_ROUNDS: 10,

  // How long a driver waits at pickup for the customer to hand over the OTP
  // before the trip auto-cancels as a customer no-show (see
  // tripLifecycle.sweepOverduePickups) — anchored to pkg_order_wait_timer's
  // own pickup_wait_start, the same column the post-trip waiting-charge
  // calculation already reads, so this and that stay consistent with each
  // other about what "arrived" means.
  PICKUP_OTP_TIMEOUT_MS: 10 * 60 * 1000,
  PICKUP_TIMEOUT_SWEEP_INTERVAL_MS: 60 * 1000,

  // How long a customer has to pay the advance (shown on accept, e.g. a
  // cancellation-charge/radius-charge hold) before the order auto-cancels —
  // see tripLifecycle.sweepExpiredAdvancePayments. Node port of the legacy
  // PHP's ADVANCE_PAYMENT_TIMEOUT_SECONDS (120s) in
  // admin/include/advance_payment_helper.php. A 30s sweep interval keeps
  // the worst-case lateness small relative to the 2-minute window itself
  // (PICKUP_TIMEOUT_SWEEP_INTERVAL_MS's 60s would let a driver wait up to a
  // full extra minute past an already-short window).
  ADVANCE_PAYMENT_TIMEOUT_MS: 2 * 60 * 1000,
  ADVANCE_PAYMENT_SWEEP_INTERVAL_MS: 5 * 1000,

  // Scheduled (booking_type=2) "later today" orders — see
  // tripLifecycle.dispatchDueScheduledOrders / sendScheduledOrderReminders,
  // Node port of the legacy PHP's cron_schedule_order_notify.php (which
  // polled every 60s). How long before schedule_date_time the customer gets
  // a reminder push, and how often the sweep checks for orders whose
  // reminder/dispatch is due.
  SCHEDULED_ORDER_REMINDER_LEAD_MS: 10 * 60 * 1000,
  SCHEDULED_ORDER_SWEEP_INTERVAL_MS: 30 * 1000,
};
