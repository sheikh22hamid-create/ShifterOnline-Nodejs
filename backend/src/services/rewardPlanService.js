const prisma = require("../config/db");
const { istNow } = require("../utils/istTime");
const pushNotifier = require("./pushNotifier");
const logger = require("../utils/logger");

const DRIVER_PLAN_TYPES = ["DRIVER_PREMIUM", "DRIVER_SECOND"];

/**
 * Fare of a completed order for ride-amount rewards. pkg_order.grand_total is
 * never written by Node (it stays at its Decimal(0.00) default; only the API
 * response mirrors total_dcharge into it), and a Prisma Decimal object is
 * truthy even at 0 - so `grand_total || total_dcharge` always picked 0 and
 * spend progress was stuck at 0%. total_dcharge holds the real final fare;
 * grand_total is only used when it carries a positive value (legacy rows).
 */
function orderAmount(o) {
  const grand = Number(o?.grand_total);
  if (Number.isFinite(grand) && grand > 0) return grand;
  const fare = Number(o?.total_dcharge);
  return Number.isFinite(fare) && fare > 0 ? fare : 0;
}

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
          created_at: istNow(),
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

// --- Ride-Amount Rewards -----------------------------------------------------
// Admin-configured reward rules: "when a customer books/completes a ride of
// at least ₹X, give them this plan". Admin can set/adjust min_amount and
// max_customers quota (and increase or reduce them at any time).

async function listAmountRewards() {
  const rows = await prisma.tbl_ride_amount_reward.findMany({ orderBy: { min_amount: "asc" } });
  if (rows.length === 0) return rows;
  const plans = await prisma.tbl_premium_plan.findMany({ where: { id: { in: rows.map((r) => r.plan_id) } } });
  const plansById = new Map(plans.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    min_amount: Number(r.min_amount),
    plan: plansById.get(r.plan_id) || null,
  }));
}

async function createAmountReward({ minAmount, planId, maxCustomers, adminId }) {
  const amount = Number(minAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("min_amount must be a positive number.");
  const plan = await prisma.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "USER", status: true } });
  if (!plan) throw new Error("Plan not found or inactive.");

  let maxCust = null;
  if (maxCustomers !== undefined && maxCustomers !== null && maxCustomers !== "") {
    const parsed = Number(maxCustomers);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("max_customers must be an integer >= 0 (0 for unlimited).");
    maxCust = parsed > 0 ? parsed : null;
  }

  return prisma.tbl_ride_amount_reward.create({
    data: {
      min_amount: amount,
      plan_id: plan.id,
      max_customers: maxCust,
      claimed_count: 0,
      created_by_admin: Number(adminId || 0),
    },
  });
}

async function updateAmountReward({ id, minAmount, planId, maxCustomers, status }) {
  const existing = await prisma.tbl_ride_amount_reward.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Ride amount reward rule not found.");

  const data = {};
  if (minAmount !== undefined) {
    const amount = Number(minAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("min_amount must be a positive number.");
    data.min_amount = amount;
  }
  if (planId !== undefined) {
    const plan = await prisma.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "USER", status: true } });
    if (!plan) throw new Error("Plan not found or inactive.");
    data.plan_id = plan.id;
  }
  if (maxCustomers !== undefined) {
    if (maxCustomers === null || maxCustomers === "" || Number(maxCustomers) === 0) {
      data.max_customers = null;
    } else {
      const parsed = Number(maxCustomers);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("max_customers must be an integer >= 0.");
      data.max_customers = parsed;
    }
  }
  if (status !== undefined) data.status = Boolean(status);

  return prisma.tbl_ride_amount_reward.update({ where: { id: Number(id) }, data });
}

async function deleteAmountReward({ id }) {
  const existing = await prisma.tbl_ride_amount_reward.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Ride amount reward rule not found.");
  await prisma.tbl_ride_amount_reward.delete({ where: { id: Number(id) } });
  return { success: true };
}

