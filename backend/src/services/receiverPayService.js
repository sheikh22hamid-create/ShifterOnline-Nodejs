const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("./receiverPaySettings");
const { parseCommissionPercent, receiverPayable } = require("./receiverPayCalc");
const { mintToken } = require("./receiverPayToken");
const { normalizeToLast10Digits } = require("../utils/phone");

class ReceiverPayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReceiverPayError";
    this.code = code;
  }
}

const bookingFail = (code, msg) => ({ ok: false, code, msg });

// Same cash test tripLifecycle uses when it decides a settlement is due.
function isCashBooking(pMethodId, transactionId) {
  return Number(pMethodId) === 2 || Number(pMethodId) === 0 || String(transactionId || "").toLowerCase().startsWith("cash");
}

async function validateBooking({ receiverPays, commissionPercent, dmobile, pMethodId, transactionId }) {
  if (!receiverPays) return { ok: true, value: null };
  if (!(await settings.isReceiverPayAvailable())) {
    return bookingFail("RECEIVER_PAY_UNAVAILABLE", "Receiver pays is not available right now.");
  }
  if (!isCashBooking(pMethodId, transactionId)) {
    return bookingFail("RECEIVER_PAY_UNAVAILABLE", "Receiver pays works only with cash orders.");
  }
  const phone = normalizeToLast10Digits(dmobile);
  if (!phone || phone.length !== 10) {
    return bookingFail("VALIDATION", "A valid 10-digit receiver mobile number is required.");
  }
  const { maxPercent } = await settings.getReceiverPaySettings();
  const pct = parseCommissionPercent(commissionPercent, maxPercent);
  if (!pct.ok) return bookingFail("VALIDATION", pct.msg);
  return { ok: true, value: { phone, percent: pct.value } };
}

async function createForOrder({ orderId, uid, phone, name, percent }) {
  const now = new Date();
  return prisma.order_receiver_pay.create({
    data: {
      order_id: orderId,
      uid,
      receiver_phone: phone,
      receiver_name: name ? String(name).slice(0, 100) : null,
      commission_percent: percent,
      status: "active",
      created_at: now,
      updated_at: now,
    },
  });
}

async function getActiveForOrder(orderId) {
  return prisma.order_receiver_pay.findFirst({ where: { order_id: orderId, status: "active" } });
}

// Receiver mode turned out not to apply (Monthly/Daily driver, nothing due, settlement
// creation failed): the order proceeds as a normal customer-paid ride.
async function close(orderId, reason) {
  const res = await prisma.order_receiver_pay.updateMany({
    where: { order_id: orderId, status: "active" },
    data: { status: "closed", updated_at: new Date() },
  });
  if (res.count) logger.info(`receiverPay: order ${orderId} closed (${reason})`);
}

async function getConfig() {
  const s = await settings.getReceiverPaySettings();
  const available = await settings.isReceiverPayAvailable();
  return { enabled: available, max_percent: s.maxPercent, max_amount: s.maxAmount };
}

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_LINK_SENDS = 10;

function buildPayLink(token) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/pay/${token}`;
}

function buildLinkMessage({ orderId, amountDue, markup, total, link }) {
  const money = (n) => Number(n).toFixed(2);
  const breakup = markup > 0
    ? `Fare (discount ke baad): ₹${money(amountDue)}\nService fee: ₹${money(markup)}\n*Total: ₹${money(total)}*`
    : `*Total: ₹${money(total)}*`;
  return (
    `Hello! 👋\n` +
    `Order *#${orderId}* ki delivery complete ho gayi hai. Is order ka payment aapko karna hai. 💳\n\n` +
    `${breakup}\n\n` +
    `Secure payment link (app ki zaroorat nahi):\n${link}\n\n` +
    `Agar aap pay nahi karna chahte, to link me *Decline* dabayein.\n\n` +
    `— *Team Shifter Online*\n📞 Customer Care: 9109114515`
  );
}

// Mints a fresh token on every call, so a resend invalidates the previous link.
async function issueLink({ orderId, resend = false }) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId } });
  if (!row || row.status !== "active") throw new ReceiverPayError("NOT_ACTIVE", "Receiver payment is not active for this order.");
  const settlement = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!settlement || settlement.payer !== "receiver" || settlement.status !== "pending") {
    throw new ReceiverPayError("NOT_PAYABLE", "There is nothing for the receiver to pay on this order.");
  }
  if (!process.env.PUBLIC_BASE_URL) {
    logger.error("receiverPay.issueLink: PUBLIC_BASE_URL is not configured; cannot build a pay link.");
    throw new ReceiverPayError("NOT_CONFIGURED", "Payment link is not available right now.");
  }
  const now = new Date();
  if (resend) {
    if (row.link_send_count >= MAX_LINK_SENDS) throw new ReceiverPayError("LINK_LIMIT", "The link was already sent too many times.");
    if (row.link_sent_at && now.getTime() - new Date(row.link_sent_at).getTime() < RESEND_COOLDOWN_MS) {
      throw new ReceiverPayError("TOO_SOON", "Please wait a minute before sending the link again.");
    }
  }
  const { linkTtlHours } = await settings.getReceiverPaySettings();
  const { token, hash } = mintToken();
  await prisma.order_receiver_pay.update({
    where: { id: row.id },
    data: {
      token_hash: hash,
      token_expires_at: new Date(now.getTime() + linkTtlHours * 3600 * 1000),
      link_sent_at: now,
      link_send_count: { increment: 1 },
      updated_at: now,
    },
  });
  const link = buildPayLink(token);
  const total = receiverPayable(settlement.amount_due, settlement.receiver_markup);
  // Lazy require: whatsapp/notifications pulls in the WhatsApp client; keep it out of module load.
  const { sendWhatsAppNotification } = require("../whatsapp/notifications");
  // The token was already rotated above, so a send failure must still hand the new link back.
  let sent = false;
  try {
    sent = await sendWhatsAppNotification(
      row.receiver_phone,
      buildLinkMessage({ orderId, amountDue: Number(settlement.amount_due), markup: Number(settlement.receiver_markup), total, link })
    );
  } catch (err) {
    logger.warn(`receiverPay.issueLink: WhatsApp send threw for order ${orderId}: ${err && err.message}`);
  }
  if (!sent) logger.warn(`receiverPay.issueLink: WhatsApp not delivered for order ${orderId}; link must be resent or shared.`);
  return { sent: Boolean(sent), link };
}

module.exports = { ReceiverPayError, isCashBooking, validateBooking, createForOrder, getActiveForOrder, close, getConfig, buildPayLink, buildLinkMessage, issueLink };
