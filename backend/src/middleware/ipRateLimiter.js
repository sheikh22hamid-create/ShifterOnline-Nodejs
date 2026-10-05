// Per-instance, proxy-aware fixed-window limiter for public (no-login) endpoints.
// Keys on the first x-forwarded-for hop (Render sits behind a proxy), falling back to req.ip.
const PRUNE_THRESHOLD = 1000;

function createIpRateLimiter({ name, windowMs, max }) {
  const hits = new Map();

  const middleware = (req, res, next) => {
    const now = Date.now();
    if (hits.size > PRUNE_THRESHOLD) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const xff = req.headers && req.headers["x-forwarded-for"];
    const first = typeof xff === "string" ? xff.split(",")[0].trim() : "";
    const key = `${name}:${first || req.ip || "unknown"}`;

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, code: "RATE_LIMITED", message: "Too many requests, please try again shortly." });
    }
    return next();
  };
  middleware._size = () => hits.size;
  return middleware;
}

module.exports = { createIpRateLimiter };
