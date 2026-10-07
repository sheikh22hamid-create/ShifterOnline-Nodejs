import { useCallback, useEffect, useRef, useState } from 'react'
import { Gift, Plus, Trash2, Lock, Unlock, Ban } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useDebouncedValue from '../hooks/useDebouncedValue'

const TABS = [
  { id: 'settings', label: 'Settings' },
  { id: 'pool', label: 'Offer Pool' },
  { id: 'bookings', label: 'Bookings & Users' },
]

const inputClass = 'mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const cardStyle = { background: 'var(--surface)', borderColor: 'var(--border)' }

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{label}</label>
      {children}
    </div>
  )
}

// <input type="datetime-local"> works in the browser's local time; the API stores UTC.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)
const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '')
const errMsg = (err, fallback) => err?.response?.data?.message || fallback

export default function FreeBookingOffer() {
  const toast = useToast()
  // The toast object is re-created on every provider render; keep it in a ref so loaders stay stable
  // (otherwise an error toast would re-render, re-run the load effect and loop).
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user, hasRole } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const canWrite = hasRole('superadmin', 'admin')

  const [tab, setTab] = useState('settings')
  const [cities, setCities] = useState([])
  const [cityId, setCityId] = useState(isSuper ? '' : String(user?.city_id ?? ''))
  // A non-superadmin is pinned to their own city (also covers `user` arriving after the first render).
  useEffect(() => {
    if (user && user.role !== 'superadmin') setCityId(String(user.city_id ?? ''))
  }, [user])

  const [settings, setSettings] = useState({ enabled: false, offer_start: '', offer_end: '', referrals_required: '1' })
  const [pool, setPool] = useState([])
  const [candidates, setCandidates] = useState([])
  const [orders, setOrders] = useState([])
  const [addForm, setAddForm] = useState({ rider_id: '', valid_from: '', valid_to: '' })
  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState([])
  const [pickedCust, setPickedCust] = useState(null)
  const debouncedCust = useDebouncedValue(custSearch)

  const params = useCallback(() => (isSuper ? { city_id: cityId } : {}), [isSuper, cityId])
  const ready = Boolean(cityId)

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities')
      .then((res) => setCities(res.data?.data || res.data || []))
      .catch((err) => {
        setCities([])
        toastRef.current.error(errMsg(err, 'Could not load cities'))
      })
  }, [isSuper])

  // Latest city + a per-loader request counter: a response is applied only if it is still the newest
  // request AND the city has not changed since it was sent.
  const cityRef = useRef(cityId)
  const reqRef = useRef({ settings: 0, pool: 0, orders: 0 })
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // Declared before the load effect so on a city change it runs first: clear every city-scoped value.
  useEffect(() => {
    cityRef.current = cityId
    setSettings({ enabled: false, offer_start: '', offer_end: '', referrals_required: '1' })
    setSettingsLoaded(false)
    setPool([])
    setCandidates([])
    setOrders([])
    setAddForm({ rider_id: '', valid_from: '', valid_to: '' })
    setCustSearch(''); setCustResults([]); setPickedCust(null)
  }, [cityId])

  // Runs `request`, then `apply(res)`; on failure runs `clear()` and toasts. Stale results are dropped.
  const guarded = useCallback((kind, request, apply, clear, failMsg) => {
    const sentCity = cityId
    const token = ++reqRef.current[kind]
    const fresh = () => cityRef.current === sentCity && reqRef.current[kind] === token
    request()
      .then((res) => { if (fresh()) apply(res) })
      .catch((err) => {
        if (!fresh()) return
        clear()
        toastRef.current.error(errMsg(err, failMsg))
      })
  }, [cityId])

  const loadSettings = useCallback(() => {
    if (!ready) return
    guarded(
      'settings',
      () => api.get('/free-booking/settings', { params: params() }),
      (res) => {
        const d = res.data.data
        setSettings({ enabled: d.enabled, offer_start: toLocalInput(d.offer_start), offer_end: toLocalInput(d.offer_end), referrals_required: String(d.referrals_required ?? 1) })
        setSettingsLoaded(true)
      },
      () => setSettingsLoaded(false),
      'Could not load settings',
    )
  }, [ready, params, guarded])

  const loadPool = useCallback(() => {
    if (!ready) return
    guarded(
      'pool',
      () => Promise.all([
        api.get('/free-booking/pool', { params: params() }),
        api.get('/free-booking/pool/candidates', { params: params() }),
      ]),
      ([poolRes, candRes]) => {
        setPool(poolRes.data.data || [])
        setCandidates(candRes.data.data || [])
      },
      () => { setPool([]); setCandidates([]) },
      'Could not load the offer pool',
    )
  }, [ready, params, guarded])

  const loadOrders = useCallback(() => {
    if (!ready) return
    guarded(
      'orders',
      () => api.get('/free-booking/orders', { params: params() }),
      (res) => setOrders(res.data.data || []),
      () => setOrders([]),
      'Could not load free bookings',
    )
  }, [ready, params, guarded])

  useEffect(() => {
    if (tab === 'settings') loadSettings()
    if (tab === 'pool') loadPool()
    if (tab === 'bookings') loadOrders()
  }, [tab, loadSettings, loadPool, loadOrders])

  // One write at a time: a second click while a request is in flight is ignored.
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  async function runWrite(fn) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // Runs a mutation for the city selected right now. When the response arrives the admin may have switched
  // city: then nothing is reloaded and no success toast is shown (the other city's data is not what is on screen); failures always toast.
  async function mutate({ request, success, failMsg, reload, onSuccess }) {
    const sentCity = cityRef.current
    const sameCity = () => cityRef.current === sentCity
    try {
      await request()
      if (!sameCity()) return
      if (onSuccess) onSuccess()
      if (success) toastRef.current.success(success)
      if (reload) reload()
    } catch (err) {
      toastRef.current.error(errMsg(err, failMsg))
    }
  }

  function saveSettings(e) {
    e.preventDefault()
    return runWrite(() => mutate({
      request: () => api.put('/free-booking/settings', {
        ...params(),
        enabled: settings.enabled,
        offer_start: fromLocalInput(settings.offer_start),
        offer_end: fromLocalInput(settings.offer_end),
        referrals_required: Number(settings.referrals_required),
      }),
      success: 'Free Booking settings saved',
      failMsg: 'Could not save settings',
      reload: loadSettings,
    }))
  }

  function addToPool(e) {
    e.preventDefault()
    return runWrite(() => mutate({
      request: () => api.post('/free-booking/pool', { ...params(), ...addForm }),
      success: 'Driver added to the offer pool',
      failMsg: 'Could not add driver',
      onSuccess: () => setAddForm({ rider_id: '', valid_from: '', valid_to: '' }),
      reload: loadPool,
    }))
  }

  function togglePool(row) {
    return runWrite(() => mutate({
      request: () => api.put(`/free-booking/pool/${row.id}`, { ...params(), active: !row.active }),
      failMsg: 'Could not update',
      reload: loadPool,
    }))
  }

  function removePool(row) {
    if (busyRef.current) return
    if (!window.confirm('Remove this vehicle from the offer pool?')) return
    return runWrite(() => mutate({
      request: () => api.delete(`/free-booking/pool/${row.id}`, { params: params() }),
      success: 'Removed from the offer pool',
      failMsg: 'Could not remove',
      reload: loadPool,
    }))
  }

  function voidBooking(row) {
    if (busyRef.current) return
    if (!window.confirm('Void this free booking? The customer will not receive the wallet credit.')) return
    return runWrite(() => mutate({
      request: () => api.post(`/free-booking/orders/${row.id}/void`, { ...params() }),
      success: 'Free booking voided',
      failMsg: 'Could not void',
      reload: loadOrders,
    }))
  }

  // Customer lookup for the lock / unlock box: name, email or the full mobile number.
  useEffect(() => {
    const q = debouncedCust.trim()
    if (pickedCust || q.length < 2) { setCustResults([]); return undefined }
    let live = true
    api.get('/customers', { params: { search: q, limit: 8 } })
      .then((res) => { if (live) setCustResults(res.data?.data ?? []) })
      .catch(() => { if (live) setCustResults([]) })
    return () => { live = false }
  }, [debouncedCust, pickedCust])

  function setLock(locked) {
    const id = pickedCust?.id
    if (!Number.isInteger(id) || id <= 0) {
      toastRef.current.error('Search and select a customer first')
      return
    }
    return runWrite(() => mutate({
      request: () => api.post(`/free-booking/users/${id}/${locked ? 'lock' : 'unlock'}`, { ...params() }),
      success: `${pickedCust.name || 'Customer'} (#${id}) ${locked ? 'locked' : 'unlocked'}`,
      failMsg: 'Could not change the lock',
    }))
  }

  const busyStyle = busy ? { opacity: 0.5 } : {}

  // Not-yet-loaded user: render nothing rather than flash a wrong message.
  if (!user) return null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift size={22} style={{ color: 'var(--ink)' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>Free Booking Offer</h1>
        </div>
        {isSuper && (
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass} style={{ ...inputStyle, width: 220, marginTop: 0 }}>
            <option value="">Select a city…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ ...cardStyle, color: 'var(--ink)', opacity: tab === t.id ? 1 : 0.6 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!ready && (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          {isSuper ? 'Select a city to manage the offer.' : 'Your account is not assigned to a city. Ask a superadmin to assign one.'}
        </p>
      )}

      {ready && tab === 'settings' && (
        <form onSubmit={saveSettings} className="rounded-2xl border p-5 space-y-4 max-w-xl" style={cardStyle}>
          <label className="flex items-center gap-3 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" disabled={!canWrite} checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
            Free Booking Offer is {settings.enabled ? 'ON' : 'OFF'} for this city
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Offer starts">
              <input type="datetime-local" disabled={!canWrite} value={settings.offer_start} onChange={(e) => setSettings({ ...settings, offer_start: e.target.value })} className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Offer ends">
              <input type="datetime-local" disabled={!canWrite} value={settings.offer_end} onChange={(e) => setSettings({ ...settings, offer_end: e.target.value })} className={inputClass} style={inputStyle} />
            </Field>
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>The offer only applies between these two times, and only while it is ON.</p>
          <Field label="Referrals needed to unlock again">
            <input type="number" min="1" max="50" step="1" required disabled={!canWrite} value={settings.referrals_required} onChange={(e) => setSettings({ ...settings, referrals_required: e.target.value })} className={inputClass} style={inputStyle} />
          </Field>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>After a customer gets a free booking, the offer locks. They unlock it by completing this many successful referrals (counted after the lock). Default 1.</p>
          {canWrite && settingsLoaded && <button type="submit" disabled={busy} style={busyStyle} className="rounded-xl px-4 py-2 text-sm font-semibold text-white bg-emerald-600">Save</button>}
        </form>
      )}

      {ready && tab === 'pool' && (
        <div className="space-y-4">
          {canWrite && (
            <form onSubmit={addToPool} className="rounded-2xl border p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end" style={cardStyle}>
              <Field label="Driver / vehicle">
                <select required value={addForm.rider_id} onChange={(e) => setAddForm({ ...addForm, rider_id: e.target.value })} className={inputClass} style={inputStyle}>
                  <option value="">Select…</option>
                  {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.vehicle}{c.reg_num ? ` · ${c.reg_num}` : ''}</option>)}
                </select>
              </Field>
              <Field label="Valid from">
                <input type="date" required value={addForm.valid_from} onChange={(e) => setAddForm({ ...addForm, valid_from: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Valid to">
                <input type="date" required value={addForm.valid_to} onChange={(e) => setAddForm({ ...addForm, valid_to: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
              <button type="submit" disabled={busy} style={busyStyle} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 flex items-center justify-center gap-1"><Plus size={16} /> Add to pool</button>
            </form>
          )}
          <div className="rounded-2xl border overflow-x-auto" style={cardStyle}>
            <table className="w-full text-sm" style={{ color: 'var(--ink)' }}>
              <thead><tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                <th className="p-3">Driver</th><th className="p-3">Vehicle</th><th className="p-3">Valid</th><th className="p-3">Active</th><th className="p-3" />
              </tr></thead>
              <tbody>
                {pool.length === 0 && <tr><td className="p-3" colSpan={5}>No vehicles in the pool yet.</td></tr>}
                {pool.map((row) => (
                  <tr key={row.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3">{row.rider_name}</td>
                    <td className="p-3">{row.vehicle}{row.reg_num ? ` · ${row.reg_num}` : ''}</td>
                    <td className="p-3">{dateOnly(row.valid_from)} → {dateOnly(row.valid_to)}</td>
                    <td className="p-3"><input type="checkbox" disabled={!canWrite || busy} style={busyStyle} checked={row.active} onChange={() => togglePool(row)} /></td>
                    <td className="p-3 text-right">{canWrite && <button onClick={() => removePool(row)} disabled={busy} style={busyStyle} title="Remove from pool"><Trash2 size={16} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ready && tab === 'bookings' && (
        <div className="space-y-4">
          {canWrite && (
            <div className="rounded-2xl border p-5 flex flex-wrap items-end gap-3" style={cardStyle}>
              <Field label="Customer (manual lock / unlock)">
                {pickedCust ? (
                  <div className="mt-1 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm" style={{ ...inputStyle }}>
                    <span>{pickedCust.name || 'Customer'} · {pickedCust.mobile} · #{pickedCust.id}</span>
                    <button type="button" onClick={() => { setPickedCust(null); setCustSearch('') }} className="text-xs underline" style={{ color: 'var(--ink-muted)' }}>change</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input type="text" placeholder="Search name, email or full mobile number" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} className={inputClass} style={{ ...inputStyle, minWidth: 320 }} />
                    {custResults.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full rounded-xl border overflow-hidden shadow-lg" style={cardStyle}>
                        {custResults.map((c) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => { setPickedCust({ id: c.id, name: c.fname, mobile: c.mobile }); setCustResults([]) }} className="w-full text-left px-3.5 py-2 text-sm hover:opacity-80" style={{ color: 'var(--ink)' }}>
                              {c.fname || 'Customer'} · {c.mobile} · #{c.id}{c.city_name ? ` · ${c.city_name}` : ''}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Field>
              <button onClick={() => setLock(true)} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-semibold border flex items-center gap-1" style={{ color: 'var(--ink)', borderColor: 'var(--border)', ...busyStyle }}><Lock size={16} /> Lock</button>
              <button onClick={() => setLock(false)} disabled={busy} style={busyStyle} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 flex items-center gap-1"><Unlock size={16} /> Unlock</button>
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>If a free booking's payment settlement is waived, its refund is cancelled permanently, even if the settlement is changed later.</p>
          <div className="rounded-2xl border overflow-x-auto" style={cardStyle}>
            <table className="w-full text-sm" style={{ color: 'var(--ink)' }}>
              <thead><tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                <th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Status</th><th className="p-3">Fare</th><th className="p-3">Credit</th><th className="p-3">Reason</th><th className="p-3" />
              </tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td className="p-3" colSpan={7}>No free bookings yet.</td></tr>}
                {orders.map((o) => (
                  <tr key={o.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3">#{o.order_id}</td>
                    <td className="p-3">#{o.user_id}</td>
                    <td className="p-3">{o.status.replace('FREE_BOOKING_', '')}</td>
                    <td className="p-3">{o.actual_fare ?? '-'}</td>
                    <td className="p-3">{o.credit_amount ?? '-'}</td>
                    <td className="p-3">{o.not_eligible_reason ?? ''}</td>
                    <td className="p-3 text-right">
                      {canWrite && ['FREE_BOOKING_CONFIRMED', 'FREE_BOOKING_REWARD_PENDING'].includes(o.status) && (
                        <button onClick={() => voidBooking(o)} disabled={busy} style={busyStyle} title="Void this free booking"><Ban size={16} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
