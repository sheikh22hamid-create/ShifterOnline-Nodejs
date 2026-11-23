const prisma = require("../config/db");
const logger = require("../utils/logger");

// Porter live pricing switch (app_settings key, JSON value). OFF by default; any read/parse error keeps it off.
const KEY = "porter_live_pricing";
const DEFAULTS = { enabled: false, cityIds: [], timeoutMs: 3000, cacheMinutes: 10 };
const TIMEOUT_MIN = 500;
// Capped at 4 s: route-change anchors are computed before a row-lock transaction, and Prisma's default
// interactive-transaction timeout is 5 s; keeping Porter well under it bounds how long a booking can wait.
const TIMEOUT_MAX = 4000;
const CONFIG_TTL_MS = 30 * 1000;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Parsed config cached in memory for 30 s (read on every estimate and booking); saveConfig invalidates it.
let cached = null; // { at, config }
function _resetCacheForTests() {
  cached = null;
}
const copy = (c) => ({ ...c, cityIds: [...c.cityIds] });

function normalize(raw) {
  const num = (v, d, min, max) => {
    const n = v === undefined || v === null || String(v).trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) ? clamp(n, min, max) : d;
  };
  const ids = Array.isArray(raw.city_ids) ? raw.city_ids.map(Number).filter((n) => Number.isInteger(n)) : [];
  return {
    enabled: raw.enabled === true,
    cityIds: ids,
    timeoutMs: Math.round(num(raw.timeout_ms, DEFAULTS.timeoutMs, TIMEOUT_MIN, TIMEOUT_MAX)),
    cacheMinutes: Math.round(num(raw.cache_minutes, DEFAULTS.cacheMinutes, 1, 60)),
  };
}

async function loadConfig() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: KEY } });
  if (!row?.setting_value) return { ...DEFAULTS, cityIds: [] };
  const parsed = JSON.parse(row.setting_value);
  if (!parsed || typeof parsed !== "object") return { ...DEFAULTS, cityIds: [] };
  return normalize(parsed);
}

async function getConfig() {
  try {
    if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return copy(cached.config);
    const config = await loadConfig();
    cached = { at: Date.now(), config };
    return copy(config);
  } catch (err) {
    logger.warn(`porterLiveSettings.getConfig: using defaults (${err.message})`);
    return { ...DEFAULTS, cityIds: [] };
  }
}

async function isActiveForCity(cityId) {
  const id = Number(cityId);
  if (cityId === null || cityId === undefined || !Number.isInteger(id)) return false;
  const cfg = await getConfig();
  return cfg.enabled && cfg.cityIds.includes(id);
}

async function saveConfig({ enabled, cityIds, timeoutMs, cacheMinutes }) {
  if (!Array.isArray(cityIds) || !cityIds.every((c) => Number.isInteger(Number(c)) && String(c).trim() !== "")) {
    throw new Error("cityIds must be an array of city ids");
  }
  const t = Number(timeoutMs);
  const c = Number(cacheMinutes);
  if (!(t >= TIMEOUT_MIN && t <= TIMEOUT_MAX)) throw new Error(`timeoutMs must be between ${TIMEOUT_MIN} and ${TIMEOUT_MAX}`);
  if (!(c >= 1 && c <= 60)) throw new Error("cacheMinutes must be between 1 and 60");
  const config = { enabled: enabled === true, cityIds: cityIds.map(Number), timeoutMs: Math.round(t), cacheMinutes: Math.round(c) };
  const setting_value = JSON.stringify({ enabled: config.enabled, city_ids: config.cityIds, timeout_ms: config.timeoutMs, cache_minutes: config.cacheMinutes });
  const where = { setting_key: KEY };
  await prisma.app_settings.upsert({ where, create: { ...where, setting_value }, update: { setting_value } });
  cached = null;
  return config;
}

module.exports = { getConfig, isActiveForCity, saveConfig, KEY, _resetCacheForTests };
