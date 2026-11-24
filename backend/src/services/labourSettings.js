// Loading/Unloading labour config reader (spec 2026-11-24).
// Reads the owner-tunable labour_* app_settings and resolves them (with safe defaults) into the
// config object labourPricing.computeLabour consumes. A DB hiccup or bad JSON keeps the feature OFF
// / falls back to defaults, so bookings never break on a settings problem.

const prisma = require("../config/db");
const logger = require("../utils/logger");

// Baked-in defaults == the migration seed. Feature OFF until an admin enables it per city.
const DEFAULTS = {
  enabled: false,
  baseHome: 60,
  baseShop: 80,
  sizeMult: { small: 1, medium: 1.6, large: 2.6 },
  floorMult: { ground: 1, f1_2: 1.4, f3plus: 1.9, lift_factor: 0.6 },
  qtyMult: { q15: 1, q15_40: 1.8, q40plus: 3 },
  accessMult: { shutter: 1, stack_inside: 1.5, loft_basement: 2.2 },
  caps: {
    max_size: "medium",
    max_floor: "f1_2",
    max_qty: "q15_40",
    blocked_access: ["loft_basement"],
    heavy_items: ["fridge", "cement", "tandoor", "almirah", "washing_machine"],
  },
  fee: 0,
};

const KEYS = [
  "labour_enabled",
  "labour_base_home",
  "labour_base_shop",
  "labour_size_mult",
  "labour_floor_mult",
  "labour_qty_mult",
  "labour_access_mult",
  "labour_caps",
  "labour_fee",
];

function parseJson(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseNum(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pure: resolve a {setting_key: setting_value} map + cityId into a labour config.
 */
function buildConfig(map, cityId) {
  const m = map || {};
  const enabledCfg = parseJson(m.labour_enabled, { global: false, cities: {} });
  const cities = enabledCfg.cities || {};
  const cityKey = String(cityId);
  const enabled = Object.prototype.hasOwnProperty.call(cities, cityKey)
    ? cities[cityKey] === true
    : enabledCfg.global === true;

  return {
    enabled,
    baseHome: parseNum(m.labour_base_home, DEFAULTS.baseHome),
    baseShop: parseNum(m.labour_base_shop, DEFAULTS.baseShop),
    sizeMult: parseJson(m.labour_size_mult, DEFAULTS.sizeMult),
    floorMult: parseJson(m.labour_floor_mult, DEFAULTS.floorMult),
    qtyMult: parseJson(m.labour_qty_mult, DEFAULTS.qtyMult),
    accessMult: parseJson(m.labour_access_mult, DEFAULTS.accessMult),
    caps: parseJson(m.labour_caps, DEFAULTS.caps),
    fee: parseNum(m.labour_fee, DEFAULTS.fee),
  };
}

/**
 * Read the labour_* settings and resolve the config for a city. Never throws.
 */
async function getLabourConfig(cityId) {
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: KEYS } } });
    const map = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;
    return buildConfig(map, cityId);
  } catch (err) {
    logger.warn(`labourSettings.getLabourConfig: defaults/off (${err.message})`);
    return { ...DEFAULTS };
  }
}

module.exports = { buildConfig, getLabourConfig, DEFAULTS, KEYS };
