jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  tbl_premium_plan: { findFirst: jest.fn(), findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user_plan_subscription: { updateMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  tbl_pending_reward_plan: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  tbl_ride_milestone_reward: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
  tbl_ride_milestone_applied: { create: jest.fn(), updateMany: jest.fn() },
  pkg_order: { count: jest.fn() },
}));

jest.mock("../pushNotifier", () => ({
  notifyRewardPlanAssigned: jest.fn().mockResolvedValue({ sent: true }),
}));

const prisma = require("../../config/db");
const pushNotifier = require("../pushNotifier");
const rewardPlanService = require("../rewardPlanService");

describe("rewardPlanService.applyPendingRewardPlanIfAny", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
  });

  it("does nothing when there is no pending reward for the user", async () => {
    prisma.tbl_pending_reward_plan.findFirst.mockResolvedValue(null);
    const result = await rewardPlanService.applyPendingRewardPlanIfAny({ uid: 9, orderId: 500 });
    expect(result).toBeNull();
    expect(prisma.tbl_pending_reward_plan.updateMany).not.toHaveBeenCalled();
  });

  it("activates the plan and marks the pending row applied", async () => {
    prisma.tbl_pending_reward_plan.findFirst.mockResolvedValue({ id: 7, user_id: 9, plan_id: 3, plan_for: "USER" });
    prisma.tbl_pending_reward_plan.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_premium_plan.findFirst.mockResolvedValue({
      id: 3, plan_name: "Gold", plan_for: "USER", status: true, validity_days: 30,
      lifetime_enabled: false, min_ride_guarantee_enabled: false, wallet_bonus_enabled: false,
    });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 9, fcm_token: "token-9" });
    prisma.tbl_user_plan_subscription.create.mockResolvedValue({ id: 55 });

    const result = await rewardPlanService.applyPendingRewardPlanIfAny({ uid: 9, orderId: 500 });

    expect(prisma.tbl_pending_reward_plan.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: "pending" },
      data: expect.objectContaining({ status: "applied", applied_order_id: 500 }),
    });
    expect(prisma.tbl_user_plan_subscription.updateMany).toHaveBeenCalledWith({
      where: { user_id: 9, plan_for: "USER", plan_type: "CUSTOMER_PREMIUM", status: "active" },
      data: { status: "expired" },
    });
    expect(pushNotifier.notifyRewardPlanAssigned).toHaveBeenCalledWith("token-9", "Gold");
    expect(result.plan.plan_name).toBe("Gold");
  });

  it("is idempotent: a concurrently-claimed pending row is not applied twice", async () => {
    prisma.tbl_pending_reward_plan.findFirst.mockResolvedValue({ id: 7, user_id: 9, plan_id: 3, plan_for: "USER" });
    // Someone else already claimed it between the findFirst and this updateMany.
    prisma.tbl_pending_reward_plan.updateMany.mockResolvedValue({ count: 0 });

    const result = await rewardPlanService.applyPendingRewardPlanIfAny({ uid: 9, orderId: 500 });

    expect(result).toBeNull();
    expect(prisma.tbl_premium_plan.findFirst).not.toHaveBeenCalled();
  });

  it("reverts the claim if activation fails, so the admin's decision isn't silently lost", async () => {
    prisma.tbl_pending_reward_plan.findFirst.mockResolvedValue({ id: 7, user_id: 9, plan_id: 3, plan_for: "USER" });
    prisma.tbl_pending_reward_plan.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_pending_reward_plan.update.mockResolvedValue({});
    prisma.tbl_premium_plan.findFirst.mockResolvedValue(null); // plan was deleted/deactivated meanwhile

    const result = await rewardPlanService.applyPendingRewardPlanIfAny({ uid: 9, orderId: 500 });

    expect(result).toBeNull();
    expect(prisma.tbl_pending_reward_plan.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: "pending", applied_order_id: null, applied_at: null },
    });
  });
});

