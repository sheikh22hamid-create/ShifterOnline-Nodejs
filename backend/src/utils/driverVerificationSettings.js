const prisma = require("../config/db");

// Per-vehicle-type overrides live in app_settings as
// `auto_verification_charge_vehicle_<slug>` (slug of the vehicle category name,
// e.g. "Three Wheeler" -> "three_wheeler"). The admin Settings page uses the
// same slug rule (frontend/src/pages/Settings.jsx) - keep the two in sync.
const VEHICLE_CHARGE_PREFIX = "auto_verification_charge_vehicle_";

function vehicleSlug(name) {
  return String(name || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

// Shared reader for the auto-verification charge settings (admin-configurable
// via app_settings) - used by registration (to decide whether a new driver
// owes a payment), the verification-payment endpoints (to price the
// Razorpay order server-side, never trusting the client's amount), and the
// registration-settings endpoint the app reads before showing the form.
//
// Pass `vehicle` (the driver's chosen vehicle type) to get the charge for that
// type. A type with no override set falls back to the global charge; an
// explicit 0 override means that type is free. One type's fee never applies
// to another type.
async function getAutoVerificationSettings({ vehicle } = {}) {
  const rows = await prisma.app_settings.findMany({
    where: {
      OR: [
        { setting_key: { in: ["auto_verification", "auto_verification_charge", "auto_verification_charge_old", "auto_verification_msg"] } },
        { setting_key: { startsWith: VEHICLE_CHARGE_PREFIX } },
      ],
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const num = (k, def = 0) => {
    const v = Number(map[k]);
    return Number.isFinite(v) ? v : def;
  };

  const vehicleCharges = {};
  for (const [key, raw] of Object.entries(map)) {
    if (!key.startsWith(VEHICLE_CHARGE_PREFIX) || String(raw ?? "").trim() === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) vehicleCharges[key.slice(VEHICLE_CHARGE_PREFIX.length)] = v;
  }

  const defaultCharge = num("auto_verification_charge", 0);
  const slug = vehicleSlug(vehicle);
  const hasOverride = slug !== "" && Object.prototype.hasOwnProperty.call(vehicleCharges, slug);
  const charge = hasOverride ? vehicleCharges[slug] : defaultCharge;
  let chargeOld = num("auto_verification_charge_old", 0);
  // The global strikethrough price is meaningless against a different per-type fee.
  if (hasOverride && chargeOld <= charge) chargeOld = 0;

  return {
    enabled: num("auto_verification", 0) === 1,
    charge,
    chargeOld,
    msg: map.auto_verification_msg || "",
    defaultCharge,
    vehicleCharges,
  };
}

module.exports = { getAutoVerificationSettings, vehicleSlug, VEHICLE_CHARGE_PREFIX };
