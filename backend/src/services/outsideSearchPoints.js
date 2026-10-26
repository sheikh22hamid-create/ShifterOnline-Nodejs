const logger = require("../utils/logger");
const { haversineKm } = require("../utils/geoDistance");

// Pickup/drop the outside-driver search sends to the partner (Porter). They are generated per search and are NOT the
// customer's order locations: the search pickup is 500 m - 1 km from the order's pickup and the search drop is about
// 2 km from the search pickup. Each point is snapped to a drivable road with the Google Routes API, so it is a real,
// reachable place. The order itself is never read-for-write here.
const PICKUP_RANGE_M = [500, 1000];
const DROP_RANGE_M = [1800, 2200];
const MAX_TRIES = 6;
const SNAP_TOLERANCE_M = 150; // the road point must be this close to the point we asked for
const MAX_ROAD_TO_STRAIGHT = 2.5; // a route much longer than the straight line means a detour (river, rail, one-way maze)
const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** The point `meters` away from (lat, lng) along `bearingRad` (great-circle, fine for a few km). */
function offsetPoint(lat, lng, meters, bearingRad) {
  const d = meters / EARTH_RADIUS_M;
  const la1 = toRad(lat);
  const lo1 = toRad(lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(bearingRad));
  const lo2 = lo1 + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lng: toDeg(lo2) };
}

const metersBetween = (a, b) => haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;

/** Drive route from -> to. Resolves { distanceM, end } where `end` is the road point Google snapped `to` onto, or null. */
async function driveRoute(from, to, fetchImpl) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.distanceMeters,routes.legs.endLocation" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const route = (await resp.json())?.routes?.[0];
    const end = route?.legs?.[route.legs.length - 1]?.endLocation?.latLng;
    if (!route || typeof route.distanceMeters !== "number" || !end || !Number.isFinite(end.latitude) || !Number.isFinite(end.longitude)) return null;
    return { distanceM: route.distanceMeters, end: { lat: end.latitude, lng: end.longitude } };
  } catch (err) {
    logger.warn(`outsideSearchPoints: route lookup failed: ${err.message}`);
    return null;
  }
}

/** One valid point `rangeM` away from `from`, or null after MAX_TRIES. */
async function pickPoint(from, [minM, maxM], deps) {
  for (let i = 0; i < MAX_TRIES; i += 1) {
    const meters = minM + deps.random() * (maxM - minM);
    const wanted = offsetPoint(from.lat, from.lng, meters, deps.random() * 2 * Math.PI);
    const route = await driveRoute(from, wanted, deps.fetchImpl);
    if (!route) continue;
    const straight = metersBetween(from, route.end);
    const ok = metersBetween(wanted, route.end) <= SNAP_TOLERANCE_M
      && straight >= minM * 0.9 && straight <= maxM * 1.1
      && route.distanceM <= straight * MAX_ROAD_TO_STRAIGHT;
    if (ok) return route.end;
  }
  return null;
}

/** The nearest named place (Places API New; the Geocoding API is not enabled on this project's key), or null. */
async function nearbyPlace(point, fetchImpl) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetchImpl("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.displayName,places.formattedAddress" },
      body: JSON.stringify({ maxResultCount: 1, locationRestriction: { circle: { center: { latitude: point.lat, longitude: point.lng }, radius: 150 } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const place = (await resp.json())?.places?.[0];
    const title = String(place?.displayName?.text || "").trim();
    if (!title) return null;
    return { title, subtitle: String(place.formattedAddress || "").trim() };
  } catch (err) {
    logger.warn(`outsideSearchPoints: place lookup failed: ${err.message}`);
    return null;
  }
}

/** Address fields for the partner; a generic title when no place is found (the point itself is already verified). */
async function describe(point, fallbackTitle, placeFn) {
  return (await placeFn(point)) || { title: fallbackTitle, subtitle: "" };
}

/**
 * Search pickup and drop for an order whose real pickup is `origin` ({ lat, lng }).
 * Resolves { pickup, drop } ({ title, subtitle, lat, lng } each) or null when no suitable points were found.
 * `deps` ({ fetchImpl, random, placeFn }) exist for tests.
 */
async function generate(origin, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const d = { fetchImpl, random: deps.random || Math.random, placeFn: deps.placeFn || ((point) => nearbyPlace(point, fetchImpl)) };
  const pickupAt = await pickPoint(origin, PICKUP_RANGE_M, d);
  if (!pickupAt) return null;
  const dropAt = await pickPoint(pickupAt, DROP_RANGE_M, d);
  if (!dropAt) return null;
  const [pickupName, dropName] = await Promise.all([describe(pickupAt, "Pickup Location", d.placeFn), describe(dropAt, "Drop Location", d.placeFn)]);
  return { pickup: { ...pickupName, ...pickupAt }, drop: { ...dropName, ...dropAt } };
}

module.exports = { generate, offsetPoint, PICKUP_RANGE_M, DROP_RANGE_M, MAX_TRIES };
