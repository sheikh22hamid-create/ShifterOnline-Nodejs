const prisma = require("../config/db");
const logger = require("../utils/logger");
const { sendWhatsAppNotification } = require("../whatsapp/notifications");

const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY;
const TWOFACTOR_BASE = "https://2factor.in/API/V1";
const DRIVER_APP_DOWNLOAD_URL = "https://play.google.com/store/apps/details?id=com.shifter.driver";
const HELPLINE_NUMBER = "+91 9109114515";

function buildWhatsAppReminderText() {
  return (
    `Namaste! 🙏\n\n` +
    `Aapne *Shifter Online Driver Partner* banne ke liye mobile number verify kiya tha lekin registration form complete nahi hua. 🚚\n\n` +
    `Bas 2 minute me apni details aur documents submit karke daily behtareen kamai shuru karein!\n\n` +
    `📲 *Shifter Driver App* khol kar registration poora karein:\n` +
    `👉 ${DRIVER_APP_DOWNLOAD_URL}\n\n` +
    `Koi sawaal ho to hume call karein: ${HELPLINE_NUMBER}\n` +
    `— *Team Shifter Online*`
  );
}

function buildSmsReminderText() {
  return `Namaste! Aapne Shifter Driver registration start kiya tha. Isse poora karne ke liye Driver App kholein: ${DRIVER_APP_DOWNLOAD_URL} - Shifter Online`;
}

/**
 * Sends the "continue your registration" nudge to a verified-but-incomplete
 * driver lead via WhatsApp and SMS. Returns which channels succeeded.
 */
async function sendReminder(leadId) {
  const lead = await prisma.tbl_registration_lead.findUnique({ where: { id: parseInt(leadId, 10) } });
  if (!lead) throw new Error("Lead not found");

  const phone = String(lead.phone || "").replace(/[^0-9]/g, "").slice(-10);
  if (!phone || phone.length !== 10) throw new Error("Invalid lead phone number");

  const whatsappMsg = buildWhatsAppReminderText();
  const smsMsg = buildSmsReminderText();

  let whatsappSent = false;
  let smsSent = false;

  try {
    whatsappSent = await sendWhatsAppNotification(phone, whatsappMsg);
  } catch (err) {
    logger.error(`registrationLeadService: WhatsApp send failed for ${phone}:`, err.message);
  }

  if (!TWOFACTOR_API_KEY) {
    logger.warn("registrationLeadService: TWOFACTOR_API_KEY not configured, skipping SMS reminder.");
  } else {
    try {
      const encodedMsg = encodeURIComponent(smsMsg);
      const smsUrl = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/ADDON_SERVICES/SEND/TSMS`;
      const resp = await fetch(smsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `From=SHIFTR&To=${phone}&Msg=${encodedMsg}`,
      }).catch(() => null);

      if (resp && resp.ok) {
        const json = await resp.json().catch(() => null);
        if (json && (json.Status === "Success" || json.status === "success")) {
          smsSent = true;
        }
      }

      if (!smsSent) {
        const fallbackUrl = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/SMS/${phone}/${encodedMsg}`;
        const fbResp = await fetch(fallbackUrl).catch(() => null);
        if (fbResp && fbResp.ok) {
          const fbJson = await fbResp.json().catch(() => null);
          if (fbJson && fbJson.Status === "Success") smsSent = true;
        }
      }
    } catch (err) {
      logger.error(`registrationLeadService: SMS send failed for ${phone}:`, err.message);
    }
  }

  await prisma.tbl_registration_lead.update({
    where: { id: lead.id },
    data: { last_reminder_sent_at: new Date(), reminder_count: { increment: 1 } },
  });

  return { whatsapp: whatsappSent, sms: smsSent, phone };
}

/**
 * Called from riderAuthController.verifyOtp when a driver mobile number
 * clears OTP but has no tbl_rider row yet. Upserts by phone so repeated OTP
 * retries update the timestamp instead of creating duplicate rows, and fires
 * the first reminder automatically - later ones are admin-triggered via
 * sendReminder above.
 */
async function upsertOnOtpVerify({ phone, deviceId }) {
  const existing = await prisma.tbl_registration_lead.findUnique({ where: { phone } });
  const now = new Date();

  if (existing) {
    await prisma.tbl_registration_lead.update({
      where: { id: existing.id },
      data: { otp_verified_at: now, device_id: deviceId || existing.device_id },
    });
    return existing;
  }

  const created = await prisma.tbl_registration_lead.create({
    data: { phone, device_id: deviceId || null, otp_verified_at: now, status: "pending" },
  });

  try {
    await sendReminder(created.id);
  } catch (err) {
    logger.warn(`registrationLeadService: initial reminder failed for lead #${created.id}:`, err.message);
  }

  return created;
}

/**
 * Called from riderAuthController.registerHandler once a driver finishes
 * registration, so the admin's incomplete-registrations queue drops the row
 * automatically instead of relying on manual cleanup.
 */
async function markRegistered({ phone, riderId }) {
  const lead = await prisma.tbl_registration_lead.findUnique({ where: { phone } });
  if (!lead) return null;

  return prisma.tbl_registration_lead.update({
    where: { id: lead.id },
    data: { status: "registered", registered_rider_id: riderId, registered_at: new Date() },
  });
}

module.exports = { upsertOnOtpVerify, markRegistered, sendReminder };
