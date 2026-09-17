-- Admin-configurable vehicle detail specs shown on the customer app's new
-- "Details" screen per vehicle category, replacing the hardcoded
-- getVehicleSpecs() lookup table in orderAvailabilityController.js.
ALTER TABLE pkg_category
  ADD COLUMN max_load_kg DECIMAL(10,2) NULL,
  ADD COLUMN dim_length DECIMAL(10,2) NULL,
  ADD COLUMN dim_width DECIMAL(10,2) NULL,
  ADD COLUMN dim_height DECIMAL(10,2) NULL,
  ADD COLUMN dim_unit VARCHAR(4) NULL,
  ADD COLUMN detail_image TEXT NULL;
