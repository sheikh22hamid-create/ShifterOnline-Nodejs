jest.mock("../../config/db", () => ({ tbl_user: { findUnique: jest.fn() } }));
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
