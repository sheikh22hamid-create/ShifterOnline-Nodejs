const prisma = require("../config/db");
const { vehicleSlug } = require("../utils/driverVerificationSettings");

// Driver wallet limits, configurable per vehicle type from the admin Settings page.
//   - "Minimum Required Balance": the reserve that must stay in the driver's ledger on a withdrawal
//     (global key driver_min_withdrawal_amount).
//   - "Negative Balance Limit": how far below zero the ledger may go before the driver stops receiving orders
//     (global key driver_max_due_limit).
// A vehicle type's own value lives under `<global key>_vehicle_<slug>` (slug of the vehicle name, same rule as
// auto_verification_charge_vehicle_*). A type with no value of its own - or a driver with no vehicle on file -
// uses the global value, so nothing changes until an admin sets a per-vehicle amount.
const DRIVER_MAX_DUE_LIMIT_KEY = "driver_max_due_limit";
const DEFAULT_DRIVER_MAX_DUE_LIMIT = 100;
const DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY = "driver_min_withdrawal_amount";
const DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT = 0;
const VEHICLE_KEY_INFIX = "_vehicle_";

const vehicleKey = (globalKey, vehicle) => {
  const slug = vehicleSlug(vehicle);
  return slug ? `${globalKey}${VEHICLE_KEY_INFIX}${slug}` : null;
};

async function readNumericSetting(key) {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: key } });
  return row ? toNumber(row.setting_value) : null;
}

const toNumber = (raw) => {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

async function readVehicleAwareSetting(globalKey, fallback, vehicle) {
  const key = vehicleKey(globalKey, vehicle);
  if (!key) {
    const global = await readNumericSetting(globalKey);
    return global === null ? fallback : global;
  }
  // One query for the vehicle's own value and the global fallback (this runs on every dispatch).
  const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: [key, globalKey] } } });
  const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, toNumber(r.setting_value)]));
  const own = byKey[key] ?? null;
  if (own !== null) return own;
  const global = byKey[globalKey] ?? null;
  return global === null ? fallback : global;
}

/** Negative balance limit (a positive number of rupees) for a driver of this vehicle type. */
const getDriverMaxDueLimit = (vehicle) => readVehicleAwareSetting(DRIVER_MAX_DUE_LIMIT_KEY, DEFAULT_DRIVER_MAX_DUE_LIMIT, vehicle);

/** Minimum balance that must stay in the ledger when a driver of this vehicle type withdraws. */
const getDriverMinWithdrawalAmount = (vehicle) =>
  readVehicleAwareSetting(DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY, DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT, vehicle);

async function getDriverWalletLimits(vehicle) {
  const [minBalance, negativeLimit] = await Promise.all([getDriverMinWithdrawalAmount(vehicle), getDriverMaxDueLimit(vehicle)]);
  return { minBalance, negativeLimit };
}

const CUSTOMER_WALLET_MAX_TOPUP_KEY = "customer_wallet_max_topup";
const DEFAULT_CUSTOMER_WALLET_MAX_TOPUP = 50000;

async function getCustomerWalletMaxTopup() {
  let row = null;
  try {
    row = await prisma.app_settings.findFirst({ where: { setting_key: CUSTOMER_WALLET_MAX_TOPUP_KEY } });
  } catch (_) {
    // Settings table unreachable - fall back to the default cap rather than blocking top-ups.
  }
  const parsed = parseFloat(row?.setting_value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CUSTOMER_WALLET_MAX_TOPUP;
}

/** app_settings key holding this vehicle type's own negative balance limit (never matches when no vehicle). */
const driverMaxDueLimitVehicleKey = (vehicle) => vehicleKey(DRIVER_MAX_DUE_LIMIT_KEY, vehicle) || `${DRIVER_MAX_DUE_LIMIT_KEY}${VEHICLE_KEY_INFIX}`;
const driverMinWithdrawalVehicleKey = (vehicle) => vehicleKey(DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY, vehicle) || `${DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY}${VEHICLE_KEY_INFIX}`;

module.exports = {
  driverMaxDueLimitVehicleKey,
  driverMinWithdrawalVehicleKey,
  getDriverWalletLimits,
  getCustomerWalletMaxTopup,
  CUSTOMER_WALLET_MAX_TOPUP_KEY,
  getDriverMaxDueLimit,
  DRIVER_MAX_DUE_LIMIT_KEY,
  DEFAULT_DRIVER_MAX_DUE_LIMIT,
  getDriverMinWithdrawalAmount,
  DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY,
  DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT,
};
