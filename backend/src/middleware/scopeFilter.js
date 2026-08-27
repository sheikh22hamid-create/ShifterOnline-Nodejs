/**
 * Must run after auth.js. Superadmin has no forced city filter (can pass
 * ?city_id=X to narrow); admin/executive are hard-bound to their own city_id
 * regardless of any city_id in the request, per spec Section 3.2.
 */
module.exports = function scopeCityFilter(req, res, next) {
  if (req.user.role === "superadmin") {
    req.scopedCityId = req.query.city_id ? parseInt(req.query.city_id, 10) : null;
  } else {
    req.scopedCityId = parseInt(req.user.city_id, 10);
  }
  next();
};
