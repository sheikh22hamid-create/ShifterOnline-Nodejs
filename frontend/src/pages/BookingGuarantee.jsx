import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'
import { formatCurrency, formatDateTime } from '../utils/format'

const STATUS_LABEL = {
  open: 'Waiting for admin',
  resolved_assigned: 'Driver assigned',
  expired_compensated: 'Expired',
  cancelled: 'Cancelled',
}
const STATUS_TONE = { open: 'warning', resolved_assigned: 'success', expired_compensated: 'danger', cancelled: 'neutral' }
const EVENT_LABEL = {
  opened: 'Case opened', admin_alerted: 'Admins alerted', admin_assigned: 'Admin assigned a driver', driver_assigned: 'Driver assigned', trial_driver_auto_assigned: 'Trial Driver auto-assigned when online',
  customer_cancelled: 'Customer cancelled', admin_cancelled: 'Admin cancelled', expired: 'Window expired',
  wallet_credited: 'Compensation credited', refunds_processed: 'Refunds processed', order_already_closed: 'Order already closed',
}
const errMsg = (err, fallback) => err?.response?.data?.message || fallback

export default function BookingGuarantee() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { hasRole } = useAuth()
  const canWrite = hasRole('superadmin', 'admin')
  const isSuper = hasRole('superadmin')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [lockBusy, setLockBusy] = useState(false)

  const [minutes, setMinutes] = useState('')
  const [saving, setSaving] = useState(false)
  const [auditFor, setAuditFor] = useState(null)
  const [audit, setAudit] = useState([])

  const casesFetcher = useCallback(() => api.get('/booking-guarantee/cases', { params: { limit: 100 } }).then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(casesFetcher)
  const cases = data?.data ?? []
  useRealtimeSync(['admin:dispatch_alert', 'admin:order_status_update'], refetch)

  useEffect(() => {
    api.get('/booking-guarantee/settings')
      .then((res) => setMinutes(String(res.data?.data?.assign_minutes ?? '')))
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load settings')))
  }, [])

  // Debounced name / mobile search; the server scopes results to the admin's city.
  useEffect(() => {
    const q = customerQuery.trim()
    if (selectedCustomer || q.length < 2) {
      setCustomerResults([])
      setSearching(false)
      return undefined
    }
    let stale = false
    setSearching(true)
    const timer = setTimeout(() => {
      api.get('/booking-guarantee/customers', { params: { q } })
        .then((res) => { if (!stale) setCustomerResults(res.data?.data ?? []) })
        .catch((err) => { if (!stale) toastRef.current.error(errMsg(err, 'Could not search customers')) })
        .finally(() => { if (!stale) setSearching(false) })
    }, 300)
    return () => { stale = true; clearTimeout(timer) }
  }, [customerQuery, selectedCustomer])

  function pickCustomer(c) {
    setSelectedCustomer(c)
    setCustomerQuery('')
    setCustomerResults([])
  }

  async function save() {
    setSaving(true)
    try {
      const res = await api.put('/booking-guarantee/settings', { assign_minutes: minutes })
      setMinutes(String(res.data?.data?.assign_minutes ?? minutes))
      toastRef.current.success('Admin assignment time saved')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  async function setLock(locked) {
    if (!selectedCustomer) {
      toastRef.current.error('Search and select a customer first')
      return
    }
    setLockBusy(true)
    try {
      const res = await api.post(`/booking-guarantee/users/${selectedCustomer.id}/${locked ? 'lock' : 'unlock'}`)
      setSelectedCustomer((c) => (c ? { ...c, guarantee_locked: locked } : c))
      toastRef.current.success(res.data?.message || (locked ? 'Customer locked' : 'Customer unlocked'))
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not update the customer'))
    } finally {
      setLockBusy(false)
    }
  }

  async function openAudit(orderId) {
    setAuditFor(orderId)
    setAudit([])
    try {
      const res = await api.get(`/booking-guarantee/cases/${orderId}/audit`)
      setAudit(res.data?.data ?? [])
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not load history'))
    }
  }

  return (
    <div>
      <h1 className="flex items-center gap-2 text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        <ShieldCheck size={20} /> Booking Guarantee
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        When no driver is found in any model the customer switched on, the order is held for the time below so you can assign a driver. If none is assigned, the customer is compensated automatically.
      </p>

      <div className="surface-card mt-4 rounded-xl p-4">
        <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="assign_minutes">Default admin assignment time (minutes)</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="assign_minutes"
            type="number"
            min="1"
            max="1440"
            value={minutes}
            disabled={!isSuper}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-32 rounded-xl border px-3.5 py-2.5 text-sm outline-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
          {isSuper && (
            <button type="button" onClick={save} disabled={saving} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Used by cities that do not set their own time in Order Search System. Applies to new cases only; cases already open keep their own deadline.</p>
      </div>

      {canWrite && (
        <div className="surface-card mt-4 rounded-xl p-4">
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="lock_customer">Customer name</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="relative w-72 max-w-full">
              {selectedCustomer ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
                  <span className="truncate">
                    {selectedCustomer.name} · {selectedCustomer.mobile}
                    {' '}<Badge tone={selectedCustomer.guarantee_locked ? 'danger' : 'success'}>{selectedCustomer.guarantee_locked ? 'Locked' : 'Unlocked'}</Badge>
                  </span>
                  <button type="button" onClick={() => setSelectedCustomer(null)} className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }} aria-label="Change customer">Change</button>
                </div>
              ) : (
                <>
                  <input
                    id="lock_customer"
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    placeholder="Search by name or mobile number"
                    autoComplete="off"
                    className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                  {customerQuery.trim().length >= 2 && (
                    <ul className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto rounded-xl border text-[13px] shadow-lg" style={{ background: 'var(--surface, var(--bg))', borderColor: 'var(--border)', color: 'var(--ink)' }}>
                      {searching && <li className="px-3.5 py-2.5" style={{ color: 'var(--ink-faint)' }}>Searching…</li>}
                      {!searching && customerResults.length === 0 && <li className="px-3.5 py-2.5" style={{ color: 'var(--ink-faint)' }}>No customers found.</li>}
                      {!searching && customerResults.map((c) => (
                        <li key={c.id}>
                          <button type="button" onClick={() => pickCustomer(c)} className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left hover:opacity-80">
                            <span className="truncate">{c.name}</span>
                            <span className="font-mono-data shrink-0" style={{ color: 'var(--ink-muted)' }}>{c.mobile}{c.guarantee_locked ? ' · Locked' : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <button type="button" disabled={lockBusy || !selectedCustomer} onClick={() => setLock(true)} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Lock guarantee</button>
            <button type="button" disabled={lockBusy || !selectedCustomer} onClick={() => setLock(false)} className="rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>Unlock guarantee</button>
          </div>
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>A customer is locked automatically after a compensation and unlocked by the referrals set for the city. Use this only to override.</p>
        </div>
      )}

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order', 'Status', 'Compensation', 'Time left', 'Opened', 'Closed', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</td></tr>}
              {!loading && error && <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: 'var(--danger)' }}>{error}</td></tr>}
              {!loading && !error && cases.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--ink-faint)' }}>No guarantee cases yet.</td></tr>}
              {!loading && !error && cases.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink)' }}>#{c.order_id}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[c.status] || 'neutral'}>{STATUS_LABEL[c.status] || c.status}</Badge></td>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink)' }}>{formatCurrency(c.compensation_amount)}</td>
                  <td className="px-4 py-2.5">{c.status === 'open' ? <GuaranteeCountdown deadline={c.deadline_at} /> : '—'}</td>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(c.opened_at)}</td>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(c.closed_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => openAudit(c.order_id)} className="text-[12.5px] font-semibold" style={{ color: 'var(--brand)' }}>History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {auditFor && (
        <div className="surface-card mt-4 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>History · Order #{auditFor}</div>
            <button type="button" onClick={() => setAuditFor(null)} className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Close</button>
          </div>
          <ul className="mt-2 space-y-1 text-[13px]" style={{ color: 'var(--ink)' }}>
            {audit.map((e) => (
              <li key={e.id}>
                <span className="font-mono-data" style={{ color: 'var(--ink-faint)' }}>{formatDateTime(e.created_at)}</span>{' '}
                {EVENT_LABEL[e.event] || e.event}{e.admin_id ? ` (admin #${e.admin_id})` : ''}
              </li>
            ))}
            {audit.length === 0 && <li style={{ color: 'var(--ink-faint)' }}>No events.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
