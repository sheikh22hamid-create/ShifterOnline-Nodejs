jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn() } }));
jest.mock("../../services/dailyDriverOrderAssign", () => ({ isApplicable: jest.fn(), listAvailableDailyDrivers: jest.fn() }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../../services/dailyDriverOrderAssign");
const { listForOrder } = require("../adminDailyDriverOrderController");

const mockRes = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const req = (o = {}) => ({ params: { id: "10" }, user: { role: "superadmin" }, scopedCityId: null, ...o });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 10, city_id: 1, booking_type: 3 });
  svc.isApplicable.mockResolvedValue(true);
  svc.listAvailableDailyDrivers.mockResolvedValue([{ id: 7 }]);
});

describe("GET /orders/:id/daily-drivers", () => {
  it("returns the available Daily Drivers for an applicable order", async () => {
    const res = mockRes();
    await listForOrder(req(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { applicable: true, drivers: [{ id: 7 }] } });
  });

  it("says not applicable (and lists nobody) for other orders", async () => {
    svc.isApplicable.mockResolvedValue(false);
    const res = mockRes();
    await listForOrder(req(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { applicable: false, drivers: [] } });
    expect(svc.listAvailableDailyDrivers).not.toHaveBeenCalled();
  });

  it("a city admin cannot read another city's order", async () => {
    const res = mockRes();
    await listForOrder(req({ user: { role: "admin" }, scopedCityId: 2 }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("a city admin with no city is refused (NaN scope fails closed)", async () => {
    const res = mockRes();
    await listForOrder(req({ user: { role: "admin" }, scopedCityId: NaN }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects a bad id and an unknown order", async () => {
    let res = mockRes();
    await listForOrder(req({ params: { id: "abc" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    prisma.pkg_order.findUnique.mockResolvedValue(null);
    res = mockRes();
    await listForOrder(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
