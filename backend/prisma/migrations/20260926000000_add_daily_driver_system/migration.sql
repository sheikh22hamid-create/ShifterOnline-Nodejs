-- CreateTable
CREATE TABLE `daily_driver_plan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `plan_name` VARCHAR(150) NOT NULL,
    `price` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `duty_start_time` VARCHAR(20) NOT NULL DEFAULT '10:00:00',
    `duty_end_time` VARCHAR(20) NOT NULL DEFAULT '20:00:00',
    `required_duty_hours` DOUBLE NOT NULL DEFAULT 10,
    `free_km` INTEGER NOT NULL DEFAULT 0,
    `extra_km_rate` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `shortfall_hourly_rate` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `overtime_hourly_rate` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `max_drivers` INTEGER NOT NULL DEFAULT 1,
    `assigned_zone_id` INTEGER NULL,
    `city` VARCHAR(255) NOT NULL DEFAULT 'all',
    `package_categories` VARCHAR(255) NOT NULL DEFAULT 'all',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL,

    INDEX `idx_ddp_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- CreateTable
CREATE TABLE `daily_driver_enrollment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rider_id` INTEGER NOT NULL,
    `plan_id` INTEGER NOT NULL,
    `enrollment_date` DATE NOT NULL,
    `status` ENUM('pending_approval', 'enrolled', 'active', 'completed', 'settlement_pending', 'settlement_completed', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending_approval',
    `auto_enroll_id` INTEGER NULL,
    `approved_by_admin` INTEGER NULL,
    `approved_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_dde_rider_date`(`rider_id`, `enrollment_date`),
    INDEX `idx_dde_plan_date_status`(`plan_id`, `enrollment_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- CreateTable
CREATE TABLE `daily_driver_auto_enroll` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rider_id` INTEGER NOT NULL,
    `plan_id` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `until_date` DATE NOT NULL,
    `status` ENUM('active', 'cancelled') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_ddae_rider_status`(`rider_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- CreateTable
CREATE TABLE `daily_driver_duty_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollment_id` INTEGER NOT NULL,
    `rider_id` INTEGER NOT NULL,
    `punch_in_at` DATETIME(0) NULL,
    `punch_out_at` DATETIME(0) NULL,
    `total_online_minutes` INTEGER NOT NULL DEFAULT 0,
    `total_in_zone_minutes` INTEGER NOT NULL DEFAULT 0,
    `total_out_zone_minutes` INTEGER NOT NULL DEFAULT 0,
    `rides_completed` INTEGER NOT NULL DEFAULT 0,
    `actual_km` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `extra_km` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `extra_km_charge` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `shortfall_hours` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `shortfall_deduction` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `overtime_minutes` INTEGER NOT NULL DEFAULT 0,
    `overtime_pay` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `ride_earnings` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `eligible_plan_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `final_settlement_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `settlement_direction` ENUM('none', 'company_pays', 'company_retains') NOT NULL DEFAULT 'none',
    `status` VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `daily_driver_duty_log_enrollment_id_key`(`enrollment_id`),
    INDEX `idx_ddl_rider`(`rider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- CreateTable
CREATE TABLE `daily_driver_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rider_id` INTEGER NOT NULL,
    `enrollment_id` INTEGER NULL,
    `order_id` INTEGER NULL,
    `entry_type` VARCHAR(50) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `balance_effect` VARCHAR(10) NOT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_ddledger_rider_created`(`rider_id`, `created_at`),
    INDEX `idx_ddledger_enrollment`(`enrollment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- AddForeignKey
ALTER TABLE `daily_driver_enrollment` ADD CONSTRAINT `daily_driver_enrollment_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `daily_driver_plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_driver_enrollment` ADD CONSTRAINT `daily_driver_enrollment_auto_enroll_id_fkey` FOREIGN KEY (`auto_enroll_id`) REFERENCES `daily_driver_auto_enroll`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_driver_auto_enroll` ADD CONSTRAINT `daily_driver_auto_enroll_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `daily_driver_plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_driver_duty_log` ADD CONSTRAINT `daily_driver_duty_log_enrollment_id_fkey` FOREIGN KEY (`enrollment_id`) REFERENCES `daily_driver_enrollment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