async function applyRideAmountRewardsIfAny({ uid, orderId, orderTotal }) {
  if (!uid) return [];

  const tiers = (await prisma.tbl_ride_amount_reward.findMany({
    where: { status: true },
    orderBy: { min_amount: "asc" },
  })) || [];
  if (!Array.isArray(tiers) || tiers.length === 0) return [];

  // Fetch all completed orders for this customer to calculate cumulative spend
  const completedOrders = await prisma.pkg_order.findMany({
    where: { uid: Number(uid), o_status: "Completed" },
    select: { id: true, grand_total: true, total_dcharge: true },
  });

  const currentTotal = Number(orderTotal || 0);
  let cumulativeSpent = 0;
  let currentOrderIncluded = false;

  for (const o of completedOrders) {
    if (orderId && o.id === Number(orderId)) {
      currentOrderIncluded = true;
      cumulativeSpent += currentTotal || orderAmount(o);
    } else {
      cumulativeSpent += orderAmount(o);
    }
  }
  if (!currentOrderIncluded && currentTotal > 0) {
    cumulativeSpent += currentTotal;
  }

  if (cumulativeSpent <= 0) return [];

  const qualifiedTiers = tiers.filter((t) => {
    const minAmt = Number(t.min_amount);
    const quotaAvailable = t.max_customers === null || t.max_customers === 0 || t.claimed_count < t.max_customers;
    return cumulativeSpent >= minAmt && quotaAvailable;
  });

  if (qualifiedTiers.length === 0) return [];

  const results = [];
  for (const tier of qualifiedTiers) {
    try {
      await prisma.tbl_ride_amount_reward_applied.create({
        data: { user_id: Number(uid), reward_id: tier.id, status: "applied", order_id: Number(orderId) || null },
      });
    } catch (err) {
      // Unique constraint hit -> already applied or skipped for this user+tier
      continue;
    }

    // Increment claimed count for this tier
    await prisma.tbl_ride_amount_reward.update({
      where: { id: tier.id },
      data: { claimed_count: { increment: 1 } },
    }).catch(() => {});

    const activeSubscription = await prisma.tbl_user_plan_subscription.findFirst({
      where: { user_id: Number(uid), plan_for: "USER", plan_type: "CUSTOMER_PREMIUM", status: "active" },
    });

    if (activeSubscription) {
      await prisma.tbl_ride_amount_reward_applied.updateMany({
        where: { user_id: Number(uid), reward_id: tier.id },
        data: { status: "skipped_active_plan" },
      });
      results.push({ tier, skipped: true });
      continue;
    }

    try {
      const result = await activatePlan({ userId: uid, planFor: "USER", planId: tier.plan_id, source: "ride_amount_reward" });
      const plan = result.plan;
      const validityText = plan.lifetime_enabled
        ? "Lifetime"
        : `${plan.validity_days || 30} din (${Math.max(1, Math.round((plan.validity_days || 30) / 30))} mahina)`;

      // Extract benefits for notification & WhatsApp
      const benefits = [];
      if (plan.discount_enabled && Number(plan.discount_percent) > 0) {
        benefits.push(`${Number(plan.discount_percent)}% discount on every ride`);
      }
      if (plan.no_advance_payment) {
        benefits.push("Zero advance payment required");
      }
      if (plan.priority_support) {
        benefits.push("VIP priority customer support");
      }
      if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) {
        benefits.push(`₹${Number(plan.wallet_bonus_amount)} instant wallet bonus`);
      }
      if (plan.cancellation_enabled && Number(plan.free_cancellations) > 0) {
        benefits.push(`${Number(plan.free_cancellations)} free order cancellations`);
      }

      // 1. App Push + In-App Inbox Notification
      try {
        await pushNotifier.notifyAmountRewardPlanAssigned(
          result.entity?.fcm_token,
          plan.plan_name,
          Number(tier.min_amount),
          validityText
        );
      } catch (notifyErr) {
        logger.error(`pushNotifier.notifyAmountRewardPlanAssigned error:`, notifyErr);
      }

      // 2. WhatsApp Notification
      try {
        const whatsapp = require("../whatsapp/notifications");
        await whatsapp.notifyAmountRewardWhatsApp({
          phone: result.entity?.mobile,
          customerName: result.entity?.name,
          planName: plan.plan_name,
          minAmount: Number(tier.min_amount),
          validityDays: validityText,
          benefits,
        });
      } catch (waErr) {
        logger.error(`whatsapp.notifyAmountRewardWhatsApp error:`, waErr);
      }

      results.push({ tier, skipped: false, ...result });
    } catch (err) {
      logger.error(`rewardPlanService.applyRideAmountRewardsIfAny: activation failed for user ${uid}, tier ${tier.id}:`, err);
    }
  }
  return results;
}

