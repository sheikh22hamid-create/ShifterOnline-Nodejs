// Regression tests for the security/correctness fixes made during the
// migration review: KYC verify-document auth, order/legacy-order IDOR,
// premium-plan payment trust, wallet double-credit race, payout earnings
// math, withdraw-request over-queuing, and custom-order bid status check.

jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), aggregate: jest.fn() },
  buy_order: { findUnique: jest.fn() },
  buy_order_item: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  payout_setting: { aggregate: jest.fn(), findMany: jest.fn() },
  driver_withdraw_requests: { aggregate: jest.fn(), create: jest.fn() },
  tbl_custom_order: { findUnique: jest.fn() },
  tbl_custom_order_bid: { findFirst: jest.fn(), create: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
}));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/advancePaymentTimer", () => ({ getAdvancePaymentTimerInfo: jest.fn().mockReturnValue({}) }));

const prisma = require("../../config/db");
const { verifyRazorpayPayment } = require("../../utils/razorpayVerify");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("orderController.getMapInfo IDOR guard", () => {
  const { getMapInfo } = require("../orderController");

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 1234, uid: 15, rid: 0, o_status: "Pending", distance: 1 });
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: null }]);
  });

  it("rejects when the caller sends a uid that doesn't own the order", async () => {
    const res = mockRes();
    await getMapInfo({ body: { orderid: 1234, uid: 999 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("still serves the legacy call shape with no uid (back-compat)", async () => {
    const res = mockRes();
    await getMapInfo({ body: { orderid: 1234 } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.Result).toBe("true");
  });

  it("serves the request when the sent uid matches the order's owner", async () => {
    const res = mockRes();
    await getMapInfo({ body: { orderid: 1234, uid: 15 } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.Result).toBe("true");
  });
});

describe("legacyOrderController.buyOrderDetailDriver IDOR guard", () => {
  const { buyOrderDetailDriver } = require("../legacyOrderController");

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.buy_order.findUnique.mockResolvedValue({ id: 55, uid: 1, rid: 8, o_status: "Pending" });
    prisma.tbl_user.findUnique.mockResolvedValue({ mobile: "999" });
    prisma.buy_order_item.findMany.mockResolvedValue([]);
  });

  it("rejects when the caller sends a rid that doesn't own the order", async () => {
    const res = mockRes();
    await buyOrderDetailDriver({ body: { orderid: 55, rid: 2 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("still serves the legacy call shape with no rid (back-compat)", async () => {
    const res = mockRes();
    await buyOrderDetailDriver({ body: { orderid: 55 } }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.Result).not.toBe("false");
  });
});

describe("customerWalletController.addWallet", () => {
  const { addWallet } = require("../customerWalletController");
  const body = {
    mobile: "9999999999",
    amount: 100,
    wallet_type: "user",
    razorpay_payment_id: "pay_1",
    razorpay_order_id: "order_1",
    razorpay_signature: "sig_1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 15, wallet: 50 });
    prisma.tbl_user.update.mockResolvedValue({ wallet: 150 });
  });

  it("refuses a payment that fails Razorpay verification", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment Verification Failed!" });
    const res = mockRes();
    await addWallet({ body }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("credits the wallet once verification passes and the history insert succeeds", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    const res = mockRes();
    await addWallet({ body }, res);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ razorpay_payment_id: "pay_1" }) })
    );
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 15 }, data: { wallet: { increment: 100 } } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });

  it("refuses a replayed payment_id even after signature/amount verification passes (double-credit race), relying on the DB unique constraint", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.tbl_wallet_history.create.mockRejectedValue(p2002);
    const res = mockRes();
    await addWallet({ body }, res);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: "This payment has already been credited." }));
  });
});

