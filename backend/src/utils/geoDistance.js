const logger = require("./logger");
const {
  ROAD_DISTANCE_FUDGE_FACTOR,
  ASSUMED_URBAN_SPEED_KMH,
} = require("../config/constants");

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function haversineFallback(lat1, lon1, lat2, lon2) {
  const straightKm = haversineKm(lat1, lon1, lat2, lon2);
  const distanceKm = straightKm * ROAD_DISTANCE_FUDGE_FACTOR;
  const durationMin = Math.round((distanceKm / ASSUMED_URBAN_SPEED_KMH) * 60);
  return { distanceKm, durationMin, source: "haversine" };
}

// Routes API v2, not the legacy Distance Matrix API — the legacy endpoint
// returns REQUEST_DENIED ("You're calling a legacy API, which is not
// enabled for your project") on this project's key, confirmed live
// (2026-09-02). Routes API is also Google's current recommended replacement.
async function getRoadDistanceKm(lat1, lon1, lat2, lon2) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return haversineFallback(lat1, lon1, lat2, lon2);
  }

  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat1, longitude: lon1 } } },
        destination: { location: { latLng: { latitude: lat2, longitude: lon2 } } },
        travelMode: "DRIVE",
        // Matches the live PHP backend's get_distance.php exactly — without
        // this, Google can pick a different route (and a meaningfully
        // different distanceMeters) for the identical coordinates than PHP
        // gets, since the default routing preference isn't traffic-aware.
        // Confirmed live on order #1670: PHP's customer-facing estimate
        // implied ~225.75km for this route while Node's own call (real
        // Google data, not the haversine fallback) came back with 251.249km
        // for the same pickup/drop — an ~11% fare gap across every model,
        // consistent with two different real routes rather than a formula
        // bug (the fare formula matched exactly on both sides once each
        // side's own distance was plugged in).
        routingPreference: "TRAFFIC_AWARE",
      }),
    });
    if (!response.ok) {
      throw new Error(`Routes API HTTP ${response.status}`);
    }
    const data = await response.json();
    const route = data?.routes?.[0];
    if (!route || typeof route.distanceMeters !== "number") {
      throw new Error("Routes API returned no usable route");
    }
    // duration comes back as a protobuf Duration string like "18880s" —
    // parseFloat stops at the trailing "s" and returns the numeric seconds.
    const durationSeconds = parseFloat(route.duration) || 0;
    return {
      distanceKm: route.distanceMeters / 1000,
      durationMin: Math.round(durationSeconds / 60),
      source: "google",
    };
  } catch (err) {
    logger.warn("getRoadDistanceKm: falling back to haversine —", err.message);
    return haversineFallback(lat1, lon1, lat2, lon2);
  }
}

/**
 * Greedy nearest-neighbor route for bundling several next-day orders onto
 * one driver: from the driver's current position, repeatedly pick whichever
 * remaining order's PICKUP is closest, then continue from THAT order's DROP
 * — never re-computes an optimal tour (n is small, e.g. a day's worth of
 * orders, and this is only a suggestion the admin can manually reorder).
 * Straight-line haversine only, not the Google Routes API — see
 * docs/superpowers/specs/2026-09-10-next-day-booking-design.md §7.2 for why.
 */
function buildNextDaySequence(driverLat, driverLng, orders) {
  const remaining = orders.map((o) => ({
    id: o.id,
    pickupLat: Number(o.plat),
    pickupLng: Number(o.plong),
    dropLat: Number(o.dlat),
    dropLng: Number(o.dlong),
  }));

  const sequence = [];
  let currentLat = driverLat;
  let currentLng = driverLng;

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistanceKm = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const distanceKm = haversineKm(currentLat, currentLng, remaining[i].pickupLat, remaining[i].pickupLng);
      if (distanceKm < nearestDistanceKm) {
        nearestDistanceKm = distanceKm;
        nearestIndex = i;
      }
    }
    const next = remaining[nearestIndex];
    sequence.push({ order_id: next.id, pickup_distance_km: Math.round(nearestDistanceKm * 100) / 100 });
    remaining.splice(nearestIndex, 1);
    currentLat = next.dropLat;
    currentLng = next.dropLng;
  }

  return sequence;
}

module.exports = { haversineKm, getRoadDistanceKm, buildNextDaySequence };
