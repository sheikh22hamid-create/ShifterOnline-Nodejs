-- Multi-City Geofence, Settings & Rate Card Isolation with Global Fallback
-- 1. Ensure service_zone has zone_kind column
ALTER TABLE `service_zone` ADD COLUMN IF NOT EXISTS `zone_kind` VARCHAR(20) NOT NULL DEFAULT 'duty';

-- 2. Ensure Global India city row exists in tbl_city (ID 17 or next available)
INSERT INTO `tbl_city` (`id`, `title`, `status`) 
SELECT 17, 'Global India', 1 
WHERE NOT EXISTS (SELECT 1 FROM `tbl_city` WHERE `id` = 17 OR `title` LIKE '%Global%');

-- 3. Enable Global India fallback in app_settings
INSERT INTO `app_settings` (`setting_key`, `setting_value`) 
VALUES ('global_india_fallback_enabled', '1') 
ON DUPLICATE KEY UPDATE `setting_value` = '1';

INSERT INTO `app_settings` (`setting_key`, `setting_value`) 
VALUES ('global_india_city_id', '17') 
ON DUPLICATE KEY UPDATE `setting_value` = '17';
