-- Replace Driver: one row per driver the customer replaced on an order (status 'held' until the order is
-- cancelled after a 2nd replace, then 'forfeited'). Hand-applied; NOT applied anywhere yet.
CREATE TABLE IF NOT EXISTS `order_driver_replacement` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `advance_amount` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'held',
  `created_at` DATETIME NOT NULL,
  `settled_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_rider` (`order_id`, `rider_id`),
  KEY `idx_order_status` (`order_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
