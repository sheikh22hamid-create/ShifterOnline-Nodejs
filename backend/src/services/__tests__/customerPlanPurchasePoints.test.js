// Customer plan purchase with referral points: admin-controlled (global
// switch + max %), honours the app's stepper, and writes a points ledger row.

const mockTx = {
  tbl_user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_premium_plan: { findFirst: jest.fn() },
  tbl_user_plan_subscription: { create: jest.fn(), update: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
};

jest.mock("../../config/db", () => ({
  $transaction: jest.fn((fn) => fn(mockTx)),
}));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn().mockResolvedValue({ ok: true }) }));

const { purchaseCustomerPlan } = require("../customerPlanService");

const plan = {
  id: 11, plan_for: "USER", plan_type: "CUSTOMER_PREMIUM", status: true, plan_name: "Premium Plan",
  price: 200, validity_days: 30, referral_enabled: false, referral_point_value: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.tbl_user.findUnique.mockResolvedValue({ id: 9, referral_points: 500 });
  mockTx.tbl_premium_plan.findFirst.mockResolvedValue(plan);
  mockTx.tbl_user_plan_subscription.create.mockResolvedValue({ id: 70 });
  mockTx.tbl_user.updateMany.mockResolvedValue({ count: 1 });
  mockTx.tbl_user.findFirst.mockResolvedValue({ id: 9, referral_points: 300 });
  mockTx.tbl_referral_setting.findFirst.mockResolvedValue(null);
});

describe("purchaseCustomerPlan with referral points", () => {
  it("pays fully with points, deducts with a guarded decrement and logs it", async () => {
    const result = await purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: true });

    expect(result.pointsUsed).toBe(200);
    expect(result.payable).toBe(0);
    expect(mockTx.tbl_user.updateMany).toHaveBeenCalledWith({
      where: { id: 9, referral_points: { gte: 200 } },
      data: { referral_points: { decrement: 200 } },
    });
    expect(mockTx.tbl_referral_point_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 9, user_type: "USER", points: -200, txn_type: "debit",
        source: "plan_purchase", ref_id: 70, balance_after: 300,
      }),
    });
  });

  it("works even though the plan itself has refer-and-earn off", async () => {
    // plan.referral_enabled is false in the fixture - this used to throw
    // "Referral points are not applicable on this plan."
    await expect(purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: true })).resolves.toBeDefined();
  });

  it("refuses when admin switched plan-purchase points off", async () => {
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, plan_purchase_enabled: false });
    await expect(purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: true })).rejects.toThrow(/can't be used to buy plans/i);
    expect(mockTx.tbl_user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.tbl_referral_point_log.create).not.toHaveBeenCalled();
  });

  it("aborts if the balance changed since it was read", async () => {
    mockTx.tbl_user.updateMany.mockResolvedValue({ count: 0 });
    await expect(purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: true })).rejects.toThrow(/Insufficient points/i);
    expect(mockTx.tbl_referral_point_log.create).not.toHaveBeenCalled();
  });

  it("with the admin cap at 50% only half is covered and the rest must be paid", async () => {
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, plan_purchase_enabled: true, point_value: "1.00", plan_points_max_percent: "50.00" });
    const result = await purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: true, paymentTxnId: "pay_1", razorpayOrderId: "o", razorpaySignature: "s" });
    expect(result.pointsUsed).toBe(100);
    expect(result.payable).toBe(100);
  });

  it("spends only the stepper's points and touches nothing when usePoints is false", async () => {
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, plan_purchase_enabled: true, point_value: "1.00", plan_points_max_percent: "100.00" });
    const partial = await purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: true, pointsToUse: 50, paymentTxnId: "pay_1", razorpayOrderId: "o", razorpaySignature: "s" });
    expect(partial.pointsUsed).toBe(50);
    expect(partial.payable).toBe(150);

    jest.clearAllMocks();
    mockTx.tbl_user.findUnique.mockResolvedValue({ id: 9, referral_points: 500 });
    mockTx.tbl_premium_plan.findFirst.mockResolvedValue(plan);
    mockTx.tbl_user_plan_subscription.create.mockResolvedValue({ id: 71 });
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue(null);
    await purchaseCustomerPlan({ userId: 9, planId: 11, usePoints: false, paymentTxnId: "pay_2", razorpayOrderId: "o", razorpaySignature: "s" });
    expect(mockTx.tbl_user.updateMany).not.toHaveBeenCalled();
    expect(mockTx.tbl_referral_point_log.create).not.toHaveBeenCalled();
  });
});
