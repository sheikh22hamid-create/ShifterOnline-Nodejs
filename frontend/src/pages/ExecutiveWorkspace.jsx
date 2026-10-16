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

      {open && !summaryOnly && (
        <div className="mt-4 grid gap-4">
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
        <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>My Guarantee Cases</h1>
      </div>
      <div className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Find and assign a driver before the countdown ends. The deadline is fixed for the customer's guarantee and does not move when a case is reassigned.
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
