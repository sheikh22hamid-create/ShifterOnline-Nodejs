const prisma = require("../config/db");
const { getRoadDistanceKm, haversineKm } = require("../utils/geoDistance");

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
 * Active USER-type premium-plan fare discount for this customer, if any —
 * matches the live PHP backend's packagelist.php query exactly: same table
 * join, same active/plan_for/date-range/discount_enabled conditions, same
 * "highest discount wins" tie-break on discount_percent DESC LIMIT 1.
 *
 * packagelist.php's own order-creation counterpart (pks_order.php) never
 * applied this discount at all — only the customer's fare *estimate*
 * reflected it, so a customer with an active discount plan saw one price
 * on the estimate screen and was charged a different (undiscounted) one
 * when the order actually got created and dispatched (confirmed live on
 * order #1670: driver popup showed the full undiscounted fare on every
 * model, ~10% above what the customer's estimate had shown, matching this
 * customer's active "10 percent less fare" plan exactly). Applying it here
 * — in the one formula every caller (estimate, order creation, dispatch,
 * accept, admin manual-assign) shares — makes the discount apply
 * consistently end to end instead of only on the screen before booking.
 */
async function getActivePlanDiscount(uid) {
  if (!uid) return null;
  const rows = await prisma.$queryRaw`
    SELECT pp.discount_percent, pp.discount_max_cap, pp.plan_name
    FROM tbl_user_plan_subscription ups
    JOIN tbl_premium_plan pp ON pp.id = ups.plan_id
    WHERE ups.user_id = ${Number(uid)}
      AND ups.status = 'active'
      AND ups.plan_for = 'USER'
      AND CURDATE() BETWEEN ups.start_date AND ups.end_date
      AND pp.discount_enabled = 1
    ORDER BY pp.discount_percent DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  const percent = Number(rows[0].discount_percent) || 0;
  if (percent <= 0) return null;
  return {
    percent,
    maxCap: Number(rows[0].discount_max_cap) || 0,
    planName: rows[0].plan_name || "",
  };
}

/**
 * Applies an active plan discount to min_charge/per_km_charge — matches
 * packagelist.php's own discount math exactly: each field discounted and
 * ROUNDED INDEPENDENTLY (min_charge to a whole rupee via Math.round,
 * per_km_charge to 2 decimals), not the final total, and not capped by
 * discount_max_cap — PHP fetches that field but never actually applies it
 * as a cap either, so this doesn't invent a cap PHP itself doesn't enforce.
 * Everything downstream of these two fields (radius charge via
 * pickup_per_km_charge, service/night charges, extraMileCharge) is
 * untouched by the discount, same as PHP.
 */
function applyPlanDiscount(pkg, discount) {
  if (!pkg || !discount || !discount.percent) return pkg;
  const mult = (100 - discount.percent) / 100;
  return {
    ...pkg,
    min_charge: Math.round((Number(pkg.min_charge) || 0) * mult),
    per_km_charge: round2((Number(pkg.per_km_charge) || 0) * mult),
  };
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
 *
 * `discount`, if given, is applied to a COPY of pkg (see applyPlanDiscount)
 * before anything else runs — the returned `pkg` is that discounted copy,
 * so driverEarning/commission are derived from the fare the customer is
 * actually being charged, not the pre-discount rate. Callers fetch the
 * discount themselves (via getActivePlanDiscount) rather than this function
 * looking it up, to keep it free of DB access.
 */
function priceForPackage(pkg, distanceKm, radiusRangeKm = 1, extraMileCharge = 0, discount = null) {
  const discountedPkg = applyPlanDiscount(pkg, discount);
  const isNight = isNightNow(discountedPkg);
  const fare = calculateFare(discountedPkg, distanceKm, isNight, radiusRangeKm, extraMileCharge);
  const driverEarning = calculateDriverEarning(discountedPkg, fare);
  const commission = calculateCommissionPercent(fare, driverEarning);
  const packageTitle = pkg?.title || `Model ${pkg?.id || ""}`;
  return { pkg: discountedPkg, fare, driverEarning, commission, isNight, packageTitle };
}

/** `uid`, when given, looks up that customer's active plan discount (if any) and applies it — see priceForPackage. */
async function priceForPackageId(packageId, distanceKm, radiusRangeKm = 1, extraMileCharge = 0, uid = null) {
  const [pkg, discount] = await Promise.all([
    getPackageById(packageId),
    getActivePlanDiscount(uid),
  ]);
  if (!pkg) {
    throw new Error(`tbl_package not found for id ${packageId}`);
  }
  return priceForPackage(pkg, distanceKm, radiusRangeKm, extraMileCharge, discount);
}

/**
 * radiusRangeKm/extraMileCharge are optional — callers that don't know the
 * customer's search radius yet (the estimate screen runs before that's
 * picked) get the same zero-radius-charge number this always returned.
 * Callers that DO already know it (e.g. a caller previewing the exact order
 * about to be created) can pass it through so estimated_fare matches what
 * priceForPackage/priceForPackageId will actually charge at order creation
 * and dispatch — see calculateRadiusCharge: chargeableRadius = radiusRangeKm
 * - 1, so this was silently under-quoting by that amount on every model
 * whenever the real order ends up with a search radius wider than 1km
 * (confirmed live on order #1724: estimate omitted the radius charge that
 * the driver popup / actual order correctly included).
 */
async function getFareEstimate({ cat_id, plat, plong, dlat, dlong, uid, radiusRangeKm = 1, extraMileCharge = 0 }) {
  const [{ distanceKm, durationMin }, packages, discount] = await Promise.all([
    getRoadDistanceKm(Number(plat), Number(plong), Number(dlat), Number(dlong)),
    getPackagesForCategory(cat_id),
    getActivePlanDiscount(uid),
  ]);

  const resolvedRadiusKm = Number(radiusRangeKm) > 0 ? Number(radiusRangeKm) : 1;
  const resolvedExtraMileCharge = Number(extraMileCharge) || 0;

  return {
    Result: true,
    distance_km: round2(distanceKm),
    duration_min: durationMin,
    has_plan_discount: !!discount,
    plan_discount_percent: discount ? discount.percent : 0,
    plan_name: discount ? discount.planName : "",
    packages: packages.map((pkg) => {
      const discountedPkg = applyPlanDiscount(pkg, discount);
      const isNight = isNightNow(discountedPkg);
      return {
        package_id: pkg.id,
        title: pkg.title,
        min_charge: Number(discountedPkg.min_charge),
        per_km_charge: Number(discountedPkg.per_km_charge),
        original_min_charge: Number(pkg.min_charge),
        original_per_km_charge: Number(pkg.per_km_charge),
        estimated_fare: calculateFare(discountedPkg, distanceKm, isNight, resolvedRadiusKm, resolvedExtraMileCharge),
        is_night: isNight,
      };
    }),
  };
}

/**
 * Mirrors the live PHP backend's get_distance.php response shape exactly
 * (DistanceData.distance_km etc.), so the customer app's existing
 * ApiWrapper.dataPost(Config.getDistance, ...) call site can switch to
 * this Node endpoint with no changes to how it reads the response.
 */
async function getDistanceEstimate({ plat, plong, dlat, dlong }) {
  const { distanceKm, durationMin, source } = await getRoadDistanceKm(
    Number(plat), Number(plong), Number(dlat), Number(dlong)
  );
  const airKm = round2(haversineKm(Number(plat), Number(plong), Number(dlat), Number(dlong)));
  const roadKm = round2(distanceKm);

  return {
    DistanceData: {
      distance_km: roadKm,
      distance_text: `${roadKm} km`,
      duration_min: durationMin,
      duration_text: durationMin > 0 ? `${durationMin} min` : "",
      air_distance_km: airKm,
      source,
      origin_address: "",
      destination_address: "",
      pickup_lat: Number(plat),
      pickup_lng: Number(plong),
      drop_lat: Number(dlat),
      drop_lng: Number(dlong),
    },
    ResponseCode: "200",
    Result: "true",
    ResponseMsg: "Distance calculated successfully!!",
  };
}

/**
 * Mirrors the live PHP backend's packagelist.php response shape exactly
 * (PackageData[] with the same field names, has_plan_discount/
 * plan_discount_percent/plan_name at the top level) — including the same
 * per-component plan-discount math (see applyPlanDiscount) — so the
 * customer app's existing ApiWrapper.dataPost(Config.packagelist, ...)
 * call site, and its own client-side cost calculation reading these exact
 * fields, can switch to this Node endpoint with no changes to either.
 * DRIVER-type package listing (packagelist.php's `type == 'DRIVER'`
 * branch) is intentionally not replicated — the customer app never uses
 * it, only the driver app's own separate rate-card screens do, unrelated
 * to this fare-estimate flow.
 */
async function getPackageListForCategory({ uid, catId }) {
  const [packages, discount] = await Promise.all([
    getPackagesForCategory(catId),
    getActivePlanDiscount(uid),
  ]);

  const packageData = packages.map((pkg) => {
    const isNight = isNightNow(pkg);
    const appliedNightCharge = isNight ? (parseFloat(pkg.night_charge_percent) || 0) : 0;
    const discountedPkg = applyPlanDiscount(pkg, discount);

    return {
      id: pkg.id,
      title: pkg.title,
      type: pkg.type,
      min_charge: String(discountedPkg.min_charge),
      per_km_charge: String(discountedPkg.per_km_charge),
      free_waiting_time: pkg.free_waiting_time,
      waiting_charge: pkg.waiting_charge != null ? String(pkg.waiting_charge) : "0",
      pickup_charge: pkg.pickup_charge != null ? String(pkg.pickup_charge) : null,
      service_charge_percent: pkg.service_charge_percent != null ? String(pkg.service_charge_percent) : "0",
      night_charge_percent: pkg.night_charge_percent != null ? String(pkg.night_charge_percent) : "0",
      start_time: pkg.start_time,
      end_time: pkg.end_time,
      status: pkg.status,
      user_detail_image: pkg.user_detail_image,
      driver_detail_image: pkg.driver_detail_image,
      loading_charge: pkg.loading_charge != null ? String(pkg.loading_charge) : null,
      unloading_charge: pkg.unloading_charge != null ? String(pkg.unloading_charge) : null,
      service_charge: pkg.service_charge != null ? String(pkg.service_charge) : null,
      pickup_per_km_charge: pkg.pickup_per_km_charge != null ? String(pkg.pickup_per_km_charge) : null,
      cancellation_charge: pkg.cancellation_charge_customer != null ? String(pkg.cancellation_charge_customer) : null,
      category_id: pkg.cat_id,
      is_night: isNight ? 1 : 0,
      applied_night_charge_percent: appliedNightCharge,
      applied_night_charge: appliedNightCharge,
      night_charge: appliedNightCharge,
      original_min_charge: String(pkg.min_charge),
      original_per_km_charge: String(pkg.per_km_charge),
      has_plan_discount: discount ? 1 : 0,
      plan_discount_percent: discount ? discount.percent : 0,
      discount_percent: discount ? discount.percent : 0,
      discount_max_cap: discount ? discount.maxCap : 0,
    };
  });

  return {
    PackageData: packageData,
    has_plan_discount: !!discount,
    plan_discount_percent: discount ? discount.percent : 0,
    plan_name: discount ? discount.planName : "",
    ResponseCode: "200",
    Result: "true",
    ResponseMsg: "Package List By Category Get Successfully!!",
  };
}

module.exports = {
  isNightNow,
  calculateFare,
  calculateDriverEarning,
  calculateCommissionPercent,
  commissionAmount,
  getActivePlanDiscount,
  applyPlanDiscount,
  getPackagesForCategory,
  getPackageById,
  priceForPackage,
  priceForPackageId,
  getFareEstimate,
  getDistanceEstimate,
  getPackageListForCategory,
};
