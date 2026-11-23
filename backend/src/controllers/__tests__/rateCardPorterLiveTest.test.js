const mockGetPorterAnchor = jest.fn();
const mockGetStats = jest.fn(() => ({ successes: 1 }));
const mockPriceForPackage = jest.fn();

jest.mock("../../config/db", () => ({ pkg_category: { findUnique: jest.fn() } }));
jest.mock("../../services/porterLiveSettings", () => ({ getConfig: jest.fn(async () => ({ enabled: true })), saveConfig: jest.fn() }));
jest.mock("../../services/porterQuoteService", () => ({
  getPorterAnchor: (...a) => mockGetPorterAnchor(...a),
  getStats: () => mockGetStats(),
}));
jest.mock("../../services/pricingEngine", () => ({
  getPackagesForCategory: jest.fn(async () => [{ id: 1, title: "Model 1" }, { id: 2, title: "Model 2" }]),
  getSlabPricingConfig: jest.fn(async () => ({ slabRates: {}, modelMultipliers: {} })),
  resolveVehicleSlabConfig: jest.fn(async () => ({})),
  priceForPackage: (...a) => mockPriceForPackage(...a),
}));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn(async () => ({ distanceKm: 7.5, durationMin: 20 })) }));

const prisma = require("../../config/db");
const { testPorterLive, getPorterLive } = require("../rateCardController");

const mkRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = { city_id: 1, cat_id: 3, plat: "22.7", plong: "75.8", dlat: "22.75", dlong: "75.9" };

describe("rateCardController.testPorterLive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_category.findUnique.mockResolvedValue({ cat_name: "3 Wheeler" });
    mockPriceForPackage.mockImplementation((pkg, km, r, e, d, s, m, c, n, anchor) => ({ fare: anchor ? 200 + pkg.id : 100 + pkg.id }));
  });

  it("returns porter_based and rate_card fares", async () => {
    mockGetPorterAnchor.mockResolvedValue({ fare: 300 });
    const res = mkRes();
    await testPorterLive({ body }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.success).toBe(true);
    expect(out.data.anchor).toEqual({ fare: 300 });
    expect(out.data.distance_km).toBe(7.5);
    expect(out.data.porter_based).toEqual([{ title: "Model 1", fare: 201 }, { title: "Model 2", fare: 202 }]);
    expect(out.data.rate_card).toEqual([{ title: "Model 1", fare: 101 }, { title: "Model 2", fare: 102 }]);
    expect(mockGetPorterAnchor).toHaveBeenCalledWith(expect.objectContaining({ cityId: 1, category: "3 Wheeler" }));
  });

  it("Porter unavailable -> anchor null, only rate_card filled", async () => {
    mockGetPorterAnchor.mockResolvedValue(null);
    const res = mkRes();
    await testPorterLive({ body }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.data.anchor).toBeNull();
    expect(out.data.porter_based).toEqual([]);
    expect(out.data.rate_card).toHaveLength(2);
  });

  it("400 on invalid coords", async () => {
    const res = mkRes();
    await testPorterLive({ body: { ...body, plat: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("GET includes stats", async () => {
    const res = mkRes();
    await getPorterLive({}, res);
    expect(res.json.mock.calls[0][0].data.stats).toEqual({ successes: 1 });
  });
});
