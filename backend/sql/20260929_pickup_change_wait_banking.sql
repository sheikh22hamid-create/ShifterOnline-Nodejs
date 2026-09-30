-- A customer moving the pickup location while the driver is already parked
-- there (order_status = 2, pickup_wait_start set) must not wipe out wait
-- time the driver has already legitimately accrued when the trip reverts
-- to order_status = 1 and the driver re-travels to the new point (see
-- orderPickupService.confirmPickupChange). This column banks that elapsed
-- time so it survives the pickup_wait_start reset and re-arrival cycle.
ALTER TABLE pkg_order_wait_timer
  ADD COLUMN pickup_wait_banked_seconds INT NOT NULL DEFAULT 0;
