-- Driver training-video gate: create `driver_training_progress` and widen
-- `app_settings.setting_value`.
-- Run manually against the live Hostinger DB (srv2206.hstgr.io), then run
-- `npx prisma generate` in backend/ to refresh the Prisma client.
--
-- Backs the `driver_training_progress` Prisma model in backend/prisma/schema.prisma.
-- This repo has no `backend/prisma/migrations/` directory — schema changes ship
-- as hand-written SQL here, matching 2026_08_27_admin_rbac_upgrade.sql.
--
-- NOTE: deploying the backend before this table exists makes the training-status
-- endpoint 500, and the Android app's onFailure fallback then routes every driver
-- into the training video with no way back to Home — run this first.

CREATE TABLE IF NOT EXISTS `driver_training_progress` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `rider_id` INT(11) NOT NULL,
  `video_url` TEXT NOT NULL,
  `current_position_seconds` INT(11) NOT NULL DEFAULT 0,
  `total_duration_seconds` INT(11) NOT NULL DEFAULT 0,
  `watch_progress` FLOAT NOT NULL DEFAULT 0,
  `is_completed` TINYINT(1) NOT NULL DEFAULT 0,
  `completed_at` DATETIME NULL DEFAULT NULL,
  `last_reminded_at` DATETIME NULL DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `app_settings.setting_value` was VARCHAR(255) — too small for real signed
-- CloudFront/S3/Firebase Storage video URLs, which routinely exceed 255 chars.
-- On MySQL strict mode this 500s the Settings save; in non-strict mode it
-- silently truncates the stored URL. Widen to TEXT.
ALTER TABLE `app_settings`
MODIFY COLUMN `setting_value` TEXT NULL;
