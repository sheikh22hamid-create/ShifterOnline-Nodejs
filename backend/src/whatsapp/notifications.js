const prisma = require("../config/db");
const logger = require("../utils/logger");

let whatsappClientRef = null;

function setWhatsAppClient(client) {
  whatsappClientRef = client;
}

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
 * Sends outbound automated WhatsApp message to a 10-digit phone number
 */
async function sendWhatsAppNotification(phoneNumber, messageText) {
  if (!whatsappClientRef) {
    logger.warn(`WhatsApp client not ready. Notification omitted for ${phoneNumber}`);
    return false;
  }

  try {
    const phone10 = normalizePhone10(phoneNumber);
    if (!phone10 || phone10.length !== 10) {
      logger.warn(`Invalid phone number for WhatsApp notification: ${phoneNumber}`);
      return false;
    }

    const cleanPhone = `91${phone10}`;
    let targetJid = `${cleanPhone}@s.whatsapp.net`;

    if (typeof whatsappClientRef.onWhatsApp === "function") {
      try {
        const checkResults = await whatsappClientRef.onWhatsApp(cleanPhone);
        if (checkResults && checkResults.length > 0 && checkResults[0]?.jid) {
          targetJid = checkResults[0].jid;
        }
      } catch (chkErr) {
        logger.warn(`onWhatsApp check fallback for ${cleanPhone}:`, chkErr.message);
      }
    }

    if (whatsappClientRef.sendMessage) {
      await whatsappClientRef.sendMessage(targetJid, { text: messageText });
      logger.info(`✅ Outbound WhatsApp notification successfully sent to ${targetJid}`);
      return true;
    }
  } catch (err) {
    logger.error(`❌ Failed to send WhatsApp notification to ${phoneNumber}:`, err);
    return false;
  }
}

// In-memory deduplication cache: prevents duplicate notifications for the same milestone within 2 hours
const sentMilestonesCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function wasMilestoneSent(orderId, milestone, phone) {
  const key = `${orderId}_${milestone}_${phone}`;
  const now = Date.now();
  if (sentMilestonesCache.has(key)) {
    const sentTime = sentMilestonesCache.get(key);
    if (now - sentTime < CACHE_TTL_MS) {
      return true;
    }
  }
  return false;
}

function markMilestoneSent(orderId, milestone, phone) {
  const key = `${orderId}_${milestone}_${phone}`;
  sentMilestonesCache.set(key, Date.now());

  // Cleanup old entries if cache grows
  if (sentMilestonesCache.size > 2000) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, time] of sentMilestonesCache.entries()) {
      if (time < cutoff) sentMilestonesCache.delete(k);
    }
  }
}

/**
 * Fetches order along with customer, driver, and vehicle category information
 */
async function getOrderDetailsWithParticipants(orderId) {
  try {
    const id = Number(orderId);
    if (!id || isNaN(id)) return null;

    const order = await prisma.pkg_order.findUnique({
      where: { id },
    });
    if (!order) return null;

    let user = null;
    if (order.uid) {
      user = await prisma.tbl_user.findUnique({
        where: { id: order.uid },
        select: { id: true, name: true, mobile: true },
      }).catch(() => null);
    }

    let rider = null;
    if (order.rid && order.rid > 0) {
      rider = await prisma.tbl_rider.findUnique({
        where: { id: order.rid },
        select: { id: true, first_name: true, last_name: true, fmobile: true, vehicle_no: true },
      }).catch(() => null);
    }

    let categoryTitle = "Delivery Vehicle";
    if (order.category) {
      const cat = await prisma.pkg_category.findUnique({
        where: { id: Number(order.category) },
        select: { title: true },
      }).catch(() => null);
      if (cat?.title) categoryTitle = cat.title;
    }

    const senderPhone = normalizePhone10(order.pmobile || user?.mobile);
    const receiverPhone = normalizePhone10(order.dmobile);
    const senderName = order.pick_name || user?.name || "Customer";
    const receiverName = order.drop_name || "Receiver";

    return {
      order,
      user,
      rider,
      categoryTitle,
      senderPhone,
      receiverPhone,
      senderName,
      receiverName,
    };
  } catch (err) {
    logger.error(`Error loading order participants for #${orderId}:`, err);
    return null;
  }
}

/**
 * 1. Booking Confirm Notification
 * Sent to both Sender and Receiver when order is placed
 */
