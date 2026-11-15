const fs = require("fs");
const path = require("path");
const { containsPoint, parsePolygon } = require("./serviceAreaRules");
const { isPointInPolygon } = require("./geofenceService");

// Pure rules for the Global India fallback (spec 2026-11-15). No database access.
//
// Every pickup is decided from the CURRENT geofences each time it is asked:
//   1. inside an active city's geofence -> that city (the most specific zone wins when geofences overlap);
//   2. else inside India -> the Global India city (it needs no geofence of its own: its area is simply "India minus
//      every active city geofence", which is never stored, so it changes the moment a geofence does);
//   3. else (outside India) -> not serviceable, the existing "service is not available here" handling.

let indiaRings = null;

/** The India boundary: outer rings as [[lng, lat], ...] (Natural Earth 1:50m, data/india_boundary.json). */
function loadIndiaRings() {
  if (indiaRings) return indiaRings;
  const file = path.join(__dirname, "..", "..", "data", "india_boundary.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  indiaRings = (parsed.rings || []).filter((ring) => Array.isArray(ring) && ring.length >= 4);
  return indiaRings;
}

/** True when the point lies inside India (mainland or an island polygon). A bad coordinate is never inside. */
function isInsideIndia(lat, lng, rings = loadIndiaRings()) {
  const pLat = Number(lat);
  const pLng = Number(lng);
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || Math.abs(pLat) > 90 || Math.abs(pLng) > 180) return false;
  // isPointInPolygon takes [lat, lng] pairs; the boundary file is GeoJSON [lng, lat], so swap per ring.
  return rings.some((ring) => isPointInPolygon(pLat, pLng, ring.map(([x, y]) => [y, x])));
}

const KM_PER_DEG = 111.32;

/** Approximate area in km2: a polygon (shoelace, longitude scaled by cos(latitude)) or a circle. Infinity when unusable. */
function zoneAreaKm2(zone) {
  const polygon = parsePolygon(zone?.polygon_geojson);
  if (polygon) {
    const meanLat = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
    const kx = KM_PER_DEG * Math.cos((meanLat * Math.PI) / 180);
    let twice = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      twice += (polygon[j][1] * kx) * (polygon[i][0] * KM_PER_DEG) - (polygon[i][1] * kx) * (polygon[j][0] * KM_PER_DEG);
    }
    return Math.abs(twice) / 2;
  }
  const radius = Number(zone?.radius_km);
  return Number.isFinite(radius) && radius > 0 ? Math.PI * radius * radius : Infinity;
}

/**
 * Overlap rule (deterministic): among the zones that contain the point, the SMALLEST area wins (the most specific
 * geofence, e.g. a suburb city inside a big one); equal areas go to the lowest zone id.
 */
function pickZone(zones, lat, lng) {
  const containing = (zones || []).filter((zone) => containsPoint(zone, lat, lng));
  if (containing.length === 0) return null;
  return containing
    .map((zone) => ({ zone, area: zoneAreaKm2(zone) }))
    .sort((a, b) => a.area - b.area || Number(a.zone.id) - Number(b.zone.id))[0].zone;
}

/**
 * Who serves this pickup. `zones` are the geofence zones (any kind) with a city; `activeCityIds` the ids of the active
 * cities; `globalCityId` the Global India city (null when none is configured). Zones of an inactive city, of no city,
 * or of the Global India city itself never count as a city geofence.
 *
 * Returns { kind: 'city', cityId, zoneId } | { kind: 'global', cityId } | { kind: 'no_global' } (inside India but no
 * Global India city is set up) | { kind: 'outside_india' }.
 */
function decide({ lat, lng, zones, activeCityIds, globalCityId, rings }) {
  const active = new Set((activeCityIds || []).map(Number));
  const usable = (zones || []).filter((zone) => {
    const cityId = Number(zone.city_id);
    return Number.isInteger(cityId) && cityId > 0 && active.has(cityId) && cityId !== Number(globalCityId);
  });
  const zone = pickZone(usable, lat, lng);
  if (zone) return { kind: "city", cityId: Number(zone.city_id), zoneId: zone.id, zoneName: zone.name };
  if (!isInsideIndia(lat, lng, rings)) return { kind: "outside_india" };
  const global = Number(globalCityId);
  return Number.isInteger(global) && global > 0 ? { kind: "global", cityId: global } : { kind: "no_global" };
}

/** A package's city_id is free text (comma-separated ids in some rows); empty or 0 means "all cities". */
function packageServesCity(pkgCityId, cityId) {
  const raw = String(pkgCityId ?? "").trim();
  if (!raw || raw === "0") return true;
  return raw.split(",").map((part) => part.trim()).includes(String(cityId));
}

module.exports = { packageServesCity, loadIndiaRings, isInsideIndia, zoneAreaKm2, pickZone, decide };
