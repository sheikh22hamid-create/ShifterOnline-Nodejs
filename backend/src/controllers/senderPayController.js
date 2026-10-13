const logger = require("../utils/logger");
const senderPayService = require("../services/senderPayService");
const { TOKEN_SHAPE } = require("../services/senderPayToken");
const { SettlementError } = require("../services/settlementService");
const { SENDER_PAGE_HTML } = require("./receiverPayPage");

const notFound = (res) => res.status(404).json({ success: false, code: "INVALID_LINK", message: "This payment link is not valid." });

function handleError(res, err, label) {
  if (err instanceof SettlementError) {
    return res.status(err.code === "INVALID_LINK" ? 404 : 400).json({ success: false, code: err.code, message: err.message });
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

const state = guarded("senderPay state", async (token, req, res) =>
  res.json({ success: true, ...(await senderPayService.getPublicState(token)) }));

const createOrder = guarded("senderPay createOrder", async (token, req, res) =>
  res.json({ success: true, ...(await senderPayService.createOrderByToken(token)) }));

const verify = guarded("senderPay verify", async (token, req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ success: false, code: "VALIDATION", message: "Payment details are missing." });
  }
  await senderPayService.settleByToken({
    token, paymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id, signature: razorpay_signature,
  });
  return res.json({ success: true, state: "paid" });
});

function page(req, res) {
  if (!TOKEN_SHAPE.test(String(req.params.token || ""))) return notFound(res);
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
  return res.send(SENDER_PAGE_HTML);
}

module.exports = { state, createOrder, verify, page };
