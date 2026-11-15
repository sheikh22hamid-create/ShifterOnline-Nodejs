jest.mock("../../config/db", () => ({ tbl_user: { findMany: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../services/goodsTypeService", () => ({ formatGoodsType: () => "" }));

const prisma = require("../../config/db");
const { formatPkgOrderForDriver, loadBookingUsers } = require("../driverOrderHistoryController");

const row = (o = {}) => ({
  id: 77, uid: 5, rid: 9, o_status: "Processing", order_status: 1, d_charge: 100, total_dcharge: 100,
  pick_name: "Pickup Person", pmobile: "9000000001", drop_name: "Drop Person", dmobile: "9000000002",
  advance_payment: "0", payment_status: 1, ...o,
});
const ctx = (extra = {}) => ({ stopsByOrder: {}, benefitByOrder: {}, planNameCache: {}, globalComm: 10, receiverModeByOrder: {}, ...extra });

describe("loadBookingUsers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads the account name and mobile once per user, mobile as a plain integer string", async () => {
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 5, name: "  Asha Verma ", mobile: 9999900009 }]);
    const out = await loadBookingUsers([5, 5, "5", 0, null]);
    expect(prisma.tbl_user.findMany).toHaveBeenCalledWith({ where: { id: { in: [5] } }, select: { id: true, name: true, mobile: true } });
    expect(out).toEqual({ 5: { name: "Asha Verma", mobile: "9999900009" } });
  });

  it("returns nothing (and never throws) when the lookup fails or there are no ids", async () => {
    expect(await loadBookingUsers([])).toEqual({});
    prisma.tbl_user.findMany.mockRejectedValue(new Error("db down"));
    expect(await loadBookingUsers([5])).toEqual({});
  });
});

describe("formatPkgOrderForDriver booking user", () => {
  it("adds the booking account's name and mobile, separate from the pickup / drop contacts", () => {
    const out = formatPkgOrderForDriver(row(), ctx({ bookingUsersById: { 5: { name: "Asha Verma", mobile: "9999900009" } } }));
    expect(out.booking_user_name).toBe("Asha Verma");
    expect(out.booking_user_mobile).toBe("9999900009");
    // existing contact fields are untouched
    expect(out.pick_name).toBe("Pickup Person");
    expect(out.customer_pmobile).toBe("9000000001");
    expect(out.customer_dmobile).toBe("9000000002");
  });

  it("falls back to empty strings when the account could not be read", () => {
    const out = formatPkgOrderForDriver(row(), ctx());
    expect(out.booking_user_name).toBe("");
    expect(out.booking_user_mobile).toBe("");
  });
});
