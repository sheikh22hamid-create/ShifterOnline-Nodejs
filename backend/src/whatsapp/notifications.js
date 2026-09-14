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
 * Sends outbound automated WhatsApp message to a customer's phone number
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
    const formattedJid = `${cleanPhone}@s.whatsapp.net`;

    if (whatsappClientRef.sendMessage) {
      await whatsappClientRef.sendMessage(formattedJid, { text: messageText });
      logger.info(`Outbound WhatsApp notification successfully sent to ${cleanPhone}`);
      return true;
    }
  } catch (err) {
    logger.error(`Failed to send WhatsApp notification to ${phoneNumber}:`, err);
    return false;
  }
}

/**
 * Triggered when a new order is booked via Mobile App (order_status: 0 / Pending)
 */
async function notifyOrderBooked(orderId) {
  try {
    const order = await prisma.pkg_order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order || !order.pmobile) return;

    const trackingUrl = process.env.PUBLIC_TRACKING_URL || `https://shifter.online/track/${order.id}`;
    const radiusNote = Number(order.radius_charge) > 0 ? ` (Radius Charge: ₹${order.radius_charge})` : ` (1st km Free)`;

    const msg = `🎉 *Order Booked Successfully! (Order #${order.id})*\n\n` +
      `🚗 *Category*: ${order.category || "Parcel"}\n` +
      `📍 *Pickup*: ${order.paddress}\n` +
      `🎯 *Drop*: ${order.daddress}\n` +
      `🛣️ *Distance*: ${order.distance || 0} km\n` +
      `⭕ *Search Radius*: ${order.radius_range || 5} km${radiusNote}\n` +
      `💰 *Estimated Total Fare*: ₹${order.total_dcharge}\n` +
      `🔑 *Pickup OTP*: ${order.otp || "N/A"}\n\n` +
      `⚡ Nearest driver assign hone par aapko yahan turant update milega!\n\n` +
      `🗺️ *Live Order Status Track Karein*: ${trackingUrl}`;

    await sendWhatsAppNotification(order.pmobile, msg);
  } catch (err) {
    logger.error("notifyOrderBooked error:", err);
  }
}

/**
 * Triggered when a driver accepts a trip (order_status: 1 / Processing / Driver Assigned)
 */
async function notifyDriverAssigned(orderId) {
  try {
    const order = await prisma.pkg_order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order || !order.pmobile) return;

    let driverText = "Assigned Driver Partner";
    if (order.rid > 0) {
      const driver = await prisma.tbl_rider.findUnique({
        where: { id: order.rid },
      });
      if (driver) {
        driverText = `👤 *Driver*: ${driver.first_name || ""} ${driver.last_name || ""}\n📱 *Phone*: ${driver.fmobile}\n🛵 *Vehicle*: ${driver.vehicle || ""} (${driver.vehicle_no || "N/A"})`;
      }
    }

    const trackingUrl = process.env.PUBLIC_TRACKING_URL || `https://shifter.online/track/${order.id}`;

    const msg = `🚗 *Your Driver Has Been Assigned! (Order #${order.id})*\n\n` +
      `${driverText}\n\n` +
      `📍 *Pickup*: ${order.paddress}\n` +
      `🔑 *Pickup OTP*: ${order.otp || "N/A"}\n` +
      `💰 *Fare Amount*: ₹${order.total_dcharge}\n\n` +
      `Driver aapke pickup point ki taraf ravana ho chuka hai!\n\n` +
      `🗺️ *Live Status*: ${trackingUrl}`;

    await sendWhatsAppNotification(order.pmobile, msg);
  } catch (err) {
    logger.error("notifyDriverAssigned error:", err);
  }
}

/**
 * Triggered when driver reaches pickup location (order_status: 2 / Pickup / Arrived)
 */
async function notifyDriverArrived(orderId) {
  try {
    const order = await prisma.pkg_order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order || !order.pmobile) return;

    let driverName = "Driver Partner";
    if (order.rid > 0) {
      const driver = await prisma.tbl_rider.findUnique({
        where: { id: order.rid },
      });
      if (driver) {
        driverName = `${driver.first_name || ""} ${driver.last_name || ""}`.trim();
      }
    }

    const msg = `📍 *Driver Arrived at Pickup Location! (Order #${order.id})*\n\n` +
      `Aapka driver partner (*${driverName}*) pickup location par pahunch chuka hai.\n\n` +
      `🔑 *Share OTP with Driver*: *${order.otp || "N/A"}*\n\n` +
      `Kripya driver ko parcel handover karein.`;

    await sendWhatsAppNotification(order.pmobile, msg);
  } catch (err) {
    logger.error("notifyDriverArrived error:", err);
  }
}

/**
 * Triggered when OTP is verified and trip starts (order_status: 3 / On_Route)
 */
