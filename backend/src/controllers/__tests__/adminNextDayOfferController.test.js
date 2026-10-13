jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn() } }));
jest.mock("../../services/nextDayOfferService", () => ({
  listAvailableDailyDrivers: jest.fn(), offerToDriver: jest.fn(), listOffers: jest.fn(),
}));
jest.mock("../../services/nextDaySettings", () => ({
  getOfferSeconds: jest.fn().mockResolvedValue(60), getLiveTime: jest.fn().mockResolvedValue("14:00"),
  setOfferSeconds: jest.fn(), setLiveTime: jest.fn(),
  validateOfferSeconds: jest.fn((v) => Number(v)), validateLiveTime: jest.fn((v) => v),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const settings = require("../../services/nextDaySettings");
const offers = require("../../services/nextDayOfferService");
const ctrl = require("../adminNextDayOfferController");

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const req = (extra = {}) => ({ params: { id: "10" }, body: {}, user: { id: 9, role: "admin", city_id: 1 }, scopedCityId: 1, ...extra });
const next = (o = {}) => ({ id: 10, city_id: 1, booking_type: 3, ...o });

beforeEach(() => { jest.clearAllMocks(); prisma.pkg_order.findUnique.mockResolvedValue(next()); });

it("lists available Daily Drivers for a next-day order", async () => {
  offers.listAvailableDailyDrivers.mockResolvedValue([{ id: 1 }]);
  const r = res();
  await ctrl.listDailyDrivers(req(), r);
  expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1 }] });
});
it("404s for a missing order and 400s for a non-next-day order", async () => {
  prisma.pkg_order.findUnique.mockResolvedValue(null);
  let r = res(); await ctrl.listDailyDrivers(req(), r); expect(r.status).toHaveBeenCalledWith(404);
  prisma.pkg_order.findUnique.mockResolvedValue(next({ booking_type: 1 }));
  r = res(); await ctrl.listDailyDrivers(req(), r); expect(r.status).toHaveBeenCalledWith(400);
});
it("refuses an order from another city", async () => {
  prisma.pkg_order.findUnique.mockResolvedValue(next({ city_id: 2 }));
  const r = res(); await ctrl.listDailyDrivers(req(), r); expect(r.status).toHaveBeenCalledWith(403);
});
it("offers the order to the chosen driver as the calling admin", async () => {
  offers.offerToDriver.mockResolvedValue({ id: 1, rider_id: 5 });
  const r = res();
  await ctrl.offer(req({ body: { rider_id: "5" } }), r);
  expect(offers.offerToDriver).toHaveBeenCalledWith({ order: next(), riderId: 5, adminId: 9 });
  expect(r.status).toHaveBeenCalledWith(201);
});
it("requires rider_id and passes service errors through with their status", async () => {
  let r = res(); await ctrl.offer(req({ body: {} }), r); expect(r.status).toHaveBeenCalledWith(400);
  offers.offerToDriver.mockRejectedValue(Object.assign(new Error("An offer for this order is already open"), { statusCode: 409 }));
  r = res(); await ctrl.offer(req({ body: { rider_id: 5 } }), r);
  expect(r.status).toHaveBeenCalledWith(409);
  expect(r.json).toHaveBeenCalledWith({ success: false, message: "An offer for this order is already open" });
});
it("saves settings", async () => {
  const s = require("../../services/nextDaySettings");
  s.setOfferSeconds.mockResolvedValue(90);
  const r = res();
  await ctrl.saveSettings({ body: { offer_seconds: 90 }, user: { id: 9, role: "admin" } }, r);
  expect(s.setOfferSeconds).toHaveBeenCalledWith(90);
  expect(r.json).toHaveBeenCalledWith({ success: true, data: { offer_seconds: 90, live_time: "14:00" } });
});

describe("city scoping fails closed", () => {
  it("403s an admin with no city (scopedCityId NaN)", async () => {
    const r = res(); await ctrl.listDailyDrivers(req({ scopedCityId: NaN, user: { id: 9, role: "admin" } }), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "Your account is not assigned to a city" });
  });
  it("403s a scoped admin for an order with null city_id", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(next({ city_id: null }));
    const r = res(); await ctrl.listDailyDrivers(req(), r);
    expect(r.status).toHaveBeenCalledWith(403);
  });
  it("lets a superadmin reach any city", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(next({ city_id: 7 }));
    offers.listAvailableDailyDrivers.mockResolvedValue([]);
    const r = res(); await ctrl.listDailyDrivers(req({ scopedCityId: null, user: { id: 1, role: "superadmin" } }), r);
    expect(r.status).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

describe("settings", () => {
  it("saves live_time alone", async () => {
    settings.setLiveTime.mockResolvedValue("15:30");
    const r = res(); await ctrl.saveSettings({ body: { live_time: "15:30" } }, r);
    expect(settings.setOfferSeconds).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { offer_seconds: 60, live_time: "15:30" } });
  });
  it("does not half-apply: invalid live_time blocks the valid offer_seconds write", async () => {
    settings.validateLiveTime.mockImplementationOnce(() => { throw Object.assign(new Error("live_time must be HH:MM (24-hour)"), { statusCode: 400 }); });
    const r = res(); await ctrl.saveSettings({ body: { offer_seconds: 90, live_time: "nope" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(settings.setOfferSeconds).not.toHaveBeenCalled();
    expect(settings.setLiveTime).not.toHaveBeenCalled();
  });
  it("gets settings", async () => {
    const r = res(); await ctrl.getSettings({}, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { offer_seconds: 60, live_time: "14:00" } });
  });
});

it("lists offers for the order", async () => {
  offers.listOffers.mockResolvedValue([{ id: 3 }]);
  const r = res(); await ctrl.listOffers(req(), r);
  expect(offers.listOffers).toHaveBeenCalledWith(10);
  expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 3 }] });
});
it("400s a bad :id", async () => {
  const r = res(); await ctrl.listOffers(req({ params: { id: "abc" } }), r);
  expect(r.status).toHaveBeenCalledWith(400);
});
it("hides internals on unexpected errors", async () => {
  offers.listOffers.mockRejectedValue(new Error("db password leaked"));
  const r = res(); await ctrl.listOffers(req(), r);
  expect(r.status).toHaveBeenCalledWith(500);
  expect(r.json).toHaveBeenCalledWith({ success: false, message: "Internal server error" });
  expect(logger.error).toHaveBeenCalled();
});
it.each(["abc", -1])("400s offer with rider_id %p", async (rid) => {
  const r = res(); await ctrl.offer(req({ body: { rider_id: rid } }), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(offers.offerToDriver).not.toHaveBeenCalled();
});

it("PUT /orders/next-day/settings is superadmin-only (the settings are global across cities)", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../../routes/adminRoutes.js"), "utf8");
  const line = src.split(/\r?\n/).find((l) => l.includes('router.put("/orders/next-day/settings"'));
  expect(line).toBeDefined();
  expect(line).toContain('authorize("superadmin")');
});
