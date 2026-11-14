-- Main Area (locality) title for each order's pickup and drop.
-- Hand-applied; NOT applied anywhere yet.
ALTER TABLE `pkg_order`
  ADD COLUMN `pickup_title` VARCHAR(120) NULL,
  ADD COLUMN `drop_title` VARCHAR(120) NULL;