async function notifyTripStarted(orderId) {
  try {
    const order = await prisma.pkg_order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order || !order.pmobile) return;

    const trackingUrl = process.env.PUBLIC_TRACKING_URL || `https://shifter.online/track/${order.id}`;

    const msg = `🚚 *Trip Started & Package Picked Up! (Order #${order.id})*\n\n` +
      `Aapka parcel successful pickup ho gaya hai aur drop location ki taraf in-transit hai.\n\n` +
      `🎯 *Drop Location*: ${order.daddress}\n\n` +
      `🗺️ *Live Location Tracking*: ${trackingUrl}`;

    await sendWhatsAppNotification(order.pmobile, msg);
  } catch (err) {
    logger.error("notifyTripStarted error:", err);
  }
}

/**
 * Triggered automatically when trip completes (order_status: 5 / Completed)
 * Sends complete ride details notification to customer's registered WhatsApp number.
 */
async function notifyTripCompleted(orderId) {
  try {
    const numericOrderId = parseInt(orderId, 10);
    if (isNaN(numericOrderId)) return;

    const order = await prisma.pkg_order.findUnique({
      where: { id: numericOrderId },
    });

    if (!order) return;

    // Resolve target phone number (pmobile or registered user's mobile number)
    let targetPhone = order.pmobile;
    if ((!targetPhone || targetPhone === "0" || targetPhone.trim() === "") && order.uid) {
      const user = await prisma.tbl_user.findUnique({ where: { id: order.uid } });
      if (user && user.mobile) {
        targetPhone = String(user.mobile);
      }
    }

    if (!targetPhone) return;

    // Fetch vehicle model title
    let modelTitle = "Standard Model";
    if (order.delivery_type) {
      const pkg = await prisma.tbl_package.findUnique({
        where: { id: Number(order.delivery_type) },
      });
      if (pkg && pkg.title) {
        modelTitle = pkg.title;
      }
    } else if (order.allowed_delivery_types) {
      try {
        const parsed = JSON.parse(order.allowed_delivery_types);
        const pkgId = Array.isArray(parsed) && parsed.length > 0 ? Number(parsed[0]) : null;
        if (pkgId) {
          const pkg = await prisma.tbl_package.findUnique({ where: { id: pkgId } });
          if (pkg && pkg.title) modelTitle = pkg.title;
        }
      } catch (e) {}
    }

    // Format Completion Date & Time (IST format: DD/MM/YYYY, HH:MM AM/PM)
    const completionDate = order.ddate || order.updatedAt || new Date();
    const dateObj = new Date(completionDate);
    const formattedDateTime = dateObj.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const categoryName = order.category || "Standard Vehicle";
    const fare = order.total_dcharge || order.d_charge || 0;
    const distanceKm = order.distance || 0;

    const msg = `🎉 *Your ride has been successfully completed.*\n\n` +
      `📋 *Ride & Delivery Details*:\n` +
      `📍 *Pickup*: ${order.paddress || "N/A"}\n` +
      `🎯 *Drop*: ${order.daddress || "N/A"}\n` +
      `🚗 *Vehicle*: ${categoryName}\n` +
      `🚚 *Model*: ${modelTitle}\n` +
      `🛣️ *Distance*: ${distanceKm} km\n` +
      `💰 *Final Fare*: ₹${fare}\n` +
      `🆔 *Order ID*: #${order.id}\n` +
      `⏰ *Completed At*: ${formattedDateTime}\n\n` +
      `🙏 *Thank you for using our service. We look forward to serving you again!*`;

    await sendWhatsAppNotification(targetPhone, msg);
    logger.info(`Successfully sent ride completion WhatsApp notification for Order #${order.id} to ${targetPhone}`);
  } catch (err) {
    logger.error("notifyTripCompleted error:", err);
  }
}

/**
 * Triggered when order is cancelled (order_status: 4 / Cancelled)
 */
async function notifyOrderCancelled(orderId, reason = "") {
  try {
    const order = await prisma.pkg_order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order || !order.pmobile) return;

    const reasonText = reason || order.cancel_reason || "Cancelled by customer/system";

    const msg = `❌ *Order #${order.id} Cancelled*\n\n` +
      `Aapka Order #${order.id} cancel ho gaya hai.\n` +
      `📋 *Reason*: ${reasonText}\n\n` +
      `Naye order ke liye Shifter Online App open karein!`;

    await sendWhatsAppNotification(order.pmobile, msg);
  } catch (err) {
    logger.error("notifyOrderCancelled error:", err);
  }
}

module.exports = {
  setWhatsAppClient,
  sendWhatsAppNotification,
  notifyOrderBooked,
  notifyDriverAssigned,
  notifyDriverArrived,
  notifyTripStarted,
  notifyTripCompleted,
  notifyOrderCancelled,
};
