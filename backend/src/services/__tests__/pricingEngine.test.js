jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  tbl_package: { findMany: jest.fn() },
}));
jest.mock("../../utils/geoDistance", () => ({
  getRoadDistanceKm: jest.fn(),
  haversineKm: jest.fn(),
}));

const prisma = require("../../config/db");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const {
  calculateFare,
  calculateDriverEarning,
  calculateCommissionPercent,
  isNightNow,
  applyPlanDiscount,
  getActivePlanDiscount,
  priceForPackage,
  getPackageListForCategory,
  getFareEstimate,
} = require("../pricingEngine");

describe("isNightNow", () => {
  // start_time/end_time digits are IST wall-clock (23:00 -> 06:00 IST), matching
  // the live PHP backend which runs on Asia/Kolkata — so "now" must be converted
  // to IST before comparing, not read as the server process's local/UTC time.
  const pkg = { start_time: "1970-01-01T23:00:00.000Z", end_time: "1970-01-01T06:00:00.000Z" };

  it("treats 04:11 UTC (09:41 IST, daytime) as NOT night", () => {
    // Regression: an order at this exact instant was wrongly night-charged
    // when isNightNow compared server-local (UTC) clock digits directly
    // against the IST window bounds.
    expect(isNightNow(pkg, new Date("2026-09-07T04:11:49.000Z"))).toBe(0);
  });

  it("treats 20:24 UTC (01:54 IST, genuinely nighttime) as night", () => {
    expect(isNightNow(pkg, new Date("2026-09-06T20:24:38.000Z"))).toBe(1);
  });

  it("treats 12:00 UTC (17:30 IST, daytime) as not night", () => {
    expect(isNightNow(pkg, new Date("2026-09-06T12:00:00.000Z"))).toBe(0);
  });
});

describe("calculateFare", () => {
  // Matches the live PHP backend's pks_order.php formula exactly:
  // d_charge = min_charge + per_km_charge*distance + radius_charge (first 1km free)
  // service_charge = d_charge * service_charge_percent / 100
  // night_charge = night_charge_percent added as a flat ₹ amount when active (not a multiplier)
  // total = d_charge + service_charge + night_charge + extraMileCharge
  const pkg = { min_charge: 20, per_km_charge: 5 };

  it("base = min_charge + (per_km_charge * distance), radius within the free 1km", () => {
    expect(calculateFare(pkg, 10, false)).toBe(70);
    expect(calculateFare(pkg, 10, false, 1)).toBe(70);
  });

  it("adds night_charge_percent as a flat ₹ amount, not a multiplier", () => {
    const pkgWithNight = { ...pkg, night_charge_percent: 20 };
    expect(calculateFare(pkgWithNight, 10, false)).toBe(70);
    expect(calculateFare(pkgWithNight, 10, true)).toBe(90); // 70 + 20 flat, not 70*1.2
  });

  it("applies service_charge_percent as a % of the delivery+radius subtotal", () => {
    const pkgWithService = { ...pkg, service_charge_percent: 10 };
    expect(calculateFare(pkgWithService, 10, false)).toBe(77); // 70 + 10% of 70
  });

  it("ignores the legacy flat pickup_charge/service_charge columns entirely", () => {
    const pkgWithLegacyFlats = { ...pkg, pickup_charge: 999, service_charge: 999 };
    expect(calculateFare(pkgWithLegacyFlats, 10, false)).toBe(70);
  });

  it("bills radius beyond the free 1km at per_km_charge", () => {
    expect(calculateFare(pkg, 10, false, 3)).toBe(80); // chargeable 2km * 5 = 10 -> 70+10
  });

  it("uses pickup_per_km_charge for the radius portion when set, instead of per_km_charge", () => {
    const pkgWithPickupRate = { ...pkg, pickup_per_km_charge: 8 };
    expect(calculateFare(pkgWithPickupRate, 10, false, 3)).toBe(86); // chargeable 2km * 8 = 16 -> 70+16
  });

  it("adds extraMileCharge flat on top of everything", () => {
    expect(calculateFare(pkg, 10, false, 1, 15)).toBe(85); // 70 + 15
  });

  it("combines radius charge, service %, night flat, and extra mile together, rounded to a whole rupee", () => {
    const pkgFull = { ...pkg, service_charge_percent: 10, night_charge_percent: 20, pickup_per_km_charge: 8 };
    // dCharge = 20 + 50 + (2*8) = 86; service = 8.6; night = 20; extraMile = 5 -> 119.6 -> 120
    expect(calculateFare(pkgFull, 10, true, 3, 5)).toBe(120);
  });

  it("rounds the final total to the nearest whole rupee — the same number flows through the order, popup, and driver payout unchanged", () => {
    const pkgFraction = { min_charge: 23.96, per_km_charge: 6.69 };
    // 23.96 + 6.69*10.171 = 92.0043... -> 92
    expect(calculateFare(pkgFraction, 10.171, false)).toBe(92);
  });
});

