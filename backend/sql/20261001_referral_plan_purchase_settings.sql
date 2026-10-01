-- Admin-controlled redemption of referral points on plan purchase (users + drivers).
ALTER TABLE `tbl_referral_setting`
    ADD COLUMN `plan_purchase_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `plan_points_max_percent` DECIMAL(5, 2) NOT NULL DEFAULT 100.00;
