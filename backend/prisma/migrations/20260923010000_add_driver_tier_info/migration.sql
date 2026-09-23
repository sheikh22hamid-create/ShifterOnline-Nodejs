-- AlterTable
ALTER TABLE `tbl_package`
    ADD COLUMN `driver_card_subtitle` VARCHAR(255) NULL,
    ADD COLUMN `driver_info_subtitle` VARCHAR(255) NULL,
    ADD COLUMN `driver_info_sections` TEXT NULL;
