-- Low Fare Booking (spec 2026-10-27): next-day orders accepted by drivers inside the customer's window.
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261028010000_add_low_fare_booking`. Never `migrate deploy`.
ALTER TABLE `pkg_order`
  ADD COLUMN `next_day_model1_fare` DECIMAL(10, 2) NULL,
  ADD COLUMN `next_day_discount_percent` DECIMAL(5, 2) NULL,
  ADD COLUMN `next_day_live_until` DATETIME(0) NULL;

CREATE TABLE IF NOT EXISTS `low_fare_view` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `seen_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_low_fare_view` (`rider_id`, `order_id`),
  INDEX `idx_low_fare_view_order` (`order_id`)
);