async function notifyOrderBooked(orderId) {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, categoryTitle, senderPhone, receiverPhone, senderName, receiverName } = data;

  let receiverPayLine = "";
  try {
    const rp = await prisma.order_receiver_pay.findFirst({ where: { order_id: order.id, status: "active" } });
    if (rp) {
      const pct = Number(rp.commission_percent) || 0;
      const feeNote = pct > 0 ? `Fare ke upar ${pct}% service fee lagegi, cash ya online dono me. ` : "";
      receiverPayLine =
        `💳 *${senderName}* ne aapko payment karne wala (payer) chuna hai. ` +
        feeNote +
        `Delivery ke baad aapko ek secure payment link bheja jayega, usme app ki zaroorat nahi hai. ` +
        `Agar aap pay nahi karna chahte, to link me *Decline* dabayein.\n\n`;
    }
  } catch (err) {
    logger.warn(`notifyOrderBooked: receiver-pay lookup failed for order ${order.id}: ${err.message}`);
  }

  const senderMsg =
    `Hello! 👋\n` +
    `*Your booking has been confirmed.* 🚚\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `🚗 *Vehicle*: ${categoryTitle}\n` +
    `💰 *Estimated Fare*: ₹${order.total_dcharge}\n\n` +
    `📍 *Pickup*: ${order.paddress || "N/A"}\n` +
    `🎯 *Drop*: ${order.daddress || "N/A"}\n` +
    `👤 *Receiver*: ${receiverName}${receiverPhone ? ` (📞 ${receiverPhone})` : ""}\n\n` +
    `Aapko jaldi hi driver assign ho jayega!\n` +
    `Live status ke liye is chat me *Track ${order.id}* likhkar bhejein.\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Customer Care: 9109114515`;

  const receiverMsg =
    `Hello! 👋\n` +
    `Aapke liye ek parcel/delivery book ki gayi hai! 🚚\n` +
    `*Your booking has been confirmed.*\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `👤 *Sender*: ${senderName}${senderPhone ? ` (📞 ${senderPhone})` : ""}\n` +
    `🚗 *Vehicle*: ${categoryTitle}\n\n` +
    `📍 *Pickup*: ${order.paddress || "N/A"}\n` +
    `🎯 *Drop*: ${order.daddress || "N/A"}\n\n` +
    receiverPayLine +
    `Parcel live status check karne ke liye is chat me *Track ${order.id}* bhejein.\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Customer Care: 9109114515`;

  if (senderPhone && !wasMilestoneSent(order.id, "booked", senderPhone)) {
    markMilestoneSent(order.id, "booked", senderPhone);
    await sendWhatsAppNotification(senderPhone, senderMsg);
  }

  if (receiverPhone && receiverPhone !== senderPhone && !wasMilestoneSent(order.id, "booked", receiverPhone)) {
    markMilestoneSent(order.id, "booked", receiverPhone);
    await sendWhatsAppNotification(receiverPhone, receiverMsg);
  }

  return true;
}

/**
 * 2. Driver Pickup Location Par Arrive Hone Par
 * Sent when order status becomes "Pickup" / Driver Arrived at Pickup
 */
async function notifyDriverArrived(orderId) {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, rider, senderPhone, receiverPhone, trackingUrl } = data;
  const riderName = rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "Assigned Driver";
  const riderPhone = rider?.fmobile || "9109114515";
  const riderVehicle = rider?.vehicle_no ? `(${rider.vehicle_no})` : "";

  const senderMsg =
    `Hello! 👋\n` +
    `🚚 *Driver Arrived at Pickup Location!*\n\n` +
    `Driver aapke pickup point par pahunch chuka hai. Kripya parcel handover karein.\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `🛵 *Driver*: *${riderName}* ${riderVehicle} — 📞 ${riderPhone}\n` +
    (order.otp ? `🔑 *Pickup OTP*: *${order.otp}* (Driver ko saman dete waqt yeh OTP batayein)\n\n` : `\n`) +
    `📍 *Pickup*: ${order.paddress || "N/A"}\n` +
    `🎯 *Drop*: ${order.daddress || "N/A"}\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Helpline: 9109114515`;

  const receiverMsg =
    `Hello! 👋\n` +
    `🚚 *Driver Arrived at Pickup Point!*\n\n` +
    `Driver aapka parcel collect karne pickup location par pahunch chuka hai.\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `🛵 *Driver*: *${riderName}* ${riderVehicle} — 📞 ${riderPhone}\n` +
    `📍 *From*: ${order.paddress || "N/A"}\n` +
    `🎯 *To*: ${order.daddress || "N/A"}\n\n` +
    `Live status ke liye chat me *Track ${order.id}* likhein.\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Helpline: 9109114515`;

  if (senderPhone && !wasMilestoneSent(order.id, "arrived", senderPhone)) {
    markMilestoneSent(order.id, "arrived", senderPhone);
    await sendWhatsAppNotification(senderPhone, senderMsg);
  }

  if (receiverPhone && receiverPhone !== senderPhone && !wasMilestoneSent(order.id, "arrived", receiverPhone)) {
    markMilestoneSent(order.id, "arrived", receiverPhone);
    await sendWhatsAppNotification(receiverPhone, receiverMsg);
  }

  return true;
}

