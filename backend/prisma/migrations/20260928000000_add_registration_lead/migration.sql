-- CreateTable
CREATE TABLE `tbl_registration_lead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(20) NOT NULL,
    `device_id` VARCHAR(191) NULL,
    `status` VARCHAR(15) NOT NULL DEFAULT 'pending',
    `otp_verified_at` DATETIME(0) NOT NULL,
    `last_reminder_sent_at` DATETIME(0) NULL,
    `reminder_count` INTEGER NOT NULL DEFAULT 0,
    `registered_rider_id` INTEGER NULL,
    `registered_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uniq_registration_lead_phone`(`phone`),
    INDEX `idx_registration_lead_status`(`status`),
    INDEX `idx_registration_lead_otp_verified_at`(`otp_verified_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;
