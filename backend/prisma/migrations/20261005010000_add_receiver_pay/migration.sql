-- Receiver pays (spec 2026-10-05). Apply on prod BEFORE deploying the backend.
ALTER TABLE `order_settlement`
  ADD COLUMN `payer` VARCHAR(10) NOT NULL DEFAULT 'customer',
  ADD COLUMN `receiver_markup` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `advance_held` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `reversal_shortfall` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `receiver_credited` TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE `order_receiver_pay` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `receiver_phone` VARCHAR(15) NOT NULL,
  `receiver_name` VARCHAR(100) NULL,
  `commission_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(10) NOT NULL DEFAULT 'active',
  `token_hash` CHAR(64) NULL,
  `token_expires_at` DATETIME(0) NULL,
  `razorpay_order_id` VARCHAR(64) NULL,
  `declined_by` VARCHAR(10) NULL,
  `declined_at` DATETIME(0) NULL,
  `link_sent_at` DATETIME(0) NULL,
  `link_send_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL,
  `updated_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_receiver_pay_order` (`order_id`),
  UNIQUE INDEX `uq_order_receiver_pay_token` (`token_hash`),
  INDEX `idx_order_receiver_pay_uid` (`uid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
