const receiverTrackMessage = require("../services/receiverTrackMessage");
const logger = require("../utils/logger");

// Same convention as the other customer order endpoints: always HTTP 200, the outcome is in the body.
const toId = (v) => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const reply = (res, code, result, msg, extra = {}) =>
  res.status(200).json({ ResponseCode: code, Result: result, ResponseMsg: msg, ...extra });

// POST /api/order/track-link { uid, order_id } -> { tracking_url } for the "Share Live Tracking" card.
async function customerTrackLink(req, res) {
  try {
    const uid = toId((req.body || {}).uid);
    const orderId = toId((req.body || {}).order_id);
    if (!uid || !orderId) return reply(res, "401", "false", "uid and order_id are required", { code: "VALIDATION" });
    const out = await receiverTrackMessage.urlForBooker({ orderId, uid });
    if (!out.ok) return reply(res, "401", "false", out.msg, { code: out.code });
    return reply(res, "200", "true", "OK", { tracking_url: out.url });
  } catch (err) {
    logger.error("customerTrackLink failed:", err);
    return reply(res, "500", "false", "Internal server error");
  }
}

module.exports = { customerTrackLink };
