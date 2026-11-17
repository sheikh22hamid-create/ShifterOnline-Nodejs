// WhatsApp Trial Order (spec 2026-11-17): who sent a bot message, and whether it is a trial driver running a
// WhatsApp-channel order - so client.js can send the message to the order flow instead of the customer menu.
const prisma = require("../../config/db");
const { isCashSettlementPending } = require("./stepResolver");

const PN_SUFFIX = "@s.whatsapp.net";

/** "919876543210:12@s.whatsapp.net" -> "9876543210"; null for a non-phone JID or a non-Indian number. */
function phoneFromJid(jid) {
  if (typeof jid !== "string" || !jid.endsWith(PN_SUFFIX)) return null;
  const digits = jid.slice(0, -PN_SUFFIX.length).split(":")[0].replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 10) return digits;
  return null;
}

/**
 * The sender's 10-digit phone. A chat addressed by LID (`…@lid`) carries the phone JID in another key field:
 * Baileys 7 puts it in `remoteJidAlt` (WAMessageKey); `senderPn` is the older Baileys name for the same thing.
 */
function phoneFromMessage(msg) {
  const key = msg?.key || {};
  if (typeof key.remoteJid === "string" && key.remoteJid.endsWith(PN_SUFFIX)) return phoneFromJid(key.remoteJid);
  return phoneFromJid(key.senderPn) || phoneFromJid(key.remoteJidAlt) || null;
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE = 0, AWAITING_CASH = 1, GONE = 2;

/** How a session's order should route: active > awaiting cash > cancelled/reassigned; null = do not route. */
function routeRank(order, riderId, pendingCash) {
  if (!order) return null;
  if (order.o_status === "Cancelled" || Number(order.rid) !== Number(riderId)) return GONE;
  if (order.o_status === "Completed") return pendingCash.has(order.id) ? AWAITING_CASH : null;
  return [1, 2, 3].includes(Number(order.order_status)) ? ACTIVE : null;
}

/**
 * The WhatsApp-channel order this phone's driver is talking about, found through whatsapp_driver_session (indexed by
 * phone - an ordinary customer only costs one small lookup). Only sessions active in the last 24 h count, latest
 * first. Priority: an active order, else a Completed one still awaiting the driver's cash confirmation (PAISA MILA),
 * else one cancelled or taken away from this driver - the flow then answers "order cancel ho gaya".
 * Returns { orderId, riderId } (riderId = the session's driver) or null.
 */
async function findActiveWhatsAppOrder(phone10) {
  if (!/^\d{10}$/.test(String(phone10 || ""))) return null;
  const sessions = await prisma.whatsapp_driver_session.findMany({
    where: { phone: phone10, updated_at: { gte: new Date(Date.now() - SESSION_WINDOW_MS) } },
    orderBy: { updated_at: "desc" },
    select: { order_id: true, rider_id: true },
  });
  if (sessions.length === 0) return null;

  const orders = await prisma.pkg_order.findMany({
    where: { id: { in: sessions.map((s) => s.order_id) } },
    select: { id: true, rid: true, order_status: true, o_status: true },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const completedIds = orders.filter((o) => o.o_status === "Completed").map((o) => o.id);
  // `method` is null until settled, and Prisma's `not: 'online'` would drop NULLs - so filter with the shared rule.
  const pendingCash = new Set(completedIds.length
    ? (await prisma.order_settlement.findMany({
        where: { order_id: { in: completedIds }, status: "pending" },
        select: { order_id: true, status: true, method: true },
      })).filter(isCashSettlementPending).map((s) => s.order_id)
    : []);

  let best = null;
  for (const s of sessions) {
    const rank = routeRank(byId.get(s.order_id), s.rider_id, pendingCash);
    if (rank !== null && (!best || rank < best.rank)) best = { rank, orderId: s.order_id, riderId: s.rider_id };
  }
  return best ? { orderId: best.orderId, riderId: best.riderId } : null;
}

module.exports = { phoneFromMessage, findActiveWhatsAppOrder };
