-- AlterTable
ALTER TABLE `pkg_order_wait_timer`
    ADD COLUMN `otp_verify_lat` VARCHAR(30) NULL,
    ADD COLUMN `otp_verify_lng` VARCHAR(30) NULL,
    ADD COLUMN `otp_verify_at` DATETIME(0) NULL;
