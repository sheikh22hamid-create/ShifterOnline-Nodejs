/**
 * Must run after auth.js. Superadmin has no forced city filter (can pass
 * ?city_id=X to narrow); admin/executive are hard-bound to their own city_id
 * regardless of any city_id in the request, per spec Section 3.2.
 *
 * Fails closed: a non-superadmin whose token carries no valid city used to get
 * req.scopedCityId = NaN, which many controllers treat as "no filter" (falsy)
 * and so returned every city's data. They now get a 403 instead.
 */
module.exports = function scopeCityFilter(req, res, next) {
  if (req.user.role === "superadmin") {
    const requested = req.query.city_id ? parseInt(req.query.city_id, 10) : null;
    req.scopedCityId = Number.isInteger(requested) ? requested : null;
    return next();
  }
  const cityId = parseInt(req.user.city_id, 10);
  if (!Number.isInteger(cityId) || cityId <= 0) {
    return res.status(403).json({ success: false, message: "Your account is not assigned to a city. Ask a super admin to assign one." });
  }
  req.scopedCityId = cityId;
  next();
};
