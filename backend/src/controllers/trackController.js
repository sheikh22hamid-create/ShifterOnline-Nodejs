const logger = require("../utils/logger");
const trackLinkService = require("../services/trackLinkService");
const { buildSnapshot } = require("../services/trackSnapshotService");
const { getMapConfig } = require("../services/receiverTrackSettings");
const { renderPage } = require("./trackPage");
const trackActionService = require("../services/trackActionService");

const INVALID = { state: "invalid", poll_ms: 15000 };
const API_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const ACTION_FAIL = { ok: false, code: "NOT_AVAILABLE", message: "This link is no longer available." };

// Shared shell of the two POST endpoints: token shape, link lookup, error mapping.
function action(label, run) {
  return async (req, res) => {
    res.set(API_HEADERS);
    const { token } = req.params;
    if (!trackLinkService.isTokenShape(token)) return res.status(404).json(ACTION_FAIL);
    try {
      const link = await trackLinkService.findByToken(token);
      if (!link) return res.status(404).json(ACTION_FAIL);
      return res.json(await run(link, req.body));
    } catch (err) {
      if (err instanceof trackActionService.TrackActionError) {
        return res.status(err.status).json({ ok: false, code: err.code, message: err.message });
      }
      logger.error(`${label} failed:`, err);
      return res.status(500).json({ ok: false, code: "ERROR", message: "Something went wrong. Please try again." });
    }
  };
}

const payLink = action("track pay-link", async (link) => ({ ok: true, url: (await trackActionService.mintPayLink(link)).link }));
const review = action("track review", async (link, body) => trackActionService.submitReview(link, body));

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
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "strict-origin", "X-Robots-Tag": "noindex" });
  if (!trackLinkService.isTokenShape(req.params.token)) return res.status(404).json(INVALID);
  res.set({ "Content-Type": "text/html; charset=utf-8" });
  return res.send(renderPage(getMapConfig()));
}

module.exports = { snapshot, page, payLink, review };

