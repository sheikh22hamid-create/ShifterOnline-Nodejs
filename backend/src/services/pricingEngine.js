const prisma = require("../config/db");
const { getRoadDistanceKm } = require("../utils/geoDistance");

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * tbl_package.start_time / end_time define the night-charge window.
 * The window may wrap past midnight (e.g. 22:00 -> 06:00).
 */
function isNightNow(pkg, now = new Date()) {
  if (!pkg.start_time || !pkg.end_time) return 0;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = new Date(pkg.start_time);
  const end = new Date(pkg.end_time);
  const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();

  if (startMinutes === endMinutes) return 0;

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes ? 1 : 0;
  }
  // Wraps past midnight
  return nowMinutes >= startMinutes || nowMinutes < endMinutes ? 1 : 0;
}

/**
 * Pure fare calculation: max(min_charge, per_km_charge * distance),
 * bumped by night_charge_percent when applicable.
 */
function calculateFare(pkg, distanceKm, isNight) {
  const minCharge = Number(pkg.min_charge);
  const perKmCharge = Number(pkg.per_km_charge);
  let fare = Math.max(minCharge, perKmCharge * distanceKm);

  if (isNight) {
    const nightPct = parseFloat(pkg.night_charge_percent) || 0;
    fare *= 1 + nightPct / 100;
  }

  return round2(fare);
}

/**
 * driver_per_trip / driver_per_percent are legacy VarChar columns on the
 * live schema — never assume they parse cleanly. Flat per-trip amount wins
 * over percentage when both are present and > 0.
 */
function calculateDriverEarning(pkg, totalFare) {
  const flat = parseFloat(pkg.driver_per_trip);
  if (Number.isFinite(flat) && flat > 0) {
    return round2(flat);
  }

  const percent = parseFloat(pkg.driver_per_percent) || 0;
  return round2((totalFare * percent) / 100);
}

async function getPackagesForCategory(cat_id) {
  return prisma.tbl_package.findMany({
    where: { cat_id: Number(cat_id), status: 1 },
    orderBy: { sort_order: "asc" },
  });
}

async function getPackageById(packageId) {
  return prisma.tbl_package.findUnique({ where: { id: Number(packageId) } });
}

/**
 * Admin's commission RATE (%), driven by tbl_package.service_charge_percent.
 * This is what gets stored as-is on pkg_order.commission — matching the
 * legacy PHP convention (confirmed against live data: real values are small
 * integers like 5 or 0, not absolute ₹ amounts). Never store or read
 * pkg_order.commission as a rupee figure; convert via commissionAmount()
 * wherever real money is being moved or displayed.
 */
function calculateCommissionPercent(pkg) {
  return parseFloat(pkg.service_charge_percent) || 0;
}

/** Actual ₹ commission for an order, given its base fare and stored
 * (percentage) commission — same formula analyticsController.js uses for
 * revenue reporting, so the two stay consistent. */
function commissionAmount(dCharge, commissionPercent) {
  return round2((Number(dCharge) * Number(commissionPercent)) / 100);
}

/**
 * Pure — no DB access. Callers who already have the package row in hand
 * (e.g. from a validation query moments earlier) should use this directly
 * instead of priceForPackageId, to avoid re-fetching a row they already have.
 */
function priceForPackage(pkg, distanceKm) {
  const isNight = isNightNow(pkg);
  const fare = calculateFare(pkg, distanceKm, isNight);
  const driverEarning = calculateDriverEarning(pkg, fare);
  const commission = calculateCommissionPercent(pkg);
  return { pkg, fare, driverEarning, commission, isNight };
}

async function priceForPackageId(packageId, distanceKm) {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new Error(`tbl_package not found for id ${packageId}`);
  }
  return priceForPackage(pkg, distanceKm);
}

async function getFareEstimate({ cat_id, plat, plong, dlat, dlong }) {
  const [{ distanceKm, durationMin }, packages] = await Promise.all([
    getRoadDistanceKm(Number(plat), Number(plong), Number(dlat), Number(dlong)),
    getPackagesForCategory(cat_id),
  ]);

  return {
    Result: true,
    distance_km: round2(distanceKm),
    duration_min: durationMin,
    packages: packages.map((pkg) => {
      const isNight = isNightNow(pkg);
      return {
        package_id: pkg.id,
        title: pkg.title,
        min_charge: Number(pkg.min_charge),
        per_km_charge: Number(pkg.per_km_charge),
        estimated_fare: calculateFare(pkg, distanceKm, isNight),
        is_night: isNight,
      };
    }),
  };
}

module.exports = {
  isNightNow,
  calculateFare,
  calculateDriverEarning,
  calculateCommissionPercent,
  commissionAmount,
  getPackagesForCategory,
  getPackageById,
  priceForPackage,
  priceForPackageId,
  getFareEstimate,
};
