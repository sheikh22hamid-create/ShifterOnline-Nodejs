const logger = require("../utils/logger");
const receiverSettlementService = require("../services/receiverSettlementService");
const { SettlementError } = require("../services/settlementService");
const { PAGE_HTML } = require("./receiverPayPage");

// Tokens are 32 random bytes, base64url (43 chars). Anything else never reaches the DB.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const notFound = (res) => res.status(404).json({ success: false, code: "INVALID_LINK", message: "This payment link is not valid." });

function handleError(res, err, label) {
  if (err instanceof SettlementError) {
    const status = err.code === "INVALID_LINK" ? 404 : 400;
    return res.status(status).json({ success: false, code: err.code, message: err.message });
  }
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function guarded(label, run) {
  return async (req, res) => {
    const { token } = req.params;
    if (!TOKEN_SHAPE.test(String(token || ""))) return notFound(res);
    try {
      return await run(token, req, res);
    } catch (err) {
      return handleError(res, err, label);
    }
  };
}

const state = guarded("receiverPay state", async (token, req, res) =>
  res.json({ success: true, ...(await receiverSettlementService.getPublicState(token)) }));

const createOrder = guarded("receiverPay createOrder", async (token, req, res) =>
  res.json({ success: true, ...(await receiverSettlementService.createOrderByToken(token)) }));

const verify = guarded("receiverPay verify", async (token, req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ success: false, code: "VALIDATION", message: "Payment details are missing." });
  }
  await receiverSettlementService.settleByReceiver({
    token, paymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id, signature: razorpay_signature,
  });
  return res.json({ success: true, state: "paid" });
});

const decline = guarded("receiverPay decline", async (token, req, res) => {
  await receiverSettlementService.declineByToken(token);
  return res.json({ success: true, state: "closed" });
});

function page(req, res) {
  if (!TOKEN_SHAPE.test(String(req.params.token || ""))) return notFound(res);
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
  return res.send(PAGE_HTML);
}

module.exports = { state, createOrder, verify, decline, page };
