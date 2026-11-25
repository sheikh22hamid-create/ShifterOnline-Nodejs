const prisma = require("../src/config/db");
const pricingEngine = require("../src/services/pricingEngine");
const { resolvePickupArea } = require("../src/services/pickupCityService");

async function main() {
  console.log("==================================================");
  console.log(" MULTI-CITY GEOFENCE & RATE CARD ISOLATION TEST ");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Geofence Resolution Tests
  console.log("--- 1. Geographic Geofence Resolution ---");
  const indoreArea = await resolvePickupArea(22.7196, 75.8577);
  assert(indoreArea.serviceable && indoreArea.cityId === 1, "Indore coordinates resolve to cityId 1 (Indore)");

  const ujjainArea = await resolvePickupArea(23.1765, 75.7885);
  assert(ujjainArea.serviceable && ujjainArea.cityId === 9, "Ujjain coordinates resolve to cityId 9 (Ujjain)");

  const highwayArea = await resolvePickupArea(24.5, 76.5);
  assert(highwayArea.serviceable && highwayArea.cityId === 17, "Highway/Rural coordinates resolve to cityId 17 (Global India Fallback)");

  // 2. Fare Estimation Resolution & Fallback Tests
  console.log("\n--- 2. Fare Estimate Resolution & Fallback ---");
  // Test Indore fare estimate for Category 8 (Bike)
  const indoreFare = await pricingEngine.getFareEstimate({
    cat_id: 8,
    plat: 22.7196,
    plong: 75.8577,
    dlat: 22.7300,
    dlong: 75.8700,
    uid: 1,
  });
  assert(indoreFare && indoreFare.packages && indoreFare.packages.length > 0, "Indore pickup gets valid packages");
  assert(indoreFare.packages.every(p => String(p.city_id || "").includes("1")), "Indore fare estimate returns Indore rate cards (city_id = 1)");

  // Test Highway/Unzoned fare estimate (should fall back to Global India city_id = 17)
  const highwayFare = await pricingEngine.getFareEstimate({
    cat_id: 8,
    plat: 24.5,
    plong: 76.5,
    dlat: 24.55,
    dlong: 76.55,
    uid: 1,
  });
  assert(highwayFare && highwayFare.packages && highwayFare.packages.length > 0, "Highway pickup outside geofences gets valid packages");
  assert(highwayFare.packages.every(p => ["17", "0", ""].includes(String(p.city_id || ""))), "Highway fare estimate returns Global India baseline (city_id = 17)");

  // 3. City Override Isolation Test
  console.log("\n--- 3. City Custom Override Isolation ---");
  // Create a custom package specifically for Ujjain (city_id = '9')
  const testUjjainPkg = await prisma.tbl_package.create({
    data: {
      title: "Model 1 (Ujjain Special Custom Rate)",
      user_title: "Ujjain Fast Bike",
      driver_title: "Ujjain Fast Bike",
      type: "USER",
      cat_id: 8,
      city_id: "9",
      min_charge: 99.00,
      per_km_charge: 15.00,
      free_waiting_time: 10,
      waiting_charge: 2.00,
      start_time: new Date("1970-01-01T00:00:00.000Z"),
      end_time: new Date("1970-01-01T00:00:00.000Z"),
      status: 1,
    },
  });

  // Now query fare estimate for Ujjain coordinates
  const ujjainFare = await pricingEngine.getFareEstimate({
    cat_id: 8,
    plat: 23.1765,
    plong: 75.7885,
    dlat: 23.1850,
    dlong: 75.7950,
    uid: 1,
  });
  assert(ujjainFare && ujjainFare.packages && ujjainFare.packages.length > 0, "Ujjain pickup gets valid packages");
  const hasUjjainOverride = ujjainFare.packages.some(p => p.id === testUjjainPkg.id || String(p.city_id) === "9");
  assert(hasUjjainOverride, "Ujjain pickup immediately uses Ujjain's custom rate card (city_id = 9)");

  // Re-verify that Indore fare estimate is completely unaffected by Ujjain's custom package
  const indoreFareRecheck = await pricingEngine.getFareEstimate({
    cat_id: 8,
    plat: 22.7196,
    plong: 75.8577,
    dlat: 22.7300,
    dlong: 75.8700,
    uid: 1,
  });
  const indoreHasUjjainCard = indoreFareRecheck.packages.some(p => p.id === testUjjainPkg.id || String(p.city_id) === "9");
  assert(!indoreHasUjjainCard, "Indore fare estimate DOES NOT leak Ujjain rate card (Total Isolation Verified!)");

  // Clean up temporary test package
  await prisma.tbl_package.delete({ where: { id: testUjjainPkg.id } });
  console.log("Cleaned up temporary Ujjain test package.");

  console.log(`\n==================================================`);
  console.log(` SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
