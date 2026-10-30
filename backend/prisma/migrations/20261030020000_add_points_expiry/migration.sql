-- Points expiry (spec 2026-10-30). Existing ledger rows and balances are untouched: old credits get NULL expires_at
-- (= never expire). Apply by hand ONCE on EVERY database (ALTERs are not re-runnable), then
-- `prisma migrate resolve --applied 20261030020000_add_points_expiry`. Never `migrate deploy`.
ALTER TABLE `tbl_referral_setting`
  ADD COLUMN `points_expiry` JSON NULL;

ALTER TABLE `tbl_referral_point_log`
  ADD COLUMN `activity` VARCHAR(30) NULL,
  ADD COLUMN `expires_at` DATETIME(0) NULL,
  ADD COLUMN `expiry_status` VARCHAR(12) NULL,
  ADD COLUMN `expiry_duration` VARCHAR(20) NULL,
  ADD COLUMN `expired_points` INT NOT NULL DEFAULT 0,
  ADD COLUMN `origin_log_id` INT NULL,
  ADD INDEX `idx_expiry_due` (`expiry_status`, `expires_at`),
  ADD UNIQUE INDEX `uniq_expiry_origin` (`origin_log_id`);
