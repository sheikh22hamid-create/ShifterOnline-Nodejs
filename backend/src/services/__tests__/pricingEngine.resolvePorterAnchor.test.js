jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  tbl_package: { findMany: jest.fn() },
  app_settings: { findMany: jest.fn().mockResolvedValue([]) },
  pkg_category: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue({ cat_name: "3 Wheeler" }) },
}));
jest.mock("../../utils/geoDistance", () => ({
  getRoadDistanceKm: jest.fn(),
  getMultiStopDistanceKm: jest.fn(),
  haversineKm: jest.fn(),
}));
jest.mock("../porterQuoteService", () => ({
  getPorterAnchor: jest.fn(),
  withinSanityRange: jest.requireActual("../porterQuoteService").withinSanityRange,
}));
// Porter live pricing switched on (fetchPorterAnchor returns null before any lookup when it is off).
jest.mock("../porterLiveSettings", () => ({ getConfig: async () => ({ enabled: true, cityIds: [5, 7, 13], timeoutMs: 3000, cacheMinutes: 10 }) }));
jest.mock("../pickupCityService", () => ({ resolvePickupCityId: jest.fn() }));

const { getPorterAnchor } = require("../porterQuoteService");
const { resolvePickupCityId } = require("../pickupCityService");
const { resolvePorterAnchor } = require("../pricingEngine");

// Rate card Model 3: 100 + 10 * 10km = 200
const pkg = { id: 9, title: "Model 3", min_charge: 100, per_km_charge: 10, pickup_per_km_charge: 4, night_charge_percent: 50, use_linear_pricing: true };
const args = { cityId: 7, catId: 1, plat: 22.7, plong: 75.8, dlat: 22.8, dlong: 75.9, pkg, distanceKm: 10 };

describe("resolvePorterAnchor discount forwarding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolvePickupCityId.mockResolvedValue(7);
    getPorterAnchor.mockResolvedValue({ fare: 300 });
  });

  it("returns the anchor when it passes the guard", async () => {
    expect(await resolvePorterAnchor(args)).toEqual({ fare: 300 });
  });

  it("forwards the customer's plan discount to the sanity guard", async () => {
    // The guard hands the discount to applyPlanDiscount, which reads .percent.
    let reads = 0;
    const discount = { get percent() { reads += 1; return 10; } };
    await resolvePorterAnchor({ ...args, discount });
    expect(reads).toBeGreaterThan(0);
  });

  it("works with no discount (default null)", async () => {
    expect(await resolvePorterAnchor({ ...args, discount: null })).toEqual({ fare: 300 });
  });
});
