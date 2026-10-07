-- Booking Guarantee (spec 2026-10-07). Apply on prod BEFORE deploying the backend.
ALTER TABLE `tbl_package`
  ADD COLUMN `no_driver_compensation` DECIMAL(10,2) NOT NULL DEFAULT 0.00;

CREATE TABLE `booking_guarantee_case` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `selected_package_ids` TEXT NOT NULL,
  `compensation_package_id` INT NULL,
  `compensation_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `opened_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `deadline_at` DATETIME(0) NOT NULL,
  `closed_at` DATETIME(0) NULL,
  `resolved_by_admin_id` INT NULL,
  `wallet_history_id` INT NULL,
  `refunds_done_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_bgc_order` (`order_id`),
  INDEX `idx_bgc_status_deadline` (`status`, `deadline_at`),
  INDEX `idx_bgc_uid` (`uid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_guarantee_audit` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `event` VARCHAR(40) NOT NULL,
  `admin_id` INT NULL,
  `meta` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_bga_case` (`case_id`),
  INDEX `idx_bga_order` (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
