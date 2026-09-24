import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'

function RouteMap({ route }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!route?.geometry?.length) return
    const map = L.map(ref.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    const points = route.geometry.map(p => [p.lat, p.lng])
    L.polyline(points, { color: '#2563eb', weight: 5 }).addTo(map)
    // Sample the road geometry for a coverage preview; server uses exact segments.
    const stride = Math.max(1, Math.ceil(points.length / 150))
    points.filter((_, i) => i % stride === 0 || i === points.length - 1).forEach(p => L.circle(p, { radius: route.radius_km * 1000, stroke: false, fillColor: '#2563eb', fillOpacity: 0.025 }).addTo(map))
    route.points.forEach((p, i) => L.circleMarker([p.lat, p.lng], { radius: 7, color: i === 0 ? '#059669' : '#f97316', fillOpacity: 1 }).bindTooltip(`${i + 1}. ${p.label || 'Route point'}`).addTo(map))
    map.fitBounds(L.latLngBounds(points).pad(0.15))
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(ref.current)
    return () => { observer.disconnect(); map.remove() }
  }, [route])
  return <div ref={ref} className="h-80 rounded-xl border" aria-label="Favorite route map" />
}

export default function FavoriteRoutes() {
  const { user } = useAuth()
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [city, setCity] = useState(''), [rider, setRider] = useState(''), [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null), [config, setConfig] = useState(null)
  const [reason, setReason] = useState(''), [order, setOrder] = useState(''), [diagnostic, setDiagnostic] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const manager = ['admin', 'superadmin'].includes(user?.role)
  async function load(nextPage = page) {
    setBusy(true); setError('')
    try {
      const [routesResult, metricsResult] = await Promise.all([
        api.get('/favorite-routes', { params: { city_id: city || undefined, rider_id: rider || undefined, page: nextPage } }),
        api.get('/favorite-routes/metrics', { params: { city_id: city || undefined } }),
      ])
      setData(routesResult.data.data); setConfig(routesResult.data.data.config); setMetrics(metricsResult.data.data)
      setPage(nextPage); setSelected(null); setDiagnostic(null)
    } catch (e) { setError(e.response?.data?.message || 'Could not load routes') } finally { setBusy(false) }
  }
  useEffect(() => { load(1) }, []) // Explicit filters apply with Search.
  async function saveSettings() {
    setBusy(true); setError('')
    try { await api.put('/favorite-routes/settings', { city_id: data.city_id, config }); await load() }
    catch (e) { setError(e.response?.data?.message || 'Could not save settings') } finally { setBusy(false) }
  }
  async function disable() {
    setBusy(true); setError('')
    try { await api.post(`/favorite-routes/${selected.id}/disable`, { reason }, { params: { city_id: data.city_id } }); setReason(''); await load() }
    catch (e) { setError(e.response?.data?.message || 'Could not disable route') } finally { setBusy(false) }
  }
  async function diagnose() {
    setBusy(true); setError('')
    try { setDiagnostic((await api.post(`/favorite-routes/${selected.id}/diagnose`, { order_id: Number(order) }, { params: { city_id: data.city_id } })).data.data) }
    catch (e) { setError(e.response?.data?.message || 'Could not check order') } finally { setBusy(false) }
  }
  const input = 'rounded-lg border px-3 py-2 bg-white text-slate-900'
  const button = 'rounded-lg bg-orange-600 px-4 py-2 text-white disabled:opacity-40'
  return <div className="space-y-5 p-6">
    <div><h1 className="text-2xl font-semibold">Favorite routes</h1><p className="text-sm text-slate-500">Driver preferences, coverage and matching diagnostics.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-3">
      {user?.role === 'superadmin' && <input aria-label="City ID" className={input} type="number" min="1" placeholder="City ID (blank = global)" value={city} onChange={e => setCity(e.target.value)} />}
      <input aria-label="Driver ID" className={input} type="number" min="1" placeholder="Driver ID (optional)" value={rider} onChange={e => setRider(e.target.value)} />
      <button className={button} disabled={busy} onClick={() => load(1)}>{busy ? 'Loading…' : 'Search / refresh'}</button>
    </div>
    {data && <>
      {!data.deployment_enabled && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Server rollout switch is off. Route filtering is not applied to dispatch.</p>}
      {metrics && <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Monitoring · {city ? `City ${city}` : 'Global'}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Saved routes', metrics.saved_routes],
            ['Active route drivers', metrics.active_route_drivers],
            ['Disabled', metrics.disabled_routes],
            ['Expired', metrics.expired_routes],
            ['Prefer mode', metrics.mode_split.prefer || 0],
            ['Only mode', metrics.mode_split.only || 0],
          ].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {metrics.dispatch.map(d => <div key={d.city_id ?? 'global'} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">{d.city_id ? `City ${d.city_id}` : 'Global'} · since {new Date(d.since).toLocaleString()}</p>
            <p>Matched offers: {d.offers_matched} · Excluded (Only mode): {d.offers_excluded_only_mode}</p>
            <p>Routing errors: {d.routing_errors} · Avg match time: {d.avg_match_duration_ms} ms ({d.match_runs} dispatch runs)</p>
          </div>)}
          {!metrics.dispatch.length && <p className="text-sm text-slate-500">No dispatch activity recorded since server start.</p>}
        </div>
      </section>}
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Settings · {data.city_id ? `City ${data.city_id}` : 'Global'}</summary>
        <p className="my-3 text-sm text-slate-500">Global off restores normal dispatch. City settings cannot override global off. Pausing, expiry or disabling a route also restores normal requests.</p>
        {config && <div className="grid gap-4 sm:grid-cols-3">
          {['enabled', 'allow_only', 'allow_forward', 'preference_enabled'].map(key => <label key={key} className="flex items-center gap-2"><input type="checkbox" disabled={!manager || busy} checked={config[key]} onChange={e => setConfig({ ...config, [key]: e.target.checked })} />{key.replaceAll('_', ' ')}</label>)}
          {['min_radius', 'max_radius', 'default_radius', 'max_routes', 'max_points'].map(key => <label key={key} className="grid gap-1 text-sm">{key.replaceAll('_', ' ')}<input className={input} type="number" disabled={!manager || busy} value={config[key]} onChange={e => setConfig({ ...config, [key]: Number(e.target.value) })} /></label>)}
          {manager && <button className={button} disabled={busy} onClick={saveSettings}>Save settings</button>}
        </div>}
      </details>
      <div className="grid gap-5 lg:grid-cols-2"><section className="space-y-3">
        <h2 className="font-semibold">Saved routes ({data.total})</h2>
        {!data.routes.length && <p className="rounded-xl border p-6 text-slate-500">No saved routes in this scope.</p>}
        {data.routes.map(route => <button key={route.id} onClick={() => { setSelected(route); setDiagnostic(null); setReason('') }} className={`block w-full rounded-xl border p-4 text-left ${selected?.id === route.id ? 'border-orange-500 bg-orange-50' : 'bg-white'}`}>
          <div className="flex justify-between gap-2"><strong>{route.name}</strong><span>{route.disabled ? 'Disabled' : route.expires_at && new Date(route.expires_at) <= new Date() ? 'Expired' : route.active ? 'Active' : 'Paused'}</span></div>
          <p className="mt-1 text-sm text-slate-600">Driver #{route.rider_id} · {route.mode} · {route.radius_km} km coverage · {route.distance_km.toFixed(1)} km route</p>
          {route.disabled_reason && <p className="mt-2 text-sm text-red-700">{route.disabled_reason}</p>}
        </button>)}
        <div className="flex items-center gap-3"><button disabled={busy || page === 1} onClick={() => load(page - 1)}>Previous</button><span>Page {page}</span><button disabled={busy || page * 50 >= data.total} onClick={() => load(page + 1)}>Next</button></div>
      </section><section className="space-y-3">
        {selected ? <><h2 className="font-semibold">{selected.name}</h2><RouteMap route={selected} /><p className="text-xs text-slate-500">Shading is a sampled coverage preview. Matching uses the full road geometry.</p>
          <ol className="list-inside list-decimal text-sm">{selected.points.map((p, i) => <li key={i}>{p.label || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}</li>)}</ol>
          <p className="text-sm">{selected.forward_only ? 'Forward only' : 'Either direction'} · Expires: {selected.expires_at ? new Date(selected.expires_at).toLocaleString() : 'Until paused'}</p>
          <div className="flex gap-2"><input className={input} aria-label="Order ID" type="number" placeholder="Order ID" value={order} onChange={e => setOrder(e.target.value)} /><button className={button} disabled={busy || !order} onClick={diagnose}>Check match</button></div>
          {diagnostic && <div className="rounded-lg bg-slate-100 p-3 text-sm"><strong>{diagnostic.reason.replaceAll('_', ' ')}</strong>{diagnostic.distance_km != null && <p>Farthest drop: {diagnostic.distance_km.toFixed(2)} km from route</p>}<p>{diagnostic.note}</p></div>}
          {manager && !selected.disabled && <div className="space-y-2 rounded-lg border border-red-200 p-3"><input className={`${input} w-full`} placeholder="Reason for disabling" aria-label="Disable reason" maxLength={255} value={reason} onChange={e => setReason(e.target.value)} /><button className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-40" disabled={busy || !reason.trim()} onClick={disable}>Disable route</button></div>}
        </> : <p className="rounded-xl border p-6 text-slate-500">Select a route to inspect its map and matching.</p>}
      </section></div>
      <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Recent changes</summary>{data.audit.map(item => <p key={item.id} className="mt-2 text-sm">{new Date(item.created_at).toLocaleString()} · {item.actor} · {item.action} · Route {item.route_id || '—'}</p>)}</details>
    </>}
  </div>
}
