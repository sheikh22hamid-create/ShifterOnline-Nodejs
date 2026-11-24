-- Loading/Unloading ("saaman uthana") labour feature, Phase 1 Model A (spec 2026-11-24).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261124010000_add_labour_loading`. Never `migrate deploy`.
-- Additive only; feature is OFF by default (app_setting labour_enabled.global=false).
-- NOTE: the existing pkg_order.loading_charge / unloading_charge are the STATIC rate-card
-- per-vehicle fields and are intentionally left untouched. These new labour_* columns are the
-- dynamic, customer-declared, escrowed, driver-paid Phase-1 feature and are a separate concept.

-- 1. Per-order dynamic labour fields.
ALTER TABLE `pkg_order`
  ADD COLUMN `labour_opted`            TINYINT(1)      NOT NULL DEFAULT 0,
  ADD COLUMN `labour_mode`             VARCHAR(10)     NULL,          -- 'home' | 'shop'
  ADD COLUMN `labour_charge_amount`    DECIMAL(10,2)   NOT NULL DEFAULT 0.00,  -- declared base labour, held in escrow
  ADD COLUMN `labour_declared_json`    TEXT            NULL,          -- snapshot of per-leg declared inputs (dispute proof)
  ADD COLUMN `labour_extra_amount`     DECIMAL(10,2)   NOT NULL DEFAULT 0.00,  -- on-site mismatch delta
  ADD COLUMN `labour_extra_approved`   TINYINT(1)      NOT NULL DEFAULT 0,
  ADD COLUMN `labour_extra_photo`      VARCHAR(255)    NULL,          -- driver photo of the real situation
  ADD COLUMN `labour_extra_json`       TEXT            NULL,          -- corrected inputs snapshot
  ADD COLUMN `labour_status`           VARCHAR(12)     NOT NULL DEFAULT 'none';
  -- labour_status: none | held | released | refunded | disputed | resolved

-- 2. Driver opt-in mode (drive_only never gets labour jobs; light_only only light/ground).
ALTER TABLE `tbl_rider`
  ADD COLUMN `labour_mode` VARCHAR(12) NOT NULL DEFAULT 'drive_only';
  -- labour_mode: drive_only | light_only | full_loader

-- 3. Labour dispute, resolved by an executive (reuses the executive admin role + decide pattern).
CREATE TABLE IF NOT EXISTS `labour_dispute` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `order_id`             INT           NOT NULL,
  `city_id`              INT           NULL,
  `raised_by`            VARCHAR(10)   NOT NULL,          -- 'customer' | 'driver'
  `reason`               TEXT          NULL,
  `raised_at`            DATETIME(0)   NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `status`               VARCHAR(12)   NOT NULL DEFAULT 'pending',  -- pending | resolved
  `assigned_executive_id` INT          NULL,
  `action`               VARCHAR(10)   NULL,             -- release | refund | split
  `driver_amount`        DECIMAL(10,2) NULL,             -- amount paid to driver on resolve
  `refund_amount`        DECIMAL(10,2) NULL,             -- amount refunded to customer on resolve
  `resolved_by`          INT           NULL,
  `resolved_at`          DATETIME(0)   NULL,
  `resolve_note`         TEXT          NULL,
  `created_at`           DATETIME(0)   NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at`           DATETIME(0)   NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_labour_dispute_queue` (`status`, `city_id`),
  INDEX `idx_labour_dispute_order` (`order_id`)
);

-- 4. Owner-tunable config (all editable at runtime; feature OFF by default).
INSERT INTO `app_settings` (`setting_key`, `setting_value`) VALUES
  ('labour_enabled',     '{"global":false,"cities":{}}'),
  ('labour_base_home',   '60'),
  ('labour_base_shop',   '80'),
  ('labour_size_mult',   '{"small":1,"medium":1.6,"large":2.6}'),
  ('labour_floor_mult',  '{"ground":1,"f1_2":1.4,"f3plus":1.9,"lift_factor":0.6}'),
  ('labour_qty_mult',    '{"q15":1,"q15_40":1.8,"q40plus":3}'),
  ('labour_access_mult', '{"shutter":1,"stack_inside":1.5,"loft_basement":2.2}'),
  ('labour_caps',        '{"max_size":"medium","max_floor":"f1_2","max_qty":"q15_40","blocked_access":["loft_basement"],"heavy_items":["fridge","cement","tandoor","almirah","washing_machine"]}'),
  ('labour_fee',         '0')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
