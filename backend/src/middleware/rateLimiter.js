const logger = require("../utils/logger");

const rateLimitMap = new Map();

/**
 * Lightweight in-memory sliding window rate limiter
 * @param {Object} options { windowMs, max, message }
 */
module.exports = function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute window
  const max = options.max || 30; // max 30 requests per window
  const message = options.message || "Too many requests, please try again later.";

  return function (req, res, next) {
    const key = (req.user && req.user.id) ? `user_${req.user.id}` : `ip_${req.ip || '127.0.0.1'}`;
    const now = Date.now();
    const record = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
      record.count = 0;
      record.resetTime = now + windowMs;
    }

    record.count += 1;
    rateLimitMap.set(key, record);

    if (record.count > max) {
      logger.warn(`Rate limit exceeded for key ${key} on endpoint ${req.originalUrl}`);
      return res.status(429).json({ Result: false, success: false, msg: message });
    }

    next();
  };
};
