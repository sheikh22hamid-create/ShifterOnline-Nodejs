-- System 2 (Vehicle Category First) and city-wise Booking Guarantee (spec 2026-10-12).
-- Apply by hand on EVERY database BEFORE deploying the backend, then `prisma migrate resolve --applied`.
CREATE TABLE `city_order_settings` (
  `city_id` INT NOT NULL,
  `search_system` TINYINT NOT NULL DEFAULT 1,
  `search_radius_km` DECIMAL(5,2) NULL,
  `driver_search_seconds` INT NULL,
  `guarantee_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `admin_window_minutes` INT NULL,
  `guarantee_referrals_required` INT NOT NULL DEFAULT 1,
  `updated_by` INT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`city_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pkg_order`
  ADD COLUMN `search_system` TINYINT NULL,
  ADD COLUMN `search_deadline_at` DATETIME(0) NULL,
  ADD INDEX `idx_order_search` (`search_system`, `o_status`, `search_deadline_at`);

ALTER TABLE `tbl_user`
  ADD COLUMN `guarantee_locked` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `guarantee_locked_at` DATETIME(0) NULL;
