const prisma = require("../config/db");
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");

// Node port of the CUSTOMER_PREMIUM half of cust_api/get_premium_plans_api.php
// and purchase_premium_plan_api.php. Those two PHP files were written
// generically for both USER and DRIVER plan_for values, but the DRIVER half
// is already implemented (and tested) on Node as driverPlanService.js /
// driverPlanController.js — this is a separate, parallel implementation for
// CUSTOMER_PREMIUM specifically, on tbl_user (not tbl_rider), so as not to
// touch the working driver code path. Same tbl_premium_plan /
// tbl_user_plan_subscription tables, just plan_for = "USER".
//
// Deliberately NOT ported here: cust_api/get_plan.php, create_plan_order.php,
// plan_success.php. Those three operate on a DIFFERENT, older, simpler
// system (tbl_joining_plan + tbl_user.plan_type enum + tbl_plan_payment) —
// unrelated to tbl_premium_plan despite similar naming. get_plan.php's own
// query (`tbl_joining_plan WHERE plan_for=type`) overlaps with
// driverContentController.joiningPlan (already ported, driver's one-time
// registration/kit fee). Worth a dedicated look if that legacy path turns
// out to still be live, but it's a different feature from "premium plan
// purchase" and wasn't investigated as part of this pass.

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function todayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function activeSubscription(userId, client = prisma) {
  const { start, end } = todayRange();
  const subscription = await client.tbl_user_plan_subscription.findFirst({
    where: {
      user_id: Number(userId),
      plan_for: "USER",
      plan_type: "CUSTOMER_PREMIUM",
      status: "active",
      start_date: { lte: end },
      end_date: { gte: start },
    },
    orderBy: { id: "desc" },
  });
  if (!subscription) return null;
  const plan = await client.tbl_premium_plan.findUnique({ where: { id: subscription.plan_id } });
  return plan ? { ...subscription, tbl_premium_plan: plan } : null;
}

function daysLeft(expireDate, validityDays, today = new Date()) {
  if (!expireDate) return validityDays;
  const diffMs = new Date(expireDate).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

function validityLabel(days) {
  if (days === 30) return "Monthly";
  if (days === 90) return "Quarterly";
  if (days === 180) return "Half Yearly";
  if (days === 365) return "Yearly";
  return `${days} days`;
}

function referralBlock(plan) {
  return {
    points_per_referral: plan.referral_points_per_referral,
    point_value: Number(plan.referral_point_value),
    number_of_referrals: plan.number_of_referrals,
    auto_activate: Boolean(plan.auto_activate_on_referrals),
    note: "Referral only verifies once the referred person's first ride completes.",
  };
}

function purchaseBlock(price, plan, referralPoints) {
  const pointValue = Number(plan.referral_point_value) > 0 ? Number(plan.referral_point_value) : 1;
  const pointsRequired = Math.ceil(price / pointValue);
  const pointsUsable = Math.min(referralPoints, pointsRequired);
  const pointsAmount = money(pointsUsable * pointValue);
  const payable = Math.max(0, money(price - pointsAmount));
  return {
    point_value: pointValue,
    points_available: referralPoints,
    points_required: pointsRequired,
    points_usable: pointsUsable,
    points_covered_amount: pointsAmount,
    payable_amount: payable,
    can_buy_with_points: payable <= 0,
  };
}

function buildPlanPayload(plan, active, referralPoints) {
  const tags = [];
  const price = Number(plan.price);
  const p = {
    plan_id: plan.id,
    plan_name: plan.plan_name,
    plan_type: "CUSTOMER_PREMIUM",
    plan_type_label: "Premium Membership",
    plan_for: "USER",
    expire_date: plan.expire_date ? plan.expire_date.toISOString().slice(0, 10) : null,
    days_left: daysLeft(plan.expire_date, plan.validity_days),
    validity_label: validityLabel(plan.validity_days),
    is_popular: Boolean(plan.is_popular),
    is_active: Boolean(active && active.plan_id === plan.id),
    price_info: { price, currency_symbol: "₹" },
    ui_tags: tags,
  };
  if (plan.description) p.description = plan.description;

  if (plan.discount_enabled) {
    p.fare_discount = { percent: Number(plan.discount_percent), max_cap: Number(plan.discount_max_cap) };
    const cap = Number(plan.discount_max_cap) > 0 ? ` (upto ₹${Number(plan.discount_max_cap)})` : "";
    tags.push(`${Number(plan.discount_percent)}% fare discount${cap}`);
  }
  if (plan.cancellation_enabled) {
    p.free_cancellation = {
      free_count: plan.free_cancellations,
      unlimited: plan.free_cancellations === -1,
      window_min: plan.cancellation_window_min,
    };
    tags.push(`${plan.free_cancellations === -1 ? "Unlimited" : plan.free_cancellations} free cancellations/month`);
  }
  if (plan.referral_enabled) {
    p.refer_and_earn = referralBlock(plan);
    p.purchase_info = purchaseBlock(price, plan, referralPoints);
    tags.push(`${plan.referral_points_per_referral} points per verified referral`);
  }
  if (plan.no_advance_payment) { p.no_advance_payment = true; tags.push("No advance payment (pay after ride)"); }
  if (plan.guarantee_driver) { p.guarantee_driver = true; tags.push("Guaranteed driver assignment"); }
  if (plan.priority_support) { p.priority_support = true; tags.push("Priority support"); }
  if (plan.special_offers) { p.special_offers = true; tags.push("Special offers"); }
  if (plan.priority_enabled) { p.priority_matching = true; tags.push("Priority matching"); }
  if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) {
    p.wallet_bonus = Number(plan.wallet_bonus_amount);
    tags.push(`₹${Number(plan.wallet_bonus_amount)} wallet bonus on purchase`);
  }
  return p;
}

