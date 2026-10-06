const logger = require("../utils/logger");
const { haversineKm } = require("../utils/geoDistance");
const { fetchGoogleDrive, estimateDrive } = require("./pickupEtaService");

const ETA_FRESH_MS = 60 * 1000;
const ETA_MAX_REUSE_MS = 2 * 60 * 1000;
const ETA_MOVE_M = 150;
const ROUTE_TTL_MS = 30 * 60 * 1000;
const ROUTE_FALLBACK_TTL_MS = 2 * 60 * 1000;
const MAX_ROUTE_POINTS = 150;
const GOOGLE_TIMEOUT_MS = 4000;

const etaCache = new Map(); // orderId -> { from, at, value }
const etaInflight = new Map();
const routeCache = new Map(); // orderId -> { at, ttl, points }
const routeInflight = new Map();

function _reset() {
  etaCache.clear(); etaInflight.clear(); routeCache.clear(); routeInflight.clear();
}
function clearOrder(orderId) {
  etaCache.delete(orderId); routeCache.delete(orderId);
}

const toEta = (drive, now) => ({
  minutes: Math.max(1, Math.ceil(drive.seconds / 60)),
  distance_km: Math.round(drive.meters / 100) / 10,
  updated_at: new Date(now).toISOString(),
});

// Driver -> drop ETA. Cached per order so a busy page never turns into one Google call per poll.
async function getEta(orderId, from, to, { now = Date.now(), fetchImpl } = {}) {
  const hit = etaCache.get(orderId);
  if (hit) {
    const age = now - hit.at;
    const movedM = haversineKm(hit.from.lat, hit.from.lng, from.lat, from.lng) * 1000;
    if (age < ETA_FRESH_MS || (age < ETA_MAX_REUSE_MS && movedM < ETA_MOVE_M)) return hit.value;
  }
  if (etaInflight.has(orderId)) return etaInflight.get(orderId);
  const pending = (async () => {
    const drive = (await fetchGoogleDrive(from, to, { fetchImpl })) || estimateDrive(from, to);
    const value = toEta(drive, now);
    etaCache.set(orderId, { from, at: now, value });
    return value;
  })().finally(() => etaInflight.delete(orderId));
  etaInflight.set(orderId, pending);
  return pending;
}

function simplify(points, max = MAX_ROUTE_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

async function fetchGoogleRoute(origin, destination, { fetchImpl = fetch, apiKey = process.env.GOOGLE_MAPS_API_KEY } = {}) {
  if (!apiKey) return null;
  try {
    const response = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.polyline.geoJsonLinestring" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineEncoding: "GEO_JSON_LINESTRING",
        polylineQuality: "OVERVIEW",
      }),
    });
    if (!response.ok) {
      logger.warn(`trackEtaService: Google Routes responded ${response.status}`);
      return null;
    }
    const data = await response.json();
    const coords = data?.routes?.[0]?.polyline?.geoJsonLinestring?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const points = coords.map((c) => [Number(c[1]), Number(c[0])]).filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
    return points.length >= 2 ? points : null;
  } catch (err) {
    logger.warn(`trackEtaService: Google Routes call failed (${err.message})`);
    return null;
  }
}

// Pickup -> drop line for the map; the same for the whole trip, so it is cached per order.
async function getRoute(orderId, from, to, { now = Date.now(), fetchImpl } = {}) {
  const hit = routeCache.get(orderId);
  if (hit && now - hit.at < hit.ttl) return hit.points;
  if (routeInflight.has(orderId)) return routeInflight.get(orderId);
  const pending = (async () => {
    const google = await fetchGoogleRoute(from, to, fetchImpl ? { fetchImpl } : {});
    const points = google ? simplify(google) : [[from.lat, from.lng], [to.lat, to.lng]];
    routeCache.set(orderId, { at: now, ttl: google ? ROUTE_TTL_MS : ROUTE_FALLBACK_TTL_MS, points });
    return points;
  })().finally(() => routeInflight.delete(orderId));
  routeInflight.set(orderId, pending);
  return pending;
}

module.exports = { getEta, getRoute, clearOrder, simplify, _reset };
