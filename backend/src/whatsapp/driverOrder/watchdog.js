// WhatsApp Trial Order (spec 2026-11-17, section 5): alerts the executive when a WhatsApp-channel driver has gone
// silent on a step, or when the bot is disconnected while a WhatsApp order is active. Runs only in the process that
// hosts the WhatsApp bot (server.js starts it next to initWhatsAppBot).
const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const { stepId, stepLabel } = require("./stepResolver");
const { isWhatsappDriver } = require("../../services/whatsappTrialSettings");

const flow = () => require("./flow");
const adminSocket = () => require("../../sockets/adminSocket");

const TICK_MS = 60 * 1000;
const SILENCE_MS = 10 * 60 * 1000;

let timer = null;
let running = false;
// Orders already alerted in the current disconnect episode; cleared when the bot is CONNECTED again.
const offlineAlerted = new Set();

function botConnected() {
  try {
    return require("../client").getBotStatus().status === "CONNECTED";
  } catch (err) {
    logger.warn(`whatsapp watchdog: bot status unreadable (${err.message})`);
    return false;
  }
}

const ms = (d) => (d ? new Date(d).getTime() : 0);

// On a driving leg the driver has no step reply to send for a while; a fresh Live Location shows they are on it.
const DRIVING_STEPS = new Set(["go_pickup", "go_stop", "go_drop"]);

async function checkSilence(order, now) {
  const ctx = await flow().loadContext(order.id);
  const session = ctx?.session;
  // No session = the order card was never sent (startOrder raises its own alert for that).
  if (!session || ctx.step.key === "cancelled") return;
  const current = stepId(ctx.step);
  if (session.alerted_step === current) return;
  const activity = [session.last_reply_at, session.last_prompt_at, session.created_at];
  if (DRIVING_STEPS.has(ctx.step.key)) activity.push(session.last_location_at);
  const since = Math.max(...activity.map(ms));
  if (now - since <= SILENCE_MS) return;
  // Recorded first: if this write fails there is no alert, rather than an alert every minute.
  await prisma.whatsapp_driver_session.updateMany({ where: { order_id: order.id }, data: { alerted_step: current } });
  adminSocket().notifyDispatchAlert(
    order.id, order.city_id,
    `WhatsApp driver hasn't replied for 10 min on order #${order.id} (${stepLabel(ctx.step)}). Call the driver.`,
    { kind: "whatsapp_driver_silent", step: current, rider_id: ctx.riderId }
  );
}

/**
 * One pass over the active WhatsApp trips (order_status 1-3, not Completed/Cancelled). A completed order waiting
 * for the driver's PAISA MILA is not watched: the trip is over, and the settlement has its own admin view.
 * Never throws; a tick that is still running makes the next one a no-op.
 */
async function tick(now = Date.now()) {
  if (running) return;
  running = true;
  try {
    // Driven from the session table (one row per WhatsApp order) so the order lookup is by primary key only.
    const sessions = await prisma.whatsapp_driver_session.findMany({ select: { order_id: true, rider_id: true } });
    const sessionOf = new Map(sessions.map((s) => [s.order_id, s]));
    const candidates = sessions.length
      ? await prisma.pkg_order.findMany({
        where: { id: { in: [...sessionOf.keys()] }, driver_channel: "whatsapp", order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
        select: { id: true, city_id: true, rid: true },
      })
      : [];
    // Only orders their WhatsApp driver still holds: after a re-live / replace the next driver may be on the app.
    const orders = [];
    for (const o of candidates) {
      if (await isWhatsappDriver({ ...o, driver_channel: "whatsapp" }, sessionOf.get(o.id) || null)) orders.push(o);
    }
    const connected = botConnected();
    if (connected) offlineAlerted.clear();
    const activeIds = new Set(orders.map((o) => o.id));
    for (const id of offlineAlerted) if (!activeIds.has(id)) offlineAlerted.delete(id);

    for (const order of orders) {
      try {
        if (!connected && !offlineAlerted.has(order.id)) {
          offlineAlerted.add(order.id);
          adminSocket().notifyDispatchAlert(
            order.id, order.city_id,
            `WhatsApp bot is disconnected: the driver of order #${order.id} gets no WhatsApp messages. Reconnect the bot or call the driver.`,
            { kind: "whatsapp_bot_offline" }
          );
        }
        // While the bot is down the driver can't reply or get prompts: only the offline alert applies.
        if (connected) await checkSilence(order, now);
      } catch (err) {
        logger.error(`whatsapp watchdog: order ${order.id} check failed:`, err);
      }
    }
  } catch (err) {
    logger.error("whatsapp watchdog tick failed:", err);
  } finally {
    running = false;
  }
}

/** Starts the 60 s watchdog once per process. */
function start() {
  if (timer) return timer;
  timer = setInterval(() => { tick(); }, TICK_MS);
  timer.unref?.();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Tests only: forget the timer and the offline-episode bookkeeping. */
function _reset() {
  stop();
  running = false;
  offlineAlerted.clear();
}

module.exports = { start, stop, tick, SILENCE_MS, _reset };
