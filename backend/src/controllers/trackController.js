const logger = require("../utils/logger");
const trackLinkService = require("../services/trackLinkService");
const { buildSnapshot } = require("../services/trackSnapshotService");
const { getMapConfig } = require("../services/receiverTrackSettings");
const { renderPage } = require("./trackPage");

const INVALID = { state: "invalid", poll_ms: 15000 };
const API_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

async function snapshot(req, res) {
  res.set(API_HEADERS);
  const { token } = req.params;
  if (!trackLinkService.isTokenShape(token)) return res.status(404).json(INVALID);
  try {
    const link = await trackLinkService.findByToken(token);
    if (!link) return res.status(404).json(INVALID);
    trackLinkService.touchViewed(link.id);
    return res.json(await buildSnapshot(link));
  } catch (err) {
    logger.error("track snapshot failed:", err);
    return res.status(500).json({ state: "error", poll_ms: 15000 });
  }
}

function page(req, res) {
  // strict-origin (not no-referrer): a domain-restricted MapTiler key needs the Origin on tile requests,
  // and it still keeps the token path from leaking to cdnjs or MapTiler.
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "strict-origin", "X-Robots-Tag": "noindex" });
  if (!trackLinkService.isTokenShape(req.params.token)) return res.status(404).json(INVALID);
  return res.send(renderPage(getMapConfig()));
}

module.exports = { snapshot, page };
