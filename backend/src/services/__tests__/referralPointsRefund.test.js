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
