const logger = require("./logger");

// Server-side Razorpay order creation for flows where the amount must come
// from the DB, never from the client (see customerWalletController.createRazorpayOrder
// for the wallet-topup variant that accepts a client amount).
async function createRazorpayOrder({ amountRupees, receipt }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    logger.error("createRazorpayOrder: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.");
    return { ok: false, reason: "Payment gateway is not configured. Try again later." };
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  let resp;
  let data = null;
  try {
    resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.round(Number(amountRupees) * 100), currency: "INR", receipt }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    logger.error("createRazorpayOrder: could not reach Razorpay:", err);
    return { ok: false, reason: "Could not reach the payment gateway. Try again." };
  }
  try {
    data = await resp.json();
  } catch (err) {
    logger.error(`createRazorpayOrder: unreadable Razorpay response (HTTP ${resp.status}):`, err);
  }
  if (!resp.ok) {
    logger.error("createRazorpayOrder: Razorpay API error:", data);
    return { ok: false, reason: data?.error?.description || (data ? "Failed to create payment order" : "Payment gateway error. Try again.") };
  }
  if (!data?.id) {
    return { ok: false, reason: "Payment gateway error. Try again." };
  }
  return { ok: true, id: data.id, amountPaise: data.amount, currency: data.currency };
}

module.exports = { createRazorpayOrder };
