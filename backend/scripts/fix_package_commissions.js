require("dotenv").config();
const prisma = require("../src/config/db");

async function main() {
  console.log("=== Checking tbl_package commission values ===");

  const packages = await prisma.tbl_package.findMany({
    orderBy: { id: "asc" },
  });

  let updatedCount = 0;

  for (const pkg of packages) {
    const rawPct = parseFloat(pkg.driver_per_percent);
    const flat = parseFloat(pkg.driver_per_trip);
    const minCharge = parseFloat(pkg.min_charge) || 0;

    let needsUpdate = false;
    const updates = {};

    // 1. If driver_per_percent was entered as driver share > 50 (e.g. 80, 93),
    // convert it to standardized commission percent (e.g. 20, 7).
    if (Number.isFinite(rawPct) && rawPct > 50 && rawPct <= 100) {
      const normalizedComm = Math.round((100 - rawPct) * 100) / 100;
      updates.driver_per_percent = String(normalizedComm);
      needsUpdate = true;
      console.log(`[Package #${pkg.id} "${pkg.title}"] Inverted driver_per_percent "${pkg.driver_per_percent}" -> Commission "${normalizedComm}%" (Driver keeps ${rawPct}%)`);
    }

    // 2. If driver_per_trip is a tiny number (< minCharge and < 20),
    // it was likely a misunderstanding or commission amount, not a driver flat payout!
    if (Number.isFinite(flat) && flat > 0 && flat < minCharge && flat < 20) {
      updates.driver_per_trip = "0";
      needsUpdate = true;
      console.log(`[Package #${pkg.id} "${pkg.title}"] Reset tiny dangerous flat driver_per_trip "${pkg.driver_per_trip}" -> "0"`);
    }

    if (needsUpdate) {
      await prisma.tbl_package.update({
        where: { id: pkg.id },
        data: updates,
      });
      updatedCount++;
    }
  }

  console.log(`\nDone! Total packages updated: ${updatedCount} / ${packages.length}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
