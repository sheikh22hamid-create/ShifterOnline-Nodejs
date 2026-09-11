const prisma = require("../src/config/db");

async function main() {
  await prisma.$executeRawUnsafe(`
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
  `);

  for (const [setting_key, setting_value] of [["max_extra_stops", "2"], ["extra_stop_charge", "0"]]) {
    await prisma.app_settings.upsert({
      where: { setting_key },
      create: { setting_key, setting_value, updated_at: new Date() },
      update: {},
    });
  }
  console.log("Add Stop database deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
