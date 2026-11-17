-- WhatsApp Trial Order (spec 2026-11-17). Hand-applied; NOT applied anywhere yet.
--  pkg_order.driver_channel     'app' (default) or 'whatsapp': how the assigned driver runs the order
--  whatsapp_driver_session      one row per WhatsApp-run order: bot conversation state (pending confirm, last step, no-reply alert)
ALTER TABLE `pkg_order` ADD COLUMN `driver_channel` VARCHAR(10) NOT NULL DEFAULT 'app';

CREATE TABLE IF NOT EXISTS `whatsapp_driver_session` (
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `phone` VARCHAR(15) NOT NULL,
  `pending_confirm` VARCHAR(20) NULL,
  `pending_otp` VARCHAR(10) NULL,
  `last_step` VARCHAR(40) NULL,
  `last_prompt_at` DATETIME(3) NULL,
  `last_reply_at` DATETIME(3) NULL,
  `last_location_at` DATETIME(3) NULL,
  `alerted_step` VARCHAR(40) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`order_id`),
  INDEX `whatsapp_driver_session_rider_id_idx` (`rider_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
