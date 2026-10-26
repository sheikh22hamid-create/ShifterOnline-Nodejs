const prisma = require("../config/db");
const logger = require("../utils/logger");

// Low Fare Booking switches (app_settings key/value). OFF until an admin sets `low_fare_booking_enabled` to 1/true/on;
// a read error keeps it off. The discount is clamped to 0..50; the limits fall back to their defaults.
const ENABLED_KEY = "low_fare_booking_enabled";
const DEFAULTS = { low_fare_discount_percent: 20, low_fare_max_days_ahead: 7, low_fare_max_window_hours: 12 };

async function isEnabled() {
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: ENABLED_KEY } });
    return ["1", "true", "on", "yes"].includes(String(row?.setting_value ?? "").trim().toLowerCase());
  } catch (err) {
    logger.warn(`lowFareSettings.isEnabled: treating as off (${err.message})`);
    return false;
  }
}

async function getConfig() {
  let rows = [];
  try {
    rows = await prisma.app_settings.findMany({ where: { setting_key: { in: Object.keys(DEFAULTS) } } });
  } catch (err) {
    logger.warn(`lowFareSettings.getConfig: using defaults (${err.message})`);
  }
  const read = (key, { min, max }) => {
    const raw = rows.find((r) => r.setting_key === key)?.setting_value;
    const n = raw === undefined || raw === null || String(raw).trim() === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULTS[key];
  };
  return {
    discountPercent: read("low_fare_discount_percent", { min: 0, max: 50 }),
    maxDaysAhead: Math.round(read("low_fare_max_days_ahead", { min: 1, max: 30 })),
    maxWindowHours: read("low_fare_max_window_hours", { min: 1, max: 24 }),
  };
}

async function saveConfig({ discountPercent, maxDaysAhead, maxWindowHours }) {
  if (!(Number(discountPercent) >= 0 && Number(discountPercent) <= 50)) throw new Error("discount must be between 0 and 50");
  if (!(Number(maxDaysAhead) >= 1 && Number(maxDaysAhead) <= 30)) throw new Error("days ahead must be between 1 and 30");
  if (!(Number(maxWindowHours) >= 1 && Number(maxWindowHours) <= 24)) throw new Error("window length must be between 1 and 24 hours");
  const values = { low_fare_discount_percent: discountPercent, low_fare_max_days_ahead: maxDaysAhead, low_fare_max_window_hours: maxWindowHours };
  for (const [key, value] of Object.entries(values)) {
    const where = { setting_key: key };
    const setting_value = String(value);
    await prisma.app_settings.upsert({ where, create: { ...where, setting_value }, update: { setting_value } });
  }
}

module.exports = { isEnabled, getConfig, saveConfig, ENABLED_KEY };
