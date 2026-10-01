jest.mock("../../config/db", () => ({
  tbl_coupon: { findUnique: jest.fn() },
  pkg_order: { count: jest.fn() },
}));
const prisma = require("../../config/db");
const { resolveCoupon, parseCouponValue } = require("../couponService");

const future = new Date(Date.now() + 5 * 86400000);
const baseCoupon = { id: 4, status: 1, cdate: future, cusefor: 0, ulimit: 2, min_amt: 100, c_value: "50" };

describe("parseCouponValue", () => {
  it("parses flat and percent values and rejects junk", () => {
    expect(parseCouponValue("50")).toEqual({ isPercent: false, value: 50 });
    expect(parseCouponValue(" 10% ")).toEqual({ isPercent: true, value: 10 });
    expect(parseCouponValue("")).toBeNull();
    expect(parseCouponValue("abc")).toBeNull();
    expect(parseCouponValue("-5")).toBeNull();
  });
});

describe("resolveCoupon", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_coupon.findUnique.mockResolvedValue({ ...baseCoupon });
    prisma.pkg_order.count.mockResolvedValue(0);
  });

  it("no coupon picked -> zero discount, no DB lookups", async () => {
    expect(await resolveCoupon({ couId: 0, uid: 1, fare: 300 })).toEqual({ ok: true, cou_id: 0, cou_amt: 0 });
    expect(prisma.tbl_coupon.findUnique).not.toHaveBeenCalled();
  });

  it("flat coupon discount is computed server-side", async () => {
    expect(await resolveCoupon({ couId: 4, uid: 1, fare: 300 })).toEqual({ ok: true, cou_id: 4, cou_amt: 50 });
  });

  it("percent coupon is a share of the fare", async () => {
    prisma.tbl_coupon.findUnique.mockResolvedValue({ ...baseCoupon, c_value: "10%" });
    expect((await resolveCoupon({ couId: 4, uid: 1, fare: 250 })).cou_amt).toBe(25);
  });

  it("discount never exceeds the fare", async () => {
    prisma.tbl_coupon.findUnique.mockResolvedValue({ ...baseCoupon, c_value: "500", min_amt: 0 });
    expect((await resolveCoupon({ couId: 4, uid: 1, fare: 120 })).cou_amt).toBe(120);
  });

  it.each([
    ["missing", null],
    ["inactive", { ...baseCoupon, status: 0 }],
    ["expired", { ...baseCoupon, cdate: new Date(Date.now() - 3 * 86400000) }],
    ["for another user", { ...baseCoupon, cusefor: 99 }],
    ["bad value", { ...baseCoupon, c_value: "free" }],
  ])("rejects a %s coupon", async (_label, row) => {
    prisma.tbl_coupon.findUnique.mockResolvedValue(row);
    const r = await resolveCoupon({ couId: 4, uid: 1, fare: 300 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_COUPON");
  });

  it("rejects when the usage limit is reached or the minimum order is not met", async () => {
    prisma.pkg_order.count.mockResolvedValue(2);
    expect((await resolveCoupon({ couId: 4, uid: 1, fare: 300 })).ok).toBe(false);
    prisma.pkg_order.count.mockResolvedValue(0);
    expect((await resolveCoupon({ couId: 4, uid: 1, fare: 60 })).ok).toBe(false);
  });
});
