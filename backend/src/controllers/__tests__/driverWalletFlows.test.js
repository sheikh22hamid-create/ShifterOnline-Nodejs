jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_user: { findFirst: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
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
