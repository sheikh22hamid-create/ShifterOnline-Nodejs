const EARTH_RADIUS_M = 6371000

function toRad(deg) {
  return (deg * Math.PI) / 180
}

// Points are [lat, lng] pairs throughout this module, matching Leaflet's
// convention — callers converting from OSRM's [lng, lat] GeoJSON order must
// flip before calling in.
export function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

export function polylineLengthMeters(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i])
  return total
}

// Projects `point` onto segment a-b using an equirectangular approximation
// (fine at the short, single-city distances this map operates over) and
// returns the projected point plus how far along the segment it falls (t).
function projectOnSegment(point, a, b) {
  const latRef = toRad(a[0])
  const toXY = ([lat, lng]) => [toRad(lng) * Math.cos(latRef), toRad(lat)]
  const [px, py] = toXY(point)
  const [ax, ay] = toXY(a)
  const [bx, by] = toXY(b)
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projLatRad = ay + t * dy
  const projLngRad = (ax + t * dx) / Math.cos(latRef)
  return {
    t,
    point: [(projLatRad * 180) / Math.PI, (projLngRad * 180) / Math.PI],
  }
}

// Finds the point on the polyline closest to `point` and returns everything
// needed to redraw the "remaining" portion of the route: the projected point
// itself, which segment it falls on, and the total remaining length from
// there to the end of the line.
export function truncatePolylineFromPoint(coords, point) {
  if (!coords || coords.length < 2) return { coords: coords ?? [], remainingMeters: 0 }

  let best = null
  for (let i = 1; i < coords.length; i++) {
    const { t, point: projected } = projectOnSegment(point, coords[i - 1], coords[i])
    const distToProjected = haversineMeters(point, projected)
    if (!best || distToProjected < best.distToProjected) {
      best = { segmentIndex: i, t, projected, distToProjected }
    }
  }

  const truncated = [best.projected, ...coords.slice(best.segmentIndex)]
  return { coords: truncated, remainingMeters: polylineLengthMeters(truncated) }
}
