-- Next-Day Daily Driver Offer: backfill for next-day orders booked BEFORE this feature deployed.
--
-- DOCUMENTATION SCRIPT - NOT AUTO-RUN. Run it by hand, once, after migration
-- 20261013030000_add_next_day_daily_offer (next_day_stage / next_day_live_at columns) is applied and the new
-- code is deployed. Run the preview SELECT first and check the rows.
--
-- What it does: existing next-day orders (booking_type = 3) that are still
-- unassigned and whose trip date is today or later get
--   next_day_stage   = 'arranging'
--   next_day_live_at = trip date at 14:00 IST (= 08:30:00 UTC; stored as UTC)
-- so the Daily Driver offer flow and the 14:00 go-live sweep pick them up.
-- The trip date is the first 10 chars (YYYY-MM-DD) of schedule_date_time.

-- 1) Preview (run first):
SELECT id, uid, city_id, schedule_date_time, rid, o_status, next_day_stage, next_day_live_at,
       TIMESTAMP(STR_TO_DATE(LEFT(schedule_date_time, 10), '%Y-%m-%d'), '08:30:00') AS new_live_at_utc
FROM pkg_order
WHERE booking_type = 3
  AND rid = 0
  AND o_status = 'Pending'
  AND next_day_stage IS NULL
  AND STR_TO_DATE(LEFT(schedule_date_time, 10), '%Y-%m-%d') >= CURDATE();

-- 2) Backfill (same WHERE):
UPDATE pkg_order
SET next_day_stage = 'arranging',
    next_day_live_at = TIMESTAMP(STR_TO_DATE(LEFT(schedule_date_time, 10), '%Y-%m-%d'), '08:30:00')
WHERE booking_type = 3
  AND rid = 0
  AND o_status = 'Pending'
  AND next_day_stage IS NULL
  AND STR_TO_DATE(LEFT(schedule_date_time, 10), '%Y-%m-%d') >= CURDATE();
