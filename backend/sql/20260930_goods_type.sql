-- CreateTable
CREATE TABLE `tbl_goods_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `tbl_goods_type_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `pkg_order`
    ADD COLUMN `goods_type_id` INTEGER NULL,
    ADD COLUMN `goods_type_name` VARCHAR(100) NULL,
    ADD COLUMN `goods_type_other` VARCHAR(100) NULL;

-- Default goods types (admin can edit/add more from the Goods Types page).
INSERT IGNORE INTO `tbl_goods_type` (`name`, `sort_order`) VALUES
    ('Construction material', 1),
    ('Clothing', 2),
    ('Furniture', 3),
    ('Electronics', 4),
    ('Household items', 5),
    ('Food & groceries', 6),
    ('Machinery / Parts', 7);
