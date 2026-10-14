-- Booking Guarantee executive queue (spec 2026-10-14). Additive only; feature is OFF per city by default.
-- Apply by hand on EVERY database BEFORE deploying the backend, then
--   prisma migrate resolve --applied 20261014010000_add_guarantee_executive_queue
-- Prerequisites: 20261007020000_add_booking_guarantee, 20261012010000_add_city_order_settings,
--                20261013020000_add_guarantee_time_window.
ALTER TABLE `booking_guarantee_case`
  ADD COLUMN `city_id` INT NULL,
  ADD COLUMN `owner_admin_id` INT NULL,
  ADD COLUMN `owner_assigned_at` DATETIME(0) NULL,
  ADD COLUMN `queue_state` VARCHAR(20) NULL,
  ADD COLUMN `unassigned_reason` VARCHAR(30) NULL,
  ADD COLUMN `first_action_at` DATETIME(0) NULL,
  ADD COLUMN `last_action_at` DATETIME(0) NULL,
  ADD COLUMN `reminded_at` DATETIME(0) NULL,
  ADD COLUMN `escalated_at` DATETIME(0) NULL,
  ADD COLUMN `last_alerted_at` DATETIME(0) NULL,
  ADD INDEX `idx_bgc_queue_deadline` (`queue_state`, `deadline_at`),
  ADD INDEX `idx_bgc_owner_status` (`owner_admin_id`, `status`),
  ADD INDEX `idx_bgc_city_status` (`city_id`, `status`);

ALTER TABLE `city_order_settings`
  ADD COLUMN `exec_queue_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `exec_default_capacity` INT NOT NULL DEFAULT 5,
  ADD COLUMN `reminder_pct` INT NOT NULL DEFAULT 50,
  ADD COLUMN `escalate_pct` INT NOT NULL DEFAULT 75,
  ADD COLUMN `auto_reassign_idle_minutes` INT NULL;

-- `active` is 1 while a period is open and NULL once ended. UNIQUE ignores NULLs in InnoDB, so any number of
-- ended periods coexist per case while a second active period is rejected. Never write active = 0.
CREATE TABLE `guarantee_assignment` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `admin_id` INT NOT NULL,
  `assigned_by` INT NULL,
  `source` VARCHAR(15) NOT NULL,
  `started_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `ended_at` DATETIME(0) NULL,
  `end_reason` VARCHAR(25) NULL,
  `reassign_reason` VARCHAR(200) NULL,
  `active` TINYINT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_ga_one_active` (`case_id`, `active`),
  INDEX `idx_ga_admin_active` (`admin_id`, `active`),
  INDEX `idx_ga_case` (`case_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `guarantee_action` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `admin_id` INT NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `meaningful` TINYINT NOT NULL DEFAULT 0,
  `result` VARCHAR(30) NULL,
  `driver_id` INT NULL,
  `meta` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_gact_case_time` (`case_id`, `created_at`),
  INDEX `idx_gact_admin_time` (`admin_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `executive_guarantee_profile` (
  `admin_id` INT NOT NULL,
  `capacity` INT NULL,
  `available` TINYINT NOT NULL DEFAULT 1,
  `last_assigned_at` DATETIME(0) NULL,
  `updated_by` INT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`admin_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
