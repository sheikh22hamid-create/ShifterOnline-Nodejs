const crypto = require("crypto");
const logger = require("../utils/logger");

function secretsMatch(provided, expected) {
  if (typeof provided !== "string") return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch rather than returning
  // false, and comparing lengths first is itself safe — the secret's
  // length isn't the secret.
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = function legacyAuth(req, res, next) {
  const expected = process.env.LEGACY_BRIDGE_SECRET;
  if (!expected) {
    logger.error("legacyAuth: LEGACY_BRIDGE_SECRET is not set — refusing all /legacy requests");
    return res.status(503).json({ Result: false, msg: "Bridge not configured" });
  }

  const provided = req.headers["x-legacy-bridge-secret"];
  if (!secretsMatch(provided, expected)) {
    return res.status(401).json({ Result: false, msg: "Unauthorized" });
  }

  next();
};
