-- Sender WhatsApp opt-in (PRD 2026-10-13). Default 0 = sender gets no automated WhatsApp.
-- Apply by hand on EVERY database BEFORE deploying the backend, then `prisma migrate resolve --applied`.
ALTER TABLE `pkg_order` ADD COLUMN `send_sender_whatsapp` TINYINT(1) NOT NULL DEFAULT 0;