function buildActivePayload(subscription, today = new Date()) {
  const plan = subscription.tbl_premium_plan;
  const a = {
    subscription_id: subscription.id,
    plan_id: plan.id,
    plan_name: plan.plan_name,
    plan_type: "CUSTOMER_PREMIUM",
    plan_type_label: "Premium Membership",
    plan_for: "USER",
    start_date: subscription.start_date.toISOString().slice(0, 10),
    end_date: subscription.end_date.toISOString().slice(0, 10),
    days_left: daysLeft(subscription.end_date, 0, today),
    purchased_at: subscription.created_at,
    amount_paid: Number(subscription.amount_paid),
    payment_method: subscription.payment_method,
    payment_txn_id: subscription.payment_txn_id,
    auto_renew: Boolean(subscription.auto_renew),
    price: Number(plan.price),
    renewal_price: Number(plan.price),
  };
  if (plan.discount_enabled) {
    a.fare_discount = {
      percent: Number(plan.discount_percent),
      max_cap: Number(plan.discount_max_cap),
      total_saved: Number(subscription.discount_saved),
    };
  }
  if (plan.cancellation_enabled) {
    const unlimited = plan.free_cancellations === -1;
    a.free_cancellation = {
      free_count: plan.free_cancellations,
      unlimited,
      used: subscription.cancellations_used,
      remaining: unlimited ? "unlimited" : Math.max(0, plan.free_cancellations - subscription.cancellations_used),
      window_min: plan.cancellation_window_min,
    };
  }
  if (plan.referral_enabled) a.refer_and_earn = referralBlock(plan);
  if (plan.no_advance_payment) a.no_advance_payment = true;
  if (plan.guarantee_driver) a.guarantee_driver = true;
  if (plan.priority_support) a.priority_support = true;
  if (plan.special_offers) a.special_offers = true;
  if (plan.priority_enabled) a.priority_matching = true;
  if (plan.wallet_bonus_enabled) a.wallet_bonus_credited = Number(subscription.wallet_bonus_credited);
  return a;
}

async function listCustomerPlans(userId, cityId) {
  const user = await prisma.tbl_user.findUnique({ where: { id: Number(userId) }, select: { referral_points: true } });
  if (!user) throw new Error("User not found");
  const { start } = todayRange();

  const [plans, active] = await Promise.all([
    prisma.tbl_premium_plan.findMany({
      where: {
        plan_for: "USER",
        plan_type: "CUSTOMER_PREMIUM",
        status: true,
        OR: [{ expire_date: null }, { expire_date: { gte: start } }],
      },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    }),
    activeSubscription(userId),
  ]);
  const filtered = cityId
    ? plans.filter((plan) => !plan.city || plan.city === "" || plan.city === "all" || plan.city.split(",").includes(String(cityId)))
    : plans;

  const referralPoints = Number(user.referral_points) || 0;
  const response = {
    ResponseCode: "200",
    Result: "true",
    ResponseMsg: "Plans fetched successfully.",
    Plans: filtered.map((plan) => buildPlanPayload(plan, active, referralPoints)),
    Currency: "₹",
  };
  if (referralPoints > 0 || filtered.some((p) => p.referral_enabled)) response.ReferralPoints = referralPoints;
  if (active) response.ActivePlan = buildActivePayload(active);
  return response;
}

