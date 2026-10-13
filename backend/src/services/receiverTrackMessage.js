const prisma = require("../config/db");
const logger = require("../utils/logger");
const { normalizeToLast10Digits } = require("../utils/phone");
const settings = require("./receiverTrackSettings");
const trackLinkService = require("./trackLinkService");

// Public live-tracking URL for the order, or "" when tracking is off, no driver is assigned yet,
// PUBLIC_BASE_URL is missing, or anything fails.
async function trackUrl(order, receiverPhone) {
  try {
    if (!receiverPhone || !(Number(order && order.rid) > 0)) return "";
    if (!(await settings.isTrackingEnabled())) return "";
    const link = await trackLinkService.getOrCreate(order.id, receiverPhone);
    return (link && trackLinkService.buildLink(link.token)) || "";
  } catch (err) {
    logger.warn(`receiverTrack.trackUrl failed for order ${order && order.id}: ${err && err.message}`);
    return "";
  }
}

// "Track live" line for the receiver's WhatsApp messages. Empty (so the message goes out exactly as
// before) whenever trackUrl is empty.
async function trackLine(order, receiverPhone) {
  const url = await trackUrl(order, receiverPhone);
  return url ? `📍 *Live track karein*: ${url}

` : "";
}

// The booker asks for the order's public tracking url (the app's "Share Live Tracking" card).
// Only their own order, only while a driver is on it.
async function urlForBooker({ orderId, uid }) {
  const order = await prisma.pkg_order.findUnique({
    where: { id: orderId }, select: { id: true, uid: true, rid: true, dmobile: true, order_status: true },
  });
  if (!order) return { ok: false, code: "NOT_FOUND", msg: "Order not found." };
  if (Number(order.uid) !== Number(uid)) return { ok: false, code: "FORBIDDEN", msg: "This order belongs to another customer." };
  const inProgress = [1, 2, 3].includes(Number(order.order_status));
  const url = inProgress ? await trackUrl(order, normalizeToLast10Digits(order.dmobile)) : "";
  if (!url) return { ok: false, code: "NOT_AVAILABLE", msg: "Live tracking is not available for this order right now." };
  return { ok: true, url };
}

// The drop contact of an order changed. If the order already has a link, rotate it to the new number
// (the old number's link then answers "invalid") and, while the delivery is in progress, send the new
// number its link. Never throws: it runs next to an order edit that must not fail because of this.
async function syncReceiverPhone(orderId, rawPhone) {
  try {
    const phone = normalizeToLast10Digits(rawPhone);
    if (phone.length !== 10) return { rotated: false };
    const existing = await prisma.order_track_link.findUnique({ where: { order_id: orderId } });
    if (!existing || existing.receiver_phone === phone) return { rotated: false };
    const link = await trackLinkService.getOrCreate(orderId, phone);
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { rid: true, order_status: true } });
    const inProgress = order && Number(order.rid) > 0 && [1, 2, 3].includes(Number(order.order_status));
    const url = link ? trackLinkService.buildLink(link.token) : null;
    if (inProgress && url && (await settings.isTrackingEnabled())) {
      // Lazy require: whatsapp/notifications pulls in the WhatsApp client.
      const { sendWhatsAppNotification } = require("../whatsapp/notifications");
      await sendWhatsAppNotification(
        phone,
        `Hello! 👋\nOrder *#${orderId}* ki delivery aapke liye hai. Parcel live track karne ke liye link:\n${url}\n\n— *Team Shifter Online*\n📞 Customer Care: 9109114515`
      );
    }
    return { rotated: true };
  } catch (err) {
    logger.warn(`receiverTrack.syncReceiverPhone failed for order ${orderId}: ${err && err.message}`);
    return { rotated: false };
  }
}

module.exports = { trackUrl, trackLine, syncReceiverPhone, urlForBooker };
