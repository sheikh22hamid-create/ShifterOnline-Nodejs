const prisma = require("../../config/db");
const logger = require("../../utils/logger");

/**
 * Handles Instant Fare Estimate via WhatsApp
 */
async function handleFareCalculation(phoneNumber, entities, session) {
  const appDownloadUrl = process.env.USER_APP_DOWNLOAD_URL || "https://play.google.com/store/apps/details?id=com.shifter.online";
  return (
    `📦 *Shifter Online Booking*\n\n` +
    `WhatsApp par direct booking ya fare calculation uplabdh nahi hai.\n` +
    `Goods delivery ya vehicle booking ke liye kripya hamari official *Shifter Online Customer App* download karein:\n\n` +
    `📲 *Download Shifter App*:\n` +
    `👉 ${appDownloadUrl}\n\n` +
    `App me aap exact pickup-drop daalkar transparent live fare dekh sakte hain aur turant driver book kar sakte hain!\n\n` +
    `📞 *Customer Care*: 9109114515`
  );
}

/**
 * Normalizes phone number to last 10 digits for accurate matching
 */
function normalizePhone10(phone) {
  if (phone === null || phone === undefined) return "";
  let str = "";
  if (typeof phone === "number") {
    if (isNaN(phone) || !isFinite(phone)) return "";
    str = BigInt(Math.round(phone)).toString();
  } else {
    str = String(phone).trim();
    if (str.includes("e+") || str.includes("E+")) {
      const num = Number(str);
      if (!isNaN(num)) {
        str = BigInt(Math.round(num)).toString();
      }
    }
  }
  const digits = str.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Verifies if incoming sender phone number belongs to the order
 */
function matchesOrderPhone(senderPhone, order, user) {
  const senderClean = normalizePhone10(senderPhone);
  if (!senderClean) return false;

  const orderPmobile = normalizePhone10(order.pmobile);
  const orderDmobile = normalizePhone10(order.dmobile);
  const userMobile = user ? normalizePhone10(user.mobile) : "";

  return (
    (orderPmobile && senderClean === orderPmobile) ||
    (orderDmobile && senderClean === orderDmobile) ||
    (userMobile && senderClean === userMobile)
  );
}

/**
 * Order Tracking Query (For orders created via official mobile app)
 * Returns order tracking details ONLY if the senderPhone matches the order's
 * sender mobile, receiver mobile, user account mobile, or stop contact number.
 */
async function handleTrackingQuery(orderId, senderPhone) {
  try {
    const id = parseInt(String(orderId).replace(/\D/g, ""), 10);
    if (!id) return "⚠️ Valid Order ID bhejein (e.g. *Track 1024*).";

    const order = await prisma.pkg_order.findUnique({
      where: { id },
    });

    if (!order) {
      return `❌ Order #${id} nahi mila. Kripya sahi Order ID check karein.`;
    }

    const user = order.uid
      ? await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { id: true, name: true, mobile: true } }).catch(() => null)
      : null;

    const senderClean = normalizePhone10(senderPhone);
    let isAuthorized = matchesOrderPhone(senderClean, order, user);

    if (!isAuthorized) {
      // Also check any extra stop contact numbers
      const stops = await prisma.pkg_order_stops
        .findMany({
          where: { order_id: order.id },
          select: { contact_number: true },
        })
        .catch(() => []);
      isAuthorized = stops.some((s) => normalizePhone10(s.contact_number) === senderClean);
    }

    if (!isAuthorized) {
      logger.warn(`Unauthorized tracking attempt for Order #${order.id} by WhatsApp number: ${senderPhone}`);
      return (
        `❌ *This order was not booked using your WhatsApp number.*\n\n` +
        `Aap sirf wahi orders track kar sakte hain jisme aapka WhatsApp number Sender ya Receiver ke roop me registered ho.\n\n` +
        `📞 Kisi sahayata ke liye hamare Customer Care 9109114515 par call karein.`
      );
    }

    let riderText = "Abhi driver search / assign ho raha hai...";
    if (order.rid > 0) {
      const rider = await prisma.tbl_rider
        .findUnique({
          where: { id: order.rid },
          select: { first_name: true, last_name: true, vehicle_no: true, fmobile: true },
        })
        .catch(() => null);
      if (rider) {
        riderText = `*${rider.first_name || ""} ${rider.last_name || ""}* (${rider.vehicle_no || "N/A"}) — 📞 ${rider.fmobile}`;
      }
    }

    const statusMap = {
      Pending: "Pending (Searching Driver)",
      Processing: "Driver Assigned",
      Pickup: "Driver Arrived at Pickup Point",
      On_Route: "In Transit (On the way to drop)",
      Completed: "Delivered Successfully ✅",
      Cancelled: "Cancelled ❌",
    };
    const friendlyStatus = statusMap[order.o_status] || order.o_status;
    const trackingUrl = process.env.PUBLIC_TRACKING_URL || `https://shifter.online/track/${order.id}`;

    let reply =
      `📦 *Order #${order.id} Tracking Status*\n\n` +
      `📌 *Status*: *${friendlyStatus}*\n` +
      `🛵 *Driver*: ${riderText}\n` +
      `📍 *Pickup*: ${order.paddress || "N/A"}\n` +
      `🎯 *Drop*: ${order.daddress || "N/A"}\n` +
      `💰 *Total Amount*: ₹${order.total_dcharge}\n`;

    // Show pickup OTP only if pending pickup and requester is the pickup party
    const isSenderParty = senderClean === normalizePhone10(order.pmobile) || senderClean === normalizePhone10(user?.mobile);
    if (isSenderParty && order.order_status < 3 && order.otp) {
      reply += `🔑 *Pickup OTP*: *${order.otp}*\n`;
    }

    reply +=
      `\n🗺️ *Live Location Tracking Link*:\n` +
      `👉 ${trackingUrl}\n\n` +
      `📞 Customer Care: 9109114515`;

    return reply;
  } catch (err) {
    logger.error("handleTrackingQuery error:", err);
    return "⚠️ Order status fetch karne me error aaya. Kripya thodi der baad prayas karein.";
  }
}

module.exports = {
  handleFareCalculation,
  handleTrackingQuery,
};
