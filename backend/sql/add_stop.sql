CREATE TABLE IF NOT EXISTS pkg_order_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  sequence INT NOT NULL,
  lat TEXT NOT NULL,
  lng TEXT NOT NULL,
  address TEXT NULL,
  hno TEXT NULL,
  landmark TEXT NULL,
  contact_name TEXT NULL,
  contact_number TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_pkg_order_stops_order_sequence (order_id, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('max_extra_stops', '2')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('extra_stop_charge', '0')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
