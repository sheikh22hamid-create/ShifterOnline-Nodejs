-- Booking Guarantee daily compensation window (IST "HH:MM"). Both NULL = guarantee applies all day.
-- Apply by hand on EVERY database BEFORE deploying the backend, then `prisma migrate resolve --applied`.
ALTER TABLE `city_order_settings`
  ADD COLUMN `guarantee_start_time` VARCHAR(5) NULL,
  ADD COLUMN `guarantee_end_time` VARCHAR(5) NULL;