describe("rewardPlanService.setPendingRewardPlan", () => {
  beforeEach(() => jest.clearAllMocks());

  it("cancels any prior pending reward before creating the new one", async () => {
    prisma.tbl_premium_plan.findFirst.mockResolvedValue({ id: 3, plan_for: "USER", status: true });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 9 });
    prisma.tbl_pending_reward_plan.create.mockResolvedValue({ id: 8, status: "pending" });

    await rewardPlanService.setPendingRewardPlan({ userId: 9, planId: 3, adminId: 1 });

    expect(prisma.tbl_pending_reward_plan.updateMany).toHaveBeenCalledWith({
      where: { user_id: 9, plan_for: "USER", status: "pending" },
      data: { status: "cancelled" },
    });
    expect(prisma.tbl_pending_reward_plan.create).toHaveBeenCalled();
  });

  it("rejects when the plan doesn't exist or isn't a USER plan", async () => {
    prisma.tbl_premium_plan.findFirst.mockResolvedValue(null);
    await expect(rewardPlanService.setPendingRewardPlan({ userId: 9, planId: 999, adminId: 1 })).rejects.toThrow(
      "Plan not found or inactive."
    );
  });
});

describe("rewardPlanService.assignPlanNow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
  });

  it("expires an existing active plan of the same type before granting the new one (admin decision wins)", async () => {
    prisma.tbl_premium_plan.findFirst.mockResolvedValue({
      id: 4, plan_name: "Platinum", plan_for: "DRIVER", plan_type: "DRIVER_PREMIUM", status: true,
      validity_days: 30, lifetime_enabled: false, min_ride_guarantee_enabled: false, wallet_bonus_enabled: false,
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 21, fcm_token: "driver-token" });
    prisma.tbl_user_plan_subscription.create.mockResolvedValue({ id: 60 });

    await rewardPlanService.assignPlanNow({ userId: 21, planFor: "DRIVER", planId: 4 });

    expect(prisma.tbl_user_plan_subscription.updateMany).toHaveBeenCalledWith({
      where: { user_id: 21, plan_for: "DRIVER", plan_type: "DRIVER_PREMIUM", status: "active" },
      data: { status: "expired" },
    });
    expect(pushNotifier.notifyRewardPlanAssigned).toHaveBeenCalledWith("driver-token", "Platinum");
  });
});

