jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({}));
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: jest.fn() }) }) }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const svc = require("../settlementService");
const sweep = require("../settlementSweep");

const T0 = new Date("2026-11-15T10:00:00Z").getTime();
const row = (o = {}) => ({
  id: 1, order_id: 50, uid: 7, rid: 9, amount_due: 100, fare: 100,
  commission_amount: 10, per_trip_charge: 0, prepaid_amount: 0,
  status: "pending", method: null, wallet_effect: "none", effect_seq: 0, payer: "customer", customer_choice: null,
  pending_since: new Date(T0), ...o,
});
const AFTER_15 = T0 + 15 * 60000;

function setup(current, order = { o_status: "Completed" }) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: current.id }]);
  prisma.order_settlement.findUnique.mockResolvedValue(current);
  prisma.order_settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.pkg_order.findUnique.mockResolvedValue(order);
}

describe("autoReceiveSecondsLeft", () => {
  it("counts down from the server-saved pending_since and never goes negative", () => {
    expect(svc.autoReceiveSecondsLeft(row(), 15, T0)).toBe(900);
    expect(svc.autoReceiveSecondsLeft(row(), 15, T0 + 2000)).toBe(898);
    expect(svc.autoReceiveSecondsLeft(row(), 15, T0 + 60 * 60000)).toBe(0);
  });
  it.each([
    ["switched off (0 minutes)", row(), 0],
    ["already received", row({ status: "cash_received" }), 15],
    ["disputed", row({ status: "disputed" }), 15],
    ["customer is paying online", row({ customer_choice: "online" }), 15],
    ["receiver pays", row({ payer: "receiver" }), 15],
  ])("no countdown when %s", (_n, s, minutes) => {
    expect(svc.autoReceiveSecondsLeft(s, minutes, T0)).toBeNull();
  });
  it("a customer who chose cash still counts down", () => {
    expect(svc.autoReceiveSecondsLeft(row({ customer_choice: "cash" }), 15, T0)).toBe(900);
  });
});

describe("autoMarkReceived", () => {
  it("after the countdown: same Received effect as the driver's tap, attributed to the system", async () => {
    setup(row());
    const out = await svc.autoMarkReceived({ settlementId: 1, minutes: 15, now: AFTER_15 });
    expect(out.alreadyDone).toBeUndefined();
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ status: "cash_received", method: "cash", wallet_effect: "cash", confirmed_by: "system" }),
    });
    // commission is debited from the driver wallet exactly once, under the usual idempotency key
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({ type: "debit", amount: 10, payment_id: "settle:1:1:apply:0" });
    expect(prisma.order_settlement_event.create.mock.calls[0][0].data).toMatchObject({ actor: "system", to_status: "cash_received" });
  });

  it.each([
    ["the countdown is not over", row(), AFTER_15 - 1000],
    ["the driver already confirmed it", row({ status: "cash_received" }), AFTER_15],
    ["it is under dispute", row({ status: "disputed" }), AFTER_15],
    ["the customer is paying online", row({ customer_choice: "online" }), AFTER_15],
    ["the receiver is paying", row({ payer: "receiver" }), AFTER_15],
  ])("does nothing when %s", async (_n, s, now) => {
    setup(s);
    const out = await svc.autoMarkReceived({ settlementId: 1, minutes: 15, now });
    expect(out.alreadyDone).toBe(true);
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("does nothing for a cancelled order or when the feature is off", async () => {
    setup(row(), { o_status: "Cancelled" });
    expect((await svc.autoMarkReceived({ settlementId: 1, minutes: 15, now: AFTER_15 })).alreadyDone).toBe(true);
    setup(row());
    expect((await svc.autoMarkReceived({ settlementId: 1, minutes: 0, now: AFTER_15 })).alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("a second run after the first processes nothing again (no duplicate ledger rows)", async () => {
    setup(row());
    await svc.autoMarkReceived({ settlementId: 1, minutes: 15, now: AFTER_15 });
    prisma.order_settlement.findUnique.mockResolvedValue(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1 }));
    const again = await svc.autoMarkReceived({ settlementId: 1, minutes: 15, now: AFTER_15 + 30000 });
    expect(again.alreadyDone).toBe(true);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });
});

describe("settlementSweep.autoReceiveDue", () => {
  const settings = (enabled, minutes) => prisma.app_settings.findMany.mockResolvedValue([
    { setting_key: "settlement_enabled", setting_value: enabled ? "1" : "0" },
    { setting_key: "settlement_auto_receive_minutes", setting_value: String(minutes) },
  ]);

  it("does nothing while settlements are off or auto-receive is set to 0", async () => {
    setup(row());
    settings(false, 15);
    expect(await sweep.autoReceiveDue(new Date(AFTER_15))).toEqual({ received: 0, failed: 0 });
    settings(true, 0);
    expect(await sweep.autoReceiveDue(new Date(AFTER_15))).toEqual({ received: 0, failed: 0 });
    expect(prisma.order_settlement.findMany).not.toHaveBeenCalled();
  });

  it("selects only pending, non-receiver, non-online settlements older than the countdown", async () => {
    setup(row());
    settings(true, 15);
    prisma.order_settlement.findMany.mockResolvedValue([]);
    await sweep.autoReceiveDue(new Date(AFTER_15));
    const q = prisma.order_settlement.findMany.mock.calls[0][0];
    expect(q.where.status).toBe("pending");
    expect(q.where.pending_since.lte).toEqual(new Date(T0));
    expect(q.where.payer).toEqual({ not: "receiver" });
    expect(q.where.OR).toEqual([{ customer_choice: null }, { customer_choice: { not: "online" } }]);
  });

  it("a failure is logged and the rest still run; the failed one stays pending for the next run", async () => {
    setup(row());
    settings(true, 15);
    prisma.order_settlement.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.$transaction
      .mockImplementationOnce(() => Promise.reject(new Error("db blip")))
      .mockImplementation((cb) => cb(prisma));
    prisma.order_settlement.findUnique.mockImplementation(({ where }) => Promise.resolve(row({ id: where.id })));
    prisma.$queryRaw.mockImplementation(() => Promise.resolve([{ id: 2 }]));
    const out = await sweep.autoReceiveDue(new Date(AFTER_15));
    expect(out).toEqual({ received: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("settlement 1"), expect.any(Error));
  });
});
