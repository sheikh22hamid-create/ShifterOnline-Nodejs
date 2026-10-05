-- Backfill: drivers were never credited for completed WALLET-PAID rides
-- (p_method_id = -2 / trans_id 'wallet_*'). The customer's wallet was debited the
-- fare at booking and the driver collected no cash, so the driver is owed
-- fare - commission for each. New rides are credited at completion by the code
-- fix (payment_id 'wallet_order_credit:<orderId>'); this credits the old ones
-- with the SAME key, so running it twice (or after the fix is live) never pays
-- an order twice.
--
-- Skips Monthly Drivers (tbl_rider.monthly_plan = 1: fixed pay, own ledger) and
-- orders with no rider. REVIEW THE PREVIEW FIRST: commission here is
-- ROUND(total_dcharge * commission / 100, 2); a per-trip plan charge (if any)
-- is not known to this script. Daily Driver days (daily_driver_enrollment) are
-- NOT excluded automatically - check the preview for riders on a Daily plan.

-- PREVIEW: what would be credited, per order and per driver
SELECT o.id AS order_id, o.rid, o.total_dcharge, o.commission,
       ROUND(o.total_dcharge - ROUND(o.total_dcharge * o.commission / 100, 2), 2) AS credit,
       r.monthly_plan, o.ddate
FROM pkg_order o
JOIN tbl_rider r ON r.id = o.rid
WHERE o.o_status = 'Completed' AND o.rid > 0
  AND (o.p_method_id = -2 OR o.trans_id LIKE 'wallet%')
  AND COALESCE(r.monthly_plan, 0) <> 1
  AND NOT EXISTS (SELECT 1 FROM tbl_wallet_history w
                  WHERE w.payment_id = CONCAT('wallet_order_credit:', o.id) AND w.wallet_type = 'driver')
ORDER BY o.rid, o.id;

SELECT o.rid,
       COUNT(*) AS orders,
       ROUND(SUM(o.total_dcharge - ROUND(o.total_dcharge * o.commission / 100, 2)), 2) AS total_credit
FROM pkg_order o
JOIN tbl_rider r ON r.id = o.rid
WHERE o.o_status = 'Completed' AND o.rid > 0
  AND (o.p_method_id = -2 OR o.trans_id LIKE 'wallet%')
  AND COALESCE(r.monthly_plan, 0) <> 1
  AND NOT EXISTS (SELECT 1 FROM tbl_wallet_history w
                  WHERE w.payment_id = CONCAT('wallet_order_credit:', o.id) AND w.wallet_type = 'driver')
GROUP BY o.rid;

-- APPLY (only after the preview looks right)
START TRANSACTION;

-- 1) ledger rows first (idempotent through the NOT EXISTS on payment_id)
INSERT INTO tbl_wallet_history (user_id, amount, type, remark, wallet_type, order_id, payment_id, created_at)
SELECT o.rid,
       ROUND(o.total_dcharge - ROUND(o.total_dcharge * o.commission / 100, 2), 2),
       'credit',
       CONCAT('Earning for wallet-paid order #', o.id, ' (backfill)'),
       'driver', o.id, CONCAT('wallet_order_credit:', o.id),
       DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE)
FROM pkg_order o
JOIN tbl_rider r ON r.id = o.rid
WHERE o.o_status = 'Completed' AND o.rid > 0
  AND (o.p_method_id = -2 OR o.trans_id LIKE 'wallet%')
  AND COALESCE(r.monthly_plan, 0) <> 1
  AND ROUND(o.total_dcharge - ROUND(o.total_dcharge * o.commission / 100, 2), 2) > 0
  AND NOT EXISTS (SELECT 1 FROM tbl_wallet_history w
                  WHERE w.payment_id = CONCAT('wallet_order_credit:', o.id) AND w.wallet_type = 'driver');

-- 2) move each driver's balance by exactly what this script just inserted
UPDATE tbl_rider r
JOIN (SELECT user_id, SUM(amount) AS amt
      FROM tbl_wallet_history
      WHERE wallet_type = 'driver' AND payment_id LIKE 'wallet_order_credit:%'
        AND remark LIKE '%(backfill)'
        AND created_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE) - INTERVAL 10 MINUTE
      GROUP BY user_id) b ON b.user_id = r.id
SET r.wallet_balance = r.wallet_balance + b.amt;

COMMIT;

-- VERIFY
SELECT user_id, COUNT(*) AS rows_added, SUM(amount) AS added
FROM tbl_wallet_history WHERE remark LIKE '%(backfill)' AND payment_id LIKE 'wallet_order_credit:%'
GROUP BY user_id;
