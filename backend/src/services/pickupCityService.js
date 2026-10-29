const prisma = require("../config/db");
const { isInsideZone } = require("./geofenceService");
const serviceAreaSettings = require("./serviceAreaSettings");

// Pickup -> city resolution shared by the vehicle list (orderAvailabilityController.availableVehicles)
// and order creation, so both decide System 1 / System 2 from the SAME city (the pickup's), not the
// customer's registered city.
//
// Matches the first active `service_zone` containing the pickup. When no zone matches, falls back to
// the first active city (the long-standing availableVehicles behaviour). `serviceable` is false only
// when there is neither a zone match nor any active city.
/**
 * The zones the city lookup walks. Coverage zones (a city's pickup service area, spec 2026-10-29) take part only once the
 * service-area check is on, and then come first (they name the pickup's city). With it off the lookup is exactly the
 * original one over the Daily Driver duty zones, so drawing coverage areas ahead of time changes nothing.
 */
async function lookupZones() {
  const zones = await prisma.service_zone.findMany({ where: { status: 1 } });
  const duty = zones.filter((zone) => zone.zone_kind !== "coverage");
  if (!(await serviceAreaSettings.isEnforced())) return duty;
  return [...zones.filter((zone) => zone.zone_kind === "coverage"), ...duty];
}

async function resolvePickupArea(lat, lng) {
  let cityId = 0;
  let cityName = "";
  let zoneId = 0;
  let zoneName = "";
  let serviceable = false;

  const zones = await lookupZones();
  for (const zone of zones) {
    if (isInsideZone(lat, lng, zone)) {
      serviceable = true;
      zoneId = zone.id;
      zoneName = zone.name;
      cityId = zone.city_id || 0;
      break;
    }
  }
  if (cityId) {
    const city = await prisma.tbl_city.findUnique({ where: { id: cityId } });
    cityName = city?.title || "";
  }
  if (!serviceable) {
    const firstCity = await prisma.tbl_city.findFirst({ where: { status: 1 }, orderBy: { id: "asc" } });
    if (firstCity) {
      serviceable = true;
      cityId = firstCity.id;
      cityName = firstCity.title;
      zoneId = 1;
      zoneName = `${firstCity.title} Main Zone`;
    }
  }

  return { serviceable, cityId, cityName, zoneId, zoneName };
}

/** The pickup's city id (integer) or null when it cannot be resolved. Does not look up the city name. */
async function resolvePickupCityId(lat, lng) {
  const pickupLat = Number(lat);
  const pickupLng = Number(lng);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return null;

  const zones = await lookupZones();
  for (const zone of zones) {
    if (isInsideZone(pickupLat, pickupLng, zone)) {
      const id = Number(zone.city_id);
      return Number.isInteger(id) && id > 0 ? id : null;
    }
  }
  const firstCity = await prisma.tbl_city.findFirst({ where: { status: 1 }, orderBy: { id: "asc" } });
  const id = Number(firstCity?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { resolvePickupArea, resolvePickupCityId };
