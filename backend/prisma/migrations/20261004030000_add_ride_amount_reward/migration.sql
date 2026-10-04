-- CreateTable
CREATE TABLE IF NOT EXISTS `tbl_ride_amount_reward` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `min_amount` DECIMAL(10, 2) NOT NULL,
    `plan_id` INTEGER NOT NULL,
    `max_customers` INTEGER NULL,
    `claimed_count` INTEGER NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_by_admin` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    INDEX `idx_amount_reward_status_min_amount`(`status`, `min_amount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `tbl_ride_amount_reward_applied` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `reward_id` INTEGER NOT NULL,
    `status` ENUM('applied', 'skipped_active_plan') NOT NULL DEFAULT 'applied',
    `order_id` INTEGER NULL,
    `applied_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uniq_amount_reward_applied_user_reward`(`user_id`, `reward_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
