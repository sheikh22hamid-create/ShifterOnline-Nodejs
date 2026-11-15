-- Customer GST details (spec 2026-11-15). Hand-applied; NOT applied anywhere yet. Three new tables, nothing existing is changed.
--  customer_gst_profile   the customer's own verified GSTIN + details (one per customer), used to autofill the next booking
--  order_gst_detail       the verified details snapshotted on a booking, so its invoice never changes if the profile does
--  gst_verification_cache a provider answer per GSTIN (public registry data), to save paid lookups
CREATE TABLE IF NOT EXISTS `customer_gst_profile` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `uid` INT NOT NULL,
  `gstin` VARCHAR(15) NOT NULL,
  `legal_name` VARCHAR(255) NOT NULL,
  `trade_name` VARCHAR(255) NULL,
  `address` VARCHAR(600) NULL,
  `state` VARCHAR(100) NULL,
  `state_code` VARCHAR(2) NULL,
  `pincode` VARCHAR(10) NULL,
  `gst_status` VARCHAR(40) NULL,
  `verified_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_gst_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `order_gst_detail` (
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `gstin` VARCHAR(15) NOT NULL,
  `legal_name` VARCHAR(255) NOT NULL,
  `trade_name` VARCHAR(255) NULL,
  `address` VARCHAR(600) NULL,
  `state` VARCHAR(100) NULL,
  `state_code` VARCHAR(2) NULL,
  `pincode` VARCHAR(10) NULL,
  `verified_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`order_id`),
  KEY `idx_order_gst_uid` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `gst_verification_cache` (
  `gstin` VARCHAR(15) NOT NULL,
  `legal_name` VARCHAR(255) NOT NULL,
  `trade_name` VARCHAR(255) NULL,
  `address` VARCHAR(600) NULL,
  `state` VARCHAR(100) NULL,
  `state_code` VARCHAR(2) NULL,
  `pincode` VARCHAR(10) NULL,
  `gst_status` VARCHAR(40) NULL,
  `verified_at` DATETIME NOT NULL,
  PRIMARY KEY (`gstin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
