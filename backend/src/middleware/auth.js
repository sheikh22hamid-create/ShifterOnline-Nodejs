const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { parseSidebarModules, isApiPathAllowed } = require("../config/executiveModules");

/**
 * Executive sidebar access (see config/executiveModules.js). Reads admin.permissions on every request so a change
 * made by an admin applies immediately, without waiting for the executive's JWT to expire. Sets
 * req.executiveModules (string[] when restricted, null when unrestricted) for controllers that filter output.
 */
async function enforceExecutiveModules(req, res, next) {
  req.executiveModules = null;
  // Only the admin panel API is module-gated; /api/v1/whatsapp etc. keep their own role checks. adminRoutes.js
  // sets this flag on its own router, so it holds for any URL casing (Express routing is case-insensitive).
  if (!req.isAdminPanelApi) return next();
  try {
    const row = await prisma.admin.findUnique({ where: { id: req.user.id }, select: { permissions: true } });
    const allowed = parseSidebarModules(row && row.permissions);
    if (!allowed) return next(); // no restriction configured (or account row not found): behave as before
    req.executiveModules = allowed;
    const apiPath = req.path.toLowerCase();
    if (apiPath.startsWith("/auth/") || isApiPathAllowed(apiPath, allowed)) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this module is not enabled for your account" });
  } catch (err) {
    // Fail closed: a DB hiccup must not silently lift a restriction.
    logger.error("executive module check failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Verifies the admin-panel JWT and attaches its payload as req.user
 * ({ id, username, role, city_id }). Stateless by design — does not hit the
 * DB on every request — so a deactivated admin's existing token stays valid
 * until it expires. authController re-checks `status` at login time.
 * The one exception is executives, whose sidebar-module permissions are re-read per request.
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
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  if (req.user.role === "executive") return enforceExecutiveModules(req, res, next);
  return next();
};
