const crypto = require("crypto");
const logger = require("./logger");

// Shared Razorpay payment verification, extracted out of
// customerWalletController.addWallet so other money-moving flows (premium
// plan purchase, etc.) get the same protection instead of trusting whatever
// amount/status the client claims. See that controller's original comment
// for why signature-only verification isn't enough: the HMAC covers
// `${order_id}|${payment_id}` but not the amount, so it only proves the
// order/payment pair is real, not that the amount claimed is what was paid.
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;

async function fetchRazorpayPayment(paymentId) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const resp = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

// Verifies a client-reported Razorpay payment against Razorpay's own API:
// signature match, captured status, matching order id, and matching amount
// (in rupees - converted to paise for the comparison). Returns
// { ok: true, payment } or { ok: false, reason }. Never throws for
// verification failures - only for missing config, so callers can log that
// distinctly from "the customer sent a bad/forged payment".
async function verifyRazorpayPayment({ paymentId, orderId, signature, expectedAmountRupees }) {
  if (!RAZORPAY_KEY_SECRET || !RAZORPAY_KEY_ID) {
    throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured");
  }
  if (!paymentId || !orderId || !signature) {
    return { ok: false, reason: "Missing Razorpay payment details" };
  }

  const generatedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  if (generatedSignature !== signature) {
    return { ok: false, reason: "Payment Verification Failed!" };
  }

  let payment;
  try {
    payment = await fetchRazorpayPayment(paymentId);
  } catch (e) {
    logger.error("verifyRazorpayPayment: Razorpay payment lookup failed:", e);
    return { ok: false, reason: "Unable to verify payment right now. Try again." };
  }

  const expectedPaise = Math.round(Number(expectedAmountRupees) * 100);
  if (
    !payment ||
    payment.status !== "captured" ||
    payment.order_id !== orderId ||
    Number(payment.amount) !== expectedPaise
  ) {
    return { ok: false, reason: "Payment Verification Failed!" };
  }

  return { ok: true, payment };
}

// Fetches an order's own record from Razorpay (not the payment) - used
// where a caller needs to check what the order was actually created for
// (e.g. its `receipt`) before trusting a client-reported payment against
// it, rather than trusting whatever purpose/amount the client claims the
// order was for.
async function fetchRazorpayOrder(orderId) {
  if (!RAZORPAY_KEY_SECRET || !RAZORPAY_KEY_ID) {
    throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured");
  }
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const resp = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

module.exports = { verifyRazorpayPayment, fetchRazorpayPayment, fetchRazorpayOrder };
