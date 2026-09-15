const prisma = require("../src/config/db");
const {
  DEFAULT_SLAB_RATES,
  DEFAULT_MODEL_MULTIPLIERS,
} = require("../src/services/slabPricingService");

async function run() {
  console.log("Altering app_settings table to TEXT...");
  await prisma.$executeRawUnsafe("ALTER TABLE app_settings MODIFY setting_value TEXT;");
  console.log("Table altered successfully.");

  const cols = await prisma.$queryRawUnsafe("DESCRIBE app_settings;");
  const col = cols.find((c) => c.Field === "setting_value");
  console.log("setting_value column type is now:", col?.Type);

  // Check current rows
  const existingRows = await prisma.app_settings.findMany({
    where: { setting_key: { in: ["pricing_slab_rates", "pricing_model_multipliers"] } },
  });

  for (const row of existingRows) {
    let isValid = false;
    try {
      if (row.setting_value) {
        JSON.parse(row.setting_value);
        isValid = true;
      }
    } catch (e) {
      isValid = false;
    }

    if (!isValid) {
      console.log(`Row ${row.setting_key} has truncated/invalid JSON. Re-seeding with default...`);
      const defaultValue =
        row.setting_key === "pricing_slab_rates" ? DEFAULT_SLAB_RATES : DEFAULT_MODEL_MULTIPLIERS;
      await prisma.app_settings.update({
        where: { id: row.id },
        data: { setting_value: JSON.stringify(defaultValue), updated_at: new Date() },
      });
      console.log(`Row ${row.setting_key} successfully restored with valid untruncated JSON.`);
    } else {
      console.log(`Row ${row.setting_key} already has valid JSON.`);
    }
  }
}

run()
  .catch((err) => {
    console.error("Migration error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
