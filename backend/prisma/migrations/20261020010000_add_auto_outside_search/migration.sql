-- Automated trial driver search + executive queue (spec 2026-10-20). Per-city switch, OFF by default.
-- Apply by hand on EVERY database BEFORE deploying the backend, then
-- `prisma migrate resolve --applied 20261020010000_add_auto_outside_search`. Never `migrate deploy`.
ALTER TABLE `city_order_settings`
  ADD COLUMN `exec_auto_outside_search` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `booking_guarantee_case`
  ADD COLUMN `search_state` VARCHAR(15) NULL,
  ADD COLUMN `search_lease_until` DATETIME(0) NULL;

CREATE TABLE `guarantee_outside_candidate` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `name` VARCHAR(120) NOT NULL DEFAULT '',
  `mobile` VARCHAR(20) NOT NULL,
  `vehicle_number` VARCHAR(50) NOT NULL DEFAULT '',
  `vehicle_name` VARCHAR(120) NOT NULL DEFAULT '',
  `fare` DECIMAL(10, 2) NULL,
  `status` VARCHAR(15) NOT NULL DEFAULT 'ready',
  `rejected_by` INT NULL,
  `rejected_at` DATETIME(0) NULL,
  `reject_reason` VARCHAR(200) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `active` TINYINT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_goc_one_live` (`case_id`, `active`),
  UNIQUE INDEX `uq_goc_case_mobile` (`case_id`, `mobile`),
  INDEX `idx_goc_order` (`order_id`)
);
