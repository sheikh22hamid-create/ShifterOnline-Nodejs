-- CreateTable
CREATE TABLE `tbl_pending_reward_plan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `plan_for` ENUM('USER', 'DRIVER') NOT NULL,
    `plan_id` INTEGER NOT NULL,
    `assigned_by_admin` INTEGER NOT NULL,
    `status` ENUM('pending', 'applied', 'cancelled') NOT NULL DEFAULT 'pending',
    `applied_order_id` INTEGER NULL,
    `applied_at` TIMESTAMP(0) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_pending_user_status`(`user_id`, `plan_for`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
