const prisma = require("../config/db");
const logger = require("../utils/logger");
const settlementSettings = require("./settlementSettings");

// Admin-editable through the existing Settings page `flags` (app_settings), same
// pattern as settlementSettings.js.
const KEYS = Object.freeze({
  enabled: "receiver_pay_enabled",
  maxPercent: "receiver_commission_max_percent",
  maxAmount: "receiver_commission_max_amount",
  linkTtlHours: "receiver_pay_link_ttl_hours",
});
const DEFAULTS = Object.freeze({ enabled: false, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
function toNonNegative(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function toPositive(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getReceiverPaySettings() {
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: Object.values(KEYS) } } });
    const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      enabled: toBool(byKey.get(KEYS.enabled)),
      // A commission above 100% of the fare is never meaningful; clamp an admin typo.
      maxPercent: Math.min(toNonNegative(byKey.get(KEYS.maxPercent), DEFAULTS.maxPercent), 100),
      maxAmount: toNonNegative(byKey.get(KEYS.maxAmount), DEFAULTS.maxAmount),
      linkTtlHours: toPositive(byKey.get(KEYS.linkTtlHours), DEFAULTS.linkTtlHours),
    };
  } catch (err) {
    // Fail closed: an unreadable switch must never turn the feature ON.
    logger.error("getReceiverPaySettings: failed to read settings, treating feature as disabled:", err);
    return { ...DEFAULTS };
  }
}

// Receiver pay rides on the settlement flow, so both switches must be on.
async function isReceiverPayAvailable() {
  const s = await getReceiverPaySettings();
  if (!s.enabled) return false;
  return settlementSettings.isSettlementEnabled();
}

module.exports = { KEYS, DEFAULTS, getReceiverPaySettings, isReceiverPayAvailable };
