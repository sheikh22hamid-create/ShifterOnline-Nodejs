const jwt = require("jsonwebtoken");

/**
 * Verifies the admin-panel JWT and attaches its payload as req.user
 * ({ id, username, role, city_id }). Stateless by design — does not hit the
 * DB on every request — so a deactivated admin's existing token stays valid
 * until it expires. authController re-checks `status` at login time.
 */
module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Missing or malformed Authorization header" });
  }

  try {
    const secret = process.env.JWT_SECRET || "7004f7a8f5c94968583dc101f6b45bf81624ce51ace1197d88d773264b41c9064e51ebf2c74f4895f38739ca0358cfb0";
    const payload = jwt.verify(token, secret);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};
