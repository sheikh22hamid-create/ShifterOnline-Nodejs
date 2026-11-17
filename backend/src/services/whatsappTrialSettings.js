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
  // Only orders this rider really ran on WhatsApp (their own session): a re-lived order an app driver completed keeps
  // driver_channel='whatsapp' in the DB but was not a WhatsApp order for anyone.
  const sessions = await prisma.whatsapp_driver_session.findMany({ where: { rider_id: riderId }, select: { order_id: true } });
  const done = sessions.length
    ? await prisma.pkg_order.count({
      where: { id: { in: sessions.map((s) => s.order_id) }, rid: riderId, driver_channel: "whatsapp", o_status: "Completed" },
    })
    : 0;
  return out(true, null, done);
}

/**
 * Is this order run over WhatsApp by the driver who holds it now? pkg_order.driver_channel is written only when an
 * order is assigned and outlives that driver (driver cancel re-live, replace, approved cancel request, guarantee
 * recovery): the next driver may claim it from the app on any path. So the order counts as WhatsApp-run only while
 * the WhatsApp session - bound by startOrder to the WhatsApp driver - belongs to the assigned driver.
 * order needs { id, rid, driver_channel }. session: the order's whatsapp_driver_session row (or null) if the caller
 * already loaded it; omitted -> read here.
 */
async function isWhatsappDriver(order, session) {
  if (!order || order.driver_channel !== "whatsapp") return false;
  const rid = Number(order.rid) || 0;
  if (rid <= 0) return false;
  const row = session !== undefined
    ? session
    : await prisma.whatsapp_driver_session.findUnique({ where: { order_id: Number(order.id) }, select: { rider_id: true } });
  return Boolean(row) && Number(row.rider_id) === rid;
}

module.exports = { isEnabled, eligibility, isWhatsappDriver, SETTING_KEY };