describe("calculateDriverEarning", () => {
  it("prefers a positive flat driver_per_trip over the percentage", () => {
    const pkg = { driver_per_trip: "80", driver_per_percent: "50" };
    expect(calculateDriverEarning(pkg, 100)).toBe(80);
  });

  it("falls back to fare-minus-commission when driver_per_trip is 0 or unset (driver_per_percent is admin's commission rate, not the driver's share)", () => {
    const pkg = { driver_per_trip: "0", driver_per_percent: "70" };
    expect(calculateDriverEarning(pkg, 100)).toBe(30);
  });

  it("returns the full fare when neither field parses to a usable number (0% commission)", () => {
    const pkg = { driver_per_trip: "", driver_per_percent: "" };
    expect(calculateDriverEarning(pkg, 100)).toBe(100);
  });

  it("rounds the result to a whole rupee — the driver's real payout is a round number, not fractional paise", () => {
    const pkg = { driver_per_trip: "0", driver_per_percent: "5" };
    // 92 * 95 / 100 = 87.4 -> 87
    expect(calculateDriverEarning(pkg, 92)).toBe(87);
  });
});

describe("calculateCommissionPercent", () => {
  it("recovers driver_per_percent exactly for a percent-based package", () => {
    // fare=100, driverEarning=100*(100-30)/100=70 -> commission should read back as 30%
    expect(calculateCommissionPercent(100, 70)).toBe(30);
  });

  it("derives the true effective % admin kept for a flat driver_per_trip package", () => {
    // fare=56, driver kept a flat 32 -> admin's real cut is (56-32)/56 = 42.86%
    expect(calculateCommissionPercent(56, 32)).toBe(42.86);
  });

  it("returns 0 for a non-positive fare instead of dividing by zero", () => {
    expect(calculateCommissionPercent(0, 0)).toBe(0);
  });
});

describe("applyPlanDiscount", () => {
  // Matches packagelist.php's own discount math exactly: min_charge and
  // per_km_charge discounted and rounded INDEPENDENTLY (min_charge to a
  // whole rupee, per_km_charge to 2 decimals) — not the final total.
  const pkg = { min_charge: 23.96, per_km_charge: 6.69, driver_per_percent: "5", pickup_per_km_charge: 4 };

  it("discounts min_charge (whole rupee) and per_km_charge (2 decimals) independently", () => {
    const discounted = applyPlanDiscount(pkg, { percent: 10 });
    // 23.96 * 0.9 = 21.564 -> round -> 22; 6.69 * 0.9 = 6.021 -> round2 -> 6.02
    expect(discounted.min_charge).toBe(22);
    expect(discounted.per_km_charge).toBe(6.02);
  });

  it("leaves every other field untouched, including pickup_per_km_charge — PHP's discount never touches it either", () => {
    const discounted = applyPlanDiscount(pkg, { percent: 10 });
    expect(discounted.pickup_per_km_charge).toBe(4);
    expect(discounted.driver_per_percent).toBe("5");
  });

  it("returns pkg unchanged when there's no discount", () => {
    expect(applyPlanDiscount(pkg, null)).toBe(pkg);
    expect(applyPlanDiscount(pkg, { percent: 0 })).toBe(pkg);
  });
});

describe("getActivePlanDiscount", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null immediately for a falsy uid, without querying the DB", async () => {
    const result = await getActivePlanDiscount(null);
    expect(result).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns the discount when an active USER-plan row comes back", async () => {
    prisma.$queryRaw.mockResolvedValue([{ discount_percent: "10", discount_max_cap: "0", plan_name: "10 percent less fare" }]);

    const result = await getActivePlanDiscount(12);

    expect(result).toEqual({ percent: 10, maxCap: 0, planName: "10 percent less fare" });
  });

  it("returns null when no active discount plan is found", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await getActivePlanDiscount(12)).toBeNull();
  });

  it("returns null when the row's discount_percent is 0 or non-positive", async () => {
    prisma.$queryRaw.mockResolvedValue([{ discount_percent: "0", discount_max_cap: "0", plan_name: "x" }]);
    expect(await getActivePlanDiscount(12)).toBeNull();
  });
});

