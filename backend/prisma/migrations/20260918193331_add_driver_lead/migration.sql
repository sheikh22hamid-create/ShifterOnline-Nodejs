-- AlterTable
ALTER TABLE `tbl_referral` ADD COLUMN `source` VARCHAR(10) NOT NULL DEFAULT 'code';

-- AlterTable
ALTER TABLE `tbl_referral_setting` ADD COLUMN `lead_referral_points` INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN `lead_verification_window_days` INTEGER NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE `tbl_driver_lead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `driver_id` INTEGER NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `status` VARCHAR(15) NOT NULL DEFAULT 'pending',
    `submitted_at` DATETIME(0) NOT NULL,
    `verified_at` DATETIME(0) NULL,
    `verified_by_admin_id` INTEGER NULL,
    `expires_at` DATETIME(0) NULL,
    `converted_user_id` INTEGER NULL,
    `converted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uniq_lead_phone`(`phone`),
    INDEX `idx_lead_driver`(`driver_id`),
    INDEX `idx_lead_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

