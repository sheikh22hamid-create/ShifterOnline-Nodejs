-- Admin-configurable driver vs customer body types per vehicle category.
-- allowed_body_types = Customer-facing body types
-- driver_body_types  = Driver-facing body types
ALTER TABLE pkg_category
  ADD COLUMN driver_body_types VARCHAR(255) NULL;
