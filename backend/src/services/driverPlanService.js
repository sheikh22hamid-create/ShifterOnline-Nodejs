const prisma = require("../config/db");

const DRIVER_PLAN_TYPES = ["DRIVER_PREMIUM", "DRIVER_SECOND"];

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function planType(plan) {
  return DRIVER_PLAN_TYPES.includes(plan.plan_type)
    ? plan.plan_type
    : plan.guaranteed_enabled
      ? "DRIVER_SECOND"
      : "DRIVER_PREMIUM";
}

function todayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function activeSubscriptions(driverId, client = prisma) {
  // Older unit-test fixtures (and an incomplete Prisma deployment during a
  // rolling migration) may not expose the subscription delegate yet. In that
  // case the safe behaviour is the normal non-premium settlement path.
  if (!client.tbl_user_plan_subscription || !client.tbl_premium_plan) return [];
  const { start, end } = todayRange();
  const subscriptions = await client.tbl_user_plan_subscription.findMany({
    where: {
      user_id: Number(driverId),
      plan_for: "DRIVER",
      status: "active",
      start_date: { lte: end },
      end_date: { gte: start },
    },
    orderBy: { id: "desc" },
  });
  if (!subscriptions.length) return [];
  const plans = await client.tbl_premium_plan.findMany({
    where: { id: { in: subscriptions.map((subscription) => subscription.plan_id) } },
  });
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  return subscriptions
    .filter((subscription) => byId.has(subscription.plan_id))
    .map((subscription) => ({ ...subscription, tbl_premium_plan: byId.get(subscription.plan_id) }));
}

function subscriptionSnapshot(subscription) {
  try {
    return subscription.plan_snapshot ? JSON.parse(subscription.plan_snapshot) : {};
  } catch (_) {
    return {};
  }
}

function candidateForFare(subscription, fare, baseCommissionPercent = 0, basePerTripCharge = 0) {
  const plan = subscription.tbl_premium_plan;
  const snapshot = subscriptionSnapshot(subscription);
  const commissionPercent = Number(snapshot.commission_percent ?? plan.commission_percent) || 0;
  const perTripCharge = Number(snapshot.per_trip_charge ?? plan.per_trip_charge) || 0;
  const minFare = Number(snapshot.incentive_min_fare ?? plan.incentive_min_fare) || 0;
  const monthlyCap = Number(snapshot.incentive_monthly_cap ?? plan.incentive_monthly_cap) || 0;
  const alreadyEarned = Number(subscription.incentive_earned) || 0;
  let incentive = 0;

  const incentiveEnabled = Boolean(snapshot.incentive_enabled ?? plan.incentive_enabled);
  if (planType(plan) === "DRIVER_PREMIUM" && incentiveEnabled && fare >= minFare) {
    const raw = plan.incentive_type === "percent"
      ? (fare * (Number(snapshot.incentive_value ?? plan.incentive_value) || 0)) / 100
      : Number(snapshot.incentive_value ?? plan.incentive_value) || 0;
    incentive = monthlyCap > 0 ? Math.max(0, Math.min(raw, monthlyCap - alreadyEarned)) : raw;
  }

  const baseDeduction = money((fare * baseCommissionPercent) / 100 + basePerTripCharge);
  const deduction = money((fare * commissionPercent) / 100 + perTripCharge - incentive);
  return {
    subscription,
    plan,
    planType: planType(plan),
    commissionPercent,
    perTripCharge,
    incentive: money(incentive),
    deduction,
    benefit: money(Math.max(0, baseDeduction - deduction)),
    priorityEnabled: Boolean(plan.priority_enabled),
  };
}

/**
 * Select exactly one active plan per completed ride. Plans never stack:
 * the driver receives the plan that leaves them with the highest net earning
 * for this fare. A normal (non-plan) deduction is retained when every active
 * plan would be worse than the rate-card terms.
 */
async function resolveBestBenefit(driverId, fare, baseCommissionPercent = 0, basePerTripCharge = 0, client = prisma) {
  const subscriptions = await activeSubscriptions(driverId, client);
  const candidates = subscriptions.map((subscription) =>
    candidateForFare(subscription, fare, baseCommissionPercent, basePerTripCharge)
  );
  candidates.sort((a, b) => b.benefit - a.benefit || a.deduction - b.deduction || b.subscription.id - a.subscription.id);
  return candidates[0] || null;
}

