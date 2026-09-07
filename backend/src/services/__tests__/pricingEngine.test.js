const { calculateFare, calculateDriverEarning, calculateCommissionPercent, isNightNow } = require("../pricingEngine");

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
