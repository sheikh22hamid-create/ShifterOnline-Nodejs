const crypto = require("crypto");

// Stateless pay-link token for the SENDER: "<orderId>.<expiresAtMs>.<hmac>". It only proves the holder
// was given the link for that order; the amount, the payer and whether anything is still due always come
// from the settlement row. Needs no table, and an old link keeps working until it expires.
const TOKEN_SHAPE = /^\d{1,10}\.\d{10,16}\.[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;

const secret = () => process.env.SENDER_PAY_SECRET || process.env.JWT_SECRET || "";
const sign = (body) => crypto.createHmac("sha256", secret()).update(`sender-pay:${body}`).digest("base64url");

function mint(orderId, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  if (!secret() || !Number.isInteger(Number(orderId)) || Number(orderId) <= 0) return null;
  const body = `${Number(orderId)}.${now + ttlMs}`;
  return `${body}.${sign(body)}`;
}

// -> { orderId, expiresAt } for an authentic token (expired or not), else null.
function verify(token) {
  if (!secret() || !TOKEN_SHAPE.test(String(token || ""))) return null;
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const given = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(sign(body));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const [orderId, expiresAt] = body.split(".").map(Number);
  return { orderId, expiresAt };
}

module.exports = { TOKEN_SHAPE, mint, verify };
