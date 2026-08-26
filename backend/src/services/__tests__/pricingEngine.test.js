const { calculateFare, calculateDriverEarning } = require("../pricingEngine");

describe("calculateFare", () => {
  const pkg = { min_charge: 20, per_km_charge: 5, night_charge_percent: 20 };

  it("uses per_km_charge * distance when it exceeds min_charge", () => {
    expect(calculateFare(pkg, 10, false)).toBe(50);
  });

  it("falls back to min_charge when distance is below the minimum", () => {
    expect(calculateFare(pkg, 1, false)).toBe(20);
  });

  it("applies night_charge_percent on top of the base fare", () => {
    expect(calculateFare(pkg, 10, true)).toBe(60);
  });
});

describe("calculateDriverEarning", () => {
  it("prefers a positive flat driver_per_trip over the percentage", () => {
    const pkg = { driver_per_trip: "80", driver_per_percent: "50" };
    expect(calculateDriverEarning(pkg, 100)).toBe(80);
  });

  it("falls back to driver_per_percent when driver_per_trip is 0 or unset", () => {
    const pkg = { driver_per_trip: "0", driver_per_percent: "70" };
    expect(calculateDriverEarning(pkg, 100)).toBe(70);
  });

  it("returns 0 when neither field parses to a usable number", () => {
    const pkg = { driver_per_trip: "", driver_per_percent: "" };
    expect(calculateDriverEarning(pkg, 100)).toBe(0);
  });
});
