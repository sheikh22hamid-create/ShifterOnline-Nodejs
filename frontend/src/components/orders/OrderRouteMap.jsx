import { useCallback, useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Route as RouteIcon } from 'lucide-react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import useRealtimeSync from '../../hooks/useRealtimeSync'
import Badge from '../common/Badge'
import { formatDateTime } from '../../utils/format'

// The recorded driver GPS trail of one order (live, completed or cancelled), same data and colours as the customer
// app's route map: blue = driver heading to pickup, orange = pickup to drop. A booking several drivers took shows
// each driver's route as its own line (never joined into one). Only recorded points are drawn: with no trail the map
// shows the pins and an empty state, never an estimated route.
const TO_PICKUP = '#2563EB'
const TO_DROP = '#F97316'
const DRIVER_COLORS = ['#7C3AED', '#0D9488', '#DB2777', '#CA8A04'] // earlier (replaced) drivers, one colour each
const REALTIME_EVENTS = ['admin:order_status_update', 'admin:driver_status_update']

const pin = (color) => L.divIcon({
  className: '',
  html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const toLatLng = (p) => (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) ? [Number(p.lat), Number(p.lng)] : null)

// Contiguous runs of one phase, with a dashed connector over long offline gaps.
function segmentsOf(points) {
  const segments = []
  let run = []
  let phase = null
  for (const p of points) {
    const at = [Number(p.lat), Number(p.lng)]
    if (p.gap && run.length) {
      segments.push({ phase, latlngs: run, dashed: false })
      segments.push({ phase, latlngs: [run[run.length - 1], at], dashed: true })
      run = [at]
    } else if (run.length && p.phase !== phase) {
      run.push(at)
      segments.push({ phase, latlngs: run, dashed: false })
      run = [at]
    } else {
      run.push(at)
    }
    phase = p.phase
  }
  if (run.length) segments.push({ phase, latlngs: run, dashed: false })
  return segments.filter((s) => s.latlngs.length >= 2)
}

const driverLabel = (a) => a.driver_name || `Driver #${a.rider_id}`

export default function OrderRouteMap({ orderId, status }) {
  const fetcher = useCallback(() => api.get(`/orders/${orderId}/route`).then((res) => res.data.data), [orderId])
  const { data: route, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(REALTIME_EVENTS, refetch)

  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return undefined
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([22.7196, 75.8577], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Earlier drivers (a booking whose driver cancelled and was replaced) first, the latest driver on top.
  const assignments = useMemo(() => route?.assignments || [], [route])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer || !route) return
    layer.clearLayers()
    const bounds = []
    const mark = (where, color, label) => {
      const at = toLatLng(where)
      if (!at) return
      L.marker(at, { icon: pin(color) }).bindTooltip(label).addTo(layer)
      bounds.push(at)
    }

    assignments.forEach((a, index) => {
      const latest = index === assignments.length - 1
      const earlierColor = DRIVER_COLORS[index % DRIVER_COLORS.length]
      for (const seg of segmentsOf(a.points)) {
        const color = latest ? (seg.phase === 0 ? TO_PICKUP : TO_DROP) : earlierColor
        if (seg.dashed) L.polyline(seg.latlngs, { color: '#94a3b8', weight: 3, dashArray: '6 8' }).addTo(layer)
        else L.polyline(seg.latlngs, { color, weight: latest ? 5 : 4, opacity: latest ? 0.95 : 0.7 }).addTo(layer)
        bounds.push(...seg.latlngs)
      }
      const first = toLatLng(a.points[0])
      if (first && a.has_trail) mark(a.points[0], latest ? '#00B0FF' : earlierColor, `${driverLabel(a)} · start`)
    })

    mark(route.pickup, '#16A34A', 'Pickup')
    mark(route.final_pickup, '#F97316', 'Final pickup')
    mark(route.otp_point, '#7B2FF7', 'OTP location')
    ;(route.stops || []).forEach((s, i) => mark(s, '#EAB308', `Stop ${i + 1}`))
    mark(route.drop, '#DC2626', 'Drop')

    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
  }, [route, assignments])

  const totalPoints = assignments.reduce((n, a) => n + a.points.length, 0)
  const emptyText = route?.cancelled
    ? 'No GPS tracking was recorded before this order was cancelled.'
    : 'No GPS tracking has been recorded for this order yet.'

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        <RouteIcon size={13} /> Route Map
      </h3>
      <div className="surface-card overflow-hidden rounded-xl">
        <div ref={containerRef} style={{ height: 260 }} />
        <div className="space-y-2 p-3.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          {loading && <div>Loading route…</div>}
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
          {route && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {status && <Badge tone={route.cancelled ? 'danger' : 'info'}>{status}</Badge>}
                {route.has_trail && (
                  <span>
                    {route.cancelled ? 'Travelled until cancellation' : 'Driven so far'}: <b className="font-mono-data" style={{ color: 'var(--ink)' }}>{route.distance_km} km</b>
                  </span>
                )}
                <span>{totalPoints} recorded GPS points</span>
              </div>
              {totalPoints === 0 && <div style={{ color: 'var(--ink-faint)' }}>{emptyText}</div>}
              {assignments.length > 0 && (
                <ul className="space-y-1">
                  {assignments.map((a, index) => {
                    const latest = index === assignments.length - 1
                    return (
                      <li key={a.rider_id} className="flex flex-wrap items-center gap-2">
                        <span style={{ display: 'inline-block', width: 18, height: 4, borderRadius: 2, background: latest ? TO_PICKUP : DRIVER_COLORS[index % DRIVER_COLORS.length] }} />
                        <span style={{ color: 'var(--ink)' }}>{driverLabel(a)}</span>
                        {a.vehicle_no && <span className="font-mono-data">{a.vehicle_no}</span>}
                        <span>
                          {a.has_trail ? `${a.distance_km} km` : 'no route recorded'} · {formatDateTime(a.started_at)}
                          {assignments.length > 1 && !latest ? ' · replaced after cancelling' : ''}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                <span><i style={{ display: 'inline-block', width: 14, height: 3, background: TO_PICKUP, marginRight: 4 }} />Driver to pickup</span>
                <span><i style={{ display: 'inline-block', width: 14, height: 3, background: TO_DROP, marginRight: 4 }} />Pickup to drop</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
