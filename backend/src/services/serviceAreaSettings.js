const prisma = require("../config/db");
const logger = require("../utils/logger");

// Switch for service-area enforcement (spec 2026-10-29). OFF until an admin sets `service_area_enforcement_enabled`
// to 1/true/on/yes; a read error keeps it off so a database hiccup never changes how bookings behave.
const ENABLED_KEY = "service_area_enforcement_enabled";

async function isEnforced() {
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: ENABLED_KEY } });
    return ["1", "true", "on", "yes"].includes(String(row?.setting_value ?? "").trim().toLowerCase());
  } catch (err) {
    logger.warn(`serviceAreaSettings.isEnforced: treating as off (${err.message})`);
    return false;
  }
}

module.exports = { isEnforced, ENABLED_KEY };
