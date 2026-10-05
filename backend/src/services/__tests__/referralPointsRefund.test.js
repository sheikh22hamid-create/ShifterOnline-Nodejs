jest.mock("../../config/db", () => ({}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn() }));

const { refundReferralPointsForOrder } = require("../referralPointsRefund");

function client({ order = { uid: 9, referral_points_used: 40 }, claimed = 1 } = {}) {
  return {
    pkg_order: { findUnique: jest.fn().mockResolvedValue(order), updateMany: jest.fn().mockResolvedValue({ count: claimed }) },
    tbl_user: { update: jest.fn().mockResolvedValue({ referral_points: 140 }) },
    tbl_referral_point_log: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe("refundReferralPointsForOrder", () => {
  it("gives the spent points back and logs a ride_discount_refund credit", async () => {
    const c = client();
    expect(await refundReferralPointsForOrder(199, c)).toBe(40);
    expect(c.tbl_user.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { referral_points: { increment: 40 } } });
    expect(c.tbl_referral_point_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 9, points: 40, txn_type: "credit", source: "ride_discount_refund", balance_after: 140 }),
    });
  });

  it("does nothing when the order used no points", async () => {
    const c = client({ order: { uid: 9, referral_points_used: 0 } });
    expect(await refundReferralPointsForOrder(199, c)).toBe(0);
    expect(c.pkg_order.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent: a concurrent cancel that lost the claim refunds nothing", async () => {
    const c = client({ claimed: 0 });
    expect(await refundReferralPointsForOrder(199, c)).toBe(0);
    expect(c.tbl_user.update).not.toHaveBeenCalled();
  });

  it("never throws into the cancel flow", async () => {
    const c = client();
    c.pkg_order.findUnique.mockRejectedValue(new Error("db down"));
    await expect(refundReferralPointsForOrder(199, c)).resolves.toBe(0);
  });
});

describe("reconcileRideDiscountToFare", () => {
  const { reconcileRideDiscountToFare } = require("../referralPointsRefund");

  // order #468: booked at Rs652 (50% cap = 326 points), early-dropped to Rs170.
  function rc({ order = { uid: 31, referral_points_used: 326, referral_points_amount: 326, cou_amt: 0 }, setting = { referral_enabled: true, ride_discount_percent: 50, point_value: 1 }, claimed = 1 } = {}) {
    return {
      pkg_order: { findUnique: jest.fn().mockResolvedValue(order), updateMany: jest.fn().mockResolvedValue({ count: claimed }) },
      tbl_referral_setting: { findFirst: jest.fn().mockResolvedValue(setting) },
      tbl_user: { update: jest.fn().mockResolvedValue({ referral_points: 241 }) },
      tbl_referral_point_log: { create: jest.fn().mockResolvedValue({}) },
    };
  }

  it("refunds points above the admin % cap when the fare drops (order #468: 326 -> 85)", async () => {
    const c = rc();
    const r = await reconcileRideDiscountToFare(468, 170, c);
    expect(r).toEqual({ refundedPoints: 241, pointsUsed: 85, pointsAmount: 85 });
    expect(c.pkg_order.updateMany).toHaveBeenCalledWith({
      where: { id: 468, referral_points_used: 326 },
      data: { referral_points_used: 85, referral_points_amount: 85 },
    });
    expect(c.tbl_user.update).toHaveBeenCalledWith({ where: { id: 31 }, data: { referral_points: { increment: 241 } } });
    expect(c.tbl_referral_point_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 31, points: 241, txn_type: "credit", source: "ride_discount_refund" }),
    });
  });

  it("subtracts the coupon before applying the % cap", async () => {
    const c = rc({ order: { uid: 31, referral_points_used: 100, referral_points_amount: 100, cou_amt: 70 } });
    const r = await reconcileRideDiscountToFare(1, 170, c); // (170-70)*50% = 50
    expect(r.pointsUsed).toBe(50);
    expect(r.refundedPoints).toBe(50);
  });

  it("does nothing when the points still fit under the cap", async () => {
    const c = rc({ order: { uid: 31, referral_points_used: 80, referral_points_amount: 80, cou_amt: 0 } });
    expect(await reconcileRideDiscountToFare(468, 170, c)).toEqual({ refundedPoints: 0, pointsUsed: 80, pointsAmount: 80 });
    expect(c.pkg_order.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when the order used no points", async () => {
    const c = rc({ order: { uid: 31, referral_points_used: 0, referral_points_amount: 0, cou_amt: 0 } });
    expect((await reconcileRideDiscountToFare(468, 170, c)).refundedPoints).toBe(0);
  });

  it("leaves points alone when the redeem program is now off / 0% (not a fare-driven change)", async () => {
    const c = rc({ setting: { referral_enabled: true, ride_discount_percent: 0, point_value: 1 } });
    expect((await reconcileRideDiscountToFare(468, 170, c)).refundedPoints).toBe(0);
    expect(c.pkg_order.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent: losing the optimistic claim refunds nothing", async () => {
    const c = rc({ claimed: 0 });
    expect((await reconcileRideDiscountToFare(468, 170, c)).refundedPoints).toBe(0);
    expect(c.tbl_user.update).not.toHaveBeenCalled();
  });

  it("never throws into the fare-change flow", async () => {
    const c = rc();
    c.pkg_order.findUnique.mockRejectedValue(new Error("db down"));
    await expect(reconcileRideDiscountToFare(468, 170, c)).resolves.toEqual({ refundedPoints: 0, pointsUsed: 0, pointsAmount: 0 });
  });
});
