const prisma = require("../config/db");
const logger = require("../utils/logger");
const { normalizeToLast10Digits } = require("../utils/phone");
const settings = require("./receiverTrackSettings");
const trackLinkService = require("./trackLinkService");

// "Track live" line for the receiver's WhatsApp messages. Empty (so the message goes out exactly as
// before) when tracking is off, no driver is assigned yet, PUBLIC_BASE_URL is missing, or anything fails.
async function trackLine(order, receiverPhone) {
  try {
    if (!receiverPhone || !(Number(order && order.rid) > 0)) return "";
    if (!(await settings.isTrackingEnabled())) return "";
    const link = await trackLinkService.getOrCreate(order.id, receiverPhone);
    const url = link ? trackLinkService.buildLink(link.token) : null;
    return url ? `📍 *Live track karein*: ${url}\n\n` : "";
  } catch (err) {
    logger.warn(`receiverTrack.trackLine failed for order ${order && order.id}: ${err && err.message}`);
    return "";
  }
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

module.exports = { trackLine, syncReceiverPhone };
