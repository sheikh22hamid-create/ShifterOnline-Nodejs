jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_user: { findFirst: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  driver_withdraw_requests: { aggregate: jest.fn(), findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn(), fetchRazorpayOrder: jest.fn() }));

const prisma = require("../../config/db");
const { verifyRazorpayPayment, fetchRazorpayOrder } = require("../../utils/razorpayVerify");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("customerWalletController.addWallet driver block", () => {
  const { addWallet } = require("../customerWalletController");
  const driverBody = {
    mobile: "9999999999",
    amount: 100,
    wallet_type: "driver",
    razorpay_payment_id: "pay_1",
    razorpay_order_id: "order_1",
    razorpay_signature: "sig_1",
  };

  beforeEach(() => jest.clearAllMocks());

  it("refuses a driver recharge before verifying the payment with Razorpay", async () => {
    const res = mockRes();
    await addWallet({ body: driverBody }, res);
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: "Drivers cannot add money to their wallet." }));
  });

  it("still allows a customer recharge", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 15, wallet: 50 });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    prisma.tbl_user.update.mockResolvedValue({ wallet: 150 });
    const res = mockRes();
    await addWallet({ body: { ...driverBody, wallet_type: "user" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });
});

describe("customerWalletController.withdrawWallet", () => {
  const { withdrawWallet } = require("../customerWalletController");
  const driverBody = { mobile: "9999999999", amount: 100, wallet_type: "driver" };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
  });

  it("rejects a driver withdraw when balance is exactly 0", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "0.00" });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(prisma.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("rejects a driver withdraw when balance is already negative", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-20.00" });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(prisma.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("debits atomically and writes the ledger row in the same transaction", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "500.00" });
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(prisma.tbl_rider.updateMany).toHaveBeenCalledWith({
      where: { id: 7, wallet_balance: { gte: 100 } },
      data: { wallet_balance: { decrement: 100 } },
    });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user_id: 7, amount: 100, type: "debit" }) })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true" }));
  });

  // Code review finding: NewBalance must come from a fresh in-transaction
  // read, not `currentBalance - amount` arithmetic - that stale math is
  // wrong whenever the real balance moved between the initial read and this
  // transaction committing (e.g. a commission debit from tripLifecycle
  // landed in the gap), even though this withdraw itself succeeded validly.
  it("reports the fresh post-debit balance, not stale pre-transaction arithmetic", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "500.00" });
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 1 });
    // Simulates another debit (e.g. a commission charge) landing between the
    // initial read (500) and this withdrawal's transaction committing: the
    // real balance after this withdraw's own -100 is 350, not 400.
    prisma.tbl_rider.findFirst
      .mockResolvedValueOnce({ id: 7, wallet_balance: "500.00" })
      .mockResolvedValueOnce({ id: 7, wallet_balance: "350.00" });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ NewBalance: 350 }));
  });

  it("reports insufficient balance instead of over-withdrawing when a concurrent request already spent the balance", async () => {
    // Simulates two concurrent withdraw calls both reading wallet_balance=100
    // before either commits: the first's transaction wins the atomic
    // updateMany; this second call's updateMany then matches 0 rows because
    // the WHERE's wallet_balance >= amount no longer holds against the
    // already-decremented row.
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "100.00" });
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await withdrawWallet({ body: { ...driverBody, amount: 100 } }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "402", Result: "false" }));
  });
});

jest.mock("../../services/driverWalletSettings", () => ({ getDriverMaxDueLimit: jest.fn() }));

describe("customerWalletController.walletHistory outstanding-due fields", () => {
  const { walletHistory } = require("../customerWalletController");
  const { getDriverMaxDueLimit } = require("../../services/driverWalletSettings");

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_wallet_history.findMany.mockResolvedValue([]);
    prisma.driver_withdraw_requests.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.driver_withdraw_requests.findFirst.mockResolvedValue(null);
    getDriverMaxDueLimit.mockResolvedValue(100);
  });

  async function request(riderOverrides) {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "0.00", ...riderOverrides });
    const res = mockRes();
    await walletHistory({ body: { mobile: "9000000000", wallet_type: "driver" } }, res);
    return res.json.mock.calls[0][0];
  }

  it("balance = 0: cannot withdraw, cannot clear due, limit not reached", async () => {
    const result = await request({ wallet_balance: "0.00" });
    expect(result.can_withdraw).toBe(false);
    expect(result.can_clear_due).toBe(false);
    expect(result.outstanding_due).toBe("0.00");
    expect(result.due_limit_reached).toBe(false);
  });

  it("balance = -70 (within limit): cannot withdraw, can clear due, limit not reached", async () => {
    const result = await request({ wallet_balance: "-70.00" });
    expect(result.can_withdraw).toBe(false);
    expect(result.can_clear_due).toBe(true);
    expect(result.outstanding_due).toBe("70.00");
    expect(result.max_due_limit).toBe(100);
    expect(result.due_limit_reached).toBe(false);
  });

  it("balance = -100 (at limit): due_limit_reached is true", async () => {
    const result = await request({ wallet_balance: "-100.00" });
    expect(result.can_clear_due).toBe(true);
    expect(result.due_limit_reached).toBe(true);
  });

  it("balance = 690 (positive): can withdraw, cannot clear due", async () => {
    const result = await request({ wallet_balance: "690.00" });
    expect(result.can_withdraw).toBe(true);
    expect(result.can_clear_due).toBe(false);
    expect(result.outstanding_due).toBe("0.00");
  });

  it("does not add these fields for a customer wallet", async () => {
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 2, wallet: "90.00" });
    const res = mockRes();
    await walletHistory({ body: { mobile: "9000000000", wallet_type: "user" } }, res);
    const result = res.json.mock.calls[0][0];
    expect(result).not.toHaveProperty("outstanding_due");
    expect(result).not.toHaveProperty("can_withdraw");
    expect(getDriverMaxDueLimit).not.toHaveBeenCalled();
  });
});

