-- Dynamic configuration for Package Category filtering on Premium Plans.
-- Plans can target 'all' vehicle categories or specific categories (comma-separated pkg_category IDs / names).
ALTER TABLE tbl_premium_plan
  ADD COLUMN package_categories VARCHAR(255) NOT NULL DEFAULT 'all';