describe("priceForPackage with an active plan discount", () => {
  it("bases fare/driverEarning on the discounted min_charge/per_km_charge, not the original rate", () => {
    // Live regression (order #1670): customer had an active "10 percent
    // less fare" plan. The estimate correctly showed the discounted fare,
    // but the driver's popup and the actual order/dispatch fare used the
    // undiscounted rate — an ~10% gap across every model. Threading the
    // discount into priceForPackage (which every caller — estimate, order
    // creation, dispatch, accept, admin manual-assign — shares) fixes it
    // at the source instead of only on the pre-booking screen.
    const pkg = { id: 6, title: "Model 1", min_charge: 23.96, per_km_charge: 6.69, driver_per_percent: "5", driver_per_trip: "0" };

    const withoutDiscount = priceForPackage(pkg, 251.249, 1, 0, null);
    const withDiscount = priceForPackage(pkg, 251.249, 1, 0, { percent: 10 });

    expect(withoutDiscount.fare).toBe(1705); // matches the live driver-popup figure for order #1670
    expect(withDiscount.fare).toBeLessThan(withoutDiscount.fare);
    expect(withDiscount.fare / withoutDiscount.fare).toBeCloseTo(0.9, 1);
  });
});

describe("getPackageListForCategory", () => {
  beforeEach(() => jest.clearAllMocks());

  const pkg = {
    id: 6, title: "Model 1", type: "USER", min_charge: "23.96", per_km_charge: "6.69",
    free_waiting_time: 5, waiting_charge: "2", pickup_charge: null,
    service_charge_percent: "0", night_charge_percent: "30",
    start_time: "1970-01-01T23:00:00.000Z", end_time: "1970-01-01T06:00:00.000Z",
    status: 1, user_detail_image: "img.png", driver_detail_image: "img2.png",
    loading_charge: "0", unloading_charge: "0", service_charge: null,
    pickup_per_km_charge: "4", cancellation_charge_customer: "15", cat_id: 8,
  };

  it("mirrors packagelist.php's field names, with min_charge/per_km_charge discounted when an active plan applies", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([pkg]);
    prisma.$queryRaw.mockResolvedValue([{ discount_percent: "10", discount_max_cap: "0", plan_name: "10 percent less fare" }]);

    const result = await getPackageListForCategory({ uid: 12, catId: 8 });

    expect(result.has_plan_discount).toBe(true);
    expect(result.plan_discount_percent).toBe(10);
    expect(result.plan_name).toBe("10 percent less fare");

    const [row] = result.PackageData;
    expect(row.id).toBe(6);
    expect(row.min_charge).toBe("22"); // 23.96 * 0.9 -> round -> 22
    expect(row.per_km_charge).toBe("6.02"); // 6.69 * 0.9 -> round2 -> 6.02
    expect(row.original_min_charge).toBe("23.96");
    expect(row.original_per_km_charge).toBe("6.69");
    expect(row.pickup_per_km_charge).toBe("4"); // untouched by the discount, same as PHP
    expect(row.cancellation_charge).toBe("15");
  });

  it("leaves min_charge/per_km_charge at the original rate with no active discount", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([pkg]);
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await getPackageListForCategory({ uid: 12, catId: 8 });

    expect(result.has_plan_discount).toBe(false);
    expect(result.PackageData[0].min_charge).toBe("23.96");
    expect(result.PackageData[0].per_km_charge).toBe("6.69");
  });
});

describe("getFareEstimate", () => {
  beforeEach(() => jest.clearAllMocks());

  const pkg = { id: 6, title: "Model 1", min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 4 };

  it("quotes zero radius charge when radius_km isn't known yet (unchanged default behavior)", async () => {
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 10, durationMin: 20 });
    prisma.tbl_package.findMany.mockResolvedValue([pkg]);
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await getFareEstimate({ cat_id: 1, plat: 1, plong: 1, dlat: 2, dlong: 2, uid: 1 });

    expect(result.packages[0].estimated_fare).toBe(70); // 20 + 5*10, no radius/extra-mile charge
  });

  // Regression for order #1724: the estimate omitted the radius charge that
  // order/create + the driver popup correctly included (radius_range=10 ->
  // 9km chargeable * pickup_per_km_charge), so the customer's pre-booking
  // quote was under the real dispatched fare by exactly that amount.
  it("includes radius charge + extra-mile charge when the caller already knows them", async () => {
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 10, durationMin: 20 });
    prisma.tbl_package.findMany.mockResolvedValue([pkg]);
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await getFareEstimate({
      cat_id: 1, plat: 1, plong: 1, dlat: 2, dlong: 2, uid: 1,
      radiusRangeKm: 10, extraMileCharge: 5,
    });

    // dCharge = 20 + 5*10 + (10-1)*4 = 106; total = 106 + 5 extra-mile = 111
    expect(result.packages[0].estimated_fare).toBe(111);
  });
});
