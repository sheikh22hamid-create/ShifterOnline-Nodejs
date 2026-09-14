const { PrismaClient } = require("@prisma/client");

const DEV_URL = "mysql://u755836427_shifter_dev:Shifterdev%402026@srv2206.hstgr.io:3306/u755836427_shifter_dev";
const PROD_URL = "mysql://u755836427_shifteronline:U755836427_shifteronline@srv2206.hstgr.io:3306/u755836427_shifteronline";

async function migrateDb(name, url) {
  console.log(`\n--- Migrating ${name} ---`);
  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });

  try {
    const cols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM tbl_package");
    const colNames = cols.map((c) => c.Field);

    if (!colNames.includes("user_title")) {
      console.log(`Adding user_title column to ${name}...`);
      await prisma.$executeRawUnsafe(
        "ALTER TABLE tbl_package ADD COLUMN user_title VARCHAR(255) NULL DEFAULT NULL AFTER title"
      );
      console.log(`user_title added to ${name}.`);
    } else {
      console.log(`user_title already exists in ${name}.`);
    }

    if (!colNames.includes("driver_title")) {
      console.log(`Adding driver_title column to ${name}...`);
      await prisma.$executeRawUnsafe(
        "ALTER TABLE tbl_package ADD COLUMN driver_title VARCHAR(255) NULL DEFAULT NULL AFTER user_title"
      );
      console.log(`driver_title added to ${name}.`);
    } else {
      console.log(`driver_title already exists in ${name}.`);
    }

    const sample = await prisma.$queryRawUnsafe("SELECT id, title, user_title, driver_title FROM tbl_package LIMIT 3");
    console.log(`Sample rows from ${name}:`, sample);
  } catch (err) {
    console.error(`Error migrating ${name}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await migrateDb("DEV", DEV_URL);
  await migrateDb("PROD", PROD_URL);
  console.log("\nMigration completed successfully!");
}

main();
