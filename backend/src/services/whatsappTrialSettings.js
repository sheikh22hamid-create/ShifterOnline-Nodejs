const prisma = require("../config/db");
const logger = require("../utils/logger");

const SETTING_KEY = "whatsapp_trial_orders_enabled";

/** Off unless an admin sets app_settings `whatsapp_trial_orders_enabled` to 1/true/on. Fails closed on any read error. */
async function isEnabled() {
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: SETTING_KEY } });
    const v = String(row?.setting_value ?? "").trim().toLowerCase();
    return ["1", "true", "on"].includes(v);
  } catch (err) {
    logger.warn(`whatsappTrialSettings.isEnabled: treating as off (${err.message})`);
    return false;
  }
}

/**
 * Can this rider run orders over the WhatsApp bot? Needs the switch ON, the bot connected and an active Trial Driver.
 * The bot client is required lazily so non-bot processes and tests never load Baileys.
 */
async function eligibility(riderId) {
  riderId = Number(riderId);
  const enabled = await isEnabled();
  let botConnected = false;
  try {
    botConnected = require("../whatsapp/client").getBotStatus().status === "CONNECTED";
  } catch (err) {
    logger.warn(`whatsappTrialSettings.eligibility: bot status unreadable (${err.message})`);
  }
  const out = (eligible, reason, done = 0) => ({ eligible, reason, whatsapp_orders_done: done, bot_connected: botConnected, enabled });
  if (!enabled) return out(false, "disabled");
  if (!botConnected) return out(false, "bot_offline");
  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { id: true, trial_status: true } });
  if (!rider) return out(false, "not_found");
  if (rider.trial_status !== "active") return out(false, "not_trial");
  const done = await prisma.pkg_order.count({ where: { rid: riderId, driver_channel: "whatsapp", o_status: "Completed" } });
  return out(true, null, done);
}

module.exports = { isEnabled, eligibility, SETTING_KEY };
