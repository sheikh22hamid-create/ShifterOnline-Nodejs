// Regression tests for paying a driver plan with referral points. The plan
// purchase used to decrement tbl_rider.referral_points with no
// tbl_referral_point_log row (so the driver's points history never showed
// the spend) and with an unguarded decrement (two concurrent purchases could
// double-spend the same points). clearDueWithPoints already does both right;
// this pins purchaseDriverPlan to the same discipline.

const mockTx = {
  tbl_rider: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_premium_plan: { findFirst: jest.fn() },
  tbl_user_plan_subscription: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
};

jest.mock("../../config/db", () => ({
  $transaction: jest.fn((fn) => fn(mockTx)),
}));

const { purchaseDriverPlan } = require("../driverPlanService");

const plan = {
  id: 7, plan_for: "DRIVER", status: true, plan_name: "Gold", plan_type: "DRIVER_PREMIUM",
  price: 500, referral_enabled: true, referral_point_value: 2, validity_days: 30,
  commission_percent: 5, per_trip_charge: 0, package_categories: "all",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.tbl_rider.findUnique.mockResolvedValue({ id: 3, referral_points: 100, vehicle: null });
  mockTx.tbl_premium_plan.findFirst.mockResolvedValue(plan);
  mockTx.tbl_user_plan_subscription.findFirst.mockResolvedValue(null);
  mockTx.tbl_user_plan_subscription.create.mockResolvedValue({ id: 55 });
  mockTx.tbl_rider.updateMany.mockResolvedValue({ count: 1 });
  mockTx.tbl_rider.findFirst.mockResolvedValue({ id: 3, referral_points: 0 });
  mockTx.tbl_referral_setting.findFirst.mockResolvedValue(null);
});

describe("purchaseDriverPlan with referral points", () => {
  it("spends points with a guarded decrement and writes a referral point log row", async () => {
    const result = await purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, paymentTxnId: "pay_1" });

    // 500 price / 2 per point = 250 needed, driver only has 100 -> uses 100 (₹200), pays ₹300.
    expect(result.pointsUsed).toBe(100);
    expect(result.payable).toBe(300);
    expect(mockTx.tbl_rider.updateMany).toHaveBeenCalledWith({
      where: { id: 3, referral_points: { gte: 100 } },
      data: { referral_points: { decrement: 100 } },
    });
    expect(mockTx.tbl_referral_point_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 3, user_type: "DRIVER", points: -100, txn_type: "debit",
        source: "plan_purchase", ref_id: 55, balance_after: 0,
      }),
    });
  });

  it("aborts the purchase if the points balance changed since it was read", async () => {
    mockTx.tbl_rider.updateMany.mockResolvedValue({ count: 0 });
    await expect(purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, paymentTxnId: "pay_1" }))
      .rejects.toThrow(/points balance changed/i);
    expect(mockTx.tbl_referral_point_log.create).not.toHaveBeenCalled();
  });

  it("touches neither points nor the log when usePoints is false", async () => {
    await purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: false, paymentTxnId: "pay_1" });
    expect(mockTx.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(mockTx.tbl_referral_point_log.create).not.toHaveBeenCalled();
  });
});

describe("purchaseDriverPlan referral point rules (admin settings)", () => {
  it("lets points pay for a plan that has refer-and-earn switched off", async () => {
    mockTx.tbl_premium_plan.findFirst.mockResolvedValue({ ...plan, referral_enabled: false, referral_point_value: 1 });
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, plan_purchase_enabled: true, point_value: "1.00", plan_points_max_percent: "100.00" });
    const result = await purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, paymentTxnId: "pay_1" });
    expect(result.pointsUsed).toBe(100);
    expect(result.payable).toBe(400);
  });

  it("refuses when admin switched plan-purchase points off", async () => {
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, plan_purchase_enabled: false });
    await expect(purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, paymentTxnId: "pay_1" }))
      .rejects.toThrow(/can't be used to buy plans/i);
    expect(mockTx.tbl_rider.updateMany).not.toHaveBeenCalled();
  });

  it("honours the admin max percent (30% of 500 at 2/pt = 75 points)", async () => {
    mockTx.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, plan_purchase_enabled: true, point_value: "2.00", plan_points_max_percent: "30.00" });
    const result = await purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, paymentTxnId: "pay_1" });
    expect(result.pointsUsed).toBe(75);
    expect(result.pointsAmount).toBe(150);
    expect(result.payable).toBe(350);
  });

  it("spends only the points the driver chose on the stepper", async () => {
    const result = await purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, pointsToUse: 40, paymentTxnId: "pay_1" });
    expect(result.pointsUsed).toBe(40);
    expect(result.payable).toBe(420);
  });

  it("never spends more than allowed even if the client asks for more", async () => {
    const result = await purchaseDriverPlan({ driverId: 3, planId: 7, usePoints: true, pointsToUse: 9999, paymentTxnId: "pay_1" });
    expect(result.pointsUsed).toBe(100);
  });
});
