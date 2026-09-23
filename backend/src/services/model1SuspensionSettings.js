const prisma = require("../config/db");
const { MODEL1_MISS_LIMIT, MODEL1_SUSPENSION_HOURS } = require("../config/constants");

const MODEL1_MISS_LIMIT_KEY = "model1_miss_limit";
const MODEL1_SUSPENSION_HOURS_KEY = "model1_suspension_hours";

async function getModel1MissLimit() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: MODEL1_MISS_LIMIT_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return MODEL1_MISS_LIMIT;
  }
  const parsed = parseInt(row.setting_value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? MODEL1_MISS_LIMIT : parsed;
}

async function getModel1SuspensionHours() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: MODEL1_SUSPENSION_HOURS_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return MODEL1_SUSPENSION_HOURS;
  }
  const parsed = parseFloat(row.setting_value);
  return Number.isNaN(parsed) || parsed <= 0 ? MODEL1_SUSPENSION_HOURS : parsed;
}

module.exports = {
  getModel1MissLimit,
  MODEL1_MISS_LIMIT_KEY,
  getModel1SuspensionHours,
  MODEL1_SUSPENSION_HOURS_KEY,
};
