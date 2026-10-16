-- Drop OTP: the driver must verify an OTP at the drop before the unloading timer starts (spec 2026-10-16).
-- Behind app_settings `drop_otp_enabled` (default OFF). Apply by hand on EVERY database BEFORE deploying the
-- backend, then `prisma migrate resolve --applied 20261016010000_add_drop_otp`.
ALTER TABLE `pkg_order` ADD COLUMN `drop_otp` INT NULL;
ALTER TABLE `pkg_order_wait_timer` ADD COLUMN `drop_arrived_at` DATETIME(0) NULL;
