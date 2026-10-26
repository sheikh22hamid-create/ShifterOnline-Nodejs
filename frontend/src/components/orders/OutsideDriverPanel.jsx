import { useEffect, useState } from 'react'
import { PhoneCall, RefreshCw, UserSearch, Copy, UserPlus, CheckCircle2 } from 'lucide-react'
import api from '../../services/api'

// Shown until the partner's live list loads (or if it cannot be loaded).
const FALLBACK_VEHICLES = [
  { id: 97, name: '2 Wheeler' },
  { id: 133, name: 'Scooter' },
  { id: 1139, name: 'Mini 3W' },
  { id: 126, name: 'E Loader' },
  { id: 91, name: '3 Wheeler' },
  { id: 1, name: 'Tata Ace' },
]

// Starting choice from the order's category text (same rules as the backend's vehicleIdForCategory).
// null when the partner has no matching vehicle: the admin must pick one instead of getting a wrong default.
function guessVehicle(category) {
  const c = String(category || '').toLowerCase()
  if (/passenger/.test(c)) return null
  if (/e.?loader|electric|e.?rickshaw/.test(c)) return 126
  if (/mini/.test(c)) return 1139
  if (/scooter/.test(c)) return 133
  if (/bike|2.?w|two/.test(c)) return 97
  if (/\bace\b|4.?w|four/.test(c)) return 1
  if (/3.?w|three|tempo/.test(c)) return 91
  return null
}

const REASONS = {
  no_driver_found: 'No outside driver found right now.',
  timeout: 'The search took too long.',
  api_unreachable: 'Could not reach the driver search service.',
}