async function hasPriorityPlan(driverId, client = prisma) {
  const subscriptions = await activeSubscriptions(driverId, client);
  return subscriptions.some(({ tbl_premium_plan: plan }) => Boolean(plan.priority_enabled));
}

function buildPlanPayload(plan, activeSubscriptionsForDriver = [], referralPoints = 0) {
  const type = planType(plan);
  const active = activeSubscriptionsForDriver.find((sub) => sub.plan_id === plan.id);
  const tags = [
    `Commission ${Number(plan.commission_percent) || 0}%`,
    ...(Number(plan.per_trip_charge) > 0 ? [`₹${Number(plan.per_trip_charge)} per trip charge`] : []),
    ...(plan.priority_enabled ? ["Priority ride assignment"] : []),
  ];
  if (type === "DRIVER_SECOND") tags.push(`${plan.guaranteed_rides_per_month} guaranteed rides/month`);
  if (type === "DRIVER_PREMIUM" && plan.incentive_enabled) tags.push(
    plan.incentive_type === "percent" ? `${plan.incentive_value}% bonus per trip` : `₹${plan.incentive_value} bonus per trip`
  );
  if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) tags.push(`₹${plan.wallet_bonus_amount} wallet bonus on purchase`);

  const price = type === "DRIVER_SECOND" ? Number(plan.initial_price) : Number(plan.price);
  const payload = {
    plan_id: plan.id,
    plan_name: plan.plan_name,
    plan_type: type,
    plan_type_label: type === "DRIVER_SECOND" ? "Guaranteed Rides Plan" : "Driver Premium",
    plan_for: "DRIVER",
    description: plan.description || "",
    validity_label: plan.lifetime_enabled ? "Lifetime" : `${plan.validity_days} days`,
    days_left: plan.validity_days,
    expire_date: plan.expire_date ? plan.expire_date.toISOString().slice(0, 10) : null,
    is_popular: Boolean(plan.is_popular),
    is_active: Boolean(active),
    commission_percent: Number(plan.commission_percent) || 0,
    per_trip_charge: Number(plan.per_trip_charge) || 0,
    price_info: type === "DRIVER_SECOND"
      ? { initial_price: price, subscription_price: Number(plan.subscription_price), price, currency_symbol: "₹" }
      : { price, currency_symbol: "₹" },
    ui_tags: tags,
  };
  if (type === "DRIVER_SECOND") {
    payload.guaranteed_rides = {
      per_month: plan.guaranteed_rides_per_month,
      carry_forward: Boolean(plan.rides_carry_forward),
      compensation: plan.guaranteed_compensation,
      compensation_charge: Number(plan.compunsation_charge) || 0,
    };
  }
  if (type === "DRIVER_PREMIUM" && plan.incentive_enabled) {
    payload.incentive = {
      type: plan.incentive_type,
      value: Number(plan.incentive_value),
      min_fare: Number(plan.incentive_min_fare),
      monthly_cap: Number(plan.incentive_monthly_cap),
    };
  }
  if (plan.activity_protection_enabled) {
    payload.activity_protection = {
      after_3_months: Number(plan.activity_protection_3m) || 0,
      after_6_months: Number(plan.activity_protection_6m) || 0,
      after_12_months: Number(plan.activity_protection_12m) || 0,
      min_online_hours: Number(plan.activity_min_online_hours) || 0,
      require_model1: Boolean(plan.activity_require_model1),
      require_zero_requests: Boolean(plan.activity_require_zero_requests),
      require_service_zone: Boolean(plan.activity_require_service_zone),
      eligible_request_ends_day: Boolean(plan.activity_request_ends_day),
    };
    tags.push("Activity protection on eligible no-booking days");
  }
  if (plan.referral_enabled) {
    const pointValue = Number(plan.referral_point_value) || 1;
    payload.refer_and_earn = {
      points_per_referral: plan.referral_points_per_referral,
      point_value: pointValue,
      number_of_referrals: plan.number_of_referrals,
      auto_activate: Boolean(plan.auto_activate_on_referrals),
    };
    payload.purchase_info = {
      points_available: referralPoints,
      points_usable: Math.min(referralPoints, Math.ceil(price / pointValue)),
      point_value: pointValue,
      payable_amount: price,
    };
  }
  return payload;
}

