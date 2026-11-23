jest.mock("../../config/db", () => ({
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  tbl_package: { findMany: jest.fn(), findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { createMany: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));
// Porter live pricing switched on (fetchPorterAnchor returns null before any lookup when it is off).
jest.mock("../../services/porterLiveSettings", () => ({ getConfig: async () => ({ enabled: true, cityIds: [5, 7, 13], timeoutMs: 3000, cacheMinutes: 10 }) }));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../services/porterQuoteService", () => ({
  getPorterAnchor: jest.fn(),
  withinSanityRange: jest.fn(),
}));

const prisma = require("../../config/db");
const porterQuoteService = require("../../services/porterQuoteService");
const pricingEngine = require("../../services/pricingEngine");
const { createOrderCore } = require("../orderController");

const ANCHOR = { fare: 900, distanceKm: 5, vehicles: {} };
const BASE = {
  uid: 1, category: "Tata Ace", deliveryTypeIds: [6], bookingType: 1, cityId: 13,
  plat: "22.70", plong: "75.80", dlat: "22.75", dlong: "75.90", distance: 5, totalDcharge: 1, dCharge: 1,
};
const created = () => prisma.pkg_order.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(pricingEngine, "getActiveCustomerPlan").mockResolvedValue(null);
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, cat_id: 3, sort_order: 1, min_charge: 500, per_km_charge: 40, title: "Model 1", driver_per_percent: "90" }]);
  prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 555, ...data }));
  porterQuoteService.getPorterAnchor.mockResolvedValue(ANCHOR);
  porterQuoteService.withinSanityRange.mockReturnValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe("createOrderCore: porter anchor", () => {
  it("stores the anchor on the order and prices off it", async () => {
    const spy = jest.spyOn(pricingEngine, "priceForPackage");
    const out = await createOrderCore({ ...BASE });
    expect(out.ok).toBe(true);
    expect(porterQuoteService.getPorterAnchor).toHaveBeenCalled();
    expect(created().porter_quote).toEqual(ANCHOR);
    expect(spy.mock.calls[0][9]).toEqual(ANCHOR);
  });

  it("leaves porter_quote out (never a plain null on a Json column) and prices from the rate card when Porter has no anchor", async () => {
    porterQuoteService.getPorterAnchor.mockResolvedValue(null);
    const spy = jest.spyOn(pricingEngine, "priceForPackage");
    await createOrderCore({ ...BASE });
    expect(created()).not.toHaveProperty("porter_quote");
    expect(spy.mock.calls[0][9] ?? null).toBeNull();
  });

  it("never calls Porter for an order with stops", async () => {
    await createOrderCore({ ...BASE, stops: [{ lat: 22.72, lng: 75.85, address: "Stop" }] });
    expect(porterQuoteService.getPorterAnchor).not.toHaveBeenCalled();
    expect(created()).not.toHaveProperty("porter_quote");
  });

  it("leaves porter_quote out when the sanity guard rejects the anchor", async () => {
    porterQuoteService.withinSanityRange.mockReturnValue(false);
    await createOrderCore({ ...BASE });
    expect(created()).not.toHaveProperty("porter_quote");
  });
});
