-- Admin-configurable allowed body types per vehicle category.
-- Comma-separated list of allowed types, e.g. 'open,half,covered', 'open,covered', or '' for two-wheelers.
ALTER TABLE pkg_category
  ADD COLUMN allowed_body_types VARCHAR(255) NULL;
