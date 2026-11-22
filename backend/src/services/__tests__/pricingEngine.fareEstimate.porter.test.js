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
jest.mock("../pickupCityService", () => ({ resolvePickupCityId: jest.fn() }));

const prisma = require("../../config/db");
const { getRoadDistanceKm, getMultiStopDistanceKm } = require("../../utils/geoDistance");
const { getPorterAnchor } = require("../porterQuoteService");
const { resolvePickupCityId } = require("../pickupCityService");
const { getFareEstimate } = require("../pricingEngine");

// Rate card Model 3: 100 + 10 * 10km = 200
const pkg = { id: 9, title: "Model 3", min_charge: 100, per_km_charge: 10, pickup_per_km_charge: 4, night_charge_percent: 50, use_linear_pricing: true };
const base = { cat_id: 1, plat: 22.7, plong: 75.8, dlat: 22.8, dlong: 75.9, uid: 1 };

describe("getFareEstimate with Porter anchor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 10, durationMin: 20 });
    prisma.tbl_package.findMany.mockResolvedValue([pkg]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.app_settings.findMany.mockResolvedValue([]);
    resolvePickupCityId.mockResolvedValue(7);
    getPorterAnchor.mockResolvedValue(null);
  });

  it("prices Model 3 at the Porter fare with no night/distance charge", async () => {
    getPorterAnchor.mockResolvedValue({ fare: 300 });
    const r = await getFareEstimate(base);
    expect(getPorterAnchor).toHaveBeenCalledWith(expect.objectContaining({ cityId: 7 }));
    const p = r.packages[0];
    expect(p.estimated_fare).toBe(300);
    expect(p.night_charge_amount).toBe(0);
    expect(p.distance_charge_amount).toBe(0);
    expect(p.is_night).toBe(false);
    expect(p.price_source).toBe("porter");
    expect(r.price_source).toBe("porter");
  });

  it("falls back to the cityId input when the city cannot be resolved", async () => {
    resolvePickupCityId.mockResolvedValue(null);
    await getFareEstimate({ ...base, cityId: 5 });
    expect(getPorterAnchor).toHaveBeenCalledWith(expect.objectContaining({ cityId: 5 }));
  });

  it("treats a throwing city resolver as null", async () => {
    resolvePickupCityId.mockRejectedValue(new Error("db"));
    await getFareEstimate({ ...base, cityId: 5 });
    expect(getPorterAnchor).toHaveBeenCalledWith(expect.objectContaining({ cityId: 5 }));
  });

  it("makes no Porter call when no city is known", async () => {
    resolvePickupCityId.mockResolvedValue(null);
    const r = await getFareEstimate(base);
    expect(getPorterAnchor).not.toHaveBeenCalled();
    expect(r.price_source).toBe("rate_card");
  });

  it("with a null anchor returns the rate-card fare and price_source rate_card", async () => {
    const r = await getFareEstimate(base);
    expect(r.packages[0].estimated_fare).toBe(200);
    expect(r.packages[0].price_source).toBe("rate_card");
    expect(r.price_source).toBe("rate_card");
  });

  it("drops an insane anchor (3x rate card) and uses the rate card", async () => {
    getPorterAnchor.mockResolvedValue({ fare: 600 });
    const r = await getFareEstimate(base);
    expect(r.packages[0].estimated_fare).toBe(200);
    expect(r.packages[0].price_source).toBe("rate_card");
    expect(r.price_source).toBe("rate_card");
  });

  it("does not call Porter when stops are present", async () => {
    getMultiStopDistanceKm.mockResolvedValue({ distanceKm: 12, durationMin: 25 });
    await getFareEstimate({ ...base, stops: [{ lat: 22.75, lng: 75.85 }] });
    expect(getPorterAnchor).not.toHaveBeenCalled();
  });
});
