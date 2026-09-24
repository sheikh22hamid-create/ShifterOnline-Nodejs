CREATE TABLE `driver_favorite_route` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `rider_id` INTEGER NOT NULL, `city_id` INTEGER NULL,
 `name` VARCHAR(80) NOT NULL, `points` JSON NOT NULL, `geometry` JSON NOT NULL,
 `distance_km` DOUBLE NOT NULL, `duration_seconds` INTEGER NOT NULL,
 `radius_km` DOUBLE NOT NULL DEFAULT 10, `mode` VARCHAR(12) NOT NULL DEFAULT 'prefer',
 `forward_only` BOOLEAN NOT NULL DEFAULT false, `expires_at` DATETIME(3) NULL,
 `disabled` BOOLEAN NOT NULL DEFAULT false, `disabled_reason` VARCHAR(255) NULL,
 `version` INTEGER NOT NULL DEFAULT 1, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updated_at` DATETIME(3) NOT NULL, PRIMARY KEY (`id`), INDEX (`rider_id`), INDEX (`city_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `driver_favorite_route_state` (
 `rider_id` INTEGER NOT NULL, `route_id` INTEGER NULL, `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY (`rider_id`), UNIQUE INDEX (`route_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `favorite_route_settings` (
 `city_id` INTEGER NOT NULL, `config` JSON NOT NULL, `updated_at` DATETIME(3) NOT NULL, PRIMARY KEY (`city_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `favorite_route_audit` (
 `id` INTEGER NOT NULL AUTO_INCREMENT, `city_id` INTEGER NULL, `rider_id` INTEGER NULL, `route_id` INTEGER NULL,
 `actor` VARCHAR(80) NOT NULL, `action` VARCHAR(40) NOT NULL, `detail` JSON NOT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), INDEX (`city_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
