-- RC manual-review support: persist the admin's rejection reason so the
-- driver app can show it, and flag RC rows submitted via the
-- name-mismatch fallback (driver uploaded RC photos instead of passing
-- the automatic Acko owner-name match).
ALTER TABLE tbl_vehicle_details
  ADD COLUMN rejection_reason VARCHAR(255) NULL,
  ADD COLUMN name_mismatch TINYINT(1) NOT NULL DEFAULT 0;

-- Persist why a driver was blocked so it survives past the one-time
-- notification text and can be shown on the driver's blocked screen /
-- referenced by support when they call in to get unblocked.
ALTER TABLE tbl_rider
  ADD COLUMN block_reason VARCHAR(255) NULL;
