const prisma = require("../src/config/db");

async function run() {
  console.log("Creating Monthly Driver tables if not exist...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_zone (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      city_id INT NULL,
      center_lat DOUBLE NOT NULL,
      center_lng DOUBLE NOT NULL,
      radius_km DOUBLE NOT NULL DEFAULT 5.0,
      polygon_geojson LONGTEXT NULL,
      status INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS monthly_driver_contract (
      id INT AUTO_INCREMENT PRIMARY KEY,
      rider_id INT NOT NULL UNIQUE,
      assigned_zone_id INT NULL,
      shift_start_time VARCHAR(20) NOT NULL DEFAULT '10:00:00',
      shift_end_time VARCHAR(20) NOT NULL DEFAULT '20:00:00',
      target_shift_hours DOUBLE NOT NULL DEFAULT 10.0,
      monthly_base_salary DECIMAL(10,2) NOT NULL DEFAULT 15000.00,
      allowed_break_minutes INT NOT NULL DEFAULT 45,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS driver_duty_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      rider_id INT NOT NULL,
      duty_date DATE NOT NULL,
      punch_in_at DATETIME NULL,
      punch_out_at DATETIME NULL,
      total_online_minutes INT NOT NULL DEFAULT 0,
      total_in_zone_minutes INT NOT NULL DEFAULT 0,
      total_out_zone_minutes INT NOT NULL DEFAULT 0,
      total_break_minutes INT NOT NULL DEFAULT 0,
      orders_completed INT NOT NULL DEFAULT 0,
      calculated_daily_salary DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_duty_rider_date (rider_id, duty_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS driver_order_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      rider_id INT NOT NULL,
      order_id INT NOT NULL,
      queue_order INT NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      INDEX idx_queue_rider_status (rider_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log("SUCCESS: All 4 tables created/verified without any data loss!");
  process.exit(0);
}

run().catch((e) => {
  console.error("Migration error:", e);
  process.exit(1);
});