/**
 * 3. Pickup Complete Hone Par (In Transit / On Route)
 * Sent when driver verifies OTP and starts trip to drop location
 */
async function notifyTripStarted(orderId) {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, rider, senderPhone, receiverPhone, receiverName } = data;
  const riderName = rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "Driver";
  const riderPhone = rider?.fmobile || "9109114515";
  const riderVehicle = rider?.vehicle_no ? `(${rider.vehicle_no})` : "";

  const msg =
    `Hello! 👋\n` +
    `📦 *Pickup Completed — Parcel In Transit!*\n\n` +
    `Aapka parcel successfully pickup ho chuka hai aur driver drop location ke liye nikal gaya hai. 🚚💨\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `🛵 *Driver*: *${riderName}* ${riderVehicle} — 📞 ${riderPhone}\n` +
    `📍 *From*: ${order.paddress || "N/A"}\n` +
    `🎯 *To*: ${order.daddress || "N/A"}\n` +
    `👤 *Receiver*: ${receiverName}${receiverPhone ? ` (📞 ${receiverPhone})` : ""}\n\n` +
    `Live status check karne ke liye is chat me *Track ${order.id}* bhejein.\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Helpline: 9109114515`;

  if (senderPhone && !wasMilestoneSent(order.id, "pickup", senderPhone)) {
    markMilestoneSent(order.id, "pickup", senderPhone);
    await sendWhatsAppNotification(senderPhone, msg);
  }

  if (receiverPhone && receiverPhone !== senderPhone && !wasMilestoneSent(order.id, "pickup", receiverPhone)) {
    markMilestoneSent(order.id, "pickup", receiverPhone);
    await sendWhatsAppNotification(receiverPhone, msg);
  }

  return true;
}

/**
 * 4a. Drop Location Par Driver Arrive Hone Par
 * Sent when driver reaches drop destination
 */
async function notifyDriverArrivedDrop(orderId) {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, rider, senderPhone, receiverPhone, receiverName } = data;
  const riderName = rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "Driver";
  const riderPhone = rider?.fmobile || "9109114515";
  const riderVehicle = rider?.vehicle_no ? `(${rider.vehicle_no})` : "";

  const msg =
    `Hello! 👋\n` +
    `🚚 *Driver Arrived at Drop Location!*\n\n` +
    `Driver parcel deliver karne ke liye drop location par pahunch chuka hai. Kripya parcel receive karein.\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `🛵 *Driver*: *${riderName}* ${riderVehicle} — 📞 ${riderPhone}\n` +
    `🎯 *Drop Location*: ${order.daddress || "N/A"}\n` +
    `👤 *Receiver*: ${receiverName}\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Helpline: 9109114515`;

  if (receiverPhone && !wasMilestoneSent(order.id, "arrived_drop", receiverPhone)) {
    markMilestoneSent(order.id, "arrived_drop", receiverPhone);
    await sendWhatsAppNotification(receiverPhone, msg);
  }

  if (senderPhone && senderPhone !== receiverPhone && !wasMilestoneSent(order.id, "arrived_drop", senderPhone)) {
    markMilestoneSent(order.id, "arrived_drop", senderPhone);
    await sendWhatsAppNotification(senderPhone, msg);
  }

  return true;
}

/**
 * 4b. Drop / Delivery Complete Hone Par
 * Sent when order is marked completed
 */
async function notifyTripCompleted(orderId) {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, senderPhone, receiverPhone } = data;

  const msg =
    `Hello! 👋\n` +
    `✅ *Order Delivered Successfully!*\n\n` +
    `Aapka parcel successfully deliver ho chuka hai. Shifter Online choose karne ke liye shukriya! 🙏\n\n` +
    `📦 *Order ID*: #${order.id}\n` +
    `📍 *Pickup*: ${order.paddress || "N/A"}\n` +
    `🎯 *Drop*: ${order.daddress || "N/A"}\n` +
    `💰 *Total Fare*: ₹${order.total_dcharge}\n\n` +
    `Agli delivery booking ke liye Shifter Online App use karein:\n` +
    `👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\n` +
    `— *Team Shifter Online*\n` +
    `📞 Customer Care: 9109114515`;

  if (senderPhone && !wasMilestoneSent(order.id, "complete", senderPhone)) {
    markMilestoneSent(order.id, "complete", senderPhone);
    await sendWhatsAppNotification(senderPhone, msg);
  }

  if (receiverPhone && receiverPhone !== senderPhone && !wasMilestoneSent(order.id, "complete", receiverPhone)) {
    markMilestoneSent(order.id, "complete", receiverPhone);
    await sendWhatsAppNotification(receiverPhone, msg);
  }

  return true;
}

