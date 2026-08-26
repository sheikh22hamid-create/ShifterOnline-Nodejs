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

async function getRoadDistanceKm(lat1, lon1, lat2, lon2) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return haversineFallback(lat1, lon1, lat2, lon2);
  }

  try {
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${lat1},${lon1}&destinations=${lat2},${lon2}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Distance Matrix API HTTP ${response.status}`);
    }
    const data = await response.json();
    const element = data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      throw new Error(`Distance Matrix API element status: ${element?.status}`);
    }
    return {
      distanceKm: element.distance.value / 1000,
      durationMin: Math.round(element.duration.value / 60),
      source: "google",
    };
  } catch (err) {
    logger.warn("getRoadDistanceKm: falling back to haversine —", err.message);
    return haversineFallback(lat1, lon1, lat2, lon2);
  }
}

module.exports = { haversineKm, getRoadDistanceKm };
