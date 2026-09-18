const prisma = require("../config/db");

// Shared reader for the auto-verification charge settings (admin-configurable
// via app_settings) - used by registration (to decide whether a new driver
// owes a payment), the verification-payment endpoints (to price the
// Razorpay order server-side, never trusting the client's amount), and the
// registration-settings endpoint the app reads before showing the form.
async function getAutoVerificationSettings() {
  const rows = await prisma.app_settings.findMany({
    where: {
      setting_key: { in: ["auto_verification", "auto_verification_charge", "auto_verification_charge_old", "auto_verification_msg"] },
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const num = (k, def = 0) => {
    const v = Number(map[k]);
    return Number.isFinite(v) ? v : def;
  };

  return {
    enabled: num("auto_verification", 0) === 1,
    charge: num("auto_verification_charge", 0),
    chargeOld: num("auto_verification_charge_old", 0),
    msg: map.auto_verification_msg || "",
  };
}

module.exports = { getAutoVerificationSettings };
