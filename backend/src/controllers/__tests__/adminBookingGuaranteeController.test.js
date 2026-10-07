jest.mock("../../config/db", () => ({
  booking_guarantee_case: { findMany: jest.fn() },
  booking_guarantee_audit: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
}));
jest.mock("../../services/bookingGuaranteeSettings", () => ({
  getAssignWindowMinutes: jest.fn().mockResolvedValue(10),
  setAssignWindowMinutes: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../../services/bookingGuaranteeSettings");
const ctrl = require("../adminBookingGuaranteeController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("settings", () => {
  it("getSettings returns the window", async () => {
    const r = res();
    await ctrl.getSettings({}, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { assign_minutes: 10 } });
  });
  it("saveSettings stores and echoes the value", async () => {
    settings.setAssignWindowMinutes.mockResolvedValue(15);
    const r = res();
    await ctrl.saveSettings({ body: { assign_minutes: "15" } }, r);
    expect(settings.setAssignWindowMinutes).toHaveBeenCalledWith("15");
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { assign_minutes: 15 } });
  });
  it("saveSettings turns a validation error into its 400", async () => {
    settings.setAssignWindowMinutes.mockRejectedValue(Object.assign(new Error("bad"), { statusCode: 400 }));
    const r = res();
    await ctrl.saveSettings({ body: { assign_minutes: 0 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "bad" });
  });
});

describe("listCases", () => {
  const row = (id, order_id) => ({ id, order_id, uid: 1, status: "open", compensation_amount: "100", deadline_at: new Date(), opened_at: new Date() });

  it("open filter + limit are applied, newest first", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([row(1, 500)]);
    const r = res();
    await ctrl.listCases({ query: { status: "open", limit: "10" } }, r);
    expect(prisma.booking_guarantee_case.findMany).toHaveBeenCalledWith({ where: { status: "open" }, orderBy: { id: "desc" }, take: 10 });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [expect.objectContaining({ order_id: 500 })] });
  });
  it("a city-scoped admin only sees cases for orders in their city", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([row(1, 500), row(2, 501)]);
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 501 }]);
    const r = res();
    await ctrl.listCases({ query: {}, scopedCityId: 3 }, r);
    expect(prisma.pkg_order.findMany).toHaveBeenCalledWith({ where: { id: { in: [500, 501] }, city_id: 3 }, select: { id: true } });
    expect(r.json.mock.calls[0][0].data.map((c) => c.order_id)).toEqual([501]);
  });
  it("an absurd limit is clamped", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([]);
    await ctrl.listCases({ query: { limit: "99999" } }, res());
    expect(prisma.booking_guarantee_case.findMany.mock.calls[0][0].take).toBe(200);
  });
});

describe("caseAudit", () => {
  it("rejects a non-numeric order id", async () => {
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "abc" }, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  it("returns the events oldest first", async () => {
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([{ id: 1, event: "opened" }]);
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "500" }, query: {} }, r);
    expect(prisma.booking_guarantee_audit.findMany).toHaveBeenCalledWith({ where: { order_id: 500 }, orderBy: { id: "asc" } });
  });
});