describe("customerWalletController.createClearDueOrder", () => {
  const { createClearDueOrder } = require("../customerWalletController");
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAZORPAY_KEY_ID = "key_id";
    process.env.RAZORPAY_KEY_SECRET = "key_secret";
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refuses to create an order when there is no outstanding due", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "50.00" });
    const res = mockRes();
    await createClearDueOrder({ body: { mobile: "9000000000" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("refuses to create an order when balance is exactly 0", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "0.00" });
    const res = mockRes();
    await createClearDueOrder({ body: { mobile: "9000000000" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("creates a Razorpay order for exactly the server-computed due amount, ignoring any client-sent amount", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order_due_1", amount: 7000, currency: "INR" }),
    });
    const res = mockRes();
    await createClearDueOrder({ body: { mobile: "9000000000", amount: 999999 } }, res);
    const [, options] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody.amount).toBe(7000); // 70.00 rupees in paise, not the client's 999999
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", OrderId: "order_due_1", due_amount: 70 }));
  });
});

describe("customerWalletController.clearOutstandingDue", () => {
  const { clearOutstandingDue } = require("../customerWalletController");
  const body = {
    mobile: "9000000000",
    razorpay_payment_id: "pay_due_1",
    razorpay_order_id: "order_due_1",
    razorpay_signature: "sig_1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    // Default: an order that legitimately belongs to rider 7's clear-due flow.
    fetchRazorpayOrder.mockResolvedValue({ id: "order_due_1", amount: 7000, receipt: "cleardue_7_1758610000000" });
  });

  it("credits the wallet by exactly the paid amount once payment and order-ownership are verified", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ wallet_balance: "0.00" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(fetchRazorpayOrder).toHaveBeenCalledWith("order_due_1");
    expect(verifyRazorpayPayment).toHaveBeenCalledWith(expect.objectContaining({ expectedAmountRupees: 70 }));
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 70, type: "credit", remark: "Outstanding Due Cleared", razorpay_payment_id: "pay_due_1" }) })
    );
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet_balance: { increment: 70 } } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });

  it("refuses when Razorpay verification fails", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment Verification Failed!" });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("rejects a replayed payment_id via the existing unique-constraint guard", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.tbl_wallet_history.create.mockRejectedValue(p2002);
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: "This payment has already been credited." }));
  });

  // Security regression (found in code review): a driver could previously pay
  // for an unrelated/oversized order via the generic /wallet/create-order
  // endpoint and post its payment details here with a self-chosen
  // `due_amount`, crediting their wallet by any amount they paid for -
  // completely bypassing the "drivers cannot self-recharge" rule (Task 2).
  it("rejects a payment for an order that doesn't carry this driver's clear-due receipt (self-recharge bypass attempt)", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    fetchRazorpayOrder.mockResolvedValue({ id: "order_1", amount: 500000, receipt: `wallet_${Date.now()}` });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("rejects a clear-due order receipt that belongs to a different driver", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    fetchRazorpayOrder.mockResolvedValue({ id: "order_due_1", amount: 7000, receipt: "cleardue_999_1758610000000" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("clamps the credit to the actual outstanding due, never crediting more than what's owed even if the order paid more", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    // Order was legitimately created for the due, but paid amount somehow
    // exceeds the current due (e.g. balance improved between order creation
    // and payment) - credit must still be capped at the real due, not the
    // paid amount, so this can never push the wallet positive.
    fetchRazorpayOrder.mockResolvedValue({ id: "order_due_1", amount: 500000, receipt: "cleardue_7_1758610000000" });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ wallet_balance: "0.00" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 70 }) })
    );
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet_balance: { increment: 70 } } });
  });

  it("rejects when the driver has no outstanding due left to clear, even with a valid captured payment", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "0.00" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("writes the ledger row and credits the balance in the same transaction", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ wallet_balance: "0.00" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});
