import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { createDriverIcon, createPickupIcon, createDropoffIcon, vehicleCategoryFromText } from './markerIcons'
import { truncatePolylineFromPoint } from '../../utils/geo'

const PHASE_COLOR = { 1: '#f59e0b', 2: '#10b981' }
const INTERP_DURATION_MS = 2500
// The truncated "remaining route" polyline is redrawn on a much lower
// cadence than the marker itself — a line redraw doesn't need 60fps to
// read as smooth, and re-scanning a few hundred route points every single
// animation frame would be wasted work.
const TRUNCATE_THROTTLE_MS = 200

function toLatLng(point) {
  return point ? [point.lat, point.lng] : null
}

export default function MissionControlMap({
  trip,
  phase,
  pickupPoint,
  dropoffPoint,
  driverSnapshot,
  vehicleText,
  leg1Route,
  leg2Route,
  activeLegRoute,
  latestPingRef,
  pingVersion,
  onLiveMetricsChange,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  const driverMarkerRef = useRef(null)
  const pickupMarkerRef = useRef(null)
  const dropoffMarkerRef = useRef(null)
  const leg1PolylineRef = useRef(null)
  const leg2PolylineRef = useRef(null)
  const activeLegPolylineRef = useRef(null)

  const animRef = useRef(null)
  const movingLegBaselineRef = useRef(null) // { coords, distanceMeters, durationSeconds } — full (untruncated) route for whichever leg is currently "live"

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([22.7196, 75.8577], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Markers + camera — rebuilt whenever the focused trip changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const ref of [driverMarkerRef, pickupMarkerRef, dropoffMarkerRef]) {
      ref.current?.remove()
      ref.current = null
    }

    if (!trip) return

    const driverStart = toLatLng(driverSnapshot)
    if (driverStart) {
      driverMarkerRef.current = L.marker(driverStart, {
        icon: createDriverIcon({ category: vehicleCategoryFromText(vehicleText), color: PHASE_COLOR[phase] ?? PHASE_COLOR[1] }),
        zIndexOffset: 1000,
      }).addTo(map)
    }
    if (pickupPoint) pickupMarkerRef.current = L.marker(toLatLng(pickupPoint), { icon: createPickupIcon() }).addTo(map)
    if (dropoffPoint) dropoffMarkerRef.current = L.marker(toLatLng(dropoffPoint), { icon: createDropoffIcon() }).addTo(map)

    const boundsPoints = [driverStart, toLatLng(pickupPoint), toLatLng(dropoffPoint)].filter(Boolean)
    if (boundsPoints.length > 0) map.flyToBounds(boundsPoints, { padding: [50, 50], maxZoom: 15 })
    // Only the trip identity should re-seed markers/camera — pickupPoint etc.
    // are derived fresh from `trip` every render and would otherwise refire
    // this (and re-fly the camera) on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id])

  // Driver marker icon reflects the current phase's color.
  useEffect(() => {
    const marker = driverMarkerRef.current
    if (!marker || !phase) return
    marker.setIcon(createDriverIcon({ category: vehicleCategoryFromText(vehicleText), color: PHASE_COLOR[phase] ?? PHASE_COLOR[1] }))
  }, [phase, vehicleText])

  // Full (untruncated) route redraw whenever a fresh OSRM fetch lands.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    leg1PolylineRef.current?.remove()
    leg1PolylineRef.current = null
    if (phase === 1 && leg1Route) {
      leg1PolylineRef.current = L.polyline(leg1Route.coords, { color: '#f59e0b', weight: 4, dashArray: '8 8' }).addTo(map)
      movingLegBaselineRef.current = leg1Route
    }
  }, [phase, leg1Route])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    leg2PolylineRef.current?.remove()
    leg2PolylineRef.current = null
    if (phase === 1 && leg2Route) {
      leg2PolylineRef.current = L.polyline(leg2Route.coords, { color: '#6366f1', weight: 3, opacity: 0.5 }).addTo(map)
    }
  }, [phase, leg2Route])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    activeLegPolylineRef.current?.remove()
    activeLegPolylineRef.current = null
    if (phase === 2 && activeLegRoute) {
      activeLegPolylineRef.current = L.polyline(activeLegRoute.coords, { color: '#10b981', weight: 5 }).addTo(map)
      movingLegBaselineRef.current = activeLegRoute
    }
  }, [phase, activeLegRoute])

  // Live ping arrived — smoothly move the marker (no teleporting) and, on a
  // throttled cadence, shrink the "moving" leg's polyline to match.
  useEffect(() => {
    const map = mapRef.current
    const target = latestPingRef.current
    if (!map || !target) return

    // The rider snapshot (rlats/rlongs) can be empty if the driver has never
    // sent a GPS ping — fall back to creating the marker from the first
    // live ping instead of waiting on a snapshot that may never arrive.
    let marker = driverMarkerRef.current
    if (!marker) {
      marker = L.marker([target.lat, target.lng], {
        icon: createDriverIcon({ category: vehicleCategoryFromText(vehicleText), color: PHASE_COLOR[phase] ?? PHASE_COLOR[1] }),
        zIndexOffset: 1000,
      }).addTo(map)
      driverMarkerRef.current = marker
    }

    const headingEl = marker.getElement()?.querySelector('.driver-heading')
    if (headingEl) headingEl.style.transform = `rotate(${target.heading}deg)`

    const fromLatLng = marker.getLatLng()
    const from = { lat: fromLatLng.lat, lng: fromLatLng.lng }
    const start = performance.now()
    let lastTruncateAt = 0
    cancelAnimationFrame(animRef.current)

    function step(ts) {
      const t = Math.min(1, (ts - start) / INTERP_DURATION_MS)
      const lat = from.lat + (target.lat - from.lat) * t
      const lng = from.lng + (target.lng - from.lng) * t
      marker.setLatLng([lat, lng])

      if (ts - lastTruncateAt >= TRUNCATE_THROTTLE_MS) {
        lastTruncateAt = ts
        const baseline = movingLegBaselineRef.current
        const activePolyline = phase === 1 ? leg1PolylineRef.current : phase === 2 ? activeLegPolylineRef.current : null
        if (baseline && activePolyline) {
          const { coords, remainingMeters } = truncatePolylineFromPoint(baseline.coords, [lat, lng])
          activePolyline.setLatLngs(coords)
          const ratio = baseline.distanceMeters > 0 ? remainingMeters / baseline.distanceMeters : 0
          onLiveMetricsChange?.({ remainingMeters, etaSeconds: baseline.durationSeconds * ratio })
        }
      }

      if (t < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)

    return () => cancelAnimationFrame(animRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingVersion])

  // Fresh OSRM fetch landed — that's the new metrics baseline until the next
  // ping-driven truncation refines it further.
  useEffect(() => {
    const active = phase === 1 ? leg1Route : phase === 2 ? activeLegRoute : null
    if (active) onLiveMetricsChange?.({ remainingMeters: active.distanceMeters, etaSeconds: active.durationSeconds })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, leg1Route, activeLegRoute])

  return <div ref={containerRef} className="h-full w-full" style={{ background: 'var(--bg)' }} />
}
