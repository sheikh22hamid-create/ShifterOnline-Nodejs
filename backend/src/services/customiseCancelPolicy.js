const prisma = require("../config/db");
const logger = require("../utils/logger");

// Customise Order cancellation policy (spec 2026-10-26, sections 12-14). Stored in app_settings per city with a global
// fallback; one policy for each side that can cancel. "normal" (also anything missing, unreadable or invalid) means
// the ride keeps today's rate-card cancellation fee, so no amount is ever invented.
//   special charge = fixed + agreedFare * percent / 100, never more than the agreedFare
//   the admin keeps adminSharePercent of it; the rest goes to the other party through the existing wallet + ledger.
const SIDES = ["driver", "customer"];
const MODES = ["normal", "special"];
const FIELDS = { mode: "mode", fixed: "fixed", percent: "percent", adminSharePercent: "admin_share" };
const NORMAL = { mode: "normal", fixed: 0, percent: 0, adminSharePercent: 0 };

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const key = (side, field, cityId) => `customise_cancel_${side}_${FIELDS[field]}${cityId != null ? `_city_${cityId}` : ""}`;

function penaltyOf(policy, agreedFare) {
  const zero = { charge: 0, adminShare: 0, recipientAmount: 0 };
  if (!policy || policy.mode !== "special") return zero;
  const fare = Math.max(0, num(agreedFare));
  const raw = Math.max(0, num(policy.fixed)) + (fare * Math.min(100, Math.max(0, num(policy.percent)))) / 100;
  const charge = round2(Math.min(raw, fare));
  if (charge <= 0) return zero;
  const share = Math.min(100, Math.max(0, num(policy.adminSharePercent)));
  const adminShare = round2((charge * share) / 100);
  return { charge, adminShare, recipientAmount: round2(charge - adminShare) };
}

async function getPolicy(side, cityId) {
  if (!SIDES.includes(side)) return { ...NORMAL };
  try {
    const keys = Object.keys(FIELDS).flatMap((f) => [key(side, f, null), ...(cityId != null ? [key(side, f, cityId)] : [])]);
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: keys } } });
    const value = (field) => {
      const city = cityId != null ? rows.find((r) => r.setting_key === key(side, field, cityId)) : null;
      return (city ?? rows.find((r) => r.setting_key === key(side, field, null)))?.setting_value;
    };
    const mode = String(value("mode") ?? "").trim().toLowerCase();
    if (!MODES.includes(mode)) return { ...NORMAL };
    return { mode, fixed: Math.max(0, num(value("fixed"))), percent: Math.max(0, num(value("percent"))), adminSharePercent: Math.max(0, num(value("adminSharePercent"))) };
  } catch (err) {
    logger.warn(`customiseCancelPolicy.getPolicy(${side}, ${cityId}): using Normal (${err.message})`);
    return { ...NORMAL };
  }
}

function assertValid(policy) {
  if (!MODES.includes(policy?.mode)) throw new Error("mode must be normal or special");
  const { fixed, percent, adminSharePercent } = policy;
  if (!(Number(fixed) >= 0)) throw new Error("fixed amount must be zero or more");
  if (!(Number(percent) >= 0 && Number(percent) <= 100)) throw new Error("percentage must be between 0 and 100");
  if (!(Number(adminSharePercent) >= 0 && Number(adminSharePercent) <= 100)) throw new Error("admin share must be between 0 and 100");
}

async function savePolicy(side, cityId, policy) {
  if (!SIDES.includes(side)) throw new Error("side must be driver or customer");
  assertValid(policy);
  for (const field of Object.keys(FIELDS)) {
    const where = { setting_key: key(side, field, cityId) };
    const setting_value = String(policy[field]);
    await prisma.app_settings.upsert({ where, create: { ...where, setting_value }, update: { setting_value } });
  }
}

module.exports = { penaltyOf, getPolicy, savePolicy, assertValid, NORMAL };
