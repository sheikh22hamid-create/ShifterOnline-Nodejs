-- AlterTable
ALTER TABLE `driver_withdraw_requests`
    ADD COLUMN `payout_method` VARCHAR(10) NULL,
    ADD COLUMN `payout_detail` VARCHAR(255) NULL;
