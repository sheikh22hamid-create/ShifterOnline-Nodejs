const { PrismaClient } = require("@prisma/client");
const {
  DEFAULT_SLAB_RATES,
  DEFAULT_MODEL_MULTIPLIERS,
} = require("../src/services/slabPricingService");

const DEV_URL = "mysql://u755836427_shifter_dev:Shifterdev%402026@srv2206.hstgr.io:3306/u755836427_shifter_dev";
const PROD_URL = "mysql://u755836427_shifteronline:U755836427_shifteronline@srv2206.hstgr.io:3306/u755836427_shifteronline";

async function seed(name, url) {
  console.log(`\n--- Seeding Slab Pricing for ${name} ---`);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // 1. Seed pricing_slab_rates
    await prisma.app_settings.upsert({
      where: { setting_key: "pricing_slab_rates" },
      create: {
        setting_key: "pricing_slab_rates",
        setting_value: JSON.stringify(DEFAULT_SLAB_RATES),
        updated_at: new Date(),
      },
      update: {
        setting_value: JSON.stringify(DEFAULT_SLAB_RATES),
        updated_at: new Date(),
      },
    });
    console.log(`✓ pricing_slab_rates seeded in ${name}`);

    // 2. Seed pricing_model_multipliers
    await prisma.app_settings.upsert({
      where: { setting_key: "pricing_model_multipliers" },
      create: {
        setting_key: "pricing_model_multipliers",
        setting_value: JSON.stringify(DEFAULT_MODEL_MULTIPLIERS),
        updated_at: new Date(),
      },
      update: {
        setting_value: JSON.stringify(DEFAULT_MODEL_MULTIPLIERS),
        updated_at: new Date(),
      },
    });
    console.log(`✓ pricing_model_multipliers seeded in ${name}`);
  } catch (err) {
    console.error(`Error in ${name}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await seed("DEV", DEV_URL);
  await seed("PROD", PROD_URL);
  console.log("\nSlab pricing seed completed successfully!");
}

main();
