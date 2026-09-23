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

module.exports = { getDriverMaxDueLimit, DRIVER_MAX_DUE_LIMIT_KEY, DEFAULT_DRIVER_MAX_DUE_LIMIT };
