-- Migration: Add Maximum Travel Distance (KM) to pkg_category
-- Date: 2026-11-22
-- Purpose: Vehicle Category Maximum Travel Distance Configuration & Customer App Filtering

-- 1. Add max_distance column to pkg_category table if not exists
ALTER TABLE pkg_category 
ADD COLUMN IF NOT EXISTS max_distance DECIMAL(10, 2) NULL DEFAULT NULL AFTER max_load_kg;

-- 2. Seed backward-compatible initial defaults for standard vehicle categories (only where currently NULL)
UPDATE pkg_category SET max_distance = 70.00 WHERE LOWER(cat_name) LIKE '%bike%' AND max_distance IS NULL;
UPDATE pkg_category SET max_distance = 70.00 WHERE LOWER(cat_name) LIKE '%scooter%' AND max_distance IS NULL;
UPDATE pkg_category SET max_distance = 100.00 WHERE (LOWER(cat_name) LIKE '%e loader%' OR LOWER(cat_name) LIKE '%eloader%' OR LOWER(cat_name) LIKE '%e-loader%') AND max_distance IS NULL;
UPDATE pkg_category SET max_distance = 200.00 WHERE (LOWER(cat_name) LIKE '%3 wheeler%' OR LOWER(cat_name) LIKE '%three wheeler%' OR LOWER(cat_name) LIKE '%champion%') AND max_distance IS NULL;
UPDATE pkg_category SET max_distance = 500.00 WHERE (LOWER(cat_name) LIKE '%4 wheeler%' OR LOWER(cat_name) LIKE '%four wheeler%' OR LOWER(cat_name) LIKE '%tata ace%' OR LOWER(cat_name) LIKE '%pickup%' OR LOWER(cat_name) LIKE '%bolero%') AND max_distance IS NULL;