describe("rewardPlanService.applyRideMilestoneRewardsIfAny", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
  });

  it("does nothing when no active tier has been crossed yet", async () => {
    prisma.tbl_ride_milestone_reward.findMany.mockResolvedValue([{ id: 1, rides_required: 10, plan_id: 3 }]);
    prisma.pkg_order.count.mockResolvedValue(4);

    const result = await rewardPlanService.applyRideMilestoneRewardsIfAny({ uid: 9, orderId: 500 });

    expect(result).toEqual([]);
    expect(prisma.tbl_ride_milestone_applied.create).not.toHaveBeenCalled();
  });

  it("activates the plan for a newly-crossed tier when the customer has no active plan", async () => {
    prisma.tbl_ride_milestone_reward.findMany.mockResolvedValue([{ id: 1, rides_required: 5, plan_id: 3 }]);
    prisma.pkg_order.count.mockResolvedValue(5);
    prisma.tbl_ride_milestone_applied.create.mockResolvedValue({ id: 1 });
    prisma.tbl_user_plan_subscription.findFirst.mockResolvedValue(null);
    prisma.tbl_premium_plan.findFirst.mockResolvedValue({
      id: 3, plan_name: "Gold", plan_for: "USER", status: true, validity_days: 30,
      lifetime_enabled: false, min_ride_guarantee_enabled: false, wallet_bonus_enabled: false,
    });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 9, fcm_token: "token-9" });
    prisma.tbl_user_plan_subscription.create.mockResolvedValue({ id: 55 });

    const result = await rewardPlanService.applyRideMilestoneRewardsIfAny({ uid: 9, orderId: 500 });

    expect(prisma.tbl_ride_milestone_applied.create).toHaveBeenCalledWith({
      data: { user_id: 9, milestone_id: 1, status: "applied", order_id: 500 },
    });
    expect(pushNotifier.notifyRewardPlanAssigned).toHaveBeenCalledWith("token-9", "Gold");
    expect(result).toHaveLength(1);
    expect(result[0].skipped).toBe(false);
  });

  it("skips (and logs) activation when the customer already has an active plan", async () => {
    prisma.tbl_ride_milestone_reward.findMany.mockResolvedValue([{ id: 1, rides_required: 5, plan_id: 3 }]);
    prisma.pkg_order.count.mockResolvedValue(5);
    prisma.tbl_ride_milestone_applied.create.mockResolvedValue({ id: 1 });
    prisma.tbl_user_plan_subscription.findFirst.mockResolvedValue({ id: 999, status: "active" });

    const result = await rewardPlanService.applyRideMilestoneRewardsIfAny({ uid: 9, orderId: 500 });

    expect(prisma.tbl_ride_milestone_applied.updateMany).toHaveBeenCalledWith({
      where: { user_id: 9, milestone_id: 1 },
      data: { status: "skipped_active_plan" },
    });
    expect(prisma.tbl_user_plan_subscription.create).not.toHaveBeenCalled();
    expect(result).toEqual([{ tier: { id: 1, rides_required: 5, plan_id: 3 }, skipped: true }]);
  });

  it("is idempotent: a tier already claimed for this user is not applied twice", async () => {
    prisma.tbl_ride_milestone_reward.findMany.mockResolvedValue([{ id: 1, rides_required: 5, plan_id: 3 }]);
    prisma.pkg_order.count.mockResolvedValue(5);
    prisma.tbl_ride_milestone_applied.create.mockRejectedValue(new Error("Unique constraint failed"));

    const result = await rewardPlanService.applyRideMilestoneRewardsIfAny({ uid: 9, orderId: 500 });

    expect(result).toEqual([]);
    expect(prisma.tbl_user_plan_subscription.findFirst).not.toHaveBeenCalled();
  });

  it("processes multiple newly-crossed tiers in ascending order", async () => {
    prisma.tbl_ride_milestone_reward.findMany.mockResolvedValue([
      { id: 1, rides_required: 5, plan_id: 3 },
      { id: 2, rides_required: 10, plan_id: 4 },
    ]);
    prisma.pkg_order.count.mockResolvedValue(10);
    prisma.tbl_ride_milestone_applied.create.mockResolvedValue({ id: 1 });
    prisma.tbl_user_plan_subscription.findFirst.mockResolvedValue(null);
    prisma.tbl_premium_plan.findFirst.mockResolvedValue({
      id: 3, plan_name: "Gold", plan_for: "USER", status: true, validity_days: 30,
      lifetime_enabled: false, min_ride_guarantee_enabled: false, wallet_bonus_enabled: false,
    });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 9, fcm_token: "token-9" });
    prisma.tbl_user_plan_subscription.create.mockResolvedValue({ id: 55 });

    const result = await rewardPlanService.applyRideMilestoneRewardsIfAny({ uid: 9, orderId: 500 });

    expect(result).toHaveLength(2);
    expect(prisma.tbl_ride_milestone_applied.create).toHaveBeenNthCalledWith(1, {
      data: { user_id: 9, milestone_id: 1, status: "applied", order_id: 500 },
    });
    expect(prisma.tbl_ride_milestone_applied.create).toHaveBeenNthCalledWith(2, {
      data: { user_id: 9, milestone_id: 2, status: "applied", order_id: 500 },
    });
  });
});

describe("rewardPlanService milestone CRUD", () => {
  beforeEach(() => jest.clearAllMocks());

  it("createMilestoneReward rejects a non-positive rides_required", async () => {
    await expect(
      rewardPlanService.createMilestoneReward({ ridesRequired: 0, planId: 3, adminId: 1 })
    ).rejects.toThrow("rides_required must be a positive whole number.");
  });

  it("createMilestoneReward rejects a plan that isn't a USER plan", async () => {
    prisma.tbl_premium_plan.findFirst.mockResolvedValue(null);
    await expect(
      rewardPlanService.createMilestoneReward({ ridesRequired: 5, planId: 3, adminId: 1 })
    ).rejects.toThrow("Plan not found or inactive.");
  });

  it("createMilestoneReward creates a tier when valid", async () => {
    prisma.tbl_premium_plan.findFirst.mockResolvedValue({ id: 3, plan_for: "USER", status: true });
    prisma.tbl_ride_milestone_reward.create.mockResolvedValue({ id: 1, rides_required: 5, plan_id: 3 });

    const result = await rewardPlanService.createMilestoneReward({ ridesRequired: 5, planId: 3, adminId: 1 });

    expect(prisma.tbl_ride_milestone_reward.create).toHaveBeenCalledWith({
      data: { rides_required: 5, plan_id: 3, created_by_admin: 1 },
    });
    expect(result.id).toBe(1);
  });

  it("deleteMilestoneReward rejects when the milestone doesn't exist", async () => {
    prisma.tbl_ride_milestone_reward.findUnique.mockResolvedValue(null);
    await expect(rewardPlanService.deleteMilestoneReward({ id: 99 })).rejects.toThrow("Milestone not found.");
  });
});
