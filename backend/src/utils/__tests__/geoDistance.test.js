const { haversineKm, getRoadDistanceKm } = require("../geoDistance");

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

describe("getRoadDistanceKm", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  it("requests TRAFFIC_AWARE routing, matching the live PHP backend's get_distance.php exactly", async () => {
    // Regression (order #1670): without this, Google can pick a different
    // route for identical coordinates than PHP gets, producing a
    // meaningfully different distanceMeters and an across-the-board fare
    // gap between the customer's estimate and every model in the driver's
    // popup — not a formula bug, a routing-preference mismatch.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 10171, duration: "1128s" }] }),
    });

    await getRoadDistanceKm(24.65, 76.04, 24.64, 75.94);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
  });
});
