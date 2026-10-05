-- One-off correction for order #468 (customer uid 31, driver rid 38).
-- Booked at Rs652 -> 326 points redeemed (50% cap). Early-dropped to Rs170 ->
-- cap is 85 points, but all 326 stayed spent and the driver was credited Rs312
-- ("advance_refund:468") instead of ~Rs71 (85 - 14.01 commission).
-- Excess = 326 - 85 = 241 points / Rs241 on both sides.
--
-- Run the preview SELECTs first; only run the transaction if the numbers match.
-- Safe to run once: guarded by the payment_id key / point-log note.

-- PREVIEW
SELECT id, referral_points_used, referral_points_amount, total_dcharge FROM pkg_order WHERE id = 468;
SELECT id, referral_points FROM tbl_user WHERE id = 31;
SELECT id, wallet_balance FROM tbl_rider WHERE id = 38;
SELECT COUNT(*) AS already_fixed FROM tbl_wallet_history WHERE payment_id = 'fix_468_driver_overcredit';

-- FIX
START TRANSACTION;

-- 1) order: points actually consumed by a Rs170 fare
UPDATE pkg_order
SET referral_points_used = 85, referral_points_amount = 85
WHERE id = 468 AND referral_points_used = 326;

-- 2) customer: give back the 241 extra points + ledger row
UPDATE tbl_user SET referral_points = referral_points + 241
WHERE id = 31 AND ROW_COUNT() = 1;

INSERT INTO tbl_referral_point_log (user_id, user_type, points, txn_type, source, ref_id, balance_after, note, created_at)
SELECT 31, 'USER', 241, 'credit', 'ride_discount_refund', 0, referral_points,
       'Refunded - order #468 fare reduced to Rs170, points cap is now 85', NOW()
FROM tbl_user WHERE id = 31 AND ROW_COUNT() = 1;

-- 3) driver: take back the over-credit + wallet history row (once)
UPDATE tbl_rider SET wallet_balance = wallet_balance - 241
WHERE id = 38
  AND NOT EXISTS (SELECT 1 FROM tbl_wallet_history WHERE payment_id = 'fix_468_driver_overcredit');

INSERT INTO tbl_wallet_history (user_id, amount, type, remark, wallet_type, order_id, payment_id, created_at)
SELECT 38, 241, 'debit', 'Correction for order #468 (referral points exceeded early-drop fare)', 'driver', 468,
       'fix_468_driver_overcredit', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE)
WHERE ROW_COUNT() = 1;

COMMIT;

-- VERIFY
SELECT id, referral_points_used, referral_points_amount FROM pkg_order WHERE id = 468;
SELECT id, referral_points FROM tbl_user WHERE id = 31;
SELECT id, wallet_balance FROM tbl_rider WHERE id = 38;
