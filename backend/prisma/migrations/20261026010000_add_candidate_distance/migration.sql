-- Driver-to-pickup distance for the trial driver offered to an executive (spec 2026-10-26).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261026010000_add_candidate_distance`. Never `migrate deploy`.
-- A separate table (not columns on guarantee_outside_candidate): the backend reads it defensively, so an
-- unapplied migration only hides the distance instead of failing every candidate read.
CREATE TABLE `guarantee_candidate_distance` (
  `candidate_id` INT NOT NULL,
  `case_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `driver_lat` DECIMAL(10, 7) NOT NULL,
  `driver_lng` DECIMAL(10, 7) NOT NULL,
  `location_source` VARCHAR(20) NOT NULL,
  `location_at` DATETIME(0) NULL,
  `location_approx` TINYINT(1) NOT NULL DEFAULT 0,
  `distance_m` INT NOT NULL,
  `distance_unit` VARCHAR(2) NOT NULL,
  `distance_kind` VARCHAR(10) NOT NULL,
  `computed_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`candidate_id`),
  INDEX `idx_gcd_order` (`order_id`)
);
