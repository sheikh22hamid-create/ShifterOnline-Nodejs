// advancePayment verifies the Razorpay payment against the amount the CLIENT
// claims, so a customer could pay Rs1 against a Rs60 advance and still get
// payment_status = 1 - the ride then settles as if the full advance had been
// collected (driver cash reduced, driver credited from the platform) while the
// platform only ever received Rs1.
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock("../../config/firebase", () => ({ sendPushNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../services/pricingEngine", () => ({}));
jest.mock("../../services/dispatchManager", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({}));
jest.mock("../../services/orderDestinationService", () => ({}));
jest.mock("../../services/orderPickupService", () => ({}));
jest.mock("../../services/orderStopsService", () => ({}));

const prisma = require("../../config/db");
const { advancePayment } = require("../orderController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const body = (amount) => ({ order_id: 77, amount, razorpay_payment_id: "pay_1", razorpay_order_id: "order_1", razorpay_signature: "sig" });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 77, uid: 5, rid: 0, o_status: "Processing", order_status: 1, payment_status: 0 });
  prisma.$queryRaw.mockResolvedValue([{ advance_payment: "60" }]);
  prisma.tbl_user.findUnique.mockResolvedValue({ id: 5, mobile: 9999999999 });
  prisma.tbl_user.update.mockResolvedValue({ wallet: 100 });
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.pkg_order.update.mockResolvedValue({});
});

const markedPaid = () => prisma.pkg_order.update.mock.calls.some(([a]) => a?.data?.payment_status === 1);

describe("orderController.advancePayment amount check", () => {
  it("pays the advance in full: marks the order paid and credits the wallet", async () => {
    const r = res();
    await advancePayment({ body: body(60) }, r);
    expect(markedPaid()).toBe(true);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { increment: 60 } } });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true, payment_status: 1 }));
  });

  it("an underpayment is credited to the wallet (the money was received) but does NOT mark the advance paid", async () => {
    const r = res();
    await advancePayment({ body: body(1) }, r);
    expect(markedPaid()).toBe(false);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { increment: 1 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, ResponseCode: "401" }));
  });

  it("an overpayment still counts as paid and the surplus stays in the wallet", async () => {
    const r = res();
    await advancePayment({ body: body(100) }, r);
    expect(markedPaid()).toBe(true);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { increment: 100 } } });
  });

  it("an order with no advance due is not blocked by the amount check", async () => {
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: "0" }]);
    const r = res();
    await advancePayment({ body: body(10) }, r);
    expect(markedPaid()).toBe(true);
  });

  describe("payment lands after the advance-payment timeout already cancelled the order", () => {
    beforeEach(() => {
      prisma.pkg_order.findUnique.mockResolvedValue({ id: 77, uid: 5, rid: 9, o_status: "Cancelled", order_status: 4, payment_status: 0 });
    });

    it("the money Razorpay captured is credited to the wallet and written to the ledger", async () => {
      const r = res();
      await advancePayment({ body: body(60) }, r);
      expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
      expect(prisma.tbl_wallet_history.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ user_id: 5, amount: 60, type: "credit", order_id: 77, razorpay_payment_id: "pay_1" })
      );
      expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { increment: 60 } } });
    });

    it("does not revive the cancelled order or notify the driver", async () => {
      await advancePayment({ body: body(60) }, res());
      expect(markedPaid()).toBe(false);
      expect(prisma.tbl_rider.findUnique).not.toHaveBeenCalled();
    });

    it("tells the app the order is cancelled but the amount is safe in the wallet", async () => {
      const r = res();
      await advancePayment({ body: body(60) }, r);
      expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
        Result: false, ResponseCode: "401", order_id: 77, payment_status: 0, user_wallet_balance: 100,
        ResponseMsg: expect.stringContaining("added to your wallet"),
      }));
    });

    it("a retried call with the same payment id is not credited twice", async () => {
      prisma.tbl_wallet_history.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
      const r = res();
      await advancePayment({ body: body(60) }, r);
      expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    });
  });

  it("rounds the due like the rest of the flow (Rs59.6 advance accepts Rs60)", async () => {
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: "59.6" }]);
    await advancePayment({ body: body(60) }, res());
    expect(markedPaid()).toBe(true);
  });
});
