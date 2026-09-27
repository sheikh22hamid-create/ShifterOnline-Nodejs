-- AlterTable
ALTER TABLE `tbl_rider`
  ADD COLUMN `trial_status` ENUM('none', 'active', 'exhausted', 'blocked', 'upgraded') NOT NULL DEFAULT 'none',
  ADD COLUMN `trial_orders_allowed` INTEGER NULL,
  ADD COLUMN `trial_orders_completed` INTEGER NOT NULL DEFAULT 0;
