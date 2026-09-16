-- Dynamic configuration for Driver Premium Plan's Minimum Ride Guarantee.
-- If a driver does not complete the guaranteed rides within validity_days,
-- the plan does not expire until the guaranteed rides are completed.
ALTER TABLE tbl_premium_plan
  ADD COLUMN min_ride_guarantee_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN min_ride_guarantee INT UNSIGNED NOT NULL DEFAULT 0;
