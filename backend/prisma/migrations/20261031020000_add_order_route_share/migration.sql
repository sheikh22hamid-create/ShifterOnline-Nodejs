-- Shareable read-only link to a completed ride's saved route map (spec 2026-10-31).
-- Apply by hand on EVERY database, then
-- `prisma migrate resolve --applied 20261031020000_add_order_route_share`. Never `migrate deploy`.
CREATE TABLE IF NOT EXISTS `order_route_share` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `token` CHAR(43) NOT NULL,
  `created_at` DATETIME(0) NOT NULL,
  `last_viewed_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_route_share_order` (`order_id`),
  UNIQUE KEY `uq_order_route_share_token` (`token`)
);
