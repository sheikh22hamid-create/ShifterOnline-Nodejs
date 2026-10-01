-- CreateTable
CREATE TABLE `tbl_restricted_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(255) NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `tbl_restricted_item_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Default restricted items (admin can edit/add more from the Restricted Items page).
INSERT IGNORE INTO `tbl_restricted_item` (`name`, `description`, `sort_order`) VALUES
    ('Explosives & fireworks', 'Not allowed on any booking', 1),
    ('Hazardous / toxic chemicals', 'Acids, poisons and other toxic substances', 2),
    ('Illegal goods', 'Anything prohibited by law', 3),
    ('Flammable liquids & gas cylinders', 'Petrol, LPG and similar', 4);
