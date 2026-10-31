-- Per-order fare change history for the customer "View full breakdown" (spec 2026-10-31).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261031010000_add_order_fare_history`. Never `migrate deploy`.
-- Orders created before this table existed simply have no rows; the API then reports the current fare only.
CREATE TABLE IF NOT EXISTS `pkg_order_fare_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `kind` VARCHAR(24) NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `amount_diff` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `new_total` DECIMAL(10,2) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_order_fare_history_order` (`order_id`, `id`)
);
