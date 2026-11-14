-- RazorpayX driver payouts (spec 2026-11-14). Adds payout-tracking columns and the processing/paid/failed
-- statuses to driver_withdraw_requests, and the RazorpayX contact id to tbl_rider. Apply by hand ONCE on
-- EVERY database (ALTERs are not re-runnable), then
-- `prisma migrate resolve --applied 20261114010000_add_razorpayx_payouts`. Never `migrate deploy`.
ALTER TABLE `driver_withdraw_requests`
  MODIFY COLUMN `status` ENUM('pending','approved','rejected','processing','paid','failed') NULL DEFAULT 'pending',
  ADD COLUMN `razorpay_payout_id` VARCHAR(64) NULL,
  ADD COLUMN `razorpay_fund_account_id` VARCHAR(64) NULL,
  ADD COLUMN `utr` VARCHAR(64) NULL,
  ADD COLUMN `failure_reason` VARCHAR(255) NULL,
  ADD COLUMN `payout_started_at` DATETIME(0) NULL,
  ADD COLUMN `payout_processed_at` DATETIME(0) NULL,
  ADD INDEX `idx_dwr_razorpay_payout_id` (`razorpay_payout_id`);

ALTER TABLE `tbl_rider`
  ADD COLUMN `razorpay_contact_id` VARCHAR(64) NULL;