export default function OutsideDriverPanel({ order, onAssigned }) {
  const [vehicles, setVehicles] = useState(FALLBACK_VEHICLES)
  const [vehicleId, setVehicleId] = useState(() => guessVehicle(order?.category))
  const [busy, setBusy] = useState(false)
  const [driver, setDriver] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [copied, setCopied] = useState(false)
  const [trialOrders, setTrialOrders] = useState(1)
  const [registering, setRegistering] = useState(false)
  const [onboarded, setOnboarded] = useState(null) // { rider_id, kind, name, online }
  const [assigning, setAssigning] = useState(false)

  // The partner's own catalog, so every vehicle category they support is selectable.
  useEffect(() => {
    let cancelled = false
    api.get('/outside-driver/vehicles')
      .then((res) => {
        const list = res.data?.data
        if (!cancelled && Array.isArray(list) && list.length) {
          setVehicles(list)
          setVehicleId((cur) => (list.some((v) => v.id === cur) ? cur : null))
        }
      })
      .catch(() => { /* keep the fallback list */ })
    return () => { cancelled = true }
  }, [])

  // After onboarding, poll until the driver opens the app and goes online.
  useEffect(() => {
    if (!onboarded || onboarded.online) return undefined
    let stop = false
    const tick = async () => {
      try {
        const res = await api.get(`/orders/${order.id}/outside-driver/status`, { params: { rider_id: onboarded.rider_id } })
        if (!stop && res.data.data.online) setOnboarded((o) => (o ? { ...o, online: true } : o))
      } catch { /* transient; next tick retries */ }
    }
    const timer = setInterval(tick, 5000)
    return () => { stop = true; clearInterval(timer) }
  }, [onboarded, order.id])

  async function register() {
    setRegistering(true)
    setError('')
    try {
      const res = await api.post(`/orders/${order.id}/outside-driver/register`, {
        name: driver.name, mobile: driver.mobile, vehicle_number: driver.vehicle_number, trial_orders: trialOrders,
      })
      const d = res.data.data
      setOnboarded({ rider_id: d.rider_id, kind: d.kind, name: driver.name, online: d.online })
    } catch (err) {
      setError(err.response?.data?.message || 'Could not register this driver.')
    } finally {
      setRegistering(false)
    }
  }

  async function assignNow() {
    setAssigning(true)
    setError('')
    try {
      await api.post(`/orders/${order.id}/assign-rider`, { rider_id: onboarded.rider_id })
      onAssigned?.()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not assign this driver.')
    } finally {
      setAssigning(false)
    }
  }

  async function find() {
    setBusy(true)
    setError('')
    setNote('')
    setCopied(false)
    try {
      const res = await api.post(`/orders/${order.id}/outside-driver-lookup`, { vehicle_id: vehicleId }, { timeout: 100000 })
      const d = res.data.data
      setAttempts(d.attempts)
      setDriver(d.driver)
      if (!d.driver) setNote(REASONS[d.reason] || 'No outside driver found.')
      else if (d.repeat) setNote('The same driver came up again. Try a different vehicle type.')
    } catch (err) {
      setDriver(null)
      setError(err.response?.data?.message || 'Could not search for an outside driver.')
    } finally {
      setBusy(false)
    }
  }

  async function copyMobile() {
    try {
      await navigator.clipboard.writeText(driver.mobile)
      setCopied(true)
    } catch { /* clipboard blocked; the number is visible anyway */ }
  }

  const inputStyle = { borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--surface)' }
  const optionStyle = { background: 'var(--surface)', color: 'var(--ink)' }

  return (
    <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>No Shifter driver? Find an outside driver</div>
      <p className="mb-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
        Finds one nearby driver who is not on Shifter yet. Call them, get them to install the app, register them as a trial driver, then assign this order.
      </p>
      <div className="flex items-center gap-2">
        <select value={vehicleId ?? ''} onChange={(e) => setVehicleId(Number(e.target.value))} disabled={busy} className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-[12.5px]" style={inputStyle}>
          {vehicleId === null && <option value="" disabled style={optionStyle}>Select a vehicle type</option>}
          {vehicles.map((v) => <option key={v.id} value={v.id} style={optionStyle}>{v.name}{v.desc ? ` · ${v.desc}` : ''}</option>)}
        </select>
        <button
          type="button"
          onClick={find}
          disabled={busy || vehicleId === null}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          {driver || note ? <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> : <UserSearch size={13} />}
          {busy ? 'Searching…' : driver || note ? 'Try another' : 'Find outside driver'}
        </button>
      </div>
      {busy && <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Searching can take up to a minute. Keep this window open.</p>}
      {error && <p className="mt-2 text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      {!busy && note && <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{note}</p>}
      {!busy && driver && (
        <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{driver.name || 'Driver'}</div>
          <div className="font-mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {driver.mobile} · {driver.vehicle_number || 'no plate'}{driver.vehicle_name ? ` · ${driver.vehicle_name}` : ''}
          </div>
          {driver.fare ? <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Partner fare estimate ₹{driver.fare}</div> : null}
          <div className="mt-2 flex gap-2">
            <a href={`tel:${driver.mobile}`} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              <PhoneCall size={13} /> Call
            </a>
            <button type="button" onClick={copyMobile} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              <Copy size={13} /> {copied ? 'Copied' : 'Copy number'}
            </button>
          </div>
          {!onboarded && (
            <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
              <label className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }} htmlFor="trial-orders">Trial orders</label>
              <select id="trial-orders" value={trialOrders} onChange={(e) => setTrialOrders(Number(e.target.value))} disabled={registering} className="rounded-lg border px-2 py-1 text-[12.5px]" style={inputStyle}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n} style={optionStyle}>{n}</option>)}
              </select>
              <button type="button" onClick={register} disabled={registering} className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60" style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}>
                <UserPlus size={13} /> {registering ? 'Registering…' : 'Register as trial driver'}
              </button>
            </div>
          )}
        </div>
      )}
      {onboarded && (
        <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--brand)', background: 'var(--brand-soft)' }}>
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
            <CheckCircle2 size={14} /> {onboarded.name || 'Driver'} {onboarded.kind === 'already_on_shifter' ? 'is already a Shifter driver' : 'is registered as a trial driver'}
          </div>
          {onboarded.online ? (
            <button type="button" onClick={assignNow} disabled={assigning} className="mt-2 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {assigning ? 'Assigning…' : `Driver is online · Assign order #${order.id}`}
            </button>
          ) : (
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              Waiting for the driver to install the app, log in with this mobile number and go online. This updates by itself.
            </p>
          )}
        </div>
      )}
      {attempts > 0 && <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>Searches used for this order: {attempts}</p>}
    </div>
  )
}
