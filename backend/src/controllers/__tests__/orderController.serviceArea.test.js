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
jest.mock("../../services/serviceAreaService", () => ({ validateBooking: jest.fn(), validateLocation: jest.fn(), SERVICE_AREA_ERRORS: {} }));
jest.mock("../../services/settlementService", () => ({ findBlockingSettlement: jest.fn().mockResolvedValue(null) }));

const prisma = require("../../config/db");
const serviceArea = require("../../services/serviceAreaService");
const pricingEngine = require("../../services/pricingEngine");
const { createOrderCore, createOrder, validateLocation } = require("../orderController");

const BASE = {
  uid: 1, category: "Three Wheeler", deliveryTypeIds: [6], bookingType: 1,
  plat: "22.70", plong: "75.80", dlat: "23.18", dlong: "75.78", distance: 5, totalDcharge: 100, dCharge: 100,
};
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(pricingEngine, "getActiveCustomerPlan").mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, cat_id: 3, sort_order: 1, min_charge: 500, per_km_charge: 40, title: "Model 1", driver_per_percent: "90" }]);
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.$queryRaw.mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe("createOrderCore service-area gate", () => {
  it("refuses a drop outside the allowed area before anything is created, judging the category of the validated package", async () => {
    serviceArea.validateBooking.mockResolvedValue({ ok: false, which: "drop", code: "NO_ENTRY", message: "Drop location is a no-entry zone for the selected vehicle type. Please choose another location." });
    const out = await createOrderCore({ ...BASE, category: "Bike" }); // the client names the wrong vehicle; the package is category 3
    expect(out).toEqual({ ok: false, code: "SERVICE_AREA", msg: expect.stringMatching(/^Drop location is a no-entry zone/), area_code: "NO_ENTRY", which: "drop" });
    expect(serviceArea.validateBooking).toHaveBeenCalledWith({
      pickup: { lat: "22.70", lng: "75.80" }, drop: { lat: "23.18", lng: "75.78" }, stops: [], categoryIds: [3],
    });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });
});

describe("createOrder HTTP", () => {
  it("answers 400 with the plain message, the zone code and which location", async () => {
    serviceArea.validateBooking.mockResolvedValue({ ok: false, which: "pickup", code: "NO_SERVICE_ZONE", message: "No service zone available for this pickup location." });
    const r = res();
    await createOrder({ body: { uid: 1, category: "Three Wheeler", delivery_type: [6], booking_type: 1, plat: "22.7", plong: "75.8", dlat: "22.8", dlong: "75.9" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "400", Result: "false", ResponseMsg: "No service zone available for this pickup location.", code: "SERVICE_AREA", area_code: "NO_SERVICE_ZONE", which: "pickup" });
  });
});

describe("validateLocation endpoint", () => {
  it("passes the category to the same service and reports allowed or the reason", async () => {
    serviceArea.validateLocation.mockResolvedValueOnce({ ok: true, enforced: true }).mockResolvedValueOnce({ ok: false, enforced: true, code: "NO_ENTRY", message: "Pickup is not allowed in this area for the selected vehicle type." });
    const a = res();
    await validateLocation({ body: { lat: 22.7, lng: 75.8, type: "pickup", cat_id: 3 } }, a);
    expect(serviceArea.validateLocation).toHaveBeenCalledWith({ lat: 22.7, lng: 75.8, kind: "pickup", category: 3 });
    expect(a.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", allowed: true, enforced: true });
    const b = res();
    await validateLocation({ body: { lat: 22.7, lng: 75.8, type: "pickup", cat_id: 3 } }, b);
    expect(b.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", allowed: false, enforced: true, code: "NO_ENTRY", message: "Pickup is not allowed in this area for the selected vehicle type." });
  });

  it("rejects bad input", async () => {
    const r = res();
    await validateLocation({ body: { lat: "x", lng: 75.8, type: "pickup" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    const r2 = res();
    await validateLocation({ body: { lat: 22.7, lng: 75.8, type: "stop" } }, r2);
    expect(r2.status).toHaveBeenCalledWith(400);
  });
});
