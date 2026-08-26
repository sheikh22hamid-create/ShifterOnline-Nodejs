const { haversineKm } = require("../geoDistance");

describe("haversineKm", () => {
  it("returns ~0 for the same point", () => {
    expect(haversineKm(28.704059, 77.10249, 28.704059, 77.10249)).toBeCloseTo(0, 5);
  });

  it("returns a realistic distance for Rohini Sector 7 -> Connaught Place, Delhi", () => {
    const km = haversineKm(28.704059, 77.10249, 28.613939, 77.209021);
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(16);
  });
});
