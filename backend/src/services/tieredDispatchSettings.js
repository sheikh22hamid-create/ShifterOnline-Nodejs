const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./tierPenaltyRules");

// Stored in app_settings like settlementSettings.js, so no dedicated table.
const KEYS = Object.freeze({
  tieredEnabled: "tiered_dispatch_enabled",
  penaltyEnabled: "tier_penalty_enabled",
  ladder: "tier_penalty_ladder",
  cancelPenaltyPct: "tier_cancel_penalty_pct",
});
const TTL_MS = 5000;
let cache = null; // { at, value }

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const defaults = () => ({ tieredEnabled: false, penaltyEnabled: false, ladder: [...rules.DEFAULT_LADDER], cancelPenaltyPct: 100 });

async function getTierSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: Object.values(KEYS) } } });
    const by = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    const pct = Number(by.get(KEYS.cancelPenaltyPct));
    const value = {
      tieredEnabled: toBool(by.get(KEYS.tieredEnabled)),
      penaltyEnabled: toBool(by.get(KEYS.penaltyEnabled)),
      ladder: rules.parseLadder(by.get(KEYS.ladder)),
      cancelPenaltyPct: by.has(KEYS.cancelPenaltyPct) && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 100,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // Fail closed: an unreadable switch must never turn tiered dispatch or penalties ON.
    logger.error("getTierSettings: failed to read settings, treating tiered dispatch as disabled:", err);
    return defaults();
  }
}

async function isTieredEnabled() {
  return (await getTierSettings()).tieredEnabled;
}

async function saveTierSettings({ tieredEnabled, penaltyEnabled, ladder, cancelPenaltyPct } = {}) {
  const writes = [];
  if (tieredEnabled !== undefined) writes.push([KEYS.tieredEnabled, tieredEnabled ? "1" : "0"]);
  if (penaltyEnabled !== undefined) writes.push([KEYS.penaltyEnabled, penaltyEnabled ? "1" : "0"]);
  if (ladder !== undefined) {
    const list = Array.isArray(ladder) ? ladder.map(Number) : String(ladder).split(",").map((p) => Number(p.trim()));
    if (list.length === 0 || list.some((n) => !Number.isFinite(n) || n <= 0 || n > 100)) {
      throw badRequest("ladder must be percentages between 1 and 100, for example 5,10,20,50,100");
    }
    writes.push([KEYS.ladder, list.join(",")]);
  }
  if (cancelPenaltyPct !== undefined) {
    const n = Number(cancelPenaltyPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest("cancel penalty must be between 0 and 100");
    writes.push([KEYS.cancelPenaltyPct, String(n)]);
  }
  for (const [key, value] of writes) {
    await prisma.app_settings.upsert({
      where: { setting_key: key },
      update: { setting_value: value },
      create: { setting_key: key, setting_value: value },
    });
  }
  cache = null;
  return getTierSettings({ fresh: true });
}

function _resetCache() {
  cache = null;
}

module.exports = { KEYS, getTierSettings, isTieredEnabled, saveTierSettings, _resetCache };
