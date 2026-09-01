const logger = require("../utils/logger");

module.exports = function legacyAuth(req, res, next) {
  const expected = process.env.LEGACY_BRIDGE_SECRET;
  if (!expected) {
    logger.error("legacyAuth: LEGACY_BRIDGE_SECRET is not set — refusing all /legacy requests");
    return res.status(503).json({ Result: false, msg: "Bridge not configured" });
  }

  const provided = req.headers["x-legacy-bridge-secret"];
  if (provided !== expected) {
    return res.status(401).json({ Result: false, msg: "Unauthorized" });
  }

  next();
};
