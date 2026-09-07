const prisma = require("../config/db");
const { getRoadDistanceKm } = require("../utils/geoDistance");

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Whole-rupee rounding for every actual money amount (fare, driver earning,
 * ₹ commission) — not just the popup's display text. Business decision: the
 * number the customer is quoted is the number that flows through the whole
 * order lifecycle unchanged (order creation's d_charge/total_dcharge, the
 * driver's popup, and their real payout at ride completion), rather than a
 * decimal fare getting rounded differently (or not at all) at each of those
 * separate points. Percentages (commission %) are NOT rounded this way —
 * see calculateCommissionPercent — only money itself.
 */
function roundMoney(n) {
  return Math.round(n);
}

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MINUTES_PER_DAY = 24 * 60;

/**
 * tbl_package.start_time / end_time define the night-charge window as
 * IST wall-clock digits (e.g. 23:00 -> 06:00 IST — same as the live PHP
 * backend, which explicitly runs on Asia/Kolkata). They're read via
 * getUTCHours()/getUTCMinutes() to take the stored digits as-is, ignoring
 * whatever timezone Prisma/MySQL wrapped them in — so "now" must be
 * converted to those same IST digits, not the server process's local time
 * (Render runs UTC), or a daytime IST order gets flagged as night and
 * vice versa (confirmed live: an order at 04:11 UTC == 09:41 IST — daytime
 * — was wrongly charged the night fee because 04:11 falls inside the
 * 23:00-06:00 window when compared as raw UTC clock digits).
 * The window may wrap past midnight (e.g. 22:00 -> 06:00).
 */
function isNightNow(pkg, now = new Date()) {
  if (!pkg.start_time || !pkg.end_time) return 0;

  const nowUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const nowMinutes = (nowUtcMinutes + IST_OFFSET_MINUTES) % MINUTES_PER_DAY;
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

/** First 1km of the driver-search radius is free; radiusRangeKm beyond that
 * is billed at the package's own per-km rate (pickup_per_km_charge if set,
 * else per_km_charge) — matches the live PHP backend's pks_order.php exactly
 * (chargeable_radius = max(0, radius_range - 1); radius_charge = chargeable_radius * rate). */
function calculateRadiusCharge(pkg, radiusRangeKm) {
  const perKmCharge = Number(pkg.per_km_charge) || 0;
  const pickupPerKm = Number(pkg.pickup_per_km_charge) > 0 ? Number(pkg.pickup_per_km_charge) : perKmCharge;
  const chargeableRadius = Math.max(0, (Number(radiusRangeKm) || 0) - 1);
  return chargeableRadius * pickupPerKm;
}

/**
 * Fare = min_charge + (per_km_charge * distance) + radius_charge, then
 * service_charge_percent applied as a % of THAT subtotal (not a flat
 * service_charge — that DB column and pickup_charge are both dead here),
 * then night_charge_percent added as a flat ₹ amount when the night window
 * is active (the field name says "percent" but the live PHP backend
 * (pks_order.php) adds it as-is, not as a multiplier), then extraMileCharge
 * on top. This matches pks_order.php's d_charge/total_dcharge formula
 * exactly — the same formula the customer app's own fare estimate already
 * shows and the customer already agrees to pay, so driver dispatch/earning
 * is priced off the identical number instead of a different, Node-only
 * formula that used to diverge from what the customer saw.
 */
function calculateFare(pkg, distanceKm, isNight, radiusRangeKm = 1, extraMileCharge = 0) {
  const minCharge = Number(pkg.min_charge) || 0;
  const perKmCharge = Number(pkg.per_km_charge) || 0;
  const radiusCharge = calculateRadiusCharge(pkg, radiusRangeKm);

  const dCharge = minCharge + (perKmCharge * distanceKm) + radiusCharge;

  const servicePercent = parseFloat(pkg.service_charge_percent) || 0;
  const serviceCharge = (dCharge * servicePercent) / 100;

  const nightCharge = isNight ? (parseFloat(pkg.night_charge_percent) || 0) : 0;

  const total = dCharge + serviceCharge + nightCharge + (Number(extraMileCharge) || 0);
  return roundMoney(total);
}

/**
 * driver_per_trip / driver_per_percent are legacy VarChar columns on the
 * live schema — never assume they parse cleanly. Flat per-trip amount wins
 * over percentage when both are present and > 0.
 *
 * driver_per_percent is admin's commission RATE (confirmed against the live
 * rate cards: Model 1-5 store 5/6.5/8/9.5/11 there, increasing with model
 * tier like a commission schedule, not a driver-share schedule) — so the
 * driver keeps the fare MINUS that percentage, not that percentage of it.
 * Getting this backwards was paying drivers only their commission (5-11%
 * of the fare) instead of their actual ~89-95% cut.
 */
function calculateDriverEarning(pkg, totalFare) {
  const flat = parseFloat(pkg.driver_per_trip);
  if (Number.isFinite(flat) && flat > 0) {
    return roundMoney(flat);
  }

  const commissionPercent = parseFloat(pkg.driver_per_percent) || 0;
  return roundMoney((totalFare * (100 - commissionPercent)) / 100);
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
 * Admin's actual commission RATE (%) on this specific fare, derived from
 * fare and driverEarning rather than read off a static package field.
 * tbl_package.service_charge_percent is always 0 on every live rate card —
 * it's dead data, not where the real commission lives — so pkg_order.commission
 * was being stored as 0 on every order, which silently zeroed out the admin
 * revenue dashboard (analyticsController.js sums d_charge * commission / 100)
 * and skipped the cash-order driver-wallet commission debit in
 * tripLifecycle.js (guarded on `commission > 0`).
 *
 * Deriving it from fare/driverEarning instead gets both driver-earning paths
 * right automatically: for percent-based packages this recovers exactly
 * driver_per_percent (confirmed against live data as admin's real commission
 * schedule — 5/6.5/8/9.5/11% across Model 1-5, increasing with tier); for
 * flat driver_per_trip packages it yields the true effective % admin kept
 * on that particular fare, which a static per-package field can't express.
 *
 * This is what gets stored as-is on pkg_order.commission — matching the
 * legacy PHP convention (small integers like 5, not absolute ₹ amounts).
 * Never store or read pkg_order.commission as a rupee figure; convert via
 * commissionAmount() wherever real money is being moved or displayed.
 */
function calculateCommissionPercent(fare, driverEarning) {
  if (!fare || fare <= 0) return 0;
  return round2(((fare - driverEarning) / fare) * 100);
}

/** Actual ₹ commission for an order, given its base fare and stored
 * (percentage) commission — same formula analyticsController.js uses for
 * revenue reporting, so the two stay consistent. */
function commissionAmount(dCharge, commissionPercent) {
  return roundMoney((Number(dCharge) * Number(commissionPercent)) / 100);
}

/**
 * Pure — no DB access. Callers who already have the package row in hand
 * (e.g. from a validation query moments earlier) should use this directly
 * instead of priceForPackageId, to avoid re-fetching a row they already have.
 */
function priceForPackage(pkg, distanceKm, radiusRangeKm = 1, extraMileCharge = 0) {
  const isNight = isNightNow(pkg);
  const fare = calculateFare(pkg, distanceKm, isNight, radiusRangeKm, extraMileCharge);
  const driverEarning = calculateDriverEarning(pkg, fare);
  const commission = calculateCommissionPercent(fare, driverEarning);
  const packageTitle = pkg?.title || `Model ${pkg?.id || ""}`;
  return { pkg, fare, driverEarning, commission, isNight, packageTitle };
}

async function priceForPackageId(packageId, distanceKm, radiusRangeKm = 1, extraMileCharge = 0) {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new Error(`tbl_package not found for id ${packageId}`);
  }
  return priceForPackage(pkg, distanceKm, radiusRangeKm, extraMileCharge);
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
