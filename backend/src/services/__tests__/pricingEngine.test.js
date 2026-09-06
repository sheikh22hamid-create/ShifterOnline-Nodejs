const { calculateFare, calculateDriverEarning, calculateCommissionPercent } = require("../pricingEngine");

describe("calculateFare", () => {
  const pkg = { min_charge: 20, per_km_charge: 5, night_charge_percent: 20 };

  it("calculates min_charge + (per_km_charge * distance)", () => {
    expect(calculateFare(pkg, 10, false)).toBe(70);
  });

  it("calculates correctly for short distance", () => {
    expect(calculateFare(pkg, 1, false)).toBe(25);
  });

  it("applies night_charge_percent on top of the base fare", () => {
    expect(calculateFare(pkg, 10, true)).toBe(84);
  });

  it("adds flat pickup_charge and service_charge on top, unaffected by night_charge_percent", () => {
    const pkgWithExtras = { ...pkg, pickup_charge: 10, service_charge: 50 };
    expect(calculateFare(pkgWithExtras, 10, false)).toBe(130); // 70 + 10 + 50
    expect(calculateFare(pkgWithExtras, 10, true)).toBe(144); // 84 + 10 + 50
  });

  it("treats missing pickup_charge/service_charge as 0", () => {
    expect(calculateFare(pkg, 10, false)).toBe(70);
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
