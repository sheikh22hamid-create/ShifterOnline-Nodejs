/**
 * Geofence service for Point-in-Polygon and distance-radius checks.
 */

/**
 * Checks if a point (lat, lng) is inside a polygon using the Ray Casting algorithm.
 * @param {number} lat 
 * @param {number} lng 
 * @param {Array<[number, number]>} polygon Array of [lat, lng] coordinates
 * @returns {boolean}
 */
function isPointInPolygon(lat, lng, polygon) {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i][0]);
    const yi = Number(polygon[i][1]);
    const xj = Number(polygon[j][0]);
    const yj = Number(polygon[j][1]);

    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Haversine formula to calculate distance in km between two lat/lng coordinates.
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks if a driver at (lat, lng) is inside a given ServiceZone.
 * Checks polygon_geojson if available, otherwise falls back to center_lat/lng and radius_km.
 * @param {number} lat 
 * @param {number} lng 
 * @param {object} zone service_zone DB record
 * @returns {boolean}
 */
function isInsideZone(lat, lng, zone) {
  if (!zone) return true; // If no zone assigned, consider inside
  lat = Number(lat);
  lng = Number(lng);
  if (!lat || !lng) return false;

  // 1. Check Polygon if present
  if (zone.polygon_geojson) {
    try {
      const parsed = typeof zone.polygon_geojson === "string"
        ? JSON.parse(zone.polygon_geojson)
        : zone.polygon_geojson;
      
      // Coordinates format: [[lat, lng], [lat, lng], ...]
      const coords = Array.isArray(parsed) ? parsed : parsed.coordinates?.[0] || parsed.coordinates;
      if (Array.isArray(coords) && coords.length >= 3) {
        return isPointInPolygon(lat, lng, coords);
      }
    } catch (e) {
      // fallback to circle radius
    }
  }

  // 2. Check Circle Radius
  if (zone.center_lat && zone.center_lng) {
    const dist = calculateDistanceKm(lat, lng, Number(zone.center_lat), Number(zone.center_lng));
    const radius = Number(zone.radius_km) || 5.0;
    return dist <= radius;
  }

  return true;
}

module.exports = {
  isPointInPolygon,
  calculateDistanceKm,
  isInsideZone,
};
