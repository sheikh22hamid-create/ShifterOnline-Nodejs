-- Booking Guarantee: recover an order when its assigned driver cancels before pickup (spec 2026-10-14).
-- Per-city switch, OFF by default. Apply by hand on EVERY database BEFORE deploying the backend, then
-- `prisma migrate resolve --applied 20261014020000_add_guarantee_recover_on_cancel`.
ALTER TABLE `city_order_settings`
  ADD COLUMN `guarantee_recover_on_cancel` TINYINT(1) NOT NULL DEFAULT 0;
