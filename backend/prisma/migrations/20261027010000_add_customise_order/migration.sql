-- Customise Order with counter-offer bargaining (spec 2026-10-26, Phase 1).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261027010000_add_customise_order`. Never `migrate deploy`.
-- The legacy tbl_custom_order / tbl_custom_order_bid tables are NOT touched.
CREATE TABLE IF NOT EXISTS `customise_order` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `uid` INT NOT NULL,
  `city_id` INT NULL,
  `category_id` INT NULL,
  `category_name` VARCHAR(100) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  `p_lat` DECIMAL(10, 7) NOT NULL,
  `p_lng` DECIMAL(10, 7) NOT NULL,
  `p_address` TEXT NOT NULL,
  `p_exact` TINYINT(1) NOT NULL DEFAULT 1,
  `d_lat` DECIMAL(10, 7) NOT NULL,
  `d_lng` DECIMAL(10, 7) NOT NULL,
  `d_address` TEXT NOT NULL,
  `goods_desc` TEXT NOT NULL,
  `goods_qty` INT NOT NULL,
  `goods_weight_kg` DECIMAL(10, 2) NOT NULL,
  `goods_len_cm` DECIMAL(10, 2) NULL,
  `goods_wid_cm` DECIMAL(10, 2) NULL,
  `goods_hgt_cm` DECIMAL(10, 2) NULL,
  `packing_notes` TEXT NULL,
  `p_floor` INT NOT NULL DEFAULT 0,
  `p_carry_m` INT NOT NULL DEFAULT 0,
  `p_helpers` INT NOT NULL DEFAULT 0,
  `p_load_min` INT NOT NULL DEFAULT 0,
  `p_wait_min` INT NOT NULL DEFAULT 0,
  `p_notes` TEXT NULL,
  `d_floor` INT NOT NULL DEFAULT 0,
  `d_carry_m` INT NOT NULL DEFAULT 0,
  `d_helpers` INT NOT NULL DEFAULT 0,
  `d_unload_min` INT NOT NULL DEFAULT 0,
  `d_wait_min` INT NOT NULL DEFAULT 0,
  `d_notes` TEXT NULL,
  `initial_fare` DECIMAL(10, 2) NOT NULL,
  `p_method_id` INT NOT NULL DEFAULT 1,
  `bargain_start_at` DATETIME(0) NOT NULL,
  `expires_at` DATETIME(0) NOT NULL,
  `agreed_fare` DECIMAL(10, 2) NULL,
  `agreed_rider_id` INT NULL,
  `agreed_offer_id` INT NULL,
  `pkg_order_id` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_customise_order_pkg` (`pkg_order_id`),
  INDEX `idx_customise_status_city` (`status`, `city_id`),
  INDEX `idx_customise_uid` (`uid`),
  INDEX `idx_customise_expires` (`expires_at`)
);

CREATE TABLE IF NOT EXISTS `customise_order_stop` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `seq` INT NOT NULL,
  `lat` DECIMAL(10, 7) NOT NULL,
  `lng` DECIMAL(10, 7) NOT NULL,
  `address` TEXT NOT NULL,
  `kind` VARCHAR(10) NOT NULL DEFAULT 'drop',
  `goods_desc` TEXT NULL,
  `floor` INT NOT NULL DEFAULT 0,
  `carry_m` INT NOT NULL DEFAULT 0,
  `helpers` INT NOT NULL DEFAULT 0,
  `load_min` INT NOT NULL DEFAULT 0,
  `unload_min` INT NOT NULL DEFAULT 0,
  `wait_min` INT NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_customise_stop_order` (`order_id`)
);

CREATE TABLE IF NOT EXISTS `customise_offer` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `amount` DECIMAL(10, 2) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `decided_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_customise_offer_order_rider` (`order_id`, `rider_id`, `status`)
);

CREATE TABLE IF NOT EXISTS `customise_dismissal` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_customise_dismissal` (`order_id`, `rider_id`)
);

CREATE TABLE IF NOT EXISTS `customise_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NULL,
  `type` VARCHAR(40) NOT NULL,
  `meta` JSON NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_customise_event_order` (`order_id`, `type`)
);

ALTER TABLE `pkg_order` ADD COLUMN `customise_order_id` INT NULL, ADD INDEX `idx_pkg_order_customise` (`customise_order_id`);