async function listDriverPlans(driverId, cityId) {
  const driver = await prisma.tbl_rider.findUnique({ where: { id: Number(driverId) }, select: { referral_points: true } });
  if (!driver) throw new Error("Driver not found");
  const { start } = todayRange();
  const [plans, subscriptions] = await Promise.all([
    prisma.tbl_premium_plan.findMany({
      where: {
        plan_for: "DRIVER",
        status: true,
        OR: [{ expire_date: null }, { expire_date: { gte: start } }],
      },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    }),
    activeSubscriptions(driverId),
  ]);
  const filtered = cityId ? plans.filter((plan) => !plan.city || plan.city === "all" || plan.city.split(",").includes(String(cityId))) : plans;
  return {
    ResponseCode: "200",
    Result: "true",
    ResponseMsg: "Driver plans fetched successfully.",
    Plans: filtered.map((plan) => buildPlanPayload(plan, subscriptions, Number(driver.referral_points) || 0)),
    ActivePlans: subscriptions.map((sub) => buildPlanPayload(sub.tbl_premium_plan, [sub], Number(driver.referral_points) || 0)),
    Currency: "₹",
  };
}

async function purchaseDriverPlan({ driverId, planId, usePoints = false, paymentTxnId = "", paymentMethod = "", amountPaid = 0 }) {
  const today = todayRange().start;
  return prisma.$transaction(async (tx) => {
    const [driver, plan] = await Promise.all([
      tx.tbl_rider.findUnique({ where: { id: Number(driverId) } }),
      tx.tbl_premium_plan.findFirst({ where: { id: Number(planId), plan_for: "DRIVER", status: true } }),
    ]);
    if (!driver) throw new Error("Driver not found");
    if (!plan || (plan.expire_date && plan.expire_date < today)) throw new Error("Plan is not available for drivers");

    const type = planType(plan);
    const existing = await tx.tbl_user_plan_subscription.findFirst({
      where: { user_id: Number(driverId), plan_for: "DRIVER", plan_type: type, status: "active" },
      orderBy: { id: "desc" },
    });
    if (existing && existing.end_date >= today) throw new Error("You already have an active plan of this type");

    const prior = await tx.tbl_user_plan_subscription.findFirst({
      where: { user_id: Number(driverId), plan_for: "DRIVER", plan_type: type },
      orderBy: { id: "desc" },
    });
    const price = type === "DRIVER_SECOND"
      ? Number(prior ? plan.subscription_price : plan.initial_price)
      : Number(plan.price);
    const pointValue = Number(plan.referral_point_value) || 1;
    const pointsUsed = usePoints && plan.referral_enabled ? Math.min(Number(driver.referral_points) || 0, Math.ceil(price / pointValue)) : 0;
    const pointsAmount = money(pointsUsed * pointValue);
    const payable = money(Math.max(0, price - pointsAmount));
    if (Number(amountPaid) > 0 && money(amountPaid) < payable) throw new Error("Paid amount is less than payable amount");
    if (payable > 0 && !paymentTxnId && !paymentMethod) throw new Error("Payment details are required");

    const planValidityDays = plan.lifetime_enabled ? 36500 : Math.max(1, plan.validity_days);
    const endDate = plan.expire_date || new Date(today.getFullYear(), today.getMonth(), today.getDate() + planValidityDays);
    const target = type === "DRIVER_SECOND" ? Number(plan.guaranteed_rides_per_month) || 0 : 0;
    const snapshot = JSON.stringify({
      plan_name: plan.plan_name, plan_type: type, commission_percent: Number(plan.commission_percent),
      per_trip_charge: Number(plan.per_trip_charge), incentive_enabled: plan.incentive_enabled,
      incentive_type: plan.incentive_type, incentive_value: Number(plan.incentive_value),
      incentive_min_fare: Number(plan.incentive_min_fare), incentive_monthly_cap: Number(plan.incentive_monthly_cap),
      priority_enabled: plan.priority_enabled,
      lifetime_enabled: plan.lifetime_enabled,
      activity_protection_enabled: plan.activity_protection_enabled,
      activity_protection_3m: Number(plan.activity_protection_3m),
      activity_protection_6m: Number(plan.activity_protection_6m),
      activity_protection_12m: Number(plan.activity_protection_12m),
      activity_min_online_hours: plan.activity_min_online_hours,
      activity_require_model1: plan.activity_require_model1,
      activity_require_zero_requests: plan.activity_require_zero_requests,
      activity_require_service_zone: plan.activity_require_service_zone,
      activity_request_ends_day: plan.activity_request_ends_day,
    });
    const subscription = await tx.tbl_user_plan_subscription.create({
      data: {
        user_id: Number(driverId), plan_for: "DRIVER", plan_id: plan.id, plan_type: type, plan_snapshot: snapshot,
        amount_paid: Number(amountPaid) > 0 ? Number(amountPaid) : payable, points_used: pointsUsed, points_amount: pointsAmount,
        payment_txn_id: paymentTxnId || null, payment_method: paymentMethod || (pointsUsed ? "points" : null),
        start_date: today, end_date: endDate, guaranteed_target: target, status: "active",
      },
    });
    if (pointsUsed) await tx.tbl_rider.update({ where: { id: Number(driverId) }, data: { referral_points: { decrement: pointsUsed } } });
    if (plan.wallet_bonus_enabled && Number(plan.wallet_bonus_amount) > 0) {
      const bonus = Number(plan.wallet_bonus_amount);
      await tx.tbl_rider.update({ where: { id: Number(driverId) }, data: { wallet_balance: { increment: bonus } } });
      await tx.tbl_wallet_history.create({ data: { user_id: Number(driverId), amount: bonus, type: "credit", wallet_type: "driver", payment_id: `plan_bonus_${subscription.id}`, remark: `Wallet bonus for ${plan.plan_name}`, created_at: new Date() } });
      await tx.tbl_user_plan_subscription.update({ where: { id: subscription.id }, data: { wallet_bonus_credited: bonus } });
    }
    return { subscription, plan, payable, pointsUsed, pointsAmount };
  });
}

