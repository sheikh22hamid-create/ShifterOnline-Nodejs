-- AlterTable
ALTER TABLE `pkg_order` ADD COLUMN `priority_notify_sent` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `priority_started_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `pkg_order_interest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `rider_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pkg_order_interest_order_id_idx`(`order_id`),
    INDEX `pkg_order_interest_rider_id_idx`(`rider_id`),
    UNIQUE INDEX `pkg_order_interest_order_id_rider_id_key`(`order_id`, `rider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

