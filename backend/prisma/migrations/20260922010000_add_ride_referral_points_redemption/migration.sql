-- AlterTable
ALTER TABLE `tbl_referral_setting` ADD COLUMN `ride_discount_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE `pkg_order` ADD COLUMN `referral_points_used` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `referral_points_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00;
