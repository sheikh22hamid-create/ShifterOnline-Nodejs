const logger = require("../utils/logger");
const settings = require("../services/orderSearchSettings");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminOrderSearch.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// Superadmin names the city; everyone else is pinned to their own and refused (403) if they have none.
function cityOf(req) {
  if (req.user.role === "superadmin") {
    const id = Number(req.method === "GET" ? req.query?.city_id : (req.body?.city_id ?? req.query?.city_id));
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, "city_id is required");
    return id;
  }
  const id = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(403, "Your account is not assigned to a city");
  return id;
}

const toApi = (s) => ({
  search_system: s.searchSystem,
  search_radius_km: s.searchRadiusKm,
  driver_search_seconds: s.driverSearchSeconds,
  guarantee_enabled: s.guaranteeEnabled,
  admin_window_minutes: s.adminWindowMinutes,
  guarantee_referrals_required: s.guaranteeReferralsRequired,
});

const fromBody = (b = {}) => ({
  searchSystem: b.search_system,
  searchRadiusKm: b.search_radius_km,
  driverSearchSeconds: b.driver_search_seconds,
  guaranteeEnabled: b.guarantee_enabled,
  adminWindowMinutes: b.admin_window_minutes,
  guaranteeReferralsRequired: b.guarantee_referrals_required,
});

async function getSettings(req, res) {
  try {
    const current = await settings.getCitySettings(cityOf(req), { fresh: true });
    return res.json({ success: true, data: toApi(current) });
  } catch (e) {
    return fail(res, e, "getSettings");
  }
}

async function saveSettings(req, res) {
  try {
    const saved = await settings.saveCitySettings({ cityId: cityOf(req), input: fromBody(req.body), adminId: req.user?.id });
    return res.json({ success: true, message: "Order search settings saved", data: toApi(saved) });
  } catch (e) {
    return fail(res, e, "saveSettings");
  }
}

module.exports = { getSettings, saveSettings };
