-- Dynamic configuration for the Lifetime Driver Plan's activity protection.
-- Safe to run once on the same MySQL database used by the Node backend.
ALTER TABLE tbl_premium_plan
  ADD COLUMN lifetime_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN activity_protection_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN activity_protection_3m DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN activity_protection_6m DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN activity_protection_12m DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN activity_min_online_hours INT NOT NULL DEFAULT 10,
  ADD COLUMN activity_require_model1 TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN activity_require_zero_requests TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN activity_require_service_zone TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN activity_request_ends_day TINYINT(1) NOT NULL DEFAULT 1;
