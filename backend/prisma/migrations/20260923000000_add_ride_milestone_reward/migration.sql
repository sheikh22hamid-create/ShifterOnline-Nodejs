-- CreateTable
CREATE TABLE `tbl_ride_milestone_reward` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rides_required` INTEGER NOT NULL,
    `plan_id` INTEGER NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_by_admin` INTEGER NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uniq_milestone_rides_required`(`rides_required`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tbl_ride_milestone_applied` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `milestone_id` INTEGER NOT NULL,
    `status` ENUM('applied', 'skipped_active_plan') NOT NULL,
    `order_id` INTEGER NULL,
    `applied_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uniq_milestone_applied_user_milestone`(`user_id`, `milestone_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
