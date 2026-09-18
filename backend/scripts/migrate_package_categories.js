const prisma = require('../src/config/db');

async function run() {
  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE tbl_premium_plan ADD COLUMN package_categories VARCHAR(255) NOT NULL DEFAULT 'all';"
    );
    console.log("Successfully added column package_categories to tbl_premium_plan.");
  } catch (err) {
    if (err.message && err.message.includes("Duplicate column name")) {
      console.log("Column package_categories already exists.");
    } else {
      console.error("Migration error:", err.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

run();
