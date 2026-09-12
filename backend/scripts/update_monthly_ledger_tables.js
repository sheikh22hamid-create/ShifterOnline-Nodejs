const prisma = require("../src/config/db");

async function main() {
  console.log("Running migration for Monthly Driver Ledger & Overtime...");

  // 1. Add overtime_hourly_rate to monthly_driver_contract
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`monthly_driver_contract\`
      ADD COLUMN IF NOT EXISTS \`overtime_hourly_rate\` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER \`monthly_base_salary\`;
    `);
    console.log("Updated monthly_driver_contract: overtime_hourly_rate added.");
  } catch (err) {
    console.log("monthly_driver_contract column note:", err.message);
  }

  // 2. Add overtime and cash_collected to driver_duty_log
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE \`driver_duty_log\`
      ADD COLUMN IF NOT EXISTS \`overtime_minutes\` INT NOT NULL DEFAULT 0 AFTER \`orders_completed\`,
      ADD COLUMN IF NOT EXISTS \`overtime_pay\` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER \`overtime_minutes\`,
      ADD COLUMN IF NOT EXISTS \`cash_collected\` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER \`overtime_pay\`;
    `);
    console.log("Updated driver_duty_log: overtime & cash_collected added.");
  } catch (err) {
    console.log("driver_duty_log columns note:", err.message);
  }

  // 3. Create monthly_driver_ledger table
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`monthly_driver_ledger\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`rider_id\` INT NOT NULL,
        \`order_id\` INT NULL,
        \`duty_date\` DATE NULL,
        \`entry_type\` VARCHAR(50) NOT NULL,
        \`amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        \`balance_effect\` VARCHAR(10) NOT NULL,
        \`notes\` TEXT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_ledger_rider_created\` (\`rider_id\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("Created table: monthly_driver_ledger");
  } catch (err) {
    console.log("monthly_driver_ledger table note:", err.message);
  }

  console.log("Migration complete!");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
