-- Go to Home mode for drivers (spec 2026-10-30): saved home, route to home, 5 km corridor, 2-hourly refresh.
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261030010000_add_go_to_home`. Never `migrate deploy`.
CREATE TABLE IF NOT EXISTS `driver_go_to_home` (
  `rider_id` INT NOT NULL,
  `home_lat` DECIMAL(10,7) NULL,
  `home_lng` DECIMAL(10,7) NULL,
  `home_address` VARCHAR(255) NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 0,
  `activated_at` DATETIME(3) NULL,
  `route_geometry` JSON NULL,
  `route_distance_km` DOUBLE NULL,
  `route_from_lat` DECIMAL(10,7) NULL,
  `route_from_lng` DECIMAL(10,7) NULL,
  `route_computed_at` DATETIME(3) NULL,
  `next_refresh_at` DATETIME(3) NULL,
  `last_refresh_status` VARCHAR(24) NULL,
  `last_refresh_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`rider_id`),
  INDEX `idx_go_to_home_active_refresh` (`active`, `next_refresh_at`)
);
