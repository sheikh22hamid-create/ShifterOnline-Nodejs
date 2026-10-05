const crypto = require("crypto");

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

// Only the hash is ever stored; the raw token exists in the WhatsApp message.
function mintToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

module.exports = { mintToken, hashToken };
