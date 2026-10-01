-- AlterTable
ALTER TABLE `pkg_order` ADD COLUMN `pickup_otp_mismatch_flag` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `pkg_order_wait_timer` ADD COLUMN `first_arrival_at` DATETIME(0) NULL,
    ADD COLUMN `otp_verify_at` DATETIME(0) NULL,
    ADD COLUMN `otp_verify_lat` VARCHAR(30) NULL,
    ADD COLUMN `otp_verify_lng` VARCHAR(30) NULL,
    ADD COLUMN `pickup_load_wait_seconds` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pickup_load_wait_start` DATETIME(0) NULL,
    ADD COLUMN `pickup_wait_banked_seconds` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `tbl_package` ADD COLUMN `use_linear_pricing` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `tbl_rider` ADD COLUMN `block_reason` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `tbl_vehicle_details` ADD COLUMN `name_mismatch` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rejection_reason` VARCHAR(255) NULL;

