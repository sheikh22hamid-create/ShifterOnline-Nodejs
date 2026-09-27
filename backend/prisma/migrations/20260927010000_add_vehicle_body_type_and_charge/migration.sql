-- AlterTable
ALTER TABLE `tbl_rider`
  ADD COLUMN `body_type` VARCHAR(20) NOT NULL DEFAULT 'both';

-- AlterTable
ALTER TABLE `pkg_order`
  ADD COLUMN `body_type` VARCHAR(20) NULL DEFAULT 'any',
  ADD COLUMN `covered_charge` DECIMAL(10, 2) NULL DEFAULT 0.00;
