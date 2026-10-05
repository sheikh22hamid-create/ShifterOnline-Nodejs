const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("./receiverPaySettings");
const { parseCommissionPercent } = require("./receiverPayCalc");
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

function getActiveForOrder(orderId) {
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

module.exports = { ReceiverPayError, isCashBooking, validateBooking, createForOrder, getActiveForOrder, close, getConfig };
