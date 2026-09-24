CREATE TABLE `driver_trip_progress` (
  `order_id` INTEGER NOT NULL, `rider_id` INTEGER NOT NULL,
  `stop_step` INTEGER NOT NULL DEFAULT 0, `automation_enabled` BOOLEAN NOT NULL DEFAULT false,
  `otp_verified_at` DATETIME(3) NULL,
  `candidate_key` VARCHAR(50) NULL, `candidate_since` DATETIME(3) NULL,
  `candidate_count` INTEGER NOT NULL DEFAULT 0, `last_sample_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_trip_event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `order_id` INTEGER NOT NULL,
  `rider_id` INTEGER NOT NULL, `user_id` INTEGER NOT NULL,
  `milestone` VARCHAR(50) NOT NULL, `payload` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sent_at` DATETIME(3) NULL, `lease_until` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `driver_trip_event_order_id_milestone_key` (`order_id`, `milestone`),
  INDEX `driver_trip_event_sent_at_lease_until_idx` (`sent_at`, `lease_until`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
