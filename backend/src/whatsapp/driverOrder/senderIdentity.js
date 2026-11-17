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

/**
 * The WhatsApp-channel order this phone's driver is running: the latest active one, else the latest Completed one
 * whose cash settlement is still pending (the driver still has to reply PAISA MILA). null = not a routed driver.
 */
async function findActiveWhatsAppOrder(phone10) {
  if (!/^\d{10}$/.test(String(phone10 || ""))) return null;
  const riders = await prisma.tbl_rider.findMany({
    where: { fmobile: { in: [phone10, `91${phone10}`, `+91${phone10}`] } },
    select: { id: true },
  });
  if (riders.length === 0) return null;
  const rid = { in: riders.map((r) => r.id) };

  const active = await prisma.pkg_order.findFirst({
    where: { rid, driver_channel: "whatsapp", order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
    orderBy: { id: "desc" },
    select: { id: true, rid: true },
  });
  if (active) return { orderId: active.id, riderId: active.rid };

  // `method` is null until settled, and Prisma's `not: 'online'` would drop NULLs - so filter with the shared rule.
  const pending = (await prisma.order_settlement.findMany({
    where: { rid, status: "pending" },
    select: { order_id: true, status: true, method: true },
  })).filter(isCashSettlementPending);
  if (pending.length === 0) return null;
  const awaitingCash = await prisma.pkg_order.findFirst({
    where: { id: { in: pending.map((s) => s.order_id) }, rid, driver_channel: "whatsapp", o_status: "Completed" },
    orderBy: { id: "desc" },
    select: { id: true, rid: true },
  });
  return awaitingCash ? { orderId: awaitingCash.id, riderId: awaitingCash.rid } : null;
}

module.exports = { phoneFromMessage, findActiveWhatsAppOrder };
