import { useEffect, useState } from 'react'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'

function pointKey(p) {
  return p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : ''
}

/**
 * Fetches a real road-following route between two points via the public
 * OSRM demo server. Has no refetch timer of its own — it only recalculates
 * when `origin`/`destination` actually move (rounded to ~1m). Callers that
 * want a periodic refresh for a point that's continuously live (the
 * driver's position) should throttle what they pass in as `origin` rather
 * than expect this hook to poll — that's what keeps OSRM calls to roughly
 * once per 20s heartbeat instead of once per GPS ping.
 */
export default function useOsrmRoute(origin, destination) {
  const [route, setRoute] = useState(null) // { coords, distanceMeters, durationSeconds }
  const [error, setError] = useState('')
  const originKey = pointKey(origin)
  const destKey = pointKey(destination)

  useEffect(() => {
    if (!originKey || !destKey) {
      // No valid endpoints yet (trip not selected / this leg not active in
      // the current phase) — clearing stale route data mirrors that.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoute(null)
      return
    }
    let cancelled = false

    async function fetchRoute() {
      try {
        const coordsParam = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
        const res = await fetch(`${OSRM_BASE}/${coordsParam}?overview=full&geometries=geojson`)
        const json = await res.json()
        if (cancelled) return
        const leg = json.routes?.[0]
        if (json.code !== 'Ok' || !leg) {
          setError('No route found')
          return
        }
        setRoute({
          coords: leg.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distanceMeters: leg.distance,
          durationSeconds: leg.duration,
        })
        setError('')
      } catch {
        if (!cancelled) setError('Route lookup failed')
      }
    }

    fetchRoute()
    return () => {
      cancelled = true
    }
    // originKey/destKey (rounded coords) are the real dependency — origin
    // and destination are fresh object identities every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, destKey])

  return { route, error }
}
