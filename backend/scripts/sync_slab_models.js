const { PrismaClient } = require("@prisma/client");
const {
  DEFAULT_SLAB_RATES,
  DEFAULT_MODEL_MULTIPLIERS,
  findVehicleSlabConfig,
} = require("../src/services/slabPricingService");

const DEV_URL = "mysql://u755836427_shifter_dev:Shifterdev%402026@srv2206.hstgr.io:3306/u755836427_shifter_dev";
const PROD_URL = "mysql://u755836427_shifteronline:U755836427_shifteronline@srv2206.hstgr.io:3306/u755836427_shifteronline";

async function syncDb(name, url) {
  console.log(`\n--- Syncing Models in ${name} ---`);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const categories = await prisma.pkg_category.findMany();
    const multipliers = DEFAULT_MODEL_MULTIPLIERS;
    const anchorMarkup = Number(multipliers.anchor_markup_percent) || 10;
    const anchorMultiplier = 1 + anchorMarkup / 100;

    let count = 0;
    for (const category of categories) {
      const vehicleConfig = findVehicleSlabConfig(DEFAULT_SLAB_RATES, category.id);
      if (!vehicleConfig) continue;

      const packages = await prisma.tbl_package.findMany({
        where: { cat_id: category.id },
        orderBy: { sort_order: "asc" },
      });

      for (const pkg of packages) {
        const pkgTitle = String(pkg.title || "").toLowerCase();
        const modelMatch = (multipliers.models || []).find((m) => pkgTitle.includes(m.model.toLowerCase()));

        if (modelMatch) {
          const offset = Number(modelMatch.offset_percent) || 0;
          const effectiveMultiplier = anchorMultiplier * (1 + offset / 100);
          const calculatedMin = Math.round(Number(vehicleConfig.min_charge) * effectiveMultiplier * 100) / 100;
          const basePerKm = Number(vehicleConfig.rates?.["5_10"] || vehicleConfig.rates?.["1_5"] || 10);
          const calculatedPerKm = Math.round(basePerKm * effectiveMultiplier * 100) / 100;

          await prisma.tbl_package.update({
            where: { id: pkg.id },
            data: {
              min_charge: String(calculatedMin),
              per_km_charge: String(calculatedPerKm),
              user_title: modelMatch.user_title ? String(modelMatch.user_title).trim() : null,
              driver_title: modelMatch.driver_title ? String(modelMatch.driver_title).trim() : null,
            },
          });
          count++;
          console.log(`  Updated [${category.cat_name}] ${pkg.title} -> User: "${modelMatch.user_title}", Driver: "${modelMatch.driver_title}", Min: ₹${calculatedMin}`);
        }
      }
    }
    console.log(`✓ Synced ${count} package models in ${name}`);
  } catch (err) {
    console.error(`Error in ${name}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await syncDb("DEV", DEV_URL);
  await syncDb("PROD", PROD_URL);
  console.log("\nAll models synchronized successfully!");
}

main();
