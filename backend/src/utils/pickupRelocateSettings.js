const prisma = require("../config/db");
const logger = require("./logger");

// Mirrors pickupOtpTimeout.js's convention exactly: no caching, one
// indexed lookup per call, defaults on any parse failure or missing row.
const DEFAULTS = {
  ceilingMinutes: 35,
  smallMoveThresholdM: 200,
  otpMismatchFlagM: 500,
  driverCompensation: 0,
  autoCompleteDistanceM: 150,
};

const KEYS = {
  pickup_relocate_ceiling_minutes: "ceilingMinutes",
  pickup_small_move_threshold_m: "smallMoveThresholdM",
  pickup_otp_mismatch_flag_m: "otpMismatchFlagM",
  pickup_timeout_driver_compensation: "driverCompensation",
  pickup_complete_auto_distance_m: "autoCompleteDistanceM",
};

function parsePositive(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function getPickupRelocateSettings() {
  try {
    const rows = await prisma.app_settings.findMany({
      where: { setting_key: { in: Object.keys(KEYS) } },
    });
    const settings = { ...DEFAULTS };
    for (const row of rows) {
      const field = KEYS[row.setting_key];
      if (field) settings[field] = parsePositive(row.setting_value, DEFAULTS[field]);
    }
    return settings;
  } catch (err) {
    logger.error("getPickupRelocateSettings: failed to read admin settings, using defaults:", err);
    return { ...DEFAULTS };
  }
}

module.exports = { getPickupRelocateSettings };
