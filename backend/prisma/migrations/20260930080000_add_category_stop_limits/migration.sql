-- Per-vehicle add-stop limit/charge; NULL means "use the global setting".
ALTER TABLE `pkg_category`
    ADD COLUMN `max_extra_stops` INTEGER NULL,
    ADD COLUMN `extra_stop_charge` DECIMAL(10, 2) NULL;
