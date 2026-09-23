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
