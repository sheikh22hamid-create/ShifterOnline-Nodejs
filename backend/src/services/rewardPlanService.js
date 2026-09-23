const prisma = require("../config/db");
const pushNotifier = require("./pushNotifier");
const logger = require("../utils/logger");

const DRIVER_PLAN_TYPES = ["DRIVER_PREMIUM", "DRIVER_SECOND"];

function todayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function resolvePlanType(plan, planFor) {
  if (planFor !== "DRIVER") return "CUSTOMER_PREMIUM";
  return DRIVER_PLAN_TYPES.includes(plan.plan_type) ? plan.plan_type : (plan.guaranteed_enabled ? "DRIVER_SECOND" : "DRIVER_PREMIUM");
}

/**
 * Activates a plan for a user/driver outside the normal self-purchase flow
 * (admin grant, either immediate or via a claimed pending-reward row).
 * Mirrors purchaseCustomerPlan/purchaseDriverPlan's subscription-creation
 * shape but skips payment entirely (amount_paid = 0, payment_method =
 * "admin_grant") since admin decision, not money, is what's activating it.
 *
 * Conflict policy: admin's decision always wins — any existing active
 * subscription of the same plan_for + plan_type is expired first rather than
 * stacked or left to fight over `activeSubscription()`'s "most recent" pick.
 */
async function activatePlan({ userId, planFor, planId, source }) {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: planFor, status: true } });
    if (!plan) throw new Error("Plan not found or inactive.");

    const model = planFor === "DRIVER" ? tx.tbl_rider : tx.tbl_user;
    const entity = await model.findUnique({ where: { id: Number(userId) } });
    if (!entity) throw new Error(planFor === "DRIVER" ? "Driver not found" : "Customer not found");

    const type = resolvePlanType(plan, planFor);

    await tx.tbl_user_plan_subscription.updateMany({
      where: { user_id: Number(userId), plan_for: planFor, plan_type: type, status: "active" },
      data: { status: "expired" },
    });

    const today = todayRange().start;
    const validityDays = plan.lifetime_enabled ? 36500 : Math.max(1, plan.validity_days || 30);
    const endDate = plan.expire_date || new Date(today.getFullYear(), today.getMonth(), today.getDate() + validityDays);
    const target = plan.min_ride_guarantee_enabled && Number(plan.min_ride_guarantee) > 0
      ? Number(plan.min_ride_guarantee)
      : (type === "DRIVER_SECOND" ? Number(plan.guaranteed_rides_per_month) || 0 : 0);

    const subscription = await tx.tbl_user_plan_subscription.create({
      data: {
        user_id: Number(userId),
        plan_for: planFor,
        plan_id: plan.id,
        plan_type: type,
        plan_snapshot: JSON.stringify({ plan_name: plan.plan_name, source }),
        amount_paid: 0,
        payment_method: "admin_grant",
        start_date: today,
        end_date: endDate,
        guaranteed_target: target,
        status: "active",
      },
    });

    if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) {
      const bonus = Number(plan.wallet_bonus_amount);
      const walletField = planFor === "DRIVER" ? "wallet_balance" : "wallet";
      await model.update({ where: { id: Number(userId) }, data: { [walletField]: { increment: bonus } } });
      await tx.tbl_wallet_history.create({
        data: {
          user_id: Number(userId),
          amount: bonus,
          type: "credit",
          wallet_type: planFor === "DRIVER" ? "driver" : "user",
          payment_id: `plan_bonus_${subscription.id}`,
          remark: `Wallet bonus for ${plan.plan_name} (admin grant)`,
          created_at: new Date(),
        },
      });
      await tx.tbl_user_plan_subscription.update({ where: { id: subscription.id }, data: { wallet_bonus_credited: bonus } });
    }

    return { subscription, plan, entity };
  });
}

async function notifyAssigned(entity, planName) {
  try {
    await pushNotifier.notifyRewardPlanAssigned(entity?.fcm_token, planName);
  } catch (err) {
    logger.error("rewardPlanService: notifyRewardPlanAssigned failed:", err);
  }
}

/** Admin gives a plan to a customer or driver immediately. */
async function assignPlanNow({ userId, planFor, planId }) {
  const result = await activatePlan({ userId, planFor, planId, source: "admin_grant_now" });
  notifyAssigned(result.entity, result.plan.plan_name);
  return result;
}

