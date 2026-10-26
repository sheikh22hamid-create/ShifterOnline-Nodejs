const prisma = require("../config/db");
const logger = require("../utils/logger");
const { haversineKm } = require("../utils/geoDistance");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");

// Driver-to-pickup distance for the Trial Driver offered to an executive (spec 2026-10-26). The distance is always
// measured to the order's REAL pickup (never the generated search pickup the partner was queried with).
// Location sources, best first: the driver's own Shifter app (fresh rlats/rlongs) > the partner's reported location.
// Nothing is guessed: no usable location means no distance row, and the UI shows "unavailable".
// Reads are defensive: until the migration is applied the table is missing and the distance is just hidden.

const model = () => prisma.guarantee_candidate_distance;
const isCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** "350 m" below 1 km, otherwise "1.2 km". */
function formatDistance(meters) {
  const m = Math.max(0, Math.round(Number(meters) || 0));
  return m < 1000 ? { value: m, unit: "m", text: `${m} m` } : { value: Math.round(m / 100) / 10, unit: "km", text: `${(Math.round(m / 100) / 10).toFixed(1)} km` };
}

/** Drive distance in metres via the Google Routes API, or null when unavailable (the caller then keeps the straight line). */
async function roadDistanceM(from, to, fetchImpl = fetch) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.distanceMeters" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const m = (await resp.json())?.routes?.[0]?.distanceMeters;
    return typeof m === "number" && m >= 0 ? Math.round(m) : null;
  } catch (err) {
    logger.warn(`guaranteeCandidateDistance: route lookup failed: ${err.message}`);
    return null;
  }
}

/**
 * Distance between a driver location and the order pickup: { distance_m, kind: "road"|"straight" }.
 * Road distance when Google answers, otherwise the straight line (clearly labelled as such).
 */
async function measure(driver, pickup, deps = {}) {
  const road = await (deps.roadFn || roadDistanceM)(driver, pickup, deps.fetchImpl);
  if (road !== null) return { distance_m: road, kind: "road" };
  return { distance_m: Math.round(haversineKm(driver.lat, driver.lng, pickup.lat, pickup.lng) * 1000), kind: "straight" };
}

/** The driver's best current location: their Shifter app when fresh, else the partner-reported one, else null. */
async function pickLocation(candidate, reported, now = new Date()) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: candidate.rider_id }, select: { rlats: true, rlongs: true, rloc_updated_at: true, a_status: true, status: true } });
  if (rider && rider.a_status === 1 && rider.status === 1 && rider.rloc_updated_at && now - new Date(rider.rloc_updated_at) <= RIDER_LOCATION_FRESHNESS_MS) {
    const lat = Number(rider.rlats);
    const lng = Number(rider.rlongs);
    if (isCoord(lat, lng)) return { lat, lng, source: "shifter_app", at: rider.rloc_updated_at, approx: false };
  }
  if (reported && isCoord(Number(reported.lat), Number(reported.lng))) {
    return { lat: Number(reported.lat), lng: Number(reported.lng), source: reported.source || "partner", at: reported.at ? new Date(reported.at) : null, approx: Boolean(reported.approx) };
  }
  return null;
}

/**
 * Compute and store the distance for a candidate. `reported` is the partner's location ({ lat, lng, approx?, at? }),
 * used only when the driver's own app has no fresh location. Resolves the stored row, or null when unavailable.
 */
async function computeAndStore({ candidate, orderPickup, reported, deps = {}, now = new Date() }) {
  const pickup = { lat: Number(orderPickup?.lat), lng: Number(orderPickup?.lng) };
  if (!isCoord(pickup.lat, pickup.lng)) return null;
  const loc = await pickLocation(candidate, reported, now);
  if (!loc) return null;
  const { distance_m, kind } = await measure(loc, pickup, deps);
  const data = {
    case_id: candidate.case_id, order_id: candidate.order_id, rider_id: candidate.rider_id,
    driver_lat: loc.lat, driver_lng: loc.lng, location_source: loc.source, location_at: loc.at || null, location_approx: loc.approx,
    distance_m, distance_unit: formatDistance(distance_m).unit, distance_kind: kind, computed_at: now,
  };
  return model().upsert({ where: { candidate_id: candidate.id }, create: { candidate_id: candidate.id, ...data }, update: data });
}

/** Best-effort wrapper for the search flow: a distance problem must never block offering the driver. */
async function computeSafely(args) {
  try { return await computeAndStore(args); } catch (err) {
    logger.error(`guaranteeCandidateDistance: could not compute for candidate ${args?.candidate?.id}:`, err);
    return null;
  }
}

/** API shape for one stored row (null stays null: "unavailable"). */
function present(row) {
  if (!row) return null;
  const f = formatDistance(row.distance_m);
  return {
    text: f.text, value: f.value, unit: f.unit, meters: row.distance_m,
    kind: row.distance_kind, // "road" = driving distance, "straight" = straight line
    approximate: Boolean(row.location_approx),
    source: row.location_source, // "shifter_app" (driver's own app) or "partner"
    location_at: row.location_at, computed_at: row.computed_at,
  };
}

/** Stored rows for several candidates, as a Map candidate_id -> row. Empty map when the table is not there yet. */
async function loadMany(candidateIds) {
  if (!candidateIds.length) return new Map();
  try {
    const rows = await model().findMany({ where: { candidate_id: { in: candidateIds } } });
    return new Map(rows.map((r) => [r.candidate_id, r]));
  } catch (err) {
    logger.warn(`guaranteeCandidateDistance: read failed (migration not applied?): ${err.message}`);
    return new Map();
  }
}

module.exports = { formatDistance, roadDistanceM, measure, computeAndStore, computeSafely, present, loadMany, isCoord };
