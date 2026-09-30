ALTER TABLE pkg_order_wait_timer ADD COLUMN pickup_load_wait_start DATETIME NULL;
ALTER TABLE pkg_order_wait_timer ADD COLUMN pickup_load_wait_seconds INT NOT NULL DEFAULT 0;
