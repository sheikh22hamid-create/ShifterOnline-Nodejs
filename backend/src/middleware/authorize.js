/**
 * Role whitelist middleware factory. Must run after auth.js (needs req.user).
 * Usage: router.get("/staff", auth, authorize("superadmin", "admin"), ctrl.list)
 */
module.exports = function authorize(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden: insufficient role privileges" });
    }
    next();
  };
};
