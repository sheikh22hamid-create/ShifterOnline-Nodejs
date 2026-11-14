import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'
import DriverSourceTabs from '../components/orders/DriverSourceTabs'
import { formatDateTime } from '../utils/format'
import {
  ACTIONS,
  OUTCOMES,
  NOTE_MAX_LENGTH,
  buildActionBody,
  buildEscalateBody,
  groupActiveCases,
  validateAction,
} from '../utils/guaranteeActions'

const STATE_LABEL = { unassigned: 'Unassigned', assigned: 'New assignment', in_progress: 'In progress', escalated: 'Escalated' }
const STATE_TONE = { unassigned: 'neutral', assigned: 'info', in_progress: 'brand', escalated: 'danger' }
const CLOSED_LABEL = { resolved_assigned: 'Driver assigned', expired_compensated: 'Window expired', cancelled: 'Cancelled' }
const CLOSED_TONE = { resolved_assigned: 'success', expired_compensated: 'danger', cancelled: 'neutral' }
const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const inputStyle = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }
const inputClass = 'rounded-lg border px-3 py-2 text-[13px]'

const detailRow = 'flex justify-between gap-3 text-[13px]'

function formatTripDistance(order) {
  if (!order) return null
  if (order.trip_distance_text) {
    return {
      text: order.trip_distance_text,
      kind: order.trip_distance_kind || 'road',
    }
  }
  const dist = Number(order.distance)
  if (Number.isFinite(dist) && dist > 0) {
    const formatted = dist % 1 === 0 ? dist.toFixed(1) : dist.toFixed(2)
    return {
      text: `${formatted} KM`,
      kind: 'road',
    }
  }
  return null
}

