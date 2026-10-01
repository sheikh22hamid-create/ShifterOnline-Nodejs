-- CreateTable
CREATE TABLE `tbl_booking_guideline` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text` VARCHAR(255) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Starting guidelines (admin can edit/add/delete from the Booking Guidelines page).
INSERT INTO `tbl_booking_guideline` (`text`, `sort_order`) VALUES
    ('Fare does not include loading / unloading labour charges.', 1),
    ('Toll, state taxes & parking charges to be borne by customer.', 2);
