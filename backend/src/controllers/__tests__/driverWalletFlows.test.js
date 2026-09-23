jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_user: { findFirst: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  driver_withdraw_requests: { aggregate: jest.fn(), findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));

const prisma = require("../../config/db");
const { verifyRazorpayPayment } = require("../../utils/razorpayVerify");

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
