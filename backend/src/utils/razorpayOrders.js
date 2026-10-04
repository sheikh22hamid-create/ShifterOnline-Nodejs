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
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(Number(amountRupees) * 100), currency: "INR", receipt }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    logger.error("createRazorpayOrder: Razorpay API error:", data);
    return { ok: false, reason: data?.error?.description || "Failed to create payment order" };
  }
  return { ok: true, id: data.id, amountPaise: data.amount, currency: data.currency };
}

module.exports = { createRazorpayOrder };
