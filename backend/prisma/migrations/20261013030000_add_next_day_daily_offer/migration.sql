-- Next-day Daily Driver offers (spec 2026-10-13).
-- Apply by hand on EVERY database BEFORE deploying the backend, then `prisma migrate resolve --applied`.
ALTER TABLE `pkg_order`
  ADD COLUMN `next_day_live_at` DATETIME(0) NULL,
  ADD COLUMN `next_day_stage` VARCHAR(10) NULL,
  ADD COLUMN `next_day_discount_amount` DECIMAL(10,2) NULL;

CREATE TABLE `next_day_daily_offer` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'offered',
  `offered_by_admin` INT NULL,
  `offered_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `expires_at` DATETIME(0) NOT NULL,
  `responded_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ndo_order_rider` (`order_id`, `rider_id`),
  KEY `idx_ndo_order_status` (`order_id`, `status`),
  KEY `idx_ndo_status_expires` (`status`, `expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
