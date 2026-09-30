-- CreateTable
CREATE TABLE `duty_early_start_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rider_id` INTEGER NOT NULL,
    `duty_date` DATE NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `requested_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `decided_at` DATETIME(0) NULL,
    `decided_by` VARCHAR(100) NULL,
    INDEX `duty_early_start_request_status_idx`(`status`),
    UNIQUE INDEX `duty_early_start_request_rider_id_duty_date_key`(`rider_id`, `duty_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
