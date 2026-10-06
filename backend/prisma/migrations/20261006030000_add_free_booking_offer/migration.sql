-- Free Booking Offer (spec 2026-10-06). Apply on prod BEFORE deploying the backend.
CREATE TABLE `free_booking_setting` (
  `city_id` INT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `offer_start` DATETIME(0) NULL,
  `offer_end` DATETIME(0) NULL,
  `updated_by` INT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`city_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `free_booking_pool` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `city_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `vehicle_details_id` INT NULL,
  `valid_from` DATE NOT NULL,
  `valid_to` DATE NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `added_by` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_fbp_city_active_dates` (`city_id`, `active`, `valid_from`, `valid_to`),
  INDEX `idx_fbp_rider` (`rider_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `free_booking_order` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `city_id` INT NULL,
  `status` VARCHAR(40) NOT NULL,
  `not_eligible_reason` VARCHAR(60) NULL,
  `pool_rider_id` INT NULL,
  `accepted_in_pool` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_fare` DECIMAL(10,2) NULL,
  `credit_amount` DECIMAL(10,2) NULL,
  `wallet_history_id` INT NULL,
  `search_radius_km` INT NULL,
  `premium_plan_id` INT NULL,
  `premium_plan_amount` DECIMAL(10,2) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `completed_at` DATETIME(0) NULL,
  `credited_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_fbo_order` (`order_id`),
  INDEX `idx_fbo_user_status` (`user_id`, `status`),
  INDEX `idx_fbo_city_status` (`city_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tbl_user`
  ADD COLUMN `free_booking_locked` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `free_booking_locked_at` DATETIME(0) NULL,
  ADD COLUMN `free_booking_just_unlocked` TINYINT(1) NOT NULL DEFAULT 0;
