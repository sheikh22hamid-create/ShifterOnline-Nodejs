-- Admin Panel Phase 1: upgrade `admin` table for Super Admin / City Admin / Executive RBAC.
-- Run manually against the live Hostinger DB (srv2206.hstgr.io), then run
-- `npx prisma generate` in backend/ to refresh the Prisma client.
--
-- NOTE: existing `admin.password` values were hashed by the legacy PHP panel
-- (not bcrypt). Rows will not be able to log in through the new Node.js
-- auth until their password is reset to a bcrypt hash — see backend/scripts/reset-admin-password.js.

ALTER TABLE `admin`
MODIFY COLUMN `role` ENUM('superadmin', 'admin', 'executive') NOT NULL DEFAULT 'executive';

ALTER TABLE `admin`
ADD COLUMN `name` VARCHAR(150) NULL AFTER `username`,
ADD COLUMN `email` VARCHAR(150) NULL AFTER `name`,
ADD COLUMN `mobile` VARCHAR(20) NULL AFTER `email`,
ADD COLUMN `avatar` VARCHAR(255) NULL AFTER `mobile`,
ADD COLUMN `status` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=Active, 0=Deactivated' AFTER `city_id`,
ADD COLUMN `permissions` JSON NULL COMMENT 'Custom override permissions array' AFTER `status`,
ADD COLUMN `last_login_at` DATETIME NULL AFTER `permissions`,
ADD COLUMN `created_by` INT(11) NULL DEFAULT 0 AFTER `last_login_at`,
ADD COLUMN `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER `created_by`,
ADD COLUMN `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;
