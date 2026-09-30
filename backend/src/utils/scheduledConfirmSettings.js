const prisma = require("../config/db");
const logger = require("./logger");
const { SCHEDULED_ORDER_REMINDER_LEAD_MS } = require("../config/constants");

const KEY = "scheduled_confirm_popup_minutes";

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

module.exports = { getScheduledConfirmLeadMs, SCHEDULED_CONFIRM_KEY: KEY };
