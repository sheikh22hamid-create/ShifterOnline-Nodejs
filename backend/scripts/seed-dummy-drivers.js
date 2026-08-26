/**
 * Seeds 10 dummy/test riders per active vehicle category, each enabled for
 * every active package tier in that category, for use with the dispatch
 * simulator (public/index.html). Idempotent — re-running skips any
 * vehicle_no that already exists, so it's safe to run again after adding
 * a new category or bumping DRIVERS_PER_CATEGORY.
 *
 * Usage: node scripts/seed-dummy-drivers.js
 */
const prisma = require("../src/config/db");

const DRIVERS_PER_CATEGORY = 10;

// Base point matches the simulator's default pickup coordinates so these
// riders are within the default 10km search radius out of the box.
const BASE_LAT = 22.7402368;
const BASE_LNG = 75.913299;

const CATEGORY_SHORT_CODES = {
  Bike: "BIKE",
  "3 wheeler": "3WH",
  "4 wheeler": "4WH",
  "E loader": "ELOAD",
};

// Distinct 4-digit mobile-number blocks per category so none collide with
// each other or with the existing TEST0002-TEST0010 / TS09FL0001 riders.
const MOBILE_BLOCK_BASE = {
  Bike: 9999960000,
  "3 wheeler": 9999961000,
  "4 wheeler": 9999962000,
  "E loader": 9999963000,
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Deterministic small jitter (~0-2.2km) so riders spread out instead of
// stacking exactly on top of each other, while staying inside the
// simulator's default radius.
function jitter(index) {
  const angle = (index / DRIVERS_PER_CATEGORY) * 2 * Math.PI;
  const radiusDeg = 0.01 + (index % 3) * 0.005;
  return {
    lat: BASE_LAT + radiusDeg * Math.cos(angle),
    lng: BASE_LNG + radiusDeg * Math.sin(angle),
  };
}

async function seedCategory(category) {
  const shortCode = CATEGORY_SHORT_CODES[category.cat_name];
  const mobileBase = MOBILE_BLOCK_BASE[category.cat_name];
  if (!shortCode || !mobileBase) {
    console.warn(`Skipping "${category.cat_name}" — no naming convention configured for it.`);
    return { created: 0, skipped: 0 };
  }

  const activePackages = await prisma.tbl_package.findMany({
    where: { cat_id: category.id, status: 1 },
    select: { id: true },
  });
  if (activePackages.length === 0) {
    console.warn(`Skipping "${category.cat_name}" — no active packages to enable riders for.`);
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;

  for (let i = 1; i <= DRIVERS_PER_CATEGORY; i++) {
    const vehicleNo = `TEST-${shortCode}-${pad2(i)}`;

    const existing = await prisma.tbl_rider.findFirst({ where: { vehicle_no: vehicleNo } });
    if (existing) {
      skipped++;
      continue;
    }

    const { lat, lng } = jitter(i);
    const now = new Date();

    const rider = await prisma.tbl_rider.create({
      data: {
        first_name: `Sim ${category.cat_name}`,
        last_name: pad2(i),
        fmobile: String(mobileBase + i),
        vehicle: category.cat_name,
        vehicle_no: vehicleNo,
        a_status: 1,
        status: 1,
        rlats: lat.toFixed(7),
        rlongs: lng.toFixed(7),
        profile_picture: "",
        fcm_token: "",
        device_id: `sim-${vehicleNo}`,
        rdate: now,
      },
    });

    await prisma.tbl_rider_delivery_type.createMany({
      data: activePackages.map((pkg) => ({
        rider_id: rider.id,
        delivery_type: String(pkg.id),
        status: 1,
      })),
    });

    created++;
  }

  return { created, skipped };
}

async function main() {
  const categories = await prisma.pkg_category.findMany({ where: { cat_status: 1 } });

  for (const category of categories) {
    const { created, skipped } = await seedCategory(category);
    console.log(`${category.cat_name}: created ${created}, skipped ${skipped} (already existed)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("Seeding failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
