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
      logger.info(`Outbound WhatsApp notification successfully sent to ${targetJid}`);
      return true;
    }
  } catch (err) {
    logger.error(`Failed to send WhatsApp notification to ${phoneNumber}:`, err);
    return false;
  }
}

/**
 * Disabled: Automated WhatsApp Notifications for Order Booking & Trip Lifecycle
 * (Turned off as requested)
 */
async function notifyOrderBooked(orderId) {
  logger.debug(`notifyOrderBooked called for order ${orderId} (WhatsApp notification disabled)`);
  return false;
}

async function notifyDriverAssigned(orderId) {
  logger.debug(`notifyDriverAssigned called for order ${orderId} (WhatsApp notification disabled)`);
  return false;
}

async function notifyDriverArrived(orderId) {
  logger.debug(`notifyDriverArrived called for order ${orderId} (WhatsApp notification disabled)`);
  return false;
}

async function notifyTripStarted(orderId) {
  logger.debug(`notifyTripStarted called for order ${orderId} (WhatsApp notification disabled)`);
  return false;
}

async function notifyTripCompleted(orderId) {
  logger.debug(`notifyTripCompleted called for order ${orderId} (WhatsApp notification disabled)`);
  return false;
}

async function notifyOrderCancelled(orderId, reason = "") {
  logger.debug(`notifyOrderCancelled called for order ${orderId} (WhatsApp notification disabled)`);
  return false;
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