async function recordCompletedRide({ driverId, orderId, fare, baseCommissionPercent = 0, basePerTripCharge = 0, chosenBenefit = null, client = prisma }) {
  const chosen = chosenBenefit || await resolveBestBenefit(driverId, fare, baseCommissionPercent, basePerTripCharge, client);
  if (!chosen || chosen.benefit <= 0) return null;
  const { subscription, plan } = chosen;
  const secondPlanIsComplete = chosen.planType === "DRIVER_SECOND"
    && Number(subscription.guaranteed_target) > 0
    && Number(subscription.guaranteed_used) + 1 >= Number(subscription.guaranteed_target);
  await client.tbl_user_plan_subscription.update({
    where: { id: subscription.id },
    data: {
      rides_completed: { increment: 1 },
      ...(chosen.incentive > 0 ? { incentive_earned: { increment: chosen.incentive } } : {}),
      ...(chosen.planType === "DRIVER_SECOND" ? { guaranteed_used: { increment: 1 } } : {}),
      ...(secondPlanIsComplete ? { status: "expired" } : {}),
    },
  });
  await client.tbl_plan_benefit_log.create({
    data: {
      subscription_id: subscription.id, user_id: Number(driverId), ride_id: Number(orderId), plan_id: plan.id, plan_for: "DRIVER",
      ride_fare: fare, discount_applied: chosen.benefit, fare_after_discount: fare, incentive_earned: chosen.incentive,
      benefit_note: `${plan.plan_name} selected as the best driver benefit`,
    },
  });
  if (chosen.incentive > 0) {
    await client.tbl_rider.update({ where: { id: Number(driverId) }, data: { wallet_balance: { increment: chosen.incentive } } });
    await client.tbl_wallet_history.create({
      data: {
        user_id: Number(driverId), amount: chosen.incentive, type: "credit", wallet_type: "driver",
        payment_id: `plan_incentive_${subscription.id}_${orderId}`,
        order_id: Number(orderId), remark: `Premium incentive from ${plan.plan_name}`, created_at: new Date(),
      },
    });
  }
  return chosen;
}

module.exports = {
  listDriverPlans,
  purchaseDriverPlan,
  resolveBestBenefit,
  recordCompletedRide,
  hasPriorityPlan,
  __private: { candidateForFare },
};
