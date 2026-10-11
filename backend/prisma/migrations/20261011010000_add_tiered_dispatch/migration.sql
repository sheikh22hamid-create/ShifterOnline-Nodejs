-- Tiered dispatch (Free -> Daily -> Normal), penalties and cancel approval (spec 2026-10-11).
-- Apply on every DB BEFORE deploying the backend (hand-applied on dev, then prisma migrate resolve --applied).
CREATE TABLE `order_dispatch_stage` (
  `order_id` INT NOT NULL,
  `stage` VARCHAR(10) NOT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_order_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `event` VARCHAR(24) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `penalty_pct` DECIMAL(5,2) NULL,
  `penalty_amount` DECIMAL(10,2) NULL,
  `miss_no` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_doe_rider_at` (`rider_id`, `created_at`),
  INDEX `idx_doe_tier_at` (`tier`, `created_at`),
  INDEX `idx_doe_order` (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_tier_penalty_counter` (
  `rider_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `misses` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`rider_id`, `tier`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_tier_penalty` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `event` VARCHAR(24) NOT NULL,
  `miss_no` INT NULL,
  `pct` DECIMAL(5,2) NOT NULL,
  `base_amount` DECIMAL(10,2) NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `enrollment_id` INT NULL,
  `waived_by` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `collected_at` DATETIME(0) NULL,
  `waived_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_dtp_order_rider_kind` (`order_id`, `rider_id`, `kind`),
  INDEX `idx_dtp_rider_tier` (`rider_id`, `tier`),
  INDEX `idx_dtp_enrollment_status` (`enrollment_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_cancel_request` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `reason` TEXT NULL,
  `status` VARCHAR(10) NOT NULL,
  `decided_by` INT NULL,
  `decided_at` DATETIME(0) NULL,
  `penalty_id` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_ocr_status_created` (`status`, `created_at`),
  INDEX `idx_ocr_order` (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
