-- Free Booking Offer: admin-set number of successful referrals needed to unlock the offer again (per city).
-- Apply on every DB BEFORE deploying the backend (a missing column makes free_booking_setting reads fail with P2022).
ALTER TABLE `free_booking_setting` ADD COLUMN `referrals_required` INT NOT NULL DEFAULT 1;
