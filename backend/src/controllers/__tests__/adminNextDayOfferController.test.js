jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn() } }));
jest.mock("../../services/nextDayOfferService", () => ({
  listAvailableDailyDrivers: jest.fn(), offerToDriver: jest.fn(), listOffers: jest.fn(),
}));
jest.mock("../../services/nextDaySettings", () => ({
  getOfferSeconds: jest.fn().mockResolvedValue(60), getLiveTime: jest.fn().mockResolvedValue("14:00"),
  setOfferSeconds: jest.fn(), setLiveTime: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const offers = require("../../services/nextDayOfferService");
const ctrl = require("../adminNextDayOfferController");

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const req = (extra = {}) => ({ params: { id: "10" }, body: {}, user: { id: 9, role: "admin", city_id: 1 }, ...extra });
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
