const prisma = require("../config/db");
const logger = require("../utils/logger");

// Customise Order switches and bounds (app_settings key/value). The feature is OFF until an admin sets
// `customise_order_enabled` to 1/true/on, and any read error keeps it off.
const ENABLED_KEY = "customise_order_enabled";
const DEFAULTS = { customise_min_fare: 50, customise_max_fare: 500000, customise_max_window_hours: 24 };

async function isEnabled() {
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: ENABLED_KEY } });
    return ["1", "true", "on", "yes"].includes(String(row?.setting_value ?? "").trim().toLowerCase());
  } catch (err) {
    logger.warn(`customiseOrderSettings.isEnabled: treating as off (${err.message})`);
    return false;
  }
}

async function getBounds() {
  let rows = [];
  try {
    rows = await prisma.app_settings.findMany({ where: { setting_key: { in: Object.keys(DEFAULTS) } } });
  } catch (err) {
    logger.warn(`customiseOrderSettings.getBounds: using defaults (${err.message})`);
  }
  const read = (key) => {
    const n = parseFloat(rows.find((r) => r.setting_key === key)?.setting_value);
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS[key];
  };
  return { minFare: read("customise_min_fare"), maxFare: read("customise_max_fare"), maxWindowHours: read("customise_max_window_hours") };
}

module.exports = { isEnabled, getBounds, ENABLED_KEY };
