-- Pickup ETA + auto-cancel deadline (2026-10-02).
-- Customer ETA = Google driver->pickup minutes + admin buffer; pickup_deadline_at
-- (true UTC) is when tripLifecycle.sweepPickupEtaDeadlines auto-cancels the
-- order on the driver's side. Not modelled in prisma/schema.prisma on purpose
-- (raw SQL only) - see services/pickupEtaService.js.
ALTER TABLE pkg_order
  ADD COLUMN pickup_eta_minutes INT NULL,
  ADD COLUMN pickup_deadline_at DATETIME NULL;
