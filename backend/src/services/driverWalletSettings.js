const prisma = require("../config/db");

const DRIVER_MAX_DUE_LIMIT_KEY = "driver_max_due_limit";
const DEFAULT_DRIVER_MAX_DUE_LIMIT = 100;

async function getDriverMaxDueLimit() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: DRIVER_MAX_DUE_LIMIT_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return DEFAULT_DRIVER_MAX_DUE_LIMIT;
  }
  const parsed = parseFloat(row.setting_value);
  return Number.isNaN(parsed) ? DEFAULT_DRIVER_MAX_DUE_LIMIT : parsed;
}

const DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY = "driver_min_withdrawal_amount";
const DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT = 0;

async function getDriverMinWithdrawalAmount() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT;
  }
  const parsed = parseFloat(row.setting_value);
  return Number.isNaN(parsed) ? DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT : parsed;
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

module.exports = {
  getCustomerWalletMaxTopup,
  CUSTOMER_WALLET_MAX_TOPUP_KEY,
  getDriverMaxDueLimit,
  DRIVER_MAX_DUE_LIMIT_KEY,
  DEFAULT_DRIVER_MAX_DUE_LIMIT,
  getDriverMinWithdrawalAmount,
  DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY,
  DEFAULT_DRIVER_MIN_WITHDRAWAL_AMOUNT,
};
