-- Customise Order timers and extra charges (spec 2026-10-26, Phase 2).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261027020000_add_customise_order_timer`. Never `migrate deploy`.
CREATE TABLE IF NOT EXISTS `customise_order_timer` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `segment` VARCHAR(20) NOT NULL,
  `selected_min` INT NOT NULL,
  `started_at` DATETIME(0) NULL,
  `ended_at` DATETIME(0) NULL,
  `elapsed_seconds` INT NOT NULL DEFAULT 0,
  `billed_seconds` INT NOT NULL DEFAULT 0,
  `rate_per_min` DECIMAL(10, 2) NOT NULL,
  `charge` DECIMAL(10, 2) NOT NULL,
  `computed_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_customise_timer` (`order_id`, `segment`)
);
