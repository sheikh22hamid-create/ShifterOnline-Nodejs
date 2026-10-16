-- WhatsApp opt-in for the drop contact and for every extra stop (same checkbox as the pickup sender's).
-- Default 0 = no extra message. Apply by hand on EVERY database BEFORE deploying the backend, then
-- `prisma migrate resolve --applied 20261016020000_add_receiver_stop_whatsapp`.
ALTER TABLE `pkg_order` ADD COLUMN `send_receiver_whatsapp` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `pkg_order_stops` ADD COLUMN `send_whatsapp` TINYINT(1) NOT NULL DEFAULT 0;
