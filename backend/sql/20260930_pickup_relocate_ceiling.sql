ALTER TABLE pkg_order_wait_timer ADD COLUMN first_arrival_at DATETIME NULL;
ALTER TABLE pkg_order ADD COLUMN pickup_otp_mismatch_flag TINYINT(1) NOT NULL DEFAULT 0;
