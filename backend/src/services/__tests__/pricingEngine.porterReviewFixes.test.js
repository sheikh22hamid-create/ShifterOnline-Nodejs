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
  markRouteRejected: jest.fn(),
  withinSanityRange: jest.requireActual("../porterQuoteService").withinSanityRange,
}));
jest.mock("../pickupCityService", () => ({ resolvePickupCityId: jest.fn() }));
jest.mock("../porterLiveSettings", () => ({ getConfig: jest.fn() }));

const prisma = require("../../config/db");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { getPorterAnchor, markRouteRejected } = require("../porterQuoteService");
const { resolvePickupCityId } = require("../pickupCityService");
const settings = require("../porterLiveSettings");
const { fetchPorterAnchor, resolvePorterAnchor, getFareEstimate, porterModelFactor } = require("../pricingEngine");

const ON = { enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 };
// Rate card Model 3: 100 + 10 * 10km = 200
const pkg = { id: 9, title: "Model 3", min_charge: 100, per_km_charge: 10, pickup_per_km_charge: 4, night_charge_percent: 50, use_linear_pricing: true };
const route = { cityId: 7, catId: 1, plat: 22.7, plong: 75.8, dlat: 22.8, dlong: 75.9 };

beforeEach(() => {
  jest.clearAllMocks();
  settings.getConfig.mockResolvedValue(ON);
  resolvePickupCityId.mockResolvedValue(7);
  getPorterAnchor.mockResolvedValue({ fare: 300 });
  getRoadDistanceKm.mockResolvedValue({ distanceKm: 10, durationMin: 20 });
  prisma.tbl_package.findMany.mockResolvedValue([pkg]);
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.app_settings.findMany.mockResolvedValue([]);
});

describe("fetchPorterAnchor switch gate (F3)", () => {
  it.each([
    ["disabled", { ...ON, enabled: false }],
    ["no cities", { ...ON, cityIds: [] }],
  ])("%s: returns null with no city resolution, category lookup or quote call", async (_n, cfg) => {
    settings.getConfig.mockResolvedValue(cfg);
    expect(await fetchPorterAnchor(route)).toBeNull();
    expect(resolvePickupCityId).not.toHaveBeenCalled();
    expect(prisma.pkg_category.findUnique).not.toHaveBeenCalled();
    expect(getPorterAnchor).not.toHaveBeenCalled();
  });

  it("enabled: resolves the city and asks for the quote", async () => {
    expect(await fetchPorterAnchor(route)).toEqual({ fare: 300 });
    expect(resolvePickupCityId).toHaveBeenCalledTimes(1);
    expect(getPorterAnchor).toHaveBeenCalledWith(expect.objectContaining({ cityId: 7, category: "3 Wheeler" }));
  });

  it("a throwing config read degrades to null", async () => {
    settings.getConfig.mockRejectedValue(new Error("db"));
    expect(await fetchPorterAnchor(route)).toBeNull();
    expect(getPorterAnchor).not.toHaveBeenCalled();
  });

  it("getFareEstimate with the switch off makes no Porter work and prices on the rate card", async () => {
    settings.getConfig.mockResolvedValue({ ...ON, enabled: false });
    const r = await getFareEstimate({ cat_id: 1, plat: 22.7, plong: 75.8, dlat: 22.8, dlong: 75.9, uid: 1 });
    expect(r.packages[0].estimated_fare).toBe(200);
    expect(r.price_source).toBe("rate_card");
    expect(resolvePickupCityId).not.toHaveBeenCalled();
    expect(getPorterAnchor).not.toHaveBeenCalled();
  });
});

describe("guard rejection is negative-cached (F1b)", () => {
  const expectedRoute = { cityId: 7, pickup: { lat: 22.7, lng: 75.8 }, drop: { lat: 22.8, lng: 75.9 }, category: "3 Wheeler" };

  it("resolvePorterAnchor marks the route+vehicle rejected when the guard fails", async () => {
    getPorterAnchor.mockResolvedValue({ fare: 600 }); // 3x rate card
    expect(await resolvePorterAnchor({ ...route, pkg, distanceKm: 10 })).toBeNull();
    expect(markRouteRejected).toHaveBeenCalledWith(expectedRoute);
  });

  it("resolvePorterAnchor does not mark when the guard passes", async () => {
    expect(await resolvePorterAnchor({ ...route, pkg, distanceKm: 10 })).toEqual({ fare: 300 });
    expect(markRouteRejected).not.toHaveBeenCalled();
  });

  it("getFareEstimate marks the route+vehicle rejected when the guard fails", async () => {
    getPorterAnchor.mockResolvedValue({ fare: 600 });
    const r = await getFareEstimate({ cat_id: 1, plat: 22.7, plong: 75.8, dlat: 22.8, dlong: 75.9, uid: 1 });
    expect(r.price_source).toBe("rate_card");
    expect(markRouteRejected).toHaveBeenCalledWith(expectedRoute);
  });

  it("getFareEstimate does not mark when the guard passes", async () => {
    const r = await getFareEstimate({ cat_id: 1, plat: 22.7, plong: 75.8, dlat: 22.8, dlong: 75.9, uid: 1 });
    expect(r.price_source).toBe("porter");
    expect(markRouteRejected).not.toHaveBeenCalled();
  });

  it("a throwing markRouteRejected never breaks pricing", async () => {
    getPorterAnchor.mockResolvedValue({ fare: 600 });
    markRouteRejected.mockImplementation(() => { throw new Error("boom"); });
    expect(await resolvePorterAnchor({ ...route, pkg, distanceKm: 10 })).toBeNull();
  });
});

describe("porterModelFactor edge cases (M1)", () => {
  const mm = (models) => ({ models });

  it("matches Model 3 case-insensitively", () => {
    const m = mm([{ model: "model 3", offset_percent: 8 }, { model: "Model 1", offset_percent: -10 }]);
    expect(porterModelFactor({ title: "Model 1" }, m)).toBeCloseTo(0.9 / 1.08, 6);
    expect(porterModelFactor({ title: "MODEL 3" }, m)).toBe(1);
  });

  it("returns 1 when Model 3's offset makes the denominator <= 0", () => {
    expect(porterModelFactor({ title: "Model 1" }, mm([{ model: "Model 3", offset_percent: -100 }, { model: "Model 1", offset_percent: 0 }]))).toBe(1);
    expect(porterModelFactor({ title: "Model 1" }, mm([{ model: "Model 3", offset_percent: -150 }, { model: "Model 1", offset_percent: 0 }]))).toBe(1);
  });

  it("returns 1 when the package's own factor is <= 0 or not finite", () => {
    expect(porterModelFactor({ title: "Model 1" }, mm([{ model: "Model 3", offset_percent: 0 }, { model: "Model 1", offset_percent: -100 }]))).toBe(1);
    expect(porterModelFactor({ title: "Model 1" }, mm([{ model: "Model 3", offset_percent: 0 }, { model: "Model 1", offset_percent: -120 }]))).toBe(1);
    expect(porterModelFactor({ title: "Model 1" }, mm([{ model: "Model 3", offset_percent: 0 }, { model: "Model 1", offset_percent: Infinity }]))).toBe(1);
    expect(porterModelFactor({ title: "Model 1" }, mm([{ model: "Model 3", offset_percent: Infinity }, { model: "Model 1", offset_percent: 5 }]))).toBe(1);
  });

  it("tolerates a model entry with no name", () => {
    expect(porterModelFactor({ title: "Model 1" }, mm([{ offset_percent: 5 }, { model: "Model 1", offset_percent: 10 }]))).toBeCloseTo(1.1, 6);
  });
});
