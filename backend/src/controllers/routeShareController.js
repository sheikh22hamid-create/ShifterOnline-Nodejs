const logger = require("../utils/logger");
const routeShareService = require("../services/routeShareService");
const { getMapConfig } = require("../services/receiverTrackSettings");
const { renderPage } = require("./routePage");

const toId = (v) => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const reply = (res, code, result, msg, extra = {}) =>
  res.status(200).json({ ResponseCode: code, Result: result, ResponseMsg: msg, ...extra });

// POST /api/order/route-share-link { uid, order_id } -> { share_url } for the "Share Route" button.
async function customerRouteLink(req, res) {
  try {
    const uid = toId((req.body || {}).uid);
    const orderId = toId((req.body || {}).order_id);
    if (!uid || !orderId) return reply(res, "401", "false", "uid and order_id are required", { code: "VALIDATION" });
    const out = await routeShareService.urlForOwner({ orderId, uid });
    if (!out.ok) return reply(res, "401", "false", out.msg, { code: out.code });
    return reply(res, "200", "true", "OK", { share_url: out.url });
  } catch (err) {
    logger.error("customerRouteLink failed:", err);
    return reply(res, "500", "false", "Could not create the share link. Please try again.");
  }
}

const API_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

// GET /api/route/:token - read-only JSON the public page draws from.
async function routeData(req, res) {
  res.set(API_HEADERS);
  const { token } = req.params;
  if (!routeShareService.isTokenShape(token)) return res.status(404).json({ state: "invalid" });
  try {
    const link = await routeShareService.findByToken(token);
    if (!link) return res.status(404).json({ state: "invalid" });
    routeShareService.touchViewed(link.id);
    return res.json(await routeShareService.buildPublicRoute(link));
  } catch (err) {
    logger.error("route share data failed:", err);
    return res.status(500).json({ state: "error" });
  }
}

// GET /route/:token - the page itself (static shell; data comes from the API above).
function routePage(req, res) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "strict-origin", "X-Robots-Tag": "noindex" });
  if (!routeShareService.isTokenShape(req.params.token)) return res.status(404).json({ state: "invalid" });
  res.set({ "Content-Type": "text/html; charset=utf-8" });
  return res.send(renderPage(getMapConfig()));
}

module.exports = { customerRouteLink, routeData, routePage };
