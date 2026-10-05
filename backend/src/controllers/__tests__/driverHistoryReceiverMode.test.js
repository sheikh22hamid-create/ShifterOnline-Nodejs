jest.mock("../../utils/advancePaymentTimer", () => ({ getAdvancePaymentTimerInfo: () => ({ is_advance_required: false, remaining_seconds: 0 }) }));
jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  setting: { findFirst: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  tbl_plan_benefit_log: { findMany: jest.fn() },
  tbl_premium_plan: { findUnique: jest.fn() },
  order_settlement: { findMany: jest.fn() },
}));
const prisma = require("../../config/db");
const { pkgHistoryDriver } = require("../driverOrderHistoryController");

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const row = { id: 7, o_status: "Processing", payment_status: 1, total_dcharge: 100, advance_payment: "20", admin_amount: 10, category: "Bike" };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ ...row }]);
  prisma.setting.findFirst.mockResolvedValue({ rider_commission: 10 });
  prisma.pkg_order_stops.findMany.mockResolvedValue([]);
  prisma.tbl_plan_benefit_log.findMany.mockResolvedValue([]);
});

async function run() {
  const res = mockRes();
  await pkgHistoryDriver({ body: { rid: 1, type: "past" } }, res);
  return res.json.mock.calls[0][0];
}

describe("pkgHistoryDriver receiver-mode lookup", () => {
  it("uses the receiver-mode cash amount for orders with a receiver settlement", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([{ order_id: 7 }]);
    const out = await run();
    expect(prisma.order_settlement.findMany).toHaveBeenCalledWith({ where: { order_id: { in: [7] }, payer: "receiver" }, select: { order_id: true } });
    expect(out.OrderHistory[0].cash_to_collect).toBe(100);
    expect(out.OrderHistory[0].trip_payment_summary.payment_by_user.advance_payment).toBe(0);
  });

  it("keeps normal numbers when the order has no receiver settlement", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([]);
    const out = await run();
    expect(out.OrderHistory[0].cash_to_collect).toBe(80);
  });

  it("keeps normal numbers and does not throw when the receiver lookup fails", async () => {
    prisma.order_settlement.findMany.mockRejectedValue(new Error("table missing"));
    const out = await run();
    expect(out.Result).toBe("true");
    expect(out.OrderHistory[0].cash_to_collect).toBe(80);
  });
});
