import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const inputClass = 'mt-1 w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : '-')

const EMPTY_TEST = { city_id: '', cat_id: '', plat: '', plong: '', dlat: '', dlong: '' }

// Porter's web quote runs higher than its in-app price, by a different amount per vehicle. These % cut the
// web anchor down to the app level. Keyed by Porter vehicle id (matches the backend appAdjustPct map).
const PORTER_VEHICLES = [
  { id: 97, label: 'Bike' },
  { id: 133, label: 'Scooter' },
  { id: 1139, label: 'Mini 3W' },
  { id: 126, label: 'E Loader' },
  { id: 91, label: '3 Wheeler' },
  { id: 1, label: 'Tata Ace' },
]
const adjustFromConfig = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, String(v)]))
const adjustToPayload = (m) => Object.fromEntries(
  PORTER_VEHICLES
    .map((v) => [v.id, Number(m?.[v.id])])
    .filter(([, n]) => Number.isFinite(n) && n > 0),
)

/**
 * Porter Live Pricing: prices fares off Porter's live quote in switched-on cities. Anyone on the page can read;
 * only a superadmin can save (the server enforces it too).
 */
export default function PorterLivePricingCard({ categories = [] }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user } = useAuth()
  const canEdit = user?.role === 'superadmin'

  const [form, setForm] = useState({ enabled: false, cityIds: [], timeoutMs: '', cacheMinutes: '', appAdjust: {} })
  const [stats, setStats] = useState(null)
  const [cities, setCities] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState(EMPTY_TEST)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const [cfgRes, cityRes] = await Promise.all([
        api.get('/rate-cards/porter-live'),
        api.get('/cities').catch(() => null),
      ])
      const d = cfgRes.data?.data || {}
      const c = d.config || {}
      setForm({
        enabled: !!c.enabled,
        cityIds: (c.cityIds || []).map(Number),
        timeoutMs: String(c.timeoutMs ?? ''),
        cacheMinutes: String(c.cacheMinutes ?? ''),
        appAdjust: adjustFromConfig(c.appAdjustPct),
      })
      setStats(d.stats || null)
      const list = cityRes?.data?.data
      setCities(Array.isArray(list) ? list : [])
      setLoaded(true)
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not load Porter live pricing'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const toggleCity = (id) => setForm((f) => ({
    ...f,
    cityIds: f.cityIds.includes(id) ? f.cityIds.filter((x) => x !== id) : [...f.cityIds, id],
  }))

  async function save() {
    setSaving(true)
    try {
      const res = await api.put('/rate-cards/porter-live', {
        enabled: form.enabled,
        cityIds: form.cityIds,
        timeoutMs: Number(form.timeoutMs),
        cacheMinutes: Number(form.cacheMinutes),
        appAdjustPct: adjustToPayload(form.appAdjust),
      })
      const c = res.data?.data?.config || {}
      setForm({ enabled: !!c.enabled, cityIds: (c.cityIds || []).map(Number), timeoutMs: String(c.timeoutMs ?? ''), cacheMinutes: String(c.cacheMinutes ?? ''), appAdjust: adjustFromConfig(c.appAdjustPct) })
      toastRef.current.success('Porter live pricing saved')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    setTesting(true)
    setResult(null)
    try {
      const res = await api.post('/rate-cards/porter-live/test', test)
      setResult(res.data?.data || null)
      load()
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Test quote failed'))
    } finally {
      setTesting(false)
    }
  }

  const disabled = !canEdit || !loaded || saving
  const setT = (key) => (e) => setTest((t) => ({ ...t, [key]: e.target.value }))
  const rows = result
    ? (result.rate_card || []).map((r, i) => ({ title: r.title, rate: r.fare, porter: result.porter_based?.[i]?.fare }))
    : []

  return (
    <div className="surface-card rounded-xl p-4">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Porter Live Pricing</p>
      <label className="mt-2 flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} disabled={disabled} />
        Price fares off Porter live quote in the selected cities
      </label>
      <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
        Model % comes from Distance Slabs offsets (relative to Model 3).
      </p>

      <div className="mt-3">
        <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Cities</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {cities.length === 0 && <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>No cities found</span>}
          {cities.map((c) => {
            const on = form.cityIds.includes(Number(c.id))
            return (
              <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleCity(Number(c.id))}
                className="rounded-lg border px-2.5 py-1 text-[12px] font-medium disabled:opacity-60"
                style={{ borderColor: on ? 'var(--brand)' : 'var(--border)', background: on ? 'rgba(234, 88, 12, 0.08)' : 'var(--bg)', color: on ? 'var(--brand)' : 'var(--ink)' }}
              >
                {c.title}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="pl_timeout">Porter timeout (ms)</label>
          <input id="pl_timeout" type="number" min="500" max="4000" step="100" value={form.timeoutMs} onChange={(e) => setForm((f) => ({ ...f, timeoutMs: e.target.value }))} disabled={disabled} className={inputClass} style={inputStyle} />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>500 to 4000 ms</p>
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="pl_cache">Quote cache (minutes)</label>
          <input id="pl_cache" type="number" min="1" max="60" step="1" value={form.cacheMinutes} onChange={(e) => setForm((f) => ({ ...f, cacheMinutes: e.target.value }))} disabled={disabled} className={inputClass} style={inputStyle} />
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>1 to 60 minutes</p>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>App adjustment (% below Porter web)</p>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          Porter's web quote is higher than its in-app price. This % cuts the Model 3 anchor down per vehicle. Blank or 0 = no cut.
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {PORTER_VEHICLES.map((v) => (
            <label key={v.id} className="text-[12px]" style={{ color: 'var(--ink)' }}>
              {v.label}
              <input
                type="number" min="0" max="90" step="0.5" inputMode="decimal"
                value={form.appAdjust[v.id] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, appAdjust: { ...f.appAdjust, [v.id]: e.target.value } }))}
                disabled={disabled}
                className={inputClass} style={inputStyle} aria-label={`${v.label} app adjustment percent`}
              />
            </label>
          ))}
        </div>
      </div>

      {canEdit && (
        <button type="button" onClick={save} disabled={disabled} className="mt-3 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      )}

      {stats && (
        <p className="mt-3 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          Last success: {fmtTime(stats.lastSuccessAt)} · Last error: {stats.lastError ? `${stats.lastError} (${fmtTime(stats.lastFailureAt)})` : '-'} · Failures: {stats.failures ?? 0} · Breaker open until: {stats.breakerOpenUntil ? fmtTime(stats.breakerOpenUntil) : '-'}
        </p>
      )}

      {canEdit && <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Test quote</p>
        <div className="mt-1 grid gap-3 sm:grid-cols-3">
          <select value={test.city_id} onChange={setT('city_id')} className={inputClass} style={inputStyle} aria-label="City">
            <option value="">City</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <select value={test.cat_id} onChange={setT('cat_id')} className={inputClass} style={inputStyle} aria-label="Category">
            <option value="">Vehicle category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.cat_name}</option>)}
          </select>
          <span />
          <input placeholder="Pickup lat" value={test.plat} onChange={setT('plat')} className={inputClass} style={inputStyle} />
          <input placeholder="Pickup lng" value={test.plong} onChange={setT('plong')} className={inputClass} style={inputStyle} />
          <span />
          <input placeholder="Drop lat" value={test.dlat} onChange={setT('dlat')} className={inputClass} style={inputStyle} />
          <input placeholder="Drop lng" value={test.dlong} onChange={setT('dlong')} className={inputClass} style={inputStyle} />
          <button type="button" onClick={runTest} disabled={testing} className="mt-1 rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}>
            {testing ? 'Quoting...' : 'Get test quote'}
          </button>
        </div>
        {result && (
          <div className="mt-3 text-[12.5px]" style={{ color: 'var(--ink)' }}>
            <p style={{ color: 'var(--ink-muted)' }}>
              Distance {result.distance_km} km · {result.anchor ? `Porter fare ${result.anchor.fare ?? JSON.stringify(result.anchor)}` : 'Porter unavailable (city not enabled or quote failed) - rate card only'}
            </p>
            <table className="mt-2 w-full max-w-md text-left">
              <thead><tr><th className="py-1">Model</th><th>Porter-based</th><th>Rate card</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.title}><td className="py-0.5">{r.title}</td><td>{r.porter != null ? `₹${r.porter}` : '-'}</td><td>₹{r.rate}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>}
    </div>
  )
}