/**
 * Admin pre-sets a plan for a customer that activates automatically the next
 * time one of their rides completes (one-time — consumed on first use).
 * Customer-only: there's no "next ride" trigger on the driver side yet.
 */
async function setPendingRewardPlan({ userId, planId, adminId }) {
  const plan = await prisma.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "USER", status: true } });
  if (!plan) throw new Error("Plan not found or inactive.");
  const user = await prisma.tbl_user.findUnique({ where: { id: Number(userId) } });
  if (!user) throw new Error("Customer not found");

  // Admin's latest decision wins — only one pending reward per user at a time.
  await prisma.tbl_pending_reward_plan.updateMany({
    where: { user_id: Number(userId), plan_for: "USER", status: "pending" },
    data: { status: "cancelled" },
  });
  return prisma.tbl_pending_reward_plan.create({
    data: { user_id: Number(userId), plan_for: "USER", plan_id: plan.id, assigned_by_admin: Number(adminId), status: "pending" },
  });
}

async function cancelPendingRewardPlan({ id }) {
  const updated = await prisma.tbl_pending_reward_plan.updateMany({
    where: { id: Number(id), status: "pending" },
    data: { status: "cancelled" },
  });
  if (updated.count === 0) throw new Error("Pending reward plan not found or already resolved.");
  return { success: true };
}

async function getPendingRewardPlan({ userId, planFor = "USER" }) {
  return prisma.tbl_pending_reward_plan.findFirst({
    where: { user_id: Number(userId), plan_for: planFor, status: "pending" },
    orderBy: { id: "desc" },
    include: { },
  });
}

/**
 * Called fire-and-forget from tripLifecycle on every completed customer
 * order, same pattern as referralRewardService. Claims the pending row
 * (pending -> applied) with an atomic updateMany before doing anything else,
 * so a retried/duplicate 'complete' call can never double-apply it.
 */
async function applyPendingRewardPlanIfAny({ uid, orderId }) {
  if (!uid) return null;
  const pending = await prisma.tbl_pending_reward_plan.findFirst({
    where: { user_id: Number(uid), plan_for: "USER", status: "pending" },
    orderBy: { id: "desc" },
  });
  if (!pending) return null;

  const claimed = await prisma.tbl_pending_reward_plan.updateMany({
    where: { id: pending.id, status: "pending" },
    data: { status: "applied", applied_order_id: Number(orderId) || null, applied_at: new Date() },
  });
  if (claimed.count === 0) return null; // already claimed by a concurrent call

  try {
    const result = await activatePlan({ userId: uid, planFor: "USER", planId: pending.plan_id, source: "admin_grant_ride_complete" });
    notifyAssigned(result.entity, result.plan.plan_name);
    return result;
  } catch (err) {
    logger.error(`rewardPlanService.applyPendingRewardPlanIfAny: activation failed for user ${uid}:`, err);
    // Don't let a transient failure silently swallow the admin's decision.
    await prisma.tbl_pending_reward_plan.update({
      where: { id: pending.id },
      data: { status: "pending", applied_order_id: null, applied_at: null },
    }).catch(() => {});
    return null;
  }
}

// --- Ride-milestone rewards -------------------------------------------------
// Admin-configured tiers ("on their Nth completed ride, give this customer
// this plan") that apply to every USER customer automatically, as opposed to
// tbl_pending_reward_plan above which is a one-off per-customer assignment.

async function listMilestoneRewards() {
  const rows = await prisma.tbl_ride_milestone_reward.findMany({ orderBy: { rides_required: "asc" } });
  if (rows.length === 0) return rows;
  // No Prisma relation is declared between tbl_ride_milestone_reward.plan_id
  // and tbl_premium_plan (same pattern as tbl_pending_reward_plan), so the
  // plan name is joined in manually for the admin list view.
  const plans = await prisma.tbl_premium_plan.findMany({ where: { id: { in: rows.map((r) => r.plan_id) } } });
  const plansById = new Map(plans.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, plan: plansById.get(r.plan_id) || null }));
}

async function createMilestoneReward({ ridesRequired, planId, adminId }) {
  const rides = Number(ridesRequired);
  if (!Number.isInteger(rides) || rides <= 0) throw new Error("rides_required must be a positive whole number.");
  const plan = await prisma.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "USER", status: true } });
  if (!plan) throw new Error("Plan not found or inactive.");
  return prisma.tbl_ride_milestone_reward.create({
    data: { rides_required: rides, plan_id: plan.id, created_by_admin: Number(adminId) },
  });
}

