const prisma = require("../config/db");
const logger = require("./logger");
const { PICKUP_OTP_TIMEOUT_MS } = require("../config/constants");

// Shared by tripLifecycle.sweepOverduePickups (enforcement - auto-cancels an
// overdue pickup) and driverTripService.progressTrip (display - the
// countdown the driver's OTP dialog shows), so both agree on the same
// admin-configured minutes. No caching, deliberately - sweepOverduePickups
// re-reads fresh every sweep tick so an admin change takes effect on the
// very next sweep, and this is a single indexed lookup, cheap enough to run
// on every progressTrip snapshot too.
async function getPickupOtpTimeoutMinutes() {
  const defaultMinutes = PICKUP_OTP_TIMEOUT_MS / 60000;
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: "pickup_otp_timeout_minutes" } });
    const parsed = parseFloat(row?.setting_value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMinutes;
  } catch (err) {
    logger.error("getPickupOtpTimeoutMinutes: failed to read admin setting, using default:", err);
    return defaultMinutes;
  }
}

module.exports = { getPickupOtpTimeoutMinutes };
