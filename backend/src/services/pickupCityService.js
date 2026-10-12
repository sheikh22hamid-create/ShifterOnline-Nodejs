const prisma = require("../config/db");
const { isInsideZone } = require("./geofenceService");

// Pickup -> city resolution shared by the vehicle list (orderAvailabilityController.availableVehicles)
// and order creation, so both decide System 1 / System 2 from the SAME city (the pickup's), not the
// customer's registered city.
//
// Matches the first active `service_zone` containing the pickup. When no zone matches, falls back to
// the first active city (the long-standing availableVehicles behaviour). `serviceable` is false only
// when there is neither a zone match nor any active city.
async function resolvePickupArea(lat, lng) {
  let cityId = 0;
  let cityName = "";
  let zoneId = 0;
  let zoneName = "";
  let serviceable = false;

  const zones = await prisma.service_zone.findMany({ where: { status: 1 } });
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

  const zones = await prisma.service_zone.findMany({ where: { status: 1 } });
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
