-- CreateTable
CREATE TABLE `driver_trip_location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `rider_id` INTEGER NOT NULL,
    `lat` DECIMAL(10, 7) NOT NULL,
    `lng` DECIMAL(10, 7) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL,
    `phase` INTEGER NOT NULL DEFAULT 0,
    INDEX `driver_trip_location_order_id_recorded_at_idx`(`order_id`, `recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