/**
 * Driver Assignment Notification (Optional Helper)
 */
async function notifyDriverAssigned(orderId) {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, rider, senderPhone } = data;
  if (!rider || !senderPhone) return false;

  const riderName = `${rider.first_name || ""} ${rider.last_name || ""}`.trim();
  const riderPhone = rider.fmobile || "9109114515";
  const riderVehicle = rider.vehicle_no ? `(${rider.vehicle_no})` : "";

  const msg =
    `Hello! 👋\n` +
    `🛵 *Driver Assigned to Your Order #${order.id}!*\n\n` +
    `*Driver*: ${riderName} ${riderVehicle}\n` +
    `📱 *Phone*: ${riderPhone}\n\n` +
    `Driver jald hi aapke pickup point par pahunchenge.\n` +
    `Live status ke liye is chat me *Track ${order.id}* bhejein.\n\n` +
    `— *Team Shifter Online*`;

  if (!wasMilestoneSent(order.id, "assigned", senderPhone)) {
    markMilestoneSent(order.id, "assigned", senderPhone);
    await sendWhatsAppNotification(senderPhone, msg);
  }

  return true;
}

/**
 * Order Cancellation Notification
 */
async function notifyOrderCancelled(orderId, reason = "") {
  const data = await getOrderDetailsWithParticipants(orderId);
  if (!data) return false;

  const { order, senderPhone, receiverPhone } = data;

  const msg =
    `Hello! 👋\n` +
    `⚠️ *Order #${order.id} Cancelled*\n\n` +
    `Aapka order cancel ho gaya hai.` +
    (reason ? `\n*Reason*: ${reason}\n\n` : `\n\n`) +
    `Kisi bhi sahayata ke liye hamare Customer Care 9109114515 par sampark karein.\n\n` +
    `— *Team Shifter Online*`;

  if (senderPhone && !wasMilestoneSent(order.id, "cancelled", senderPhone)) {
    markMilestoneSent(order.id, "cancelled", senderPhone);
    await sendWhatsAppNotification(senderPhone, msg);
  }

  if (receiverPhone && receiverPhone !== senderPhone && !wasMilestoneSent(order.id, "cancelled", receiverPhone)) {
    markMilestoneSent(order.id, "cancelled", receiverPhone);
    await sendWhatsAppNotification(receiverPhone, msg);
  }

  return true;
}

/**
 * Milestone Ride Amount Reward WhatsApp Notification
 * Informs customer on WhatsApp about their rewarded plan, validity, and perks.
 */
async function notifyAmountRewardWhatsApp({ phone, customerName, planName, minAmount, validityDays, benefits = [] }) {
  if (!phone) return false;

  let perksText = "";
  if (Array.isArray(benefits) && benefits.length > 0) {
    perksText = "\n*Aapke Plan Ke Mukhya Fayde:*\n" + benefits.slice(0, 4).map((b) => `• ${b}`).join("\n") + "\n";
  }

  const msg =
    `Badhai ho! 🎉 *Milestone Reward Unlocked*\n\n` +
    `Namaste ${customerName || "Customer"}, 👋\n\n` +
    `Aapne safaltapoorvak total *₹${minAmount}* ki rides poori ki hai! Shifter Online ki taraf se aapko reward ke roop me mila hai:\n\n` +
    `👑 *Plan*: ${planName}\n` +
    `⏱️ *Validity*: ${validityDays || "1 Mahina (30 Din)"}\n` +
    `💰 *Price*: ₹0 (Bilkul FREE)\n` +
    perksText +
    `\nAapka reward plan activate ho chuka hai aur har nayi booking par saare fayde milenge! 🚚✨\n\n` +
    `— *Team Shifter Online*`;

  return sendWhatsAppNotification(phone, msg);
}

module.exports = {
  setWhatsAppClient,
  sendWhatsAppNotification,
  notifyOrderBooked,
  notifyDriverAssigned,
  notifyDriverArrived,
  notifyTripStarted,
  notifyDriverArrivedDrop,
  notifyTripCompleted,
  notifyOrderCancelled,
  notifyAmountRewardWhatsApp,
  getOrderDetailsWithParticipants,
};

