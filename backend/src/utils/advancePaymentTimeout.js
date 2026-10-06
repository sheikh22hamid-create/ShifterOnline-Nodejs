const prisma = require("../config/db");
const logger = require("./logger");
const { ADVANCE_PAYMENT_TIMEOUT_MS } = require("../config/constants");

let cachedTimeoutSeconds = Math.round(ADVANCE_PAYMENT_TIMEOUT_MS / 1000);
let lastFetchTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Reads admin-configured advance payment timeout in minutes from app_settings
 * table (key: advance_payment_timeout_minutes). Defaults to ADVANCE_PAYMENT_TIMEOUT_MS
 * (2 minutes) if not configured or invalid.
 */
async function getAdvancePaymentTimeoutMinutes() {
  const defaultMinutes = ADVANCE_PAYMENT_TIMEOUT_MS / 60000;
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: "advance_payment_timeout_minutes" } });
    const parsed = parseFloat(row?.setting_value);
    const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMinutes;
    cachedTimeoutSeconds = Math.round(minutes * 60);
    lastFetchTime = Date.now();
    return minutes;
  } catch (err) {
    logger.error("getAdvancePaymentTimeoutMinutes: failed to read admin setting, using default:", err);
    return defaultMinutes;
  }
}

async function getAdvancePaymentTimeoutSeconds() {
  const minutes = await getAdvancePaymentTimeoutMinutes();
  return Math.round(minutes * 60);
}

function getCachedAdvancePaymentTimeoutSeconds() {
  if (Date.now() - lastFetchTime > CACHE_TTL_MS) {
    getAdvancePaymentTimeoutMinutes().catch(() => {});
  }
  return cachedTimeoutSeconds;
}

module.exports = {
  getAdvancePaymentTimeoutMinutes,
  getAdvancePaymentTimeoutSeconds,
  getCachedAdvancePaymentTimeoutSeconds,
};
