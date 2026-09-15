require("dotenv").config();
const prisma = require("../src/config/db");
const { getFareEstimate } = require("../src/services/pricingEngine");
const { getSlabPricingConfig } = require("../src/services/slabPricingService");

async function main() {
  console.log("=== SLAB PRICING CONFIG ===");
  const slabConfig = await getSlabPricingConfig();
  console.log("Slab Rates Keys:", Object.keys(slabConfig.slabRates));
  console.log("Model Multipliers:", JSON.stringify(slabConfig.modelMultipliers, null, 2));

  console.log("\n=== CATEGORIES & PACKAGES IN DB ===");
  const categories = await prisma.pkg_category.findMany({
    where: { cat_status: 1 },
    orderBy: { sort_order: "asc" },
  });

  for (const cat of categories) {
    console.log(`\nCategory ID: ${cat.id} | Name: ${cat.cat_name}`);
    const pkgs = await prisma.tbl_package.findMany({
      where: { cat_id: cat.id, status: 1 },
      orderBy: { sort_order: "asc" },
    });
    pkgs.forEach((p) => {
      console.log(`  - Package ID ${p.id}: title="${p.title}", user_title="${p.user_title}", driver_title="${p.driver_title}", min_charge=${p.min_charge}, per_km_charge=${p.per_km_charge}`);
    });

    const estimate = await getFareEstimate({
      cat_id: cat.id,
      plat: 28.6139,
      plong: 77.2090,
      dlat: 28.5355,
      dlong: 77.3910,
      radiusRangeKm: 5,
    });
    console.log(`  Estimate @ ${estimate.distance_km}km (5km search radius):`);
    estimate.packages.forEach((pkg) => {
      console.log(`    * [${pkg.package_id}] user_title="${pkg.user_title}" / title="${pkg.title}" -> Estimated Fare: ₹${pkg.estimated_fare} (Radius Charge: ₹${pkg.radius_charge})`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
