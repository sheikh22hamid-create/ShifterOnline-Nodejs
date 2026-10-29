-- City-wise pickup coverage and vehicle No Entry Zones (spec 2026-10-29).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261029010000_add_service_area_zones`. Never `migrate deploy`.
-- Existing zones become zone_kind 'duty' (unchanged behaviour); 'coverage' zones are the pickup service areas.
ALTER TABLE `service_zone`
  ADD COLUMN `zone_kind` VARCHAR(20) NOT NULL DEFAULT 'duty';

CREATE TABLE IF NOT EXISTS `vehicle_no_entry_zone` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `city_id` INT NOT NULL,
  `category_id` INT NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `center_lat` DOUBLE NOT NULL,
  `center_lng` DOUBLE NOT NULL,
  `radius_km` DOUBLE NOT NULL DEFAULT 1,
  `polygon_geojson` LONGTEXT NULL,
  `status` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_no_entry_lookup` (`city_id`, `category_id`, `kind`, `status`)
);
