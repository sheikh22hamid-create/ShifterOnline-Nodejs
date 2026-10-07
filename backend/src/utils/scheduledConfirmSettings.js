const prisma = require("../config/db");
const logger = require("./logger");
const { SCHEDULED_ORDER_REMINDER_LEAD_MS, SCHEDULED_ORDER_MIN_ADVANCE_MINUTES } = require("../config/constants");

const KEY = "scheduled_confirm_popup_minutes";
const MIN_ADVANCE_KEY = "scheduled_min_advance_minutes";

// How many minutes before a scheduled ride's time the customer is asked
// "Do you still want to continue?". Admin-configurable (Settings page); no
// caching, same convention as pickupOtpTimeout.js.
async function getScheduledConfirmLeadMs() {
  const defaultMs = SCHEDULED_ORDER_REMINDER_LEAD_MS;
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: KEY } });
    const minutes = parseFloat(row?.setting_value);
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : defaultMs;
  } catch (err) {
    logger.error("getScheduledConfirmLeadMs: failed to read admin setting, using default:", err);
    return defaultMs;
  }
}

// The same lead time in whole minutes, for the apps (the driver app's Scheduled Trips banner).
async function getScheduledConfirmLeadMinutes() {
  return Math.round((await getScheduledConfirmLeadMs()) / 60000);
}

// The earliest a customer may schedule a ride, in minutes from now. Admin-configurable; falls back
// to the default when unset, non-numeric or not positive.
async function getScheduledMinAdvanceMinutes() {
  const defaultMinutes = SCHEDULED_ORDER_MIN_ADVANCE_MINUTES;
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: MIN_ADVANCE_KEY } });
    const minutes = Math.round(parseFloat(row?.setting_value));
    return Number.isFinite(minutes) && minutes > 0 ? minutes : defaultMinutes;
  } catch (err) {
    logger.error("getScheduledMinAdvanceMinutes: failed to read admin setting, using default:", err);
    return defaultMinutes;
  }
}

module.exports = {
  getScheduledConfirmLeadMs,
  getScheduledConfirmLeadMinutes,
  getScheduledMinAdvanceMinutes,
  SCHEDULED_CONFIRM_KEY: KEY,
  SCHEDULED_MIN_ADVANCE_KEY: MIN_ADVANCE_KEY,
};
