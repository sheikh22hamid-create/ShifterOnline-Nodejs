jest.mock("../../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock("../../services/freeBookingAdminService", () => ({
  resolveCityId: jest.fn((user, q = {}, b = {}) => {
    const raw = q.city_id ?? b.city_id;
    return raw != null ? Number(raw) : null;
  }),
  findOrderInCity: jest.fn(),
  listOrders: jest.fn(),
  assertUserInCity: jest.fn(),
}));
jest.mock("../../services/freeBookingService", () => ({ voidOrder: jest.fn(), setUserLock: jest.fn() }));

const admin = require("../../services/freeBookingAdminService");
const freeBookingService = require("../../services/freeBookingService");
const logger = require("../../utils/logger");
const ctrl = require("../adminFreeBookingController");

const mkRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const mkReq = (user, extra = {}) => ({ user, query: {}, body: {}, params: {}, ...extra });

beforeEach(() => jest.clearAllMocks());

describe("admin with no city", () => {
  const user = { id: 1, role: "admin", city_id: null };
  it("is refused (403) on void, lock and orders", async () => {
    for (const [fn, extra] of [
      [ctrl.voidOrder, { params: { id: "5" } }],
      [ctrl.lockUser, { params: { userId: "7" } }],
      [ctrl.listOrders, {}],
    ]) {
      const res = mkRes();
      await fn(mkReq(user, extra), res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(freeBookingService.voidOrder).not.toHaveBeenCalled();
    expect(freeBookingService.setUserLock).not.toHaveBeenCalled();
    expect(admin.listOrders).not.toHaveBeenCalled();
  });
});

describe("voidOrder", () => {
  it("404s a booking of another city and does not void it", async () => {
    admin.findOrderInCity.mockResolvedValue(null);
    const res = mkRes();
    await ctrl.voidOrder(mkReq({ id: 1, role: "admin", city_id: 3 }, { params: { id: "5" } }), res);
    expect(admin.findOrderInCity).toHaveBeenCalledWith("5", 3);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(freeBookingService.voidOrder).not.toHaveBeenCalled();
  });
  it("lets a superadmin void without a city lookup", async () => {
    freeBookingService.voidOrder.mockResolvedValue(true);
    const res = mkRes();
    await ctrl.voidOrder(mkReq({ id: 1, role: "superadmin" }, { params: { id: "5" } }), res);
    expect(admin.findOrderInCity).not.toHaveBeenCalled();
    expect(freeBookingService.voidOrder).toHaveBeenCalledWith("5");
    expect(logger.info).toHaveBeenCalledWith("free-booking void order=5 by admin=1");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe("listOrders", () => {
  it("scopes an executive to their own city", async () => {
    admin.listOrders.mockResolvedValue([]);
    const res = mkRes();
    await ctrl.listOrders(mkReq({ id: 2, role: "executive", city_id: 4 }, { query: { city_id: "9", status: "open" } }), res);
    expect(admin.listOrders).toHaveBeenCalledWith({ unrestricted: false, cityId: 4, status: "open" });
  });
});

describe("lock", () => {
  it("logs the admin id", async () => {
    admin.assertUserInCity.mockResolvedValue();
    freeBookingService.setUserLock.mockResolvedValue();
    const res = mkRes();
    await ctrl.lockUser(mkReq({ id: 1, role: "admin", city_id: 3 }, { params: { userId: "7" } }), res);
    expect(admin.assertUserInCity).toHaveBeenCalledWith("7", 3, false);
    expect(logger.info).toHaveBeenCalledWith("free-booking lock user=7 by admin=1");
  });
});
