-- CreateTable
CREATE TABLE IF NOT EXISTS `order_customer_feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `rider_id` INTEGER NOT NULL,
    `uid` INTEGER NOT NULL,
    `driver_rating` INTEGER NULL,
    `delivery_rating` INTEGER NULL,
    `vehicle_rating` INTEGER NULL,
    `feedback_tags` VARCHAR(255) NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `order_customer_feedback_order_id_key`(`order_id`),
    INDEX `order_customer_feedback_uid_idx`(`uid`),
    INDEX `order_customer_feedback_rider_id_idx`(`rider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