async function updateMilestoneReward({ id, ridesRequired, planId, status }) {
  const data = {};
  if (ridesRequired !== undefined) {
    const rides = Number(ridesRequired);
    if (!Number.isInteger(rides) || rides <= 0) throw new Error("rides_required must be a positive whole number.");
    data.rides_required = rides;
  }
  if (planId !== undefined) {
    const plan = await prisma.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "USER", status: true } });
    if (!plan) throw new Error("Plan not found or inactive.");
    data.plan_id = plan.id;
  }
  if (status !== undefined) data.status = Boolean(status);

  const existing = await prisma.tbl_ride_milestone_reward.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Milestone not found.");
  return prisma.tbl_ride_milestone_reward.update({ where: { id: Number(id) }, data });
}

async function deleteMilestoneReward({ id }) {
  const existing = await prisma.tbl_ride_milestone_reward.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Milestone not found.");
  await prisma.tbl_ride_milestone_reward.delete({ where: { id: Number(id) } });
  return { success: true };
}

/**
 * Called fire-and-forget from tripLifecycle on every completed customer
 * order, same pattern as applyPendingRewardPlanIfAny above. Counts the
 * customer's lifetime completed rides and activates any admin-configured
 * milestone tier they've just crossed for the first time.
 *
 * Each (user, milestone) pair is claimed via an insert into
 * tbl_ride_milestone_applied guarded by its unique constraint, so a retried
 * or concurrent completion can never double-apply the same tier. If the
 * customer already has an active plan, the tier is recorded as skipped
 * rather than stacked/replaced - admin can see it happened and grant it
 * manually via the "Give reward plan" flow if they still want to.
 */
async function applyRideMilestoneRewardsIfAny({ uid, orderId }) {
  if (!uid) return [];

  const [tiers, ridesCompleted] = await Promise.all([
    prisma.tbl_ride_milestone_reward.findMany({ where: { status: true }, orderBy: { rides_required: "asc" } }),
    prisma.pkg_order.count({ where: { uid: Number(uid), o_status: "Completed" } }),
  ]);

  const crossedTiers = tiers.filter((t) => t.rides_required <= ridesCompleted);
  if (crossedTiers.length === 0) return [];

  const results = [];
  for (const tier of crossedTiers) {
    try {
      await prisma.tbl_ride_milestone_applied.create({
        data: { user_id: Number(uid), milestone_id: tier.id, status: "applied", order_id: Number(orderId) || null },
      });
    } catch (err) {
      // Unique constraint hit -> already applied/skipped for this user+tier
      // (by this call or a concurrent one). Nothing to do, move to next tier.
      continue;
    }

    const activeSubscription = await prisma.tbl_user_plan_subscription.findFirst({
      where: { user_id: Number(uid), plan_for: "USER", plan_type: "CUSTOMER_PREMIUM", status: "active" },
    });
    if (activeSubscription) {
      await prisma.tbl_ride_milestone_applied.updateMany({
        where: { user_id: Number(uid), milestone_id: tier.id },
        data: { status: "skipped_active_plan" },
      });
      results.push({ tier, skipped: true });
      continue;
    }

    try {
      const result = await activatePlan({ userId: uid, planFor: "USER", planId: tier.plan_id, source: "ride_milestone" });
      notifyAssigned(result.entity, result.plan.plan_name);
      results.push({ tier, skipped: false, ...result });
    } catch (err) {
      logger.error(`rewardPlanService.applyRideMilestoneRewardsIfAny: activation failed for user ${uid}, tier ${tier.id}:`, err);
      // Leave the applied row as-is (claimed) rather than retrying forever -
      // a deleted/deactivated plan needs an admin fix, not an infinite loop.
    }
  }
  return results;
}

module.exports = {
  assignPlanNow,
  setPendingRewardPlan,
  cancelPendingRewardPlan,
  getPendingRewardPlan,
  applyPendingRewardPlanIfAny,
  listMilestoneRewards,
  createMilestoneReward,
  updateMilestoneReward,
  deleteMilestoneReward,
  applyRideMilestoneRewardsIfAny,
};
