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
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};
