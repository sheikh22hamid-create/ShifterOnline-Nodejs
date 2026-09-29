-- AlterTable
-- DEFAULT false preserves current live behavior exactly: every existing
-- package keeps using slab pricing (when its category has a slab config)
-- until an admin explicitly opts a package into manual linear pricing.
ALTER TABLE `tbl_package`
    ADD COLUMN `use_linear_pricing` BOOLEAN NOT NULL DEFAULT false;
