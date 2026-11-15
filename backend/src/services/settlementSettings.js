const prisma = require("../config/db");
const logger = require("../utils/logger");

// Admin-editable via the existing Settings page `flags` (settingsController.js
// upserts arbitrary keys into app_settings), so no dedicated settings table.
const KEYS = Object.freeze({
  enabled: "settlement_enabled",
  reminderMinutes: "settlement_reminder_minutes",
  escalateAfterMinutes: "settlement_escalate_after_minutes",
  driverBlockGraceMinutes: "settlement_driver_block_grace_minutes",
  disputeWindowHours: "settlement_dispute_window_hours",
  autoReceiveMinutes: "settlement_auto_receive_minutes",
});

const DEFAULTS = Object.freeze({
  enabled: false,
  reminderMinutes: Object.freeze([10, 30]),
  escalateAfterMinutes: 60,
  driverBlockGraceMinutes: 10,
  disputeWindowHours: 48,
  // A pending cash/UPI payment is marked received by the system this long after the trip ended. 0 = never.
  autoReceiveMinutes: 15,
});

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());

function toPositive(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toMinutesOrZero(v, fallback) {
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toMinuteList(v) {
  const nums = String(v ?? "")
    .split(",")
    .map((p) => parseFloat(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function defaults() {
  return { ...DEFAULTS, reminderMinutes: [...DEFAULTS.reminderMinutes] };
}

async function getSettlementSettings() {
  try {
    const rows = await prisma.app_settings.findMany({
      where: { setting_key: { in: Object.values(KEYS) } },
    });
    const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      enabled: toBool(byKey.get(KEYS.enabled)),
      reminderMinutes: byKey.has(KEYS.reminderMinutes)
        ? toMinuteList(byKey.get(KEYS.reminderMinutes))
        : [...DEFAULTS.reminderMinutes],
      escalateAfterMinutes: toPositive(byKey.get(KEYS.escalateAfterMinutes), DEFAULTS.escalateAfterMinutes),
      driverBlockGraceMinutes: toPositive(byKey.get(KEYS.driverBlockGraceMinutes), DEFAULTS.driverBlockGraceMinutes),
      disputeWindowHours: toPositive(byKey.get(KEYS.disputeWindowHours), DEFAULTS.disputeWindowHours),
      autoReceiveMinutes: toMinutesOrZero(byKey.get(KEYS.autoReceiveMinutes), DEFAULTS.autoReceiveMinutes),
    };
  } catch (err) {
    // Fail closed: an unreadable switch must never turn settlement ON.
    logger.error("getSettlementSettings: failed to read settings, treating feature as disabled:", err);
    return defaults();
  }
}

// publicView() is synchronous and used everywhere, so the driver countdown reads this small cache. It is refreshed in
// the background (at most every CACHE_TTL_MS); the sweep itself always reads the live settings.
const CACHE_TTL_MS = 30 * 1000;
const cache = { at: 0, value: { enabled: false, autoReceiveMinutes: DEFAULTS.autoReceiveMinutes }, loading: false };

function autoReceiveCached() {
  if (!cache.loading && Date.now() - cache.at > CACHE_TTL_MS) {
    cache.loading = true;
    getSettlementSettings()
      .then((s) => { cache.value = { enabled: s.enabled, autoReceiveMinutes: s.autoReceiveMinutes }; })
      .catch(() => {})
      .finally(() => { cache.at = Date.now(); cache.loading = false; });
  }
  return cache.value.enabled ? cache.value.autoReceiveMinutes : 0;
}

async function isSettlementEnabled() {
  return (await getSettlementSettings()).enabled;
}

module.exports = { KEYS, DEFAULTS, getSettlementSettings, isSettlementEnabled, autoReceiveCached };
