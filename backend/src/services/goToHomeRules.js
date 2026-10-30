const { validPoint, project } = require("./favoriteRouteGeometry");

// Go to Home (spec 2026-10-30). Pure rules, no I/O.
const CORRIDOR_KM = 5;                      // each side of the route, measured to the DROP only
const REFRESH_MS = 2 * 60 * 60 * 1000;      // next refresh after a successful route
const RETRY_MS = 10 * 60 * 1000;            // retry after a failed refresh (no hammering of the routes API)
const STALE_GRACE_MS = 15 * 60 * 1000;      // a route older than refresh + grace gets NO priority
const STANDARD_TIER_PACKAGE_ID = 6;         // Model One; same as constants.MODEL_1_PACKAGE_ID

const toPoint = (lat, lng) => ({ lat: Number(lat), lng: Number(lng) });
const validHome = (lat, lng) => validPoint(toPoint(lat, lng)) && !(Number(lat) === 0 && Number(lng) === 0);

/** The stored route can still be trusted: computed, geometry present, and not older than refresh + grace. */
function isRouteValid(row, now = new Date()) {
  if (!row || !row.route_computed_at || !Array.isArray(row.route_geometry) || row.route_geometry.length < 2) return false;
  return now - new Date(row.route_computed_at) <= REFRESH_MS + STALE_GRACE_MS;
}

/**
 * Does this driver's Go to Home route cover the order? Every drop (stops + final drop) must lie within the corridor;
 * pickup is deliberately ignored. Returns { matched, reason, distance_km }.
 */
function evaluate(row, drops, now = new Date(), corridorKm = CORRIDOR_KM) {
  if (!row || !row.active) return { matched: false, reason: "inactive" };
  if (!validHome(row.home_lat, row.home_lng)) return { matched: false, reason: "no_home" };
  if (!isRouteValid(row, now)) return { matched: false, reason: "route_stale" };
  if (!Array.isArray(drops) || !drops.length) return { matched: false, reason: "invalid_drop" };
  const projections = drops.map((d) => project(d, row.route_geometry));
  if (projections.some((p) => !p)) return { matched: false, reason: "invalid_drop" };
  const distance_km = Math.max(...projections.map((p) => p.distanceKm));
  if (distance_km > corridorKm) return { matched: false, reason: "drop_outside_corridor", distance_km };
  return { matched: true, reason: "route_match", distance_km };
}

/** Stable: matched drivers first, everyone else keeps the order dispatch already chose. Never removes anyone. */
function prioritize(rows, matchByRider) {
  const hit = [];
  const rest = [];
  for (const r of rows) (matchByRider.get(Number(r.rider_id))?.matched ? hit : rest).push(r);
  return [...hit, ...rest];
}

/** At most `max` points for the map, always keeping both ends. */
function thin(geometry, max = 400) {
  if (!Array.isArray(geometry) || geometry.length <= max) return geometry || [];
  const step = (geometry.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(geometry[Math.round(i * step)]);
  return out;
}

module.exports = { CORRIDOR_KM, REFRESH_MS, RETRY_MS, STALE_GRACE_MS, STANDARD_TIER_PACKAGE_ID, validHome, isRouteValid, evaluate, prioritize, thin };
