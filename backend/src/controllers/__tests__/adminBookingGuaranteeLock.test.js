jest.mock("../../config/db", () => ({ tbl_user: { findUnique: jest.fn() }, $queryRaw: jest.fn() }));
jest.mock("../../services/bookingGuaranteeService", () => ({ setUserLock: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../services/bookingGuaranteeSettings", () => ({}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const guarantee = require("../../services/bookingGuaranteeService");
const ctrl = require("../adminBookingGuaranteeController");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
beforeEach(() => jest.clearAllMocks());

describe("lockUser / unlockUser", () => {
  it("a city admin can lock a customer of their own city", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 3 });
    const r = res();
    await ctrl.lockUser({ user: { role: "admin" }, scopedCityId: 3, params: { userId: "7" } }, r);
    expect(guarantee.setUserLock).toHaveBeenCalledWith(7, true);
    expect(r.json).toHaveBeenCalledWith({ success: true, message: "Customer locked" });
  });

  it("a city admin cannot touch a customer of another city", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    const r = res();
    await ctrl.unlockUser({ user: { role: "admin" }, scopedCityId: 3, params: { userId: "7" } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(guarantee.setUserLock).not.toHaveBeenCalled();
  });

  it("a superadmin can unlock any customer", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    const r = res();
    await ctrl.unlockUser({ user: { role: "superadmin" }, scopedCityId: undefined, params: { userId: "7" } }, r);
    expect(guarantee.setUserLock).toHaveBeenCalledWith(7, false);
  });

  it("rejects a bad id and an unknown customer", async () => {
    const bad = res();
    await ctrl.lockUser({ user: { role: "superadmin" }, params: { userId: "abc" } }, bad);
    expect(bad.status).toHaveBeenCalledWith(400);
    prisma.tbl_user.findUnique.mockResolvedValue(null);
    const none = res();
    await ctrl.lockUser({ user: { role: "superadmin" }, params: { userId: "7" } }, none);
    expect(none.status).toHaveBeenCalledWith(404);
  });
});

describe("searchCustomers", () => {
  const row = { id: 7n, name: "Ravi", mobile: "9876543210", city_id: 3, guarantee_locked: 1 };

  it("returns nothing for a query shorter than 2 characters without hitting the DB", async () => {
    const r = res();
    await ctrl.searchCustomers({ user: { role: "superadmin" }, query: { q: "a" } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("scopes a city admin to their own city", async () => {
    prisma.$queryRaw.mockResolvedValue([row]);
    const r = res();
    await ctrl.searchCustomers({ user: { role: "admin" }, scopedCityId: 3, query: { q: "ravi" } }, r);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain("u.city_id = ?");
    expect(sql.values).toContain(3);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 7, name: "Ravi", mobile: "9876543210", city_id: 3, guarantee_locked: true }] });
  });

  it("does not add a city filter for a superadmin", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await ctrl.searchCustomers({ user: { role: "superadmin" }, query: { q: "9876" } }, res());
    expect(prisma.$queryRaw.mock.calls[0][0].sql).not.toContain("AND u.city_id");
  });

  it("fails closed for a city admin without a city", async () => {
    const r = res();
    await ctrl.searchCustomers({ user: { role: "admin" }, scopedCityId: NaN, query: { q: "ravi" } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
