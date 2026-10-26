-- Customise Order cancellation penalties (spec 2026-10-26, Phase 3).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261027030000_add_customise_cancel_fee`. Never `migrate deploy`.
CREATE TABLE IF NOT EXISTS `customise_cancel_fee` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `ride_id` INT NOT NULL,
  `side` VARCHAR(10) NOT NULL,
  `mode` VARCHAR(10) NOT NULL,
  `payer_id` INT NOT NULL,
  `recipient_id` INT NULL,
  `agreed_fare` DECIMAL(10, 2) NOT NULL,
  `fixed` DECIMAL(10, 2) NOT NULL,
  `percent` DECIMAL(5, 2) NOT NULL,
  `charge` DECIMAL(10, 2) NOT NULL,
  `admin_share` DECIMAL(10, 2) NOT NULL,
  `recipient_amount` DECIMAL(10, 2) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_customise_cancel_fee` (`ride_id`, `side`),
  INDEX `idx_customise_cancel_order` (`order_id`)
);
