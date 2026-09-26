// Regression tests for the automatic referral reward trigger - tbl_referral
// rows were previously created at signup and then never touched again (no
// code anywhere moved status past "pending" or credited points). These
// verify the fix actually pays out on a referred user/driver's first
// completed order, exactly once, and leaves everything else alone.

jest.mock("../../config/db", () => ({
  tbl_referral: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  pkg_order: { count: jest.fn(), findFirst: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

const prisma = require("../../config/db");
const { processReferralRewardsForCompletedOrder } = require("../referralRewardService");

function baseReferral(overrides = {}) {
  return {
    id: 501,
    referrer_id: 10,
    referrer_type: "USER",
    referred_id: 20,
    referred_type: "USER",
    referral_code: "ABC123",
    status: "pending",
    ...overrides,
  };
}

describe("referralRewardService.processReferralRewardsForCompletedOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({
      referral_enabled: true,
      user_points_per_referral: 100,
      driver_points_per_referral: 250,
    });
    prisma.tbl_referral.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 10, referral_points: 50 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 10, referral_points: 0 });
  });

  it("credits the referrer when the referred customer's FIRST order just completed", async () => {
    prisma.tbl_referral.findFirst.mockImplementation(({ where }) =>
      where.referred_type === "USER" ? Promise.resolve(baseReferral()) : Promise.resolve(null)
    );
    prisma.pkg_order.count.mockResolvedValue(1); // exactly one completed order so far

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.tbl_referral.updateMany).toHaveBeenCalledWith({
      where: { id: 501, status: "pending" },
      data: expect.objectContaining({ status: "completed", points_awarded: 100, ride_id: 999 }),
    });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { referral_points: 150 } });
    expect(prisma.tbl_referral_point_log.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ points: 100, txn_type: "credit", source: "referral_reward" }) })
    );
  });

  it("does nothing when the referred user has NO completed orders", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(0); // no completed orders yet

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.tbl_referral.updateMany).not.toHaveBeenCalled();
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("does nothing when there is no pending referral for this user", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(null);

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.pkg_order.count).not.toHaveBeenCalled();
    expect(prisma.tbl_referral.updateMany).not.toHaveBeenCalled();
  });

  it("does not double-pay when the atomic claim loses the race (already completed)", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral.updateMany.mockResolvedValue({ count: 0 }); // someone else already claimed it

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_referral_point_log.create).not.toHaveBeenCalled();
  });

  it("uses driver_points_per_referral and credits tbl_rider when a referred DRIVER completes their first order", async () => {
    prisma.tbl_referral.findFirst.mockImplementation(({ where }) =>
      where.referred_type === "DRIVER" ? Promise.resolve(baseReferral({ id: 777, referred_id: 30, referred_type: "DRIVER" })) : Promise.resolve(null)
    );
    prisma.pkg_order.count.mockResolvedValue(1);

    await processReferralRewardsForCompletedOrder({ uid: null, riderId: 30, orderId: 1001 });

    expect(prisma.tbl_referral.updateMany).toHaveBeenCalledWith({
      where: { id: 777, status: "pending" },
      data: expect.objectContaining({ points_awarded: 250 }),
    });
    // referrer_type is still USER here (only the REFERRED party is a
    // DRIVER) - referrer's tbl_user balance is seeded at 50 in beforeEach.
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { referral_points: 300 } });
  });

  it("uses lead_referral_points instead of user_points_per_referral when the referral source is 'lead'", async () => {
    prisma.tbl_referral.findFirst.mockImplementation(({ where }) =>
      where.referred_type === "USER" ? Promise.resolve(baseReferral({ source: "lead" })) : Promise.resolve(null)
    );
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({
      referral_enabled: true,
      user_points_per_referral: 100,
      driver_points_per_referral: 250,
      lead_referral_points: 400,
    });

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.tbl_referral.updateMany).toHaveBeenCalledWith({
      where: { id: 501, status: "pending" },
      data: expect.objectContaining({ points_awarded: 400 }),
    });
  });

  it("skips payout when referrals are disabled in settings", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: false, user_points_per_referral: 100, driver_points_per_referral: 250 });

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.tbl_referral.updateMany).not.toHaveBeenCalled();
  });

  it("syncPendingReferralRewardsForDriver credits referrer if referred driver completed an order", async () => {
    const { syncPendingReferralRewardsForDriver } = require("../referralRewardService");
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 15, referred_by: 11, refer_by: 11, referred_by_type: "DRIVER" });
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral.findFirst.mockResolvedValue({
      id: 505,
      referrer_id: 11,
      referrer_type: "DRIVER",
      referred_id: 15,
      referred_type: "DRIVER",
      status: "pending",
    });
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, driver_points_per_referral: 100 });
    prisma.tbl_referral.findMany.mockResolvedValue([]);
    prisma.tbl_rider.findUnique.mockImplementation(({ where }) => {
      if (where.id === 15) return Promise.resolve({ id: 15, referred_by: 11, refer_by: 11, referred_by_type: "DRIVER" });
      if (where.id === 11) return Promise.resolve({ id: 11, referral_points: 0 });
      return Promise.resolve(null);
    });

    const res = await syncPendingReferralRewardsForDriver(15);
    expect(res.success).toBe(true);
    expect(res.awardedToReferrer).toBe(100);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { referral_points: 100 },
    });
  });
});

describe("referralRewardService.creditSignUpBonus", () => {
  const { creditSignUpBonus } = require("../referralRewardService");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("credits signup_bonus_points to a referred customer and logs it", async () => {
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, signup_bonus_points: 25 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 20, referral_points: 0 });

    const credited = await creditSignUpBonus({ referredId: 20, referredType: "USER" });

    expect(credited).toBe(25);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 20 }, data: { referral_points: 25 } });
    expect(prisma.tbl_referral_point_log.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user_id: 20, user_type: "USER", points: 25, source: "signup_bonus" }) })
    );
  });

  it("credits a referred driver via tbl_rider", async () => {
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, signup_bonus_points: 10 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 30, referral_points: 5 });

    const credited = await creditSignUpBonus({ referredId: 30, referredType: "DRIVER" });

    expect(credited).toBe(10);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 30 }, data: { referral_points: 15 } });
  });

  it("does nothing when signup_bonus_points is 0 or unset", async () => {
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, signup_bonus_points: 0 });

    const credited = await creditSignUpBonus({ referredId: 20, referredType: "USER" });

    expect(credited).toBe(0);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("does nothing when referrals are disabled", async () => {
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: false, signup_bonus_points: 25 });

    const credited = await creditSignUpBonus({ referredId: 20, referredType: "USER" });

    expect(credited).toBe(0);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});