function OrderDetailsSection({ order, orderId, blockStyle }) {
  const distInfo = formatTripDistance(order)
  return (
    <div className="grid gap-2 rounded-lg border p-3" style={blockStyle}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Order Details</div>
        <div className="text-[14px] font-bold" style={{ color: 'var(--ink)' }}>#{orderId}</div>
      </div>

      {/* Pickup Location */}
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
        <span className="font-semibold text-[12px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Pickup</span>
        <div className="text-right max-w-[70%]">
          {order?.pickup_title ? (
            <div className="text-[13px] font-bold leading-snug" style={{ color: 'var(--ink)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-wider mr-1 opacity-70">Main Area:</span>
              {order.pickup_title}
            </div>
          ) : null}
          <div className="text-[12.5px] leading-snug mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {order?.pickup_title && <span className="text-[11px] mr-1 opacity-70">Address:</span>}
            {order?.paddress || '—'}
          </div>
          {order?.pick_name && <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>{order.pick_name}</span>}
        </div>
      </div>

      {/* Extra Stops */}
      {order?.stops?.map((stop, i) => (
        <div key={stop.sequence ?? i} className={detailRow} style={{ color: 'var(--ink-muted)' }}>
          <span className="font-semibold text-[12px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Stop {i + 1}</span>
          <div className="text-right max-w-[70%]">
            <span className="text-[12.5px] leading-snug">{stop.address || stop.landmark || '—'}</span>
            {stop.contact_name && <span className="block text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{stop.contact_name}</span>}
          </div>
        </div>
      ))}

      {/* Drop Location */}
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
        <span className="font-semibold text-[12px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Drop</span>
        <div className="text-right max-w-[70%]">
          {order?.drop_title ? (
            <div className="text-[13px] font-bold leading-snug" style={{ color: 'var(--ink)' }}>
              <span className="text-[11px] font-semibold uppercase tracking-wider mr-1 opacity-70">Main Area:</span>
              {order.drop_title}
            </div>
          ) : null}
          <div className="text-[12.5px] leading-snug mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {order?.drop_title && <span className="text-[11px] mr-1 opacity-70">Address:</span>}
            {order?.daddress || '—'}
          </div>
          {order?.drop_name && <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>{order.drop_name}</span>}
        </div>
      </div>

      {/* Total Trip Distance */}
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
        <span className="font-semibold text-[12px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Trip Distance</span>
        <div className="text-right">
          {distInfo ? (
            <>
              <span className="inline-block font-mono-data text-[13px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--brand-soft, rgba(37,99,235,0.08))', color: 'var(--brand, #2563eb)' }}>
                {distInfo.text}
              </span>
              <span className="block text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                {distInfo.kind === 'straight_line' ? 'Straight-line distance' : 'Road route distance'}
              </span>
            </>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Distance unavailable</span>
          )}
        </div>
      </div>

      {/* Vehicle & Fare */}
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
        <span className="font-semibold text-[12px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Vehicle</span>
        <span>{order?.category || '—'}</span>
      </div>
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
        <span className="font-semibold text-[12px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Fare</span>
        <span className="font-mono-data font-semibold">{order?.fare != null ? `₹${order.fare}` : '—'}</span>
      </div>
    </div>
  )
}

function DriverDetailsSection({ driver, title = 'Driver', blockStyle, onRefreshDistance, refreshing }) {
  if (!driver) return null
  const online = Boolean(driver.online)
  return (
    <div className="grid gap-1 rounded-lg border p-3" style={blockStyle}>
      <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{title}</div>
      <div className="text-[14px] font-bold" style={{ color: 'var(--ink)' }}>{driver.name || 'Driver'}</div>
      {driver.mobile && (
        <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
          <span>Mobile</span>
          <a href={`tel:${driver.mobile}`} className="font-mono-data" style={{ color: 'var(--brand)' }}>{driver.mobile}</a>
        </div>
      )}
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}><span>Vehicle</span><span>{driver.vehicle_name || '—'}</span></div>
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}><span>Vehicle number</span><span className="font-mono-data">{driver.vehicle_number || 'not available'}</span></div>
      {driver.distance !== undefined && (
        <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
          <span>Driver Distance from Pickup</span>
          <span className="text-right">
            {driver.distance ? (
              <>
                <b className="font-mono-data" style={{ color: 'var(--ink)' }}>{driver.distance.approximate ? '≈ ' : ''}{driver.distance.text}</b>
                <span className="block text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                  {driver.distance.kind === 'road' ? 'Road distance' : 'Straight-line distance'}
                  {driver.distance.approximate ? ' · approximate location' : ''}
                  {' · '}{driver.distance.source === 'shifter_app' ? "from driver's app" : 'from search platform'}
                  {driver.distance.computed_at ? ` · ${formatDateTime(driver.distance.computed_at)}` : ''}
                </span>
              </>
            ) : <span style={{ color: 'var(--ink-faint)' }}>Distance unavailable</span>}
            {onRefreshDistance && (
              <button type="button" onClick={onRefreshDistance} disabled={refreshing} className="ml-2 text-[12px] font-semibold underline" style={{ color: 'var(--brand)' }}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </span>
        </div>
      )}
      {driver.already_registered != null && (
        <div className="text-[12.5px] font-semibold" style={{ color: driver.already_registered ? 'var(--success)' : 'var(--ink-muted)' }}>
          {driver.already_registered ? 'This driver is already registered with platform.' : 'Not Registered'}
        </div>
      )}
      <div className={detailRow} style={{ color: 'var(--ink-muted)' }}>
        <span>Status</span>
        <Badge tone={online ? 'success' : 'warning'}>{online ? 'Online' : `${title} · offline`}</Badge>
      </div>
    </div>
  )
}

// The Trial Driver the bot found, with the order, on one screen: the executive decides assign or reject here.
function TrialDriverOffer({ c, onChanged }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [confirming, setConfirming] = useState(null) // 'assign' | 'reject'
  const [reason, setReason] = useState('')
  const cand = c.candidate
  const order = c.order
  const online = Boolean(cand?.online)

  // The driver installs the app and goes online after the executive's call: keep checking until they do.
  useEffect(() => {
    if (online) return undefined
    const timer = setInterval(onChanged, 5000)
    return () => clearInterval(timer)
  }, [online, onChanged])

  const assign = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/orders/${c.order_id}/assign-rider`, { rider_id: cand.rider_id })
      toastRef.current.success(`Order #${c.order_id} assigned to ${cand.name || 'the driver'}`)
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not assign the driver'))
    } finally { setBusy(false); setConfirming(null); onChanged() }
  }

  // The driver's location changes (they may start moving or open the app): re-measure on demand.
  const refreshDistance = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await api.post(`/booking-guarantee/exec/cases/${c.order_id}/candidate/refresh-distance`)
      if (!res.data?.data?.distance) toastRef.current.info?.(res.data?.data?.reason || 'No reliable driver location is available yet')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not refresh the distance'))
    } finally { setRefreshing(false); onChanged() }
  }

  const reject = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/booking-guarantee/exec/cases/${c.order_id}/candidate/reject`, reason.trim() ? { reason: reason.trim() } : {})
      toastRef.current.success('Driver rejected. Searching for the next one')
      setReason('')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not reject the driver'))
    } finally { setBusy(false); setConfirming(null); onChanged() }
  }

  const block = { borderColor: 'var(--border)', background: 'var(--bg)' }
  return (
    <div className="mt-3 grid gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--brand)' }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <DriverDetailsSection
          driver={cand}
          title="Trial driver"
          blockStyle={block}
          onRefreshDistance={refreshDistance}
          refreshing={refreshing}
        />
        <OrderDetailsSection
          order={order}
          orderId={c.order_id}
          blockStyle={block}
        />
      </div>
      {!online && (
        <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Call the driver. They must install the Shifter app and go online with this mobile number. The order is assigned to them automatically the moment they go online; this page updates by itself.
        </p>
      )}
      {confirming === 'assign' && (
        <div className="rounded-lg border p-3 text-[13px]" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)', color: 'var(--ink)' }}>
          Assign order #{c.order_id} to <b>{cand.name || 'this driver'}</b>? This takes effect immediately and closes the guarantee case.
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={assign} className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Confirm assign</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Back</button>
          </div>
        </div>
      )}
      {confirming === 'reject' && (
        <div className="grid gap-2 rounded-lg border p-3 text-[13px]" style={{ borderColor: 'var(--danger)', color: 'var(--ink)' }}>
          Not convinced about {cand.name || 'this driver'}? You become free at once and the next driver is searched automatically. This driver is not offered again for this order.
          <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason (optional)" className={inputClass} style={inputStyle} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={reject} className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: 'var(--danger)', color: '#fff' }}>Confirm reject</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Back</button>
          </div>
        </div>
      )}
      {!confirming && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !online} onClick={() => setConfirming('assign')} title={online ? undefined : 'Available once the driver is online'} className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Assign Order to Driver</button>
          <button type="button" disabled={busy} onClick={() => setConfirming('reject')} className="rounded-lg border px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Not Convinced / Do Not Assign</button>
        </div>
      )}
    </div>
  )
}

function CaseCard({ c, onChanged, readOnly, summaryOnly }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [type, setType] = useState('search_started')
  const [outcome, setOutcome] = useState('agreed')
  const [note, setNote] = useState('')
  const [driverId, setDriverId] = useState('')
  const [busy, setBusy] = useState(false)
  const [riders, setRiders] = useState([])
  const [dailyRiders, setDailyRiders] = useState([])
  const [riderSource, setRiderSource] = useState('all')
  const [riderQuery, setRiderQuery] = useState('')
  const [confirmRider, setConfirmRider] = useState(null)
  const [unavailable, setUnavailable] = useState(false)

  const loadDetail = useCallback(async () => {
    try {
      const res = await api.get(`/booking-guarantee/exec/cases/${c.order_id}`)
      setDetail(res.data?.data)
      setUnavailable(false)
    } catch (err) {
      if (err?.response?.status === 404) {
        setUnavailable(true)
        return
      }
      toastRef.current.error(errMsg(err, 'Could not load the case'))
    }
  }, [c.order_id])

  const toggle = async () => {
    if (summaryOnly) return
    const next = !open
    setOpen(next)
    if (next) {
      loadDetail()
      if (!readOnly && riders.length === 0) {
        try {
          // GET /riders responds { success, meta, total, data: [ ...riders ] }
          const res = await api.get('/riders', { params: { status: 1, a_status: 1 } })
          setRiders(Array.isArray(res.data?.data) ? res.data.data : [])
        } catch (err) {
          toastRef.current.error(errMsg(err, 'Could not load drivers'))
        }
        // Available Daily Drivers for this case's order (powers the Daily Drivers filter). Best effort:
        // if it cannot load, the picker simply stays on all drivers.
        try {
          const dailyRes = await api.get(`/orders/${c.order_id}/daily-drivers`)
          const dailyData = dailyRes.data?.data
          setDailyRiders(dailyData?.applicable && Array.isArray(dailyData.drivers) ? dailyData.drivers : [])
        } catch {
          setDailyRiders([])
        }
      }
    }
  }

  const submitAction = async (e) => {
    e.preventDefault()
    if (busy) return
    const problem = validateAction({ type, outcome, note, driverId })
    if (problem) { toastRef.current.error(problem); return }
    setBusy(true)
    try {
      await api.post(`/booking-guarantee/exec/cases/${c.order_id}/actions`, buildActionBody({ type, outcome, note, driverId }))
      toastRef.current.success('Action recorded')
      setNote('')
      await loadDetail()
      onChanged()
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not record the action'))
    } finally { setBusy(false) }
  }

  const escalate = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/booking-guarantee/exec/cases/${c.order_id}/actions`, buildEscalateBody(note))
      toastRef.current.success('Supervisors alerted')
      setNote('')
      await loadDetail()
      onChanged()
    } catch (err) { toastRef.current.error(errMsg(err, 'Could not escalate')) } finally { setBusy(false) }
  }

  const assign = async () => {
    if (busy || !confirmRider) return
    setBusy(true)
    try {
      await api.post(`/orders/${c.order_id}/assign-rider`, { rider_id: confirmRider.id })
      toastRef.current.success(`Driver assigned to order #${c.order_id}`)
      setConfirmRider(null)
      onChanged()
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not assign the driver'))
      setConfirmRider(null)
      onChanged()
    } finally { setBusy(false) }
  }

  const filteredRiders = useMemo(() => {
    const q = riderQuery.trim().toLowerCase()
    const pool = riderSource === 'daily' ? dailyRiders : riders
    const list = q ? pool.filter((r) => `${r.full_name ?? ''} ${r.fmobile ?? ''} ${r.vehicle_no ?? ''}`.toLowerCase().includes(q)) : pool
    return list.slice(0, 8)
  }, [riders, dailyRiders, riderSource, riderQuery])

  const isOpen = c.status === 'open'
  const hasTrialOffer = isOpen && !readOnly && !summaryOnly && Boolean(c.candidate)
  const order = detail?.order || c.order
  const assignedDriver = detail?.assigned_driver || c.assigned_driver
  const block = { borderColor: 'var(--border)', background: 'var(--bg)' }

  return (
    <div className="rounded-2xl border p-4" style={{ background: 'var(--surface)', borderColor: c.queue_state === 'escalated' ? 'var(--danger)' : 'var(--border)' }}>
      <button type="button" onClick={toggle} aria-expanded={summaryOnly ? undefined : open} disabled={summaryOnly} className={`flex w-full flex-wrap items-center gap-3 text-left${summaryOnly ? ' cursor-default' : ''}`}>
        <span className="font-mono-data text-[14px] font-bold" style={{ color: 'var(--ink)' }}>Order #{c.order_id}</span>
        {isOpen
          ? <Badge tone={STATE_TONE[c.queue_state] ?? 'neutral'}>{STATE_LABEL[c.queue_state] ?? c.queue_state}</Badge>
          : <Badge tone={CLOSED_TONE[c.status] ?? 'neutral'}>{CLOSED_LABEL[c.status] ?? c.status}</Badge>}
        {isOpen && <span className="ml-auto text-[13px]" style={{ color: 'var(--ink-muted)' }}>Time left <GuaranteeCountdown deadline={c.deadline_at} /></span>}
      </button>
      <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
        Window opened {formatDateTime(c.opened_at)} · deadline {formatDateTime(c.deadline_at)}
        {c.first_action_at ? ` · first action ${formatDateTime(c.first_action_at)}` : ' · no action yet'}
      </div>

      {hasTrialOffer && <TrialDriverOffer c={c} onChanged={onChanged} />}

      {open && !summaryOnly && (
        <div className="mt-4 grid gap-4">
          {!hasTrialOffer && (order || assignedDriver) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {assignedDriver ? (
                <DriverDetailsSection driver={assignedDriver} title="Assigned driver" blockStyle={block} />
              ) : null}
              {order ? (
                <OrderDetailsSection order={order} orderId={c.order_id} blockStyle={block} />
              ) : null}
            </div>
          )}

          {isOpen && !readOnly && (
            <>
              <form onSubmit={submitAction} className="grid gap-2">
                <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Record what you did</div>
                <select aria-label="Action type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass} style={inputStyle}>
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                {type === 'contact_outcome' && (
                  <select aria-label="Contact outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass} style={inputStyle}>
                    {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {(type === 'driver_contacted' || type === 'contact_outcome') && (
                  <input aria-label="Driver id" type="number" min="1" step="1" value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="Driver id (optional)" className={inputClass} style={inputStyle} />
                )}
                <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX_LENGTH} rows={2} placeholder="Note (no phone numbers or personal details)" className={inputClass} style={inputStyle} />
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Record</button>
                  <button type="button" disabled={busy} onClick={escalate} className="rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Escalate to supervisor</button>
                </div>
              </form>

              <div className="grid gap-2">
                <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Assign a driver (online, approved, your city)</div>
                {dailyRiders.length > 0 && (
                  <DriverSourceTabs value={riderSource} onChange={setRiderSource} dailyCount={dailyRiders.length} />
                )}
                <input aria-label="Search drivers" value={riderQuery} onChange={(e) => setRiderQuery(e.target.value)} placeholder="Search name, mobile or vehicle number" className={inputClass} style={inputStyle} />
                {filteredRiders.map((r) => (
                  <button key={r.id} type="button" disabled={busy} onClick={() => setConfirmRider(r)} className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                    <span>{r.full_name} · {r.vehicle_no}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>Select</span>
                  </button>
                ))}
                {confirmRider && (
                  <div className="rounded-lg border p-3 text-[13px]" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)', color: 'var(--ink)' }}>
                    Assign <b>{confirmRider.full_name}</b> to order #{c.order_id}? This takes effect immediately and closes the guarantee case.
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy} onClick={assign} className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Confirm assign</button>
                      <button type="button" disabled={busy} onClick={() => setConfirmRider(null)} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <div className="mb-1 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Contact and action history</div>
            {unavailable && <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>This case is no longer available to you.</div>}
            {!detail && !unavailable && <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}
            {detail?.actions?.length === 0 && <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Nothing recorded yet.</div>}
            {detail?.actions?.filter((a) => a.type !== 'viewed').map((a) => (
              <div key={a.id} className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {formatDateTime(a.created_at)} · {a.type.replace(/_/g, ' ')}{a.result ? ` (${a.result})` : ''}{a.driver_id ? ` · driver #${a.driver_id}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, tone, items, onChanged, readOnly, summaryOnly }) {
  if (!items.length) return null
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--ink)' }}>{title} <Badge tone={tone}>{items.length}</Badge></div>
      {items.map((c) => <CaseCard key={c.id} c={c} onChanged={onChanged} readOnly={readOnly} summaryOnly={summaryOnly} />)}
    </section>
  )
}

export default function ExecutiveWorkspace() {
  const fetcher = useCallback(() => api.get('/booking-guarantee/exec/my-cases').then((res) => res.data?.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(['admin:dispatch_alert', 'admin:order_status_update'], refetch, { fallbackInterval: 15000 })

  const active = data?.active ?? []
  const { escalated, fresh, working } = groupActiveCases(active)

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <ClipboardList size={20} style={{ color: 'var(--brand)' }} />
        <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>New Ride Trial Driver</h1>
      </div>
      <div className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Review the Trial Driver and the order, then assign or reject before the countdown ends. The deadline is fixed for the customer's guarantee and does not move when a case is reassigned.
      </div>
      {loading && !data && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}
      {error && <div className="text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      {!loading && !error && active.length === 0 && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>No active cases assigned to you.</div>}
      <Section title="Escalated" tone="danger" items={escalated} onChanged={refetch} />
      <Section title="New assignments" tone="info" items={fresh} onChanged={refetch} />
      <Section title="In progress" tone="brand" items={working} onChanged={refetch} />
      <Section title="Taken away from me (last 24 h)" tone="neutral" items={data?.reassigned ?? []} onChanged={refetch} readOnly summaryOnly />
      <Section title="Completed (last 24 h)" tone="success" items={data?.recent ?? []} onChanged={refetch} readOnly />
    </div>
  )
}
