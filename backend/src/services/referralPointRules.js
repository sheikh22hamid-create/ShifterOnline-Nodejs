// Single source of truth for redeeming referral points against a premium
// plan's price (customers and drivers alike). Admin controls it from the
// Referral settings page: a global on/off (plan_purchase_enabled) and the max
// % of the plan price points may cover (plan_points_max_percent). The
// per-plan referral_enabled flag now only governs earning (refer-and-earn),
// not whether points can be spent - previously every plan had to opt in, so
// with no plan opted in nobody could pay for a plan with points.

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function getPlanPointRules(client, plan) {
  const setting = await client.tbl_referral_setting.findFirst();
  const programOn = setting ? Boolean(setting.referral_enabled) : true;
  const planPurchaseOn = setting ? setting.plan_purchase_enabled !== false : true;

  const planValue = Number(plan?.referral_point_value);
  const globalValue = Number(setting?.point_value);
  const pointValue = plan?.referral_enabled && planValue > 0 ? planValue : globalValue > 0 ? globalValue : 1;

  const rawPercent = setting?.plan_points_max_percent;
  const percent = rawPercent === undefined || rawPercent === null ? 100 : Number(rawPercent);
  const maxPercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 100;

  return { enabled: programOn && planPurchaseOn, pointValue, maxPercent };
}

// How many points (and rupees) can be applied to `price`. Points are whole
// numbers; the credited amount is always clamped to the cap (never more than
// the price) and points never exceed the balance.
function computePlanPointUsage({ price, pointValue, maxPercent, available }) {
  const cap = money((Number(price) * Number(maxPercent)) / 100);
  const balance = Math.max(0, Math.floor(Number(available) || 0));
  if (cap <= 0 || balance <= 0 || !(pointValue > 0)) {
    return { pointsUsable: 0, pointsAmount: 0, payable: money(Math.max(0, price)) };
  }
  // Only a 100% cap may round the last point up (so a plan can be paid for
  // entirely with points); under a lower cap stay at or below it, so the
  // amount clients compute (points x point value) equals what we credit.
  const fullCover = cap >= Number(price);
  const pointsUsable = Math.min(balance, fullCover ? Math.ceil(cap / pointValue) : Math.floor(cap / pointValue));
  const pointsAmount = money(Math.min(pointsUsable * pointValue, cap));
  return { pointsUsable, pointsAmount, payable: money(Math.max(0, price - pointsAmount)) };
}

module.exports = { getPlanPointRules, computePlanPointUsage };