async function purchaseCustomerPlan({ userId, planId, usePoints = false, paymentTxnId = "", paymentMethod = "", razorpayOrderId = "", razorpaySignature = "" }) {
  const today = todayRange().start;
  return prisma.$transaction(async (tx) => {
    const [user, plan] = await Promise.all([
      tx.tbl_user.findUnique({ where: { id: Number(userId) } }),
      tx.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "USER", plan_type: "CUSTOMER_PREMIUM", status: true } }),
    ]);
    if (!user) throw new Error("User not found");
    if (!plan) throw new Error("Plan not found or inactive.");
    if (plan.expire_date && plan.expire_date < today) throw new Error("This plan has expired and is no longer available.");

    const price = Number(plan.price);
    const pointValue = Number(plan.referral_point_value) > 0 ? Number(plan.referral_point_value) : 1;
    const pointsAllowed = plan.referral_enabled;
    let pointsUsed = 0;
    let pointsAmount = 0;
    if (usePoints) {
      if (!pointsAllowed) throw new Error("Referral points are not applicable on this plan.");
      const available = Number(user.referral_points) || 0;
      const required = Math.ceil(price / pointValue);
      pointsUsed = Math.min(available, required);
      pointsAmount = money(pointsUsed * pointValue);
    }
    const payable = Math.max(0, money(price - pointsAmount));

    // Trusting client-supplied amountPaid here would let anyone activate a
    // paid plan for free by just sending amount_paid >= payable - the same
    // class of bug customerWalletController.addWallet fixes for wallet
    // recharges by verifying against Razorpay's API instead of the request
    // body. When real money is actually due (payable > 0 and not fully
    // covered by referral points), require and verify a matching Razorpay
    // payment; only a zero-payable purchase (fully points-covered, or a free
    // plan) can skip this.
    let amountPaidFinal = payable;
    if (payable > 0) {
      let verification;
      try {
        verification = await verifyRazorpayPayment({
          paymentId: paymentTxnId,
          orderId: razorpayOrderId,
          signature: razorpaySignature,
          expectedAmountRupees: payable,
        });
      } catch (e) {
        throw new Error("Payment verification is not configured. Try again later.");
      }
      if (!verification.ok) throw new Error(verification.reason);
    }

    const validityDays = plan.expire_date
      ? Math.max(0, Math.ceil((plan.expire_date.getTime() - today.getTime()) / 86400000))
      : Math.max(1, plan.validity_days || 30);
    const endDate = plan.expire_date || new Date(today.getFullYear(), today.getMonth(), today.getDate() + validityDays);

    const snapshot = JSON.stringify({
      plan_name: plan.plan_name,
      plan_type: "CUSTOMER_PREMIUM",
      plan_for: "USER",
      expire_date: plan.expire_date ? plan.expire_date.toISOString().slice(0, 10) : null,
      price,
      ...(plan.discount_enabled ? { discount_percent: Number(plan.discount_percent), discount_max_cap: Number(plan.discount_max_cap) } : {}),
      ...(plan.cancellation_enabled ? { free_cancellations: plan.free_cancellations, cancellation_window_min: plan.cancellation_window_min } : {}),
      ...(plan.referral_enabled ? { referral_points_per_referral: plan.referral_points_per_referral, referral_point_value: Number(plan.referral_point_value) } : {}),
      no_advance_payment: plan.no_advance_payment ? 1 : undefined,
      guarantee_driver: plan.guarantee_driver ? 1 : undefined,
      priority_support: plan.priority_support ? 1 : undefined,
      special_offers: plan.special_offers ? 1 : undefined,
      priority_enabled: plan.priority_enabled ? 1 : undefined,
      wallet_bonus_amount: plan.wallet_bonus_enabled ? Number(plan.wallet_bonus_amount) : undefined,
    });

    const subscription = await tx.tbl_user_plan_subscription.create({
      data: {
        user_id: Number(userId),
        plan_for: "USER",
        plan_id: plan.id,
        plan_type: "CUSTOMER_PREMIUM",
        plan_snapshot: snapshot,
        amount_paid: amountPaidFinal,
        points_used: pointsUsed,
        points_amount: pointsAmount,
        payment_txn_id: paymentTxnId || null,
        payment_method: paymentMethod || (pointsUsed ? "points" : null),
        start_date: today,
        end_date: endDate,
        status: "active",
      },
    });

    if (pointsUsed > 0) {
      const decremented = await tx.tbl_user.updateMany({
        where: { id: Number(userId), referral_points: { gte: pointsUsed } },
        data: { referral_points: { decrement: pointsUsed } },
      });
      if (decremented.count === 0) throw new Error("Referral points deduction failed. Insufficient points.");
    }

    let walletCredited = 0;
    if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) {
      walletCredited = Number(plan.wallet_bonus_amount);
      await tx.tbl_user.update({ where: { id: Number(userId) }, data: { wallet: { increment: walletCredited } } });
      await tx.tbl_user_plan_subscription.update({ where: { id: subscription.id }, data: { wallet_bonus_credited: walletCredited } });
      await tx.tbl_wallet_history.create({
        data: {
          user_id: Number(userId),
          amount: walletCredited,
          type: "credit",
          wallet_type: "user",
          payment_id: `plan_bonus_${subscription.id}`,
          remark: `Wallet bonus for ${plan.plan_name}`,
          created_at: new Date(),
        },
      });
    }

    return { subscription, plan, payable: amountPaidFinal, pointsUsed, pointsAmount, walletCredited, validityDays };
  });
}

module.exports = { listCustomerPlans, purchaseCustomerPlan };