/**
 * Returns active amount reward offer for displaying in the Customer App home screen.
 */
async function getActiveAmountRewardForCustomer({ uid }) {
  try {
    const activeRules = await prisma.tbl_ride_amount_reward.findMany({
      where: { status: true },
      orderBy: { min_amount: "asc" },
    });

    if (activeRules.length === 0) return { enabled: false };

    const plans = await prisma.tbl_premium_plan.findMany({
      where: { id: { in: activeRules.map((r) => r.plan_id) }, status: true },
    });
    const plansById = new Map(plans.map((p) => [p.id, p]));

    // Check user claimed history and cumulative spend if uid is provided
    let claimedRewardIds = new Set();
    let currentSpend = 0;
    if (uid) {
      const [claimedRows, completedOrders] = await Promise.all([
        prisma.tbl_ride_amount_reward_applied.findMany({
          where: { user_id: Number(uid), status: "applied" },
          select: { reward_id: true },
        }),
        prisma.pkg_order.findMany({
          where: { uid: Number(uid), o_status: "Completed" },
          select: { grand_total: true, total_dcharge: true },
        }),
      ]);
      claimedRewardIds = new Set(claimedRows.map((r) => r.reward_id));
      currentSpend = completedOrders.reduce(
        (sum, o) => sum + orderAmount(o),
        0
      );
    }

    // Find the first rule that has quota remaining and not yet claimed by this user
    let chosenRule = null;
    let isClaimed = false;

    for (const rule of activeRules) {
      const plan = plansById.get(rule.plan_id);
      if (!plan) continue;

      const hasQuota = rule.max_customers === null || rule.max_customers === 0 || rule.claimed_count < rule.max_customers;
      const alreadyClaimed = claimedRewardIds.has(rule.id);

      if (hasQuota && !alreadyClaimed) {
        chosenRule = { rule, plan };
        isClaimed = false;
        break;
      } else if (alreadyClaimed && !chosenRule) {
        // Fallback to show user their unlocked milestone
        chosenRule = { rule, plan };
        isClaimed = true;
      }
    }

    if (!chosenRule) return { enabled: false };

    const { rule, plan } = chosenRule;
    const minAmt = Number(rule.min_amount);
    const maxCust = rule.max_customers ? Number(rule.max_customers) : null;
    const claimed = Number(rule.claimed_count || 0);
    const remainingSpots = maxCust ? Math.max(0, maxCust - claimed) : null;
    const roundedSpend = Math.round(currentSpend);
    const remainingSpend = Math.max(0, minAmt - roundedSpend);
    const progressPercent = Math.min(100, Math.round((currentSpend / (minAmt || 1)) * 100));

    const benefits = [];
    if (plan.discount_enabled && Number(plan.discount_percent) > 0) {
      benefits.push(`${Number(plan.discount_percent)}% discount on every ride`);
    }
    if (plan.no_advance_payment) {
      benefits.push("Zero advance payment required");
    }
    if (plan.priority_support) {
      benefits.push("VIP priority customer support");
    }
    if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) {
      benefits.push(`₹${Number(plan.wallet_bonus_amount)} instant wallet bonus`);
    }
    if (plan.cancellation_enabled && Number(plan.free_cancellations) > 0) {
      benefits.push(`${Number(plan.free_cancellations)} free order cancellations`);
    }
    if (plan.special_offers) {
      benefits.push("Exclusive member discounts & priority driver dispatch");
    }
    if (plan.description && plan.description.trim().length > 0) {
      const customLines = plan.description.split(/[\r\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
      for (const line of customLines) {
        if (!benefits.includes(line)) benefits.push(line);
      }
    }
    if (benefits.length === 0) {
      benefits.push("All premium privileges and perks included");
    }

    return {
      enabled: true,
      id: rule.id,
      min_amount: minAmt,
      plan_id: rule.plan_id,
      plan_name: plan.plan_name,
      plan_price: Number(plan.price || 0),
      plan_description: plan.description || "",
      plan_benefits: benefits,
      validity_days: plan.lifetime_enabled ? "Lifetime" : `${plan.validity_days || 30} Days`,
      max_customers: maxCust,
      claimed_count: claimed,
      remaining_spots: remainingSpots,
      current_spend: roundedSpend,
      remaining_spend: remainingSpend,
      progress_percent: progressPercent,
      is_claimed: isClaimed,
      banner_title: isClaimed ? "Milestone Unlocked! 🎉" : "Exclusive Ride Milestone 🎁",
      banner_desc: isClaimed
        ? `You unlocked ${plan.plan_name} with your completed rides!`
        : (roundedSpend > 0
            ? `₹${roundedSpend} / ₹${minAmt} completed — Only ₹${remainingSpend} more to get ${plan.plan_name} FREE!`
            : `Complete ₹${minAmt} total in rides (single or multiple) & get ${plan.plan_name} completely FREE!`),
      urgency_tag: maxCust ? (remainingSpots > 0 ? `Only ${remainingSpots} spots left!` : "Offer limit reached") : null,
    };
  } catch (err) {
    logger.error("rewardPlanService.getActiveAmountRewardForCustomer error:", err);
    return { enabled: false };
  }
}

/**
 * Returns list of customer claims for a specific ride-amount reward rule.
 */
async function listAmountRewardClaims({ rewardId }) {
  const claims = await prisma.tbl_ride_amount_reward_applied.findMany({
    where: { reward_id: Number(rewardId) },
    orderBy: { applied_at: "desc" },
  });

  if (claims.length === 0) return [];

  const userIds = [...new Set(claims.map((c) => c.user_id))];
  const orderIds = [...new Set(claims.map((c) => c.order_id).filter(Boolean))];

  const [users, orders] = await Promise.all([
    prisma.tbl_user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, mobile: true, email: true, r_img: true },
    }),
    orderIds.length > 0
      ? prisma.pkg_order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, total_dcharge: true, grand_total: true, o_status: true, odate: true },
        })
      : [],
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return claims.map((c) => {
    const user = userMap.get(c.user_id);
    const order = c.order_id ? orderMap.get(c.order_id) : null;
    return {
      id: c.id,
      user_id: c.user_id,
      reward_id: c.reward_id,
      status: c.status,
      applied_at: c.applied_at,
      user: user
        ? {
            id: user.id,
            name: user.name,
            mobile: user.mobile,
            email: user.email,
            r_img: user.r_img,
          }
        : null,
      order: order
        ? {
            id: order.id,
            order_total: orderAmount(order),
            status: order.o_status,
            date: order.odate,
          }
        : null,
    };
  });
}

