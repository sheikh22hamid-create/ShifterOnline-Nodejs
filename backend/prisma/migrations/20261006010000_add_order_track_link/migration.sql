-- Receiver live tracking (spec 2026-10-06). Apply on prod BEFORE deploying the backend.
CREATE TABLE `order_track_link` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `token` CHAR(43) NOT NULL,
  `receiver_phone` VARCHAR(15) NOT NULL,
  `created_at` DATETIME(0) NOT NULL,
  `last_viewed_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_track_link_order` (`order_id`),
  UNIQUE INDEX `uq_order_track_link_token` (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
