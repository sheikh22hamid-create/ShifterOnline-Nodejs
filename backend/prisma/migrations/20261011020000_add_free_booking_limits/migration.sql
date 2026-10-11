-- Free Booking Offer (spec 2026-10-11, section 3.2): admin limits per city (max free orders, max amount, max km)
-- Apply on every DB BEFORE deploying code.
ALTER TABLE `free_booking_setting`
  ADD COLUMN `max_free_orders` INT NULL,
  ADD COLUMN `max_amount` DECIMAL(10, 2) NULL,
  ADD COLUMN `max_km` DECIMAL(6, 2) NULL;