/**
 * Returns list of customer claims for a specific ride-count milestone tier.
 */
async function listMilestoneClaims({ milestoneId }) {
  const claims = await prisma.tbl_ride_milestone_applied.findMany({
    where: { milestone_id: Number(milestoneId) },
    orderBy: { applied_at: "desc" },
  });

  if (claims.length === 0) return [];

  const userIds = [...new Set(claims.map((c) => c.user_id))];
  const orderIds = [...new Set(claims.map((c) => c.order_id).filter(Boolean))];

  const [users, orders] = await Promise.all([
    prisma.tbl_user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, mobile: true, email: true, r_img: true },
    }),
    orderIds.length > 0
      ? prisma.pkg_order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, total_dcharge: true, grand_total: true, o_status: true, odate: true },
        })
      : [],
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  return claims.map((c) => {
    const user = userMap.get(c.user_id);
    const order = c.order_id ? orderMap.get(c.order_id) : null;
    return {
      id: c.id,
      user_id: c.user_id,
      milestone_id: c.milestone_id,
      status: c.status,
      applied_at: c.applied_at,
      user: user
        ? {
            id: user.id,
            name: user.name,
            mobile: user.mobile,
            email: user.email,
            r_img: user.r_img,
          }
        : null,
      order: order
        ? {
            id: order.id,
            order_total: orderAmount(order),
            status: order.o_status,
            date: order.odate,
          }
        : null,
    };
  });
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
  listMilestoneClaims,
  listAmountRewards,
  createAmountReward,
  updateAmountReward,
  deleteAmountReward,
  applyRideAmountRewardsIfAny,
  getActiveAmountRewardForCustomer,
  listAmountRewardClaims,
};

