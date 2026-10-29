const { isPointInPolygon, calculateDistanceKm } = require("./geofenceService");

// Pure rules for city-wise pickup coverage and vehicle No Entry Zones (spec 2026-10-29). No I/O.
// A zone is either a polygon (polygon_geojson, [[lat, lng], ...] as the admin map saves it) or a circle
// (center_lat / center_lng / radius_km). When a polygon is present it wins, like geofenceService.isInsideZone.
// A point exactly on a polygon edge or corner counts as inside; a circle includes its radius.
const EDGE_EPSILON = 1e-9;

const MESSAGES = {
  pickup: {
    NO_SERVICE_ZONE: "No service zone available for this pickup location.",
    NO_ENTRY: "Pickup is not allowed in this area for the selected vehicle type.",
  },
  drop: {
    NO_SERVICE_ZONE: "No service zone available for this drop location.",
    NO_ENTRY: "Drop location is a no-entry zone for the selected vehicle type. Please choose another location.",
  },
};

const messageFor = (kind, code) => MESSAGES[kind === "drop" ? "drop" : "pickup"][code];

/** The polygon points as [[lat, lng], ...] when the zone holds a valid one (3+ finite points), else null. */
function parsePolygon(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }
  const coords = Array.isArray(parsed) ? parsed : parsed?.coordinates?.[0] || parsed?.coordinates;
  if (!Array.isArray(coords) || coords.length < 3) return null;
  const points = coords.map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null));
  if (points.some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  return points;
}

function onSegment(lat, lng, [aLat, aLng], [bLat, bLng]) {
  const cross = (lat - aLat) * (bLng - aLng) - (lng - aLng) * (bLat - aLat);
  if (Math.abs(cross) > EDGE_EPSILON) return false;
  return (
    lat >= Math.min(aLat, bLat) - EDGE_EPSILON && lat <= Math.max(aLat, bLat) + EDGE_EPSILON &&
    lng >= Math.min(aLng, bLng) - EDGE_EPSILON && lng <= Math.max(aLng, bLng) + EDGE_EPSILON
  );
}

function containsPoint(zone, lat, lng) {
  const pLat = Number(lat);
  const pLng = Number(lng);
  if (!zone || lat === null || lat === undefined || lng === null || lng === undefined || !Number.isFinite(pLat) || !Number.isFinite(pLng)) return false;

  const polygon = parsePolygon(zone.polygon_geojson);
  if (polygon) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (onSegment(pLat, pLng, polygon[j], polygon[i])) return true;
    }
    return isPointInPolygon(pLat, pLng, polygon);
  }

  const cLat = Number(zone.center_lat);
  const cLng = Number(zone.center_lng);
  const radius = Number(zone.radius_km);
  if (Number.isFinite(cLat) && Number.isFinite(cLng) && Number.isFinite(radius) && radius > 0 && zone.center_lat !== null && zone.center_lng !== null) {
    return calculateDistanceKm(pLat, pLng, cLat, cLng) <= radius;
  }
  return false;
}

/** Validates an admin-submitted zone: a name, and a usable polygon or a centre with a positive radius. */
function validZonePayload({ name, polygon_geojson, center_lat, center_lng, radius_km }) {
  if (!String(name || "").trim()) return { ok: false, error: "Zone name is required" };
  const hasPolygonText = polygon_geojson !== null && polygon_geojson !== undefined && String(polygon_geojson).trim() !== "";
  if (hasPolygonText) {
    return parsePolygon(polygon_geojson) ? { ok: true } : { ok: false, error: "Draw a valid area with at least 3 points" };
  }
  const cLat = Number(center_lat);
  const cLng = Number(center_lng);
  const radius = Number(radius_km);
  if (center_lat !== undefined && center_lat !== null && center_lng !== undefined && center_lng !== null &&
      Number.isFinite(cLat) && Number.isFinite(cLng) && Number.isFinite(radius) && radius > 0) {
    return { ok: true };
  }
  return { ok: false, error: "Draw an area on the map first" };
}

/** The points that stand for a zone's shape: every polygon vertex, else the circle centre. Used for overlap checks. */
function shapePoints(zone) {
  const polygon = parsePolygon(zone?.polygon_geojson);
  if (polygon) return polygon;
  const lat = Number(zone?.center_lat);
  const lng = Number(zone?.center_lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng]] : [];
}

module.exports = { containsPoint, parsePolygon, shapePoints, messageFor, validZonePayload, MESSAGES };
