// RazorpayX payout webhook. The signature is verified over the raw request
// bytes before anything else runs. Repeated deliveries are harmless because
// applyPayoutState only moves status-guarded transitions.
const prisma = require("../config/db");
const logger = require("../utils/logger");
const razorpayx = require("../utils/razorpayx");
const { applyPayoutState } = require("../services/withdrawalPayout");

const REFERENCE_RE = /^wd-(\d+)$/;

async function handle(req, res) {
  const signature = req.headers?.["x-razorpay-signature"];
  const rawBody = req.rawBody;
  const valid =
    Buffer.isBuffer(rawBody) &&
    typeof signature === "string" &&
    razorpayx.verifyWebhookSignature(rawBody, signature) === true;
  if (!valid) {
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    logger.warn("razorpayx webhook: signed body is not valid JSON, ignored");
    return res.status(200).json({ success: true });
  }

  const eventName = typeof body?.event === "string" ? body.event : undefined;
  const entity = body?.payload?.payout?.entity;
  if (!entity || typeof entity !== "object" || !entity.id) {
    return res.status(200).json({ success: true });
  }

  const payoutId = entity.id;
  let withdrawalId = null;
  try {
    const match = REFERENCE_RE.exec(typeof entity.reference_id === "string" ? entity.reference_id : "");
    if (match) {
      withdrawalId = Number(match[1]);
    } else {
      const found = await prisma.driver_withdraw_requests.findFirst({
        where: { razorpay_payout_id: payoutId },
        select: { id: true },
      });
      if (found) withdrawalId = found.id;
    }

    if (withdrawalId == null) {
      return res.status(200).json({ success: true });
    }

    let status = entity.status;
    if (!status && eventName && eventName.startsWith("payout.")) status = eventName.slice("payout.".length);

    await applyPayoutState({
      withdrawalId,
      payoutId,
      status,
      utr: entity.utr,
      failureReason: entity.status_details?.description || entity.failure_reason || undefined,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error(
      `razorpayx webhook: processing failed (event ${eventName}, payout ${payoutId}, withdrawal ${withdrawalId}):`,
      err
    );
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = { handle };
