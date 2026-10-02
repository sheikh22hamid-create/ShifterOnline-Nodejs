-- Ledger (tbl_wallet_history.created_at) time backfill - 2026-10-02
--
-- Convention (utils/istTime.js): created_at is stored as IST wall-clock
-- (real UTC + 5:30) and shown as-is by the apps and the admin panel. Until
-- 2026-10-01 several writers still stored true UTC (new Date()), so those rows
-- show 5.5 h early and sit out of time order next to IST rows.
--
-- Safe per-row detection, only for rows tied to an order: pkg_order.odate is
-- always true UTC, so a ledger row created within -60 min .. +270 min of the
-- order's odate is a UTC-written row (an IST-written row is always >= ~330 min
-- after odate). Those rows get +5:30. Rows with no order_id (legacy PHP era,
-- recharges, payouts) cannot be classified safely and are left untouched.
--
-- Idempotent: the backup table remembers each shifted row's original value and
-- the UPDATE only touches a row that still holds that original value.
-- Rollback:  UPDATE tbl_wallet_history w JOIN tbl_wallet_history_time_backup_20261002 b ON b.id = w.id
--            SET w.created_at = b.old_created_at;
--
-- Preview first (rows that would be shifted):
--   SELECT COUNT(*) FROM tbl_wallet_history w JOIN pkg_order o ON o.id = w.order_id
--   WHERE TIMESTAMPDIFF(MINUTE, o.odate, w.created_at) >= -60
--     AND TIMESTAMPDIFF(MINUTE, o.odate, w.created_at) < 270;

CREATE TABLE IF NOT EXISTS tbl_wallet_history_time_backup_20261002 (
  id INT NOT NULL PRIMARY KEY,
  old_created_at DATETIME NOT NULL
);

INSERT IGNORE INTO tbl_wallet_history_time_backup_20261002 (id, old_created_at)
SELECT w.id, w.created_at
FROM tbl_wallet_history w
JOIN pkg_order o ON o.id = w.order_id
WHERE w.created_at IS NOT NULL
  AND TIMESTAMPDIFF(MINUTE, o.odate, w.created_at) >= -60
  AND TIMESTAMPDIFF(MINUTE, o.odate, w.created_at) < 270;

UPDATE tbl_wallet_history w
JOIN tbl_wallet_history_time_backup_20261002 b ON b.id = w.id
SET w.created_at = DATE_ADD(w.created_at, INTERVAL 330 MINUTE)
WHERE w.created_at = b.old_created_at;
