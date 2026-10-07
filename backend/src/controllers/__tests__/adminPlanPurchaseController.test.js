jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../config/db", () => ({
  tbl_user_plan_subscription: { count: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  tbl_premium_plan: { findMany: jest.fn() },
}));

const prisma = require("../../config/db");
const { listPlanPurchases } = require("../adminPlanPurchaseController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const sub = (o = {}) => ({
  id: 1, user_id: 5, plan_for: "USER", plan_id: 9, plan_type: "CUSTOMER_PREMIUM", plan_snapshot: JSON.stringify({ plan_name: "Gold (old name)" }),
  amount_paid: "299.00", points_used: 0, points_amount: "0.00", payment_txn_id: "pay_ABC", payment_method: "razorpay",
  wallet_bonus_credited: "50.00", start_date: new Date("2026-10-01"), end_date: new Date("2026-10-31"), status: "active",
  created_at: new Date("2026-10-01T10:00:00Z"), ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_user_plan_subscription.count.mockResolvedValue(1);
  prisma.tbl_user_plan_subscription.findMany.mockResolvedValue([sub()]);
  prisma.tbl_user_plan_subscription.aggregate.mockResolvedValue({ _sum: { amount_paid: "299.00" } });
  prisma.tbl_user.findMany.mockResolvedValue([{ id: 5, name: "Anita Sharma", mobile: 9876543210 }]);
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  prisma.tbl_premium_plan.findMany.mockResolvedValue([{ id: 9, plan_name: "Gold", price: "299.00" }]);
});

const run = async (query = {}, extra = {}) => {
  const r = res();
  await listPlanPurchases({ query, ...extra }, r);
  return { r, body: r.json.mock.calls[0][0] };
};
const whereOf = () => prisma.tbl_user_plan_subscription.findMany.mock.calls[0][0].where;

describe("admin plan purchase history", () => {
  it("lists a customer purchase with buyer, plan, amount, payment and dates", async () => {
    const { body } = await run();
    expect(body).toMatchObject({ success: true, total: 1, page: 1, limit: 25, summary: { total_amount_paid: 299 } });
    expect(body.data[0]).toMatchObject({
      id: 1,
      buyer: { id: 5, type: "USER", name: "Anita Sharma", mobile: "9876543210" },
      plan: { id: 9, name: "Gold", type: "CUSTOMER_PREMIUM", for: "USER", list_price: 299 },
      amount_paid: 299, payment_method: "razorpay", payment_txn_id: "pay_ABC", wallet_bonus_credited: 50, status: "active",
    });
    expect(body.data[0].purchased_at).toEqual(new Date("2026-10-01T10:00:00Z"));
  });

  it("shows a driver purchase with the driver's name and mobile", async () => {
    prisma.tbl_user_plan_subscription.findMany.mockResolvedValue([sub({ plan_for: "DRIVER", user_id: 22, plan_type: "DRIVER_FIRST" })]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 22, full_name: "Ravi Kumar", fmobile: "9000000001" }]);
    const { body } = await run();
    expect(body.data[0].buyer).toEqual({ id: 22, type: "DRIVER", name: "Ravi Kumar", mobile: "9000000001" });
  });

  it("falls back to the purchase-time plan name when the plan was deleted", async () => {
    prisma.tbl_premium_plan.findMany.mockResolvedValue([]);
    const { body } = await run();
    expect(body.data[0].plan).toMatchObject({ name: "Gold (old name)", list_price: null });
  });

  it("paginates in the database and caps the page size at 100", async () => {
    await run({ page: "3", limit: "500" });
    expect(prisma.tbl_user_plan_subscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 200, take: 100, orderBy: { id: "desc" } }));
  });

  it("filters by customer/driver, status and a date range (inclusive end of day)", async () => {
    await run({ plan_for: "driver", status: "expired", from: "2026-10-01", to: "2026-10-07" });
    expect(whereOf().AND).toEqual(expect.arrayContaining([
      { plan_for: "DRIVER" },
      { status: "expired" },
      { created_at: { gte: new Date("2026-10-01T00:00:00.000Z") } },
      { created_at: { lte: new Date("2026-10-07T23:59:59.999Z") } },
    ]));
  });

  it("ignores unknown filter values instead of failing", async () => {
    await run({ plan_for: "bogus", status: "weird", from: "not-a-date" });
    expect(whereOf()).toEqual({});
  });

  it("searches transaction id, buyer name and an exact mobile number", async () => {
    prisma.tbl_user.findMany.mockResolvedValueOnce([{ id: 5 }]);
    prisma.tbl_rider.findMany.mockResolvedValueOnce([{ id: 22 }]);
    await run({ q: "9876543210" });
    expect(prisma.tbl_user.findMany.mock.calls[0][0].where.OR).toEqual([{ name: { contains: "9876543210" } }, { mobile: 9876543210 }]);
    const or = whereOf().AND.find((c) => c.OR).OR;
    expect(or).toEqual(expect.arrayContaining([
      { payment_txn_id: { contains: "9876543210" } },
      { plan_for: "USER", user_id: { in: [5] } },
      { plan_for: "DRIVER", user_id: { in: [22] } },
    ]));
  });

  it("restricts city-scoped staff to their own city's customers and drivers", async () => {
    prisma.tbl_user.findMany.mockResolvedValueOnce([{ id: 5 }]);
    prisma.tbl_rider.findMany.mockResolvedValueOnce([{ id: 22 }]);
    await run({}, { scopedCityId: 3 });
    expect(prisma.tbl_user.findMany.mock.calls[0][0]).toEqual({ where: { city_id: 3 }, select: { id: true } });
    expect(whereOf().AND).toEqual(expect.arrayContaining([
      { OR: [{ plan_for: "USER", user_id: { in: [5] } }, { plan_for: "DRIVER", user_id: { in: [22] } }] },
    ]));
  });

  it("returns an empty list and a zero total when nothing matches", async () => {
    prisma.tbl_user_plan_subscription.count.mockResolvedValue(0);
    prisma.tbl_user_plan_subscription.findMany.mockResolvedValue([]);
    prisma.tbl_user_plan_subscription.aggregate.mockResolvedValue({ _sum: { amount_paid: null } });
    const { body } = await run();
    expect(body).toMatchObject({ success: true, total: 0, data: [], summary: { total_amount_paid: 0 } });
  });

  it("answers 500 with the error message when the database fails", async () => {
    prisma.tbl_user_plan_subscription.count.mockRejectedValue(new Error("db down"));
    const { r } = await run();
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "db down" });
  });
});
