-- Pickup OTP share from the customer app to the driver app (spec 2026-10-29).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261029020000_add_pickup_otp_share`. Never `migrate deploy`.
CREATE TABLE IF NOT EXISTS `pickup_otp_share` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
  `attempts` INT NOT NULL DEFAULT 1,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `delivered_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_pickup_otp_share_order` (`order_id`, `requested_at`)
);
