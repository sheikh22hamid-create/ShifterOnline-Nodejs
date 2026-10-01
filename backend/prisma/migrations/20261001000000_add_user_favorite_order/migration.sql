-- CreateTable
CREATE TABLE `tbl_user_favorite_order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `order_id` INTEGER NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    INDEX `tbl_user_favorite_order_user_id_idx`(`user_id`),
    UNIQUE INDEX `tbl_user_favorite_order_user_id_order_id_key`(`user_id`, `order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
