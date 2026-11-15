jest.mock("../../config/db", () => ({
  pkg_order: { create: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { createMany: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn() }));
jest.mock("../../services/serviceAreaService", () => ({ validateBooking: jest.fn().mockResolvedValue({ ok: true }), validateLocation: jest.fn(), SERVICE_AREA_ERRORS: {} }));
jest.mock("../../services/settlementService", () => ({ findBlockingSettlement: jest.fn().mockResolvedValue(null) }));
jest.mock("../../services/globalIndiaService", () => ({ resolve: jest.fn() }));

const prisma = require("../../config/db");
const globalIndia = require("../../services/globalIndiaService");
const pricingEngine = require("../../services/pricingEngine");
const { createOrderCore, createOrder } = require("../orderController");

const BASE = {
  uid: 1, category: "Three Wheeler", deliveryTypeIds: [6], bookingType: 1,
  plat: "22.95", plong: "75.82", dlat: "23.18", dlong: "75.78", distance: 5, totalDcharge: 100, dCharge: 100,
};
const pkg = (cityId) => ({ id: 6, cat_id: 3, sort_order: 1, min_charge: 500, per_km_charge: 40, title: "Model 1", driver_per_percent: "90", city_id: cityId });
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(pricingEngine, "getActiveCustomerPlan").mockResolvedValue(null);
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.tbl_package.findMany.mockResolvedValue([pkg("1")]);
  require("../../services/serviceAreaService").validateBooking.mockResolvedValue({ ok: true });
  require("../../services/dispatchManager").startDispatch.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("createOrderCore with the Global India fallback", () => {
  it("outside India: refused before anything is created, with the usual 'service not available' message", async () => {
    globalIndia.resolve.mockResolvedValue({ kind: "outside_india", cityId: 0 });
    const out = await createOrderCore({ ...BASE, plat: "6.93", plong: "79.86" });
    expect(out).toEqual({ ok: false, code: "SERVICE_AREA", msg: "Service is not available at this pickup location yet.", area_code: "OUTSIDE_INDIA", which: "pickup" });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("a vehicle list from the wrong area (the pickup is now Global India's, the package is Indore's) is refused, never priced from the old rate card", async () => {
    globalIndia.resolve.mockResolvedValue({ kind: "global", cityId: 99 });
    prisma.tbl_package.findMany.mockResolvedValue([pkg("1")]); // an Indore package
    const out = await createOrderCore(BASE);
    expect(out).toMatchObject({ ok: false, code: "PICKUP_AREA_CHANGED" });
    expect(out.msg).toMatch(/pickup area has changed/i);
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("the HTTP answer for that is a 409 with the code the app can react to", async () => {
    globalIndia.resolve.mockResolvedValue({ kind: "global", cityId: 99 });
    const r = res();
    await createOrder({ body: { uid: 1, category: "Three Wheeler", delivery_type: [6], booking_type: 1, plat: "22.95", plong: "75.82", dlat: "23.18", dlong: "75.78", distance: 5, total_dcharge: 100, d_charge: 100 } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PICKUP_AREA_CHANGED", Result: "false" }));
  });

  it("the right area's package passes the gate, and the order is saved under the pickup's city", async () => {
    globalIndia.resolve.mockResolvedValue({ kind: "global", cityId: 99 });
    prisma.tbl_package.findMany.mockResolvedValue([pkg("99")]); // a Global India package
    prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 501, ...data }));
    const out = await createOrderCore(BASE);
    expect(out.code).not.toBe("PICKUP_AREA_CHANGED");
    expect(prisma.pkg_order.create).toHaveBeenCalledTimes(1);
    expect(Number(prisma.pkg_order.create.mock.calls[0][0].data.city_id)).toBe(99);
  });

  it("a package for all cities (empty / 0) serves any area", async () => {
    globalIndia.resolve.mockResolvedValue({ kind: "city", cityId: 2 });
    prisma.tbl_package.findMany.mockResolvedValue([pkg(""), { ...pkg("0"), id: 7 }]);
    const out = await createOrderCore({ ...BASE, deliveryTypeIds: [6, 7] }).catch(() => ({}));
    expect(out.code).not.toBe("PICKUP_AREA_CHANGED");
  });

  it("with the fallback OFF (resolve returns null) nothing about the order changes", async () => {
    globalIndia.resolve.mockResolvedValue(null);
    const out = await createOrderCore(BASE).catch(() => ({}));
    expect(out.code).not.toBe("PICKUP_AREA_CHANGED");
    expect(out.code).not.toBe("SERVICE_AREA");
  });
});
