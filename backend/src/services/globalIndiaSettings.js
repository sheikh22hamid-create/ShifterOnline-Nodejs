const prisma = require("../config/db");
const logger = require("../utils/logger");

// Settings for the Global India fallback (spec 2026-11-15), kept in app_settings like the other switches:
//   global_india_fallback_enabled  1/true/on/yes turns it ON. OFF (or unreadable) = pickups resolve exactly as before.
//   global_india_city_id           the tbl_city row that IS "Global India". When unset, an active city whose title contains
//                                  "global" is used (so a city simply named "Global India" works with no setup).
// A short cache keeps the pickup path cheap; saving a setting through the admin API clears it at once, and the TTL is
// short enough that a change made any other way is live within seconds. Nothing about areas is cached here.
const ENABLED_KEY = "global_india_fallback_enabled";
const CITY_KEY = "global_india_city_id";
const TTL_MS = 5000;

let cache = null;

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());

/** { enabled, globalCity: { id, title, source: 'setting' | 'title' } | null, configuredCityId } - never throws. */
async function getConfig({ fresh = false, assumeEnabled = false } = {}) {
  // assumeEnabled is the admin dry-run: report what the fallback WOULD do while the switch is still off (never cached).
  if (!fresh && !assumeEnabled && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = { enabled: false, globalCity: null, configuredCityId: null };
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: [ENABLED_KEY, CITY_KEY] } } });
    const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    const enabled = toBool(byKey.get(ENABLED_KEY));
    const configured = Number(byKey.get(CITY_KEY));
    const configuredCityId = Number.isInteger(configured) && configured > 0 ? configured : null;

    let globalCity = null;
    if (enabled || assumeEnabled) {
      if (configuredCityId) {
        const city = await prisma.tbl_city.findUnique({ where: { id: configuredCityId } });
        if (city && Number(city.status) === 1) globalCity = { id: city.id, title: city.title, source: "setting" };
      }
      if (!globalCity && !configuredCityId) {
        const cities = await prisma.tbl_city.findMany({ where: { status: 1 }, orderBy: { id: "asc" } });
        const byTitle = cities.find((c) => /global/i.test(String(c.title || "")));
        if (byTitle) globalCity = { id: byTitle.id, title: byTitle.title, source: "title" };
      }
    }
    value = { enabled, globalCity, configuredCityId };
  } catch (err) {
    // Fail closed: an unreadable switch means the old behaviour, never a guessed admin.
    logger.error("globalIndiaSettings.getConfig: treating the fallback as OFF:", err);
  }
  if (!assumeEnabled) cache = { at: Date.now(), value };
  return value;
}

function invalidate() {
  cache = null;
}

async function setValue(key, value) {
  const existing = await prisma.app_settings.findFirst({ where: { setting_key: key } });
  if (existing) await prisma.app_settings.update({ where: { id: existing.id }, data: { setting_value: String(value) } });
  else await prisma.app_settings.create({ data: { setting_key: key, setting_value: String(value) } });
  invalidate();
}

module.exports = { getConfig, invalidate, setValue, ENABLED_KEY, CITY_KEY };
