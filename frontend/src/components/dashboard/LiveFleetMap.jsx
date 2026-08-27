import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../services/api'
import { useSocket } from '../../context/SocketContext'
import useApiQuery from '../../hooks/useApiQuery'

const IDLE_COLOR = '#34d399'
const TRIP_COLOR = '#e8871e'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'idle', label: 'Idle' },
  { key: 'on_trip', label: 'Busy' },
]

function markerIcon(color) {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:11px;height:11px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.15)"></span>`,
    iconSize: [11, 11],
    iconAnchor: [5, 5],
  })
}

// Leaflet's bindTooltip sets string content via innerHTML, and full_name /
// vehicle come from rider-submitted profile data — building a real DOM node
// with textContent (instead of a template string) keeps that untrusted text
// from ever being parsed as markup.
function riderTooltipContent(r) {
  const el = document.createElement('span')
  el.append(document.createTextNode(r.full_name || `Driver #${r.rider_id}`), document.createTextNode(' · '), document.createTextNode(r.vehicle || ''))
  return el
}

export default function LiveFleetMap() {
  const { socket } = useSocket()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map()) // rider_id -> L.Marker
  const [filter, setFilter] = useState('all')

  const fetcher = useCallback(() => api.get('/fleet/live-tracking').then((res) => res.data.data), [])
  const { data: riders, loading } = useApiQuery(fetcher)

  const counts = useMemo(() => {
    const all = riders?.length ?? 0
    const onTrip = riders?.filter((r) => r.status === 'on_trip').length ?? 0
    return { all, on_trip: onTrip, idle: all - onTrip }
  }, [riders])

  const visibleRiders = useMemo(() => {
    if (!riders) return riders
    if (filter === 'all') return riders
    if (filter === 'on_trip') return riders.filter((r) => r.status === 'on_trip')
    return riders.filter((r) => r.status !== 'on_trip')
  }, [riders, filter])

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([22.7196, 75.8577], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map

    // Leaflet caches the container's pixel size at init time. Because this
    // component is lazy-loaded inside a grid column, that size can still be
    // settling (webfont swap, Suspense resolve) when L.map() runs, leaving
    // the rendered tiles smaller than the actual box. ResizeObserver fires
    // once immediately with the current size (fixing that first mis-measure)
    // and again on every later layout change (sidebar toggle, window resize).
    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Seed markers from the REST snapshot (re-run when the filter changes) and fit bounds.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !visibleRiders) return

    for (const marker of markersRef.current.values()) marker.remove()
    markersRef.current.clear()

    const points = []
    for (const r of visibleRiders) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue
      const marker = L.marker([r.lat, r.lng], { icon: markerIcon(r.status === 'on_trip' ? TRIP_COLOR : IDLE_COLOR) })
        .addTo(map)
        .bindTooltip(riderTooltipContent(r), { direction: 'top' })
      markersRef.current.set(r.rider_id, marker)
      points.push([r.lat, r.lng])
    }
    if (points.length > 0) map.fitBounds(points, { padding: [24, 24], maxZoom: 14 })
  }, [visibleRiders])

  // Live incremental position updates — no full refetch per ping.
  useEffect(() => {
    if (!socket) return
    function onPing({ rider_id, lat, lng }) {
      const marker = markersRef.current.get(rider_id)
      if (marker && Number.isFinite(lat) && Number.isFinite(lng)) marker.setLatLng([lat, lng])
    }
    socket.on('admin:live_driver_ping', onPing)
    return () => socket.off('admin:live_driver_ping', onPing)
  }, [socket])

  return (
    <div className="surface-card flex h-full flex-col overflow-hidden rounded-xl">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          Live Fleet Radar
        </h3>
        <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                background: filter === f.key ? 'var(--brand)' : 'transparent',
                color: filter === f.key ? 'var(--brand-ink)' : 'var(--ink-muted)',
              }}
            >
              {f.label} ({counts[f.key] ?? 0})
            </button>
          ))}
        </div>
      </div>
      {/* min-h keeps this from collapsing when the grid isn't stretching the
          card (e.g. the single-column mobile layout); flex-1 makes the
          leaflet container grow to fill the rest of the card exactly —
          otherwise the card stretches to match its taller sibling column
          but the fixed-height map doesn't, leaving a gap below it. */}
      <div className="relative min-h-[340px] flex-1">
        <div ref={containerRef} className="h-full w-full" style={{ background: 'var(--bg)' }} />
        <div
          className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border px-2.5 py-1.5 text-[11px]"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)', color: 'var(--ink-muted)' }}
        >
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: IDLE_COLOR }} /> Idle
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: TRIP_COLOR }} /> On trip
          </span>
        </div>
      </div>
      {!loading && riders?.length === 0 && (
        <p className="shrink-0 px-4 py-2 text-center text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          No online drivers with a live location right now.
        </p>
      )}
    </div>
  )
}
