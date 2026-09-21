const prisma = require("../src/config/db");

async function main() {
  try {
    console.log("Checking tbl_driver_lead columns...");
    const columns = await prisma.$queryRawUnsafe(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_driver_lead' AND COLUMN_NAME = 'lead_type';`
    );

    if (Array.isArray(columns) && columns.length > 0) {
      console.log("Column lead_type already exists.");
    } else {
      console.log("Adding lead_type column to tbl_driver_lead...");
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`tbl_driver_lead\` ADD COLUMN \`lead_type\` VARCHAR(20) NOT NULL DEFAULT 'customer';`
      );
      console.log("Column lead_type added successfully.");
    }

    // Check index
    const indexes = await prisma.$queryRawUnsafe(
      `SHOW INDEX FROM \`tbl_driver_lead\` WHERE Key_name = 'idx_lead_type';`
    );
    if (!indexes || indexes.length === 0) {
      console.log("Adding idx_lead_type index...");
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`tbl_driver_lead\` ADD INDEX \`idx_lead_type\` (\`lead_type\`);`
      );
      console.log("Index idx_lead_type added.");
    } else {
      console.log("Index idx_lead_type already exists.");
    }

    console.log("Done!");
    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

main();
