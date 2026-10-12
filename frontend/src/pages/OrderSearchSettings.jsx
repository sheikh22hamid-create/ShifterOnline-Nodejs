import { useCallback, useEffect, useRef, useState } from 'react'
import { Radar } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const inputClass = 'mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const SECONDS_PRESETS = [30, 60, 120, 180]

const EMPTY = {
  search_system: '1',
  search_radius_km: '',
  driver_search_seconds: '60',
  guarantee_enabled: false,
  admin_window_minutes: '',
  guarantee_referrals_required: '1',
}

const fromApi = (d) => ({
  search_system: String(d.search_system ?? 1),
  search_radius_km: d.search_radius_km != null ? String(d.search_radius_km) : '',
  driver_search_seconds: String(d.driver_search_seconds ?? 60),
  guarantee_enabled: Boolean(d.guarantee_enabled),
  admin_window_minutes: d.admin_window_minutes != null ? String(d.admin_window_minutes) : '',
  guarantee_referrals_required: String(d.guarantee_referrals_required ?? 1),
})

export default function OrderSearchSettings() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user, hasRole } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const canWrite = hasRole('superadmin', 'admin')

  const [cities, setCities] = useState([])
  const [cityId, setCityId] = useState(isSuper ? '' : String(user?.city_id ?? ''))
  useEffect(() => {
    if (user && user.role !== 'superadmin') setCityId(String(user.city_id ?? ''))
  }, [user])

  const [form, setForm] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const cityRef = useRef(cityId)
  useEffect(() => { cityRef.current = cityId }, [cityId])

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities')
      .then((res) => setCities(res.data?.data || res.data || []))
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load cities')))
  }, [isSuper])

  const params = useCallback(() => (isSuper ? { city_id: cityId } : {}), [isSuper, cityId])

  useEffect(() => {
    setLoaded(false)
    setForm(EMPTY)
    if (!cityId) return
    const sentCity = cityId
    api.get('/order-search/settings', { params: params() })
      .then((res) => {
        if (cityRef.current !== sentCity) return // the admin switched city meanwhile: drop this answer
        setForm(fromApi(res.data.data))
        setLoaded(true)
      })
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load settings')))
  }, [cityId, params])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    setSaving(true)
    try {
      const body = { ...form, ...(isSuper ? { city_id: Number(cityId) } : {}) }
      const res = await api.put('/order-search/settings', body)
      setForm(fromApi(res.data.data))
      toastRef.current.success('Order search settings saved')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const system2 = form.search_system === '2'
  const disabled = !canWrite || !loaded

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radar size={22} style={{ color: 'var(--ink)' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>Order Search System</h1>
        </div>
        {isSuper && (
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass} style={{ ...inputStyle, width: 220, marginTop: 0 }}>
            <option value="">Select a city…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </select>
        )}
      </div>

      <div className="rounded-2xl border p-4 text-xs space-y-1" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
        <div><b>System 1 (Driver Availability):</b> a vehicle is shown, and can be booked, only when a driver is available near the pickup.</div>
        <div><b>System 2 (Vehicle Category First):</b> every vehicle category registered in the city is shown. The driver search starts after the customer confirms the order and runs for the driver search time below.</div>
      </div>

      {!cityId && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>Select a city to see its settings.</div>}

      {cityId && (
        <div className="surface-card rounded-xl p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="search_system">Order search system</label>
            <select id="search_system" value={form.search_system} onChange={set('search_system')} disabled={disabled} className={inputClass} style={inputStyle}>
              <option value="1">System 1 – Driver Availability Based</option>
              <option value="2">System 2 – Vehicle Category First</option>
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="search_radius_km">Search radius (km, 1–30)</label>
              <input id="search_radius_km" type="number" min="1" max="30" step="0.5" value={form.search_radius_km} onChange={set('search_radius_km')} disabled={disabled} placeholder="Default (10)" className={inputClass} style={inputStyle} />
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Used for System 2 orders only. Leave empty for the default.</p>
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="driver_search_seconds">Driver search time (seconds, 15–600)</label>
              <input id="driver_search_seconds" type="number" min="15" max="600" step="1" value={form.driver_search_seconds} onChange={set('driver_search_seconds')} disabled={disabled} className={inputClass} style={inputStyle} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SECONDS_PRESETS.map((s) => (
                  <button key={s} type="button" disabled={disabled} onClick={() => setForm((f) => ({ ...f, driver_search_seconds: String(s) }))} className="rounded-lg border px-2 py-1 text-[12px] disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>{s}s</button>
                ))}
              </div>
              {!system2 && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Only applies once System 2 is selected.</p>}
            </div>
          </div>

          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={form.guarantee_enabled} onChange={set('guarantee_enabled')} disabled={disabled} />
              Booking Guarantee active in this city
            </label>
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              When no driver is found in the search time, the order is held so an admin can arrange a vehicle. If that also fails, the customer is compensated and the guarantee locks until they complete the referrals below.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="admin_window_minutes">Admin arrangement time (minutes)</label>
                <input id="admin_window_minutes" type="number" min="1" max="1440" step="1" value={form.admin_window_minutes} onChange={set('admin_window_minutes')} disabled={disabled || !form.guarantee_enabled} placeholder="Default (global setting)" className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="guarantee_referrals_required">Referrals needed to unlock</label>
                <input id="guarantee_referrals_required" type="number" min="1" step="1" value={form.guarantee_referrals_required} onChange={set('guarantee_referrals_required')} disabled={disabled || !form.guarantee_enabled} className={inputClass} style={inputStyle} />
              </div>
            </div>
          </div>

          {canWrite && (
            <button type="button" onClick={save} disabled={saving || !loaded} className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <p className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Changes apply to new orders only; orders already searching keep the time they started with.</p>
        </div>
      )}
    </div>
  )
}
