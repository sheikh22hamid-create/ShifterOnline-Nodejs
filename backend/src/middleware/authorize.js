/**
 * Role whitelist middleware factory. Must run after auth.js (needs req.user).
 * Super Admin privileges are automatically inherited by City Admin ('admin').
 * Usage: router.get("/staff", auth, authorize("superadmin", "admin"), ctrl.list)
 */
module.exports = function authorize(...allowedRoles) {
  const effectiveRoles = [...allowedRoles];
  if (effectiveRoles.includes("superadmin") && !effectiveRoles.includes("admin")) {
    effectiveRoles.push("admin");
  }
  return function (req, res, next) {
    if (!req.user || !effectiveRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden: insufficient role privileges" });
    }
    next();
  };
};
