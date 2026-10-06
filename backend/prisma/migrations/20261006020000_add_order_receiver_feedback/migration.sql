-- Receiver review of a delivery (spec 2026-10-06 delivered experience). Apply on prod BEFORE deploying the backend.
CREATE TABLE `order_receiver_feedback` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `receiver_phone` VARCHAR(15) NOT NULL,
  `driver_rating` INT NULL,
  `delivery_rating` INT NULL,
  `feedback_tags` VARCHAR(255) NULL,
  `comment` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_receiver_feedback_order` (`order_id`),
  INDEX `idx_order_receiver_feedback_rider` (`rider_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
