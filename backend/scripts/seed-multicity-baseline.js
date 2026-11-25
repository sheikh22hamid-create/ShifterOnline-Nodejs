const prisma = require("../src/config/db");

async function run() {
  console.log("=== Step 1: Creating city_order_settings table if needed ===");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`city_order_settings\` (
      \`city_id\` INT NOT NULL,
      \`search_system\` TINYINT NOT NULL DEFAULT 1,
      \`search_radius_km\` DECIMAL(5, 2) NULL,
      \`driver_search_seconds\` INT NULL,
      \`guarantee_enabled\` BOOLEAN NOT NULL DEFAULT FALSE,
      \`admin_window_minutes\` INT NULL,
      \`guarantee_referrals_required\` INT NOT NULL DEFAULT 1,
      \`guarantee_start_time\` VARCHAR(5) NULL,
      \`guarantee_end_time\` VARCHAR(5) NULL,
      \`exec_queue_enabled\` BOOLEAN NOT NULL DEFAULT FALSE,
      \`guarantee_recover_on_cancel\` BOOLEAN NOT NULL DEFAULT FALSE,
      \`exec_auto_outside_search\` BOOLEAN NOT NULL DEFAULT FALSE,
      \`exec_default_capacity\` INT NOT NULL DEFAULT 5,
      \`reminder_pct\` INT NOT NULL DEFAULT 50,
      \`escalate_pct\` INT NOT NULL DEFAULT 75,
      \`auto_reassign_idle_minutes\` INT NULL,
      \`updated_by\` INT NULL,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`city_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("city_order_settings table verified/created.");

  console.log("\n=== Checking tbl_package schema columns ===");
  const pkgCols = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM tbl_package");
  const colNames = pkgCols.map((c) => c.Field);
  console.log("Current tbl_package columns:", colNames.length);
  if (!colNames.includes("no_driver_compensation")) {
    console.log("Adding missing column no_driver_compensation to tbl_package...");
    await prisma.$executeRawUnsafe("ALTER TABLE `tbl_package` ADD COLUMN `no_driver_compensation` DECIMAL(10, 2) NOT NULL DEFAULT 0.00;");
    console.log("Added no_driver_compensation.");
  }

  console.log("\n=== Step 2: Seeding city_order_settings for Global India (17) and Indore (1) ===");
  await prisma.city_order_settings.upsert({
    where: { city_id: 17 },
    update: { search_radius_km: 5.0, driver_search_seconds: 60 },
    create: { city_id: 17, search_radius_km: 5.0, driver_search_seconds: 60, search_system: 1 },
  });
  await prisma.city_order_settings.upsert({
    where: { city_id: 1 },
    update: { search_radius_km: 8.0, driver_search_seconds: 60 },
    create: { city_id: 1, search_radius_km: 8.0, driver_search_seconds: 60, search_system: 1 },
  });
  console.log("city_order_settings seeded.");

  console.log("\n=== Step 3: Seeding Global India baseline rate cards (city_id = '17') ===");
  const indorePackages = await prisma.tbl_package.findMany({
    where: { city_id: "1", status: 1 },
  });
  console.log(`Found ${indorePackages.length} active packages in Indore (city_id = '1')`);

  let seededCount = 0;
  for (const pkg of indorePackages) {
    const existing = await prisma.tbl_package.findFirst({
      where: {
        city_id: "17",
        cat_id: pkg.cat_id,
        type: pkg.type,
        title: { contains: pkg.title },
      },
    });

    if (!existing) {
      const { id, ...dataToClone } = pkg;
      await prisma.tbl_package.create({
        data: {
          ...dataToClone,
          city_id: "17",
          title: `${pkg.title} (Global India Baseline)`,
        },
      });
      seededCount++;
    }
  }
  console.log(`Seeded ${seededCount} Global India rate cards (city_id = '17')`);

  console.log("\n=== Step 4: Ensuring Ujjain has a Geofence Zone in service_zone ===");
  const ujjainZone = await prisma.service_zone.findFirst({
    where: { city_id: 9, status: 1 },
  });

  if (!ujjainZone) {
    // Ujjain bounding box / polygon: [lat, lng]
    // Center ~ 23.1765, 75.7885
    const ujjainPolygon = [
      [23.2500, 75.7000],
      [23.2500, 75.8700],
      [23.1000, 75.8700],
      [23.1000, 75.7000],
      [23.2500, 75.7000]
    ];
    await prisma.service_zone.create({
      data: {
        city_id: 9,
        name: "Ujjain Municipal Service Zone",
        status: 1,
        zone_kind: "duty",
        center_lat: 23.1765,
        center_lng: 75.7885,
        radius_km: 15.0,
        polygon_geojson: JSON.stringify(ujjainPolygon),
      },
    });
    console.log("Created Ujjain Municipal Service Zone (city_id = 9)");
  } else {
    console.log("Ujjain zone already exists:", ujjainZone.id, ujjainZone.name);
  }

  console.log("\n=== Step 5: Verification of Package Counts ===");
  const counts = await prisma.tbl_package.groupBy({
    by: ["city_id"],
    _count: { id: true },
  });
  console.log("Package counts by city_id:", counts);

  process.exit(0);
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
