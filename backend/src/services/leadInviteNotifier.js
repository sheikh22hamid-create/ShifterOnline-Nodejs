const prisma = require("../config/db");
const logger = require("../utils/logger");
const { sendWhatsAppNotification } = require("../whatsapp/notifications");

const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY || "8b7c5cf8-49dd-11f1-9800-0200cd936042";
const TWOFACTOR_BASE = "https://2factor.in/API/V1";
const APP_DOWNLOAD_URL = "https://play.google.com/store/apps/details?id=com.shifter.online";

/**
 * Builds attractive WhatsApp message for the referred customer.
 */
function buildWhatsAppInviteText(leadName, driverName) {
  const greeting = leadName ? `Namaste ${leadName} ji! 🙏` : `Namaste! 🙏`;
  const referrer = driverName ? `Aapke dost *${driverName}* (Shifter Partner)` : `Shifter Partner`;

  return (
    `${greeting}\n\n` +
    `${referrer} ne aapko *Shifter Online* recommend kiya hai. 🚚\n\n` +
    `Ab kisi bhi saman ko bhejna, mini-truck ya tempo book karna hua behad aasan aur kifayati!\n\n` +
    `📲 *Shifter Customer App* abhi download karein aur apni pehli booking par special discount paiye:\n` +
    `👉 ${APP_DOWNLOAD_URL}\n\n` +
    `Helpline: +91 9999908008\n` +
    `— *Team Shifter Online*`
  );
}

/**
 * Builds concise SMS message text.
 */
function buildSmsInviteText(leadName, driverName) {
  const driverStr = driverName ? ` ${driverName}` : "";
  return `Namaste! Aapke dost${driverStr} ne aapko Shifter Online recommend kiya hai. Mini-truck/tempo booking ke liye app download karein: ${APP_DOWNLOAD_URL} - Shifter Online`;
}

/**
 * Sends invite to a driver lead via both WhatsApp and SMS.
 * @param {number} leadId
 * @returns {Promise<{ whatsapp: boolean, sms: boolean, message: string }>}
 */
async function sendLeadInvite(leadId) {
  const lead = await prisma.tbl_driver_lead.findUnique({ where: { id: parseInt(leadId, 10) } });
  if (!lead) {
    throw new Error("Lead not found");
  }

  const phone = String(lead.phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (!phone || phone.length !== 10) {
    throw new Error("Invalid lead phone number");
  }

  // Fetch submitting driver's name
  let driverName = "";
  if (lead.driver_id) {
    try {
      const driver = await prisma.tbl_rider.findUnique({
        where: { id: lead.driver_id },
        select: { full_name: true, first_name: true, last_name: true },
      });
      if (driver) {
        driverName = driver.full_name || [driver.first_name, driver.last_name].filter(Boolean).join(" ");
      }
    } catch (e) {
      logger.warn(`Could not load driver for lead #${leadId}:`, e.message);
    }
  }

  const whatsappMsg = buildWhatsAppInviteText(lead.name, driverName);
  const smsMsg = buildSmsInviteText(lead.name, driverName);

  let whatsappSent = false;
  let smsSent = false;

  // 1. Send WhatsApp message
  try {
    whatsappSent = await sendWhatsAppNotification(phone, whatsappMsg);
  } catch (err) {
    logger.error(`leadInviteNotifier: WhatsApp send failed for ${phone}:`, err.message);
  }

  // 2. Send SMS via 2Factor Gateway
  try {
    const encodedMsg = encodeURIComponent(smsMsg);
    // 2factor promotional / transactional message API
    const smsUrl = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/ADDON_SERVICES/SEND/TSMS`;
    
    // Attempt POST to TSMS, or fallback to GET URL
    const resp = await fetch(smsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `From=SHIFTR&To=${phone}&Msg=${encodedMsg}`,
    }).catch(() => null);

    if (resp && resp.ok) {
      const json = await resp.json().catch(() => null);
      if (json && (json.Status === "Success" || json.status === "success")) {
        smsSent = true;
        logger.info(`leadInviteNotifier: SMS successfully sent via 2Factor to ${phone}`);
      }
    }

    // If TSMS failed, attempt standard 2Factor fallback endpoint
    if (!smsSent) {
      const fallbackUrl = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/SMS/${phone}/${encodedMsg}`;
      const fbResp = await fetch(fallbackUrl).catch(() => null);
      if (fbResp && fbResp.ok) {
        const fbJson = await fbResp.json().catch(() => null);
        if (fbJson && fbJson.Status === "Success") {
          smsSent = true;
          logger.info(`leadInviteNotifier: SMS fallback sent via 2Factor to ${phone}`);
        }
      }
    }
  } catch (err) {
    logger.error(`leadInviteNotifier: SMS send failed for ${phone}:`, err.message);
  }

  return {
    whatsapp: whatsappSent,
    sms: smsSent,
    phone,
    message: whatsappSent
      ? "Invite sent successfully to customer via WhatsApp Bot! 🚀"
      : "WhatsApp Bot is offline. Please link WhatsApp in Admin -> WhatsApp Account or click the green 'WA' button.",
  };
}

module.exports = {
  sendLeadInvite,
  buildWhatsAppInviteText,
  buildSmsInviteText,
  APP_DOWNLOAD_URL,
};
