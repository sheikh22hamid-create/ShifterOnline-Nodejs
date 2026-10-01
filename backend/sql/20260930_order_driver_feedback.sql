-- CreateTable
CREATE TABLE `order_driver_feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `rider_id` INTEGER NOT NULL,
    `uid` INTEGER NOT NULL,
    `customer_rating` INTEGER NULL,
    `pickup_location_rating` INTEGER NULL,
    `drop_location_rating` INTEGER NULL,
    `route_rating` INTEGER NULL,
    `no_entry_zone` BOOLEAN NULL,
    `customer_type` VARCHAR(20) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `order_driver_feedback_order_id_key`(`order_id`),
    INDEX `order_driver_feedback_rider_id_idx`(`rider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