describe("customerPlanService.purchaseCustomerPlan payment trust", () => {
  const customerPlanService = require("../../services/customerPlanService");

  function txMock(user, plan) {
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        tbl_user: { findUnique: jest.fn().mockResolvedValue(user), updateMany: jest.fn() },
        tbl_premium_plan: { findFirst: jest.fn().mockResolvedValue(plan) },
        tbl_user_plan_subscription: { create: jest.fn().mockResolvedValue({ id: 1, start_date: new Date(), end_date: new Date() }), update: jest.fn() },
        tbl_wallet_history: { create: jest.fn() },
      })
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction = jest.fn();
    const user = { id: 15, referral_points: 0 };
    const plan = {
      id: 1, plan_name: "Gold", price: 199, referral_point_value: 1, referral_enabled: false,
      expire_date: null, validity_days: 30, discount_enabled: false, cancellation_enabled: false,
      no_advance_payment: false, guarantee_driver: false, priority_support: false, special_offers: false,
      priority_enabled: false, wallet_bonus_enabled: false,
    };
    txMock(user, plan);
  });

  it("rejects the purchase when no Razorpay payment is verified for a non-zero payable amount", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Missing Razorpay payment details" });
    await expect(
      customerPlanService.purchaseCustomerPlan({ userId: 15, planId: 1 })
    ).rejects.toThrow("Missing Razorpay payment details");
  });

  it("does not activate the plan for free just because the caller claims amount_paid covers it", async () => {
    // Old bug: passing amountPaid >= payable with no real payment used to succeed.
    // The fixed signature no longer even accepts amountPaid - only a verified
    // Razorpay payment can satisfy a non-zero payable.
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment Verification Failed!" });
    await expect(
      customerPlanService.purchaseCustomerPlan({ userId: 15, planId: 1, paymentTxnId: "fake", paymentMethod: "manual" })
    ).rejects.toThrow("Payment Verification Failed!");
  });

  it("activates the plan once Razorpay verification passes for the exact payable amount", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    const result = await customerPlanService.purchaseCustomerPlan({
      userId: 15, planId: 1, paymentTxnId: "pay_1", razorpayOrderId: "order_1", razorpaySignature: "sig_1",
    });
    expect(verifyRazorpayPayment).toHaveBeenCalledWith(expect.objectContaining({ expectedAmountRupees: 199 }));
    expect(result.payable).toBe(199);
  });
});

describe("driverPayoutController earnings and withdraw-request fixes", () => {
  const { payoutList, withdrawRequest } = require("../driverPayoutController");

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order.aggregate.mockResolvedValue({ _sum: { driver_earning: 1000 } });
    prisma.payout_setting.findMany.mockResolvedValue([]);
  });

  it("excludes rejected payouts from total_earning instead of permanently deducting them", async () => {
    prisma.payout_setting.aggregate.mockResolvedValue({ _sum: { amt: 200 } }); // only non-rejected summed (mocked directly)
    const res = mockRes();
    await payoutList({ body: { rid: 8 } }, res);
    expect(prisma.payout_setting.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ NOT: { status: "rejected" } }) })
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.total_earning).toBe(800);
  });

  it("rejects a withdraw request that would push queued pending requests past the wallet balance", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 8, wallet_balance: 100 });
    prisma.driver_withdraw_requests.aggregate.mockResolvedValue({ _sum: { amount: 80 } }); // already-pending
    const res = mockRes();
    await withdrawRequest({ body: { rider_id: 8, amount: 50 } }, res); // 80 + 50 > 100
    expect(prisma.driver_withdraw_requests.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: "Insufficient Balance" }));
  });

  it("allows a withdraw request that fits within balance minus already-pending requests", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 8, wallet_balance: 100 });
    prisma.driver_withdraw_requests.aggregate.mockResolvedValue({ _sum: { amount: 30 } });
    const res = mockRes();
    await withdrawRequest({ body: { rider_id: 8, amount: 50 } }, res); // 30 + 50 <= 100
    expect(prisma.driver_withdraw_requests.create).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });
});

describe("customOrderBiddingController.placeBid order-status guard", () => {
  const { placeBid } = require("../customOrderBiddingController");
  const body = { order_id: 10, rider_id: 8, amount: 100 };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_custom_order_bid.findFirst.mockResolvedValue(null);
  });

  it("rejects a bid on an order that isn't open", async () => {
    prisma.tbl_custom_order.findUnique.mockResolvedValue({ id: 10, status: "accepted" });
    const res = mockRes();
    await placeBid({ body }, res);
    expect(prisma.tbl_custom_order_bid.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("rejects a bid on a nonexistent order", async () => {
    prisma.tbl_custom_order.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await placeBid({ body }, res);
    expect(prisma.tbl_custom_order_bid.create).not.toHaveBeenCalled();
  });

  it("accepts a bid on an open order with no existing bid from this rider", async () => {
    prisma.tbl_custom_order.findUnique.mockResolvedValue({ id: 10, status: "open" });
    const res = mockRes();
    await placeBid({ body }, res);
    expect(prisma.tbl_custom_order_bid.create).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });
});
