const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./orderSearchRules");

const TTL_MS = 5000;
const cache = new Map(); // cityId -> { at, value }

const COLUMN = {
  searchSystem: "search_system",
  searchRadiusKm: "search_radius_km",
  driverSearchSeconds: "driver_search_seconds",
  guaranteeEnabled: "guarantee_enabled",
  adminWindowMinutes: "admin_window_minutes",
  guaranteeReferralsRequired: "guarantee_referrals_required",
};

/**
 * The city's order-search settings. Fail closed: a missing city, a missing row or any read error gives
 * System 1 with the guarantee off, so a settings outage can never change how orders are searched or paid.
 */
async function getCitySettings(cityId, { fresh = false } = {}) {
  const id = Number(cityId);
  if (!Number.isInteger(id) || id <= 0) return rules.defaultSettings();
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const row = await prisma.city_order_settings.findUnique({ where: { city_id: id } });
    const value = rules.normalizeRow(row);
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.error(`orderSearchSettings.getCitySettings: city ${id} unreadable, using System 1 / guarantee off:`, err);
    return rules.defaultSettings();
  }
}

async function saveCitySettings({ cityId, input, adminId }) {
  const id = Number(cityId);
  const clean = rules.validateSettingsInput(input);
  const city = Number.isInteger(id) && id > 0 ? await prisma.tbl_city.findUnique({ where: { id } }) : null;
  if (!city) throw Object.assign(new Error("Unknown city"), { statusCode: 400 });

  const data = {};
  for (const [key, value] of Object.entries(clean)) data[COLUMN[key]] = value;
  data.updated_by = adminId ?? null;
  await prisma.city_order_settings.upsert({
    where: { city_id: id },
    update: data,
    create: { city_id: id, ...data },
  });
  cache.delete(id);
  logger.info(`order-search settings city=${id} admin=${adminId ?? "-"} ${JSON.stringify(clean)}`);
  return getCitySettings(id, { fresh: true });
}

/** The `search` block of the customer order-details response. Never throws. */
async function getSearchView(order) {
  const system2 = rules.isSystem2Order(order);
  const view = {
    system: system2 ? 2 : 1,
    deadline_at: system2 && order.search_deadline_at ? new Date(order.search_deadline_at).toISOString() : null,
    guarantee: "off",
  };
  if (!system2) return view;
  try {
    const city = await getCitySettings(order.city_id);
    if (!city.guaranteeEnabled) return view;
    view.guarantee = "on";
    const user = await prisma.tbl_user.findUnique({ where: { id: Number(order.uid) }, select: { guarantee_locked: true } });
    if (user?.guarantee_locked) view.guarantee = "locked";
  } catch (err) {
    logger.warn(`orderSearchSettings.getSearchView failed for order ${order?.id}: ${err.message}`);
  }
  return view;
}

function _resetCache() {
  cache.clear();
}

module.exports = { getCitySettings, saveCitySettings, getSearchView, _resetCache };
