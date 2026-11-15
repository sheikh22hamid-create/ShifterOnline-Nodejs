const prisma = require("../config/db");
const rules = require("./globalIndiaRules");
const settings = require("./globalIndiaSettings");

// Global India fallback (spec 2026-11-15): decides, for one pickup, which city serves it. Read from the database on every
// call (zones and cities are small tables), so a geofence that was just edited, added, deleted or deactivated is used by
// the very next pickup lookup - no stale area assignment, no stored "Global India polygon".
//
// Every geofence zone of an active city counts (the Daily Driver duty zones and the city pickup-coverage zones alike:
// both are the city's drawn service area). The Global India city never needs a zone of its own.

/**
 * null when the fallback is OFF (callers then keep their original resolution), else
 * { kind: 'city'|'global'|'no_global'|'outside_india', cityId, cityName, zoneId, zoneName, globalCity }.
 */
async function resolve(lat, lng, { ignoreSwitch = false } = {}) {
  const config = await settings.getConfig({ assumeEnabled: ignoreSwitch });
  if (!ignoreSwitch && !config.enabled) return null;

  const [zoneRows, cityRows] = await Promise.all([
    prisma.service_zone.findMany({ where: { status: 1 } }),
    prisma.tbl_city.findMany({ where: { status: 1 } }),
  ]);
  // Filtered again here so an inactive city or zone can never serve a pickup, whatever the query returned.
  const zones = zoneRows.filter((zone) => Number(zone.status) === 1);
  const cities = cityRows.filter((city) => Number(city.status) === 1);
  const decision = rules.decide({
    lat, lng, zones,
    activeCityIds: cities.map((c) => c.id),
    globalCityId: config.globalCity?.id ?? null,
  });
  const cityById = new Map(cities.map((c) => [Number(c.id), c]));
  const cityId = decision.cityId ?? 0;
  return {
    kind: decision.kind,
    cityId,
    cityName: cityById.get(Number(cityId))?.title || "",
    zoneId: decision.zoneId ?? 0,
    zoneName: decision.kind === "global" ? "Global India" : decision.zoneName || "",
    globalCity: config.globalCity,
  };
}

module.exports = { resolve };
