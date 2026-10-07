const prisma = require("../config/db");
const { BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES } = require("../config/constants");

const BOOKING_GUARANTEE_ASSIGN_KEY = "booking_guarantee_assign_minutes";
const MAX_MINUTES = 24 * 60;

/** Admin Assignment Time in whole minutes; the default when unset or corrupt. */
async function getAssignWindowMinutes() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: BOOKING_GUARANTEE_ASSIGN_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES;
  }
  const parsed = parseInt(row.setting_value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES : parsed;
}

async function setAssignWindowMinutes(minutes) {
  const n = typeof minutes === "string" && /^\d+$/.test(minutes.trim()) ? Number(minutes) : minutes;
  if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) {
    throw Object.assign(new Error(`assign_minutes must be a whole number between 1 and ${MAX_MINUTES}`), { statusCode: 400 });
  }
  await prisma.app_settings.upsert({
    where: { setting_key: BOOKING_GUARANTEE_ASSIGN_KEY },
    update: { setting_value: String(n) },
    create: { setting_key: BOOKING_GUARANTEE_ASSIGN_KEY, setting_value: String(n) },
  });
  return n;
}

module.exports = { getAssignWindowMinutes, setAssignWindowMinutes, BOOKING_GUARANTEE_ASSIGN_KEY };
