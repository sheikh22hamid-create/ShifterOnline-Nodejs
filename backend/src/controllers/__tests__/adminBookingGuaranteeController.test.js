jest.mock("../../config/db", () => ({
  booking_guarantee_case: { findMany: jest.fn() },
  booking_guarantee_audit: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn(), findFirst: jest.fn() },
  $queryRaw: jest.fn(),
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
    await ctrl.listCases({ query: { status: "open", limit: "10" }, user: { role: "superadmin" }, scopedCityId: null }, r);
    expect(prisma.booking_guarantee_case.findMany).toHaveBeenCalledWith({ where: { status: "open" }, orderBy: { id: "desc" }, take: 10 });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [expect.objectContaining({ order_id: 500 })] });
  });
  it("a city-scoped admin gets rows from the scoped join query, not findMany", async () => {
    prisma.$queryRaw.mockResolvedValue([row(2, 501)]);
    const r = res();
    await ctrl.listCases({ query: {}, user: { role: "admin" }, scopedCityId: 3 }, r);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.booking_guarantee_case.findMany).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [expect.objectContaining({ order_id: 501 })] });
  });
  it("a superadmin without a city filter is unscoped", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([]);
    await ctrl.listCases({ query: {}, user: { role: "superadmin" }, scopedCityId: null }, res());
    expect(prisma.booking_guarantee_case.findMany).toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it("a non-superadmin with no city gets 403 and no DB read", async () => {
    const r = res();
    await ctrl.listCases({ query: {}, user: { role: "admin" }, scopedCityId: NaN }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.booking_guarantee_case.findMany).not.toHaveBeenCalled();
  });
  it("an absurd limit is clamped", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([]);
    await ctrl.listCases({ query: { limit: "99999" }, user: { role: "superadmin" }, scopedCityId: null }, res());
    expect(prisma.booking_guarantee_case.findMany.mock.calls[0][0].take).toBe(200);
  });
});

describe("caseAudit", () => {
  const admin = { role: "admin" };
  it("rejects a non-numeric order id", async () => {
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "abc" }, query: {}, user: { role: "superadmin" }, scopedCityId: null }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  it("superadmin unscoped: returns events oldest first, no ownership lookup", async () => {
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([{ id: 1, event: "opened" }]);
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "500" }, query: {}, user: { role: "superadmin" }, scopedCityId: null }, r);
    expect(prisma.pkg_order.findFirst).not.toHaveBeenCalled();
    expect(prisma.booking_guarantee_audit.findMany).toHaveBeenCalledWith({ where: { order_id: 500 }, orderBy: { id: "asc" } });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1, event: "opened" }] });
  });
  it("scoped admin, own-city order: ownership checked then events returned", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 500 });
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([{ id: 1, event: "opened" }]);
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "500" }, query: {}, user: admin, scopedCityId: 3 }, r);
    expect(prisma.pkg_order.findFirst).toHaveBeenCalledWith({ where: { id: 500, city_id: 3 }, select: { id: true } });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1, event: "opened" }] });
  });
  it("scoped admin, other-city order: 404 and no audit read", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "500" }, query: {}, user: admin, scopedCityId: 3 }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "Not found" });
    expect(prisma.booking_guarantee_audit.findMany).not.toHaveBeenCalled();
  });
  it("non-superadmin with no city: 403 and no DB reads", async () => {
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "500" }, query: {}, user: admin, scopedCityId: NaN }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(prisma.pkg_order.findFirst).not.toHaveBeenCalled();
    expect(prisma.booking_guarantee_audit.findMany).not.toHaveBeenCalled();
  });
});
