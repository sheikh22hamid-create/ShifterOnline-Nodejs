import { useState, useEffect } from 'react'
import {
  CalendarClock,
  Plus,
  Clock,
  DollarSign,
  MapPin,
  Gauge,
  Users,
  X,
  BookOpen,
  Check,
  Ban,
  Navigation,
  Power,
} from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'

const TABS = [
  { id: 'plans', label: 'Plans' },
  { id: 'requests', label: 'Pending Requests' },
  { id: 'enrollments', label: "Today's Enrollments" },
  { id: 'force-assign', label: 'Force Assign' },
]

const EMPTY_PLAN_FORM = {
  plan_name: '',
  price: '1400',
  duty_start_time: '10:00:00',
  duty_end_time: '20:00:00',
  required_duty_hours: '10',
  free_km: '100',
  extra_km_rate: '10',
  shortfall_hourly_rate: '160',
  overtime_hourly_rate: '100',
  max_drivers: '5',
  assigned_zone_id: '',
  city: 'all',
  package_categories: 'all',
}

export default function DailyDrivers() {
  const toast = useToast()
  const [tab, setTab] = useState('plans')

  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [zones, setZones] = useState([])

  const [pendingRequests, setPendingRequests] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(false)

  const [enrollments, setEnrollments] = useState([])
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false)

  const [scheduledOrders, setScheduledOrders] = useState([])
  const [allRiders, setAllRiders] = useState([])
  const [forceAssignForm, setForceAssignForm] = useState({ order_id: '', rider_id: '' })
  const [forceAssignBusy, setForceAssignBusy] = useState(false)

  // Plan create/edit modal
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [editingPlanId, setEditingPlanId] = useState(null)
  const [planForm, setPlanForm] = useState(EMPTY_PLAN_FORM)

  // Ledger modal
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false)
  const [selectedLedgerRider, setSelectedLedgerRider] = useState(null)
  const [ledgerData, setLedgerData] = useState(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)

  useEffect(() => {
    fetchPlans()
    api.get('/service-zones').then((res) => setZones(res.data.data || [])).catch(() => {})
    api.get('/riders').then((res) => setAllRiders(res.data.data || res.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'requests') fetchPendingRequests()
    if (tab === 'enrollments') fetchEnrollments()
    if (tab === 'force-assign') fetchScheduledOrders()
  }, [tab])

  function fetchPlans() {
    setPlansLoading(true)
    api
      .get('/daily-driver/plans')
      .then((res) => setPlans(res.data.data || []))
      .catch((err) => console.error(err))
      .finally(() => setPlansLoading(false))
  }

  function fetchPendingRequests() {
    setRequestsLoading(true)
    api
      .get('/daily-driver/requests/pending')
      .then((res) => setPendingRequests(res.data.data || []))
      .catch((err) => console.error(err))
      .finally(() => setRequestsLoading(false))
  }

  function fetchEnrollments() {
    setEnrollmentsLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    api
      .get('/daily-driver/enrollments', { params: { date: today } })
      .then((res) => setEnrollments(res.data.data || []))
      .catch((err) => console.error(err))
      .finally(() => setEnrollmentsLoading(false))
  }

  function fetchScheduledOrders() {
    api
      .get('/daily-driver/scheduled-orders/pending')
      .then((res) => setScheduledOrders(res.data.data || []))
      .catch(() => {})
  }

  function riderName(riderId) {
    const r = allRiders.find((x) => x.id === riderId)
    if (!r) return `Driver #${riderId}`
    return r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || `Driver #${riderId}`
  }

  // --- Plan CRUD -----------------------------------------------------------

  function openCreatePlan() {
    setEditingPlanId(null)
    setPlanForm(EMPTY_PLAN_FORM)
    setPlanModalOpen(true)
  }

  function openEditPlan(plan) {
    setEditingPlanId(plan.id)
    setPlanForm({
      plan_name: plan.plan_name,
      price: String(plan.price),
      duty_start_time: plan.duty_start_time,
      duty_end_time: plan.duty_end_time,
      required_duty_hours: String(plan.required_duty_hours),
      free_km: String(plan.free_km),
      extra_km_rate: String(plan.extra_km_rate),
      shortfall_hourly_rate: String(plan.shortfall_hourly_rate),
      overtime_hourly_rate: String(plan.overtime_hourly_rate),
      max_drivers: String(plan.max_drivers),
      assigned_zone_id: plan.assigned_zone_id || '',
      city: plan.city,
      package_categories: plan.package_categories,
    })
    setPlanModalOpen(true)
  }

  async function handleSavePlan(e) {
    e.preventDefault()
    try {
      if (editingPlanId) {
        await api.put(`/daily-driver/plans/${editingPlanId}`, planForm)
        toast.success('Plan updated')
      } else {
        await api.post('/daily-driver/plans', planForm)
        toast.success('Daily Driver plan created')
      }
      setPlanModalOpen(false)
      fetchPlans()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save plan')
    }
  }

  async function togglePlanStatus(plan) {
    try {
      await api.post(`/daily-driver/plans/${plan.id}/status`, { status: !plan.status })
      fetchPlans()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update plan status')
    }
  }

  // --- Requests --------------------------------------------------------------

  async function approveRequest(id) {
    try {
      await api.post(`/daily-driver/requests/${id}/approve`)
      toast.success('Enrollment approved')
      fetchPendingRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve')
    }
  }

  async function rejectRequest(id) {
    try {
      await api.post(`/daily-driver/requests/${id}/reject`)
      toast.info('Enrollment rejected')
      fetchPendingRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject')
    }
  }

  // --- Force assign ------------------------------------------------------------

  async function handleForceAssign(e) {
    e.preventDefault()
    if (!forceAssignForm.order_id || !forceAssignForm.rider_id) return
    setForceAssignBusy(true)
    try {
      await api.post('/daily-driver/force-assign', forceAssignForm)
      toast.success('Order force-assigned to driver')
      setForceAssignForm({ order_id: '', rider_id: '' })
      fetchScheduledOrders()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to force-assign order')
    } finally {
      setForceAssignBusy(false)
    }
  }

  // --- Ledger ----------------------------------------------------------------

  function openLedger(riderId) {
    setSelectedLedgerRider(riderId)
    setLedgerModalOpen(true)
    setLedgerLoading(true)
    api
      .get(`/daily-driver/${riderId}/ledger`)
      .then((res) => setLedgerData(res.data.data))
      .catch((err) => console.error(err))
      .finally(() => setLedgerLoading(false))
  }

  const statusPill = (status) => {
    const map = {
      pending_approval: { bg: 'var(--warning-soft, #fef9e7)', color: '#a16207', label: 'Pending Approval' },
      enrolled: { bg: 'var(--info-soft, #eff4ff)', color: '#1d4ed8', label: 'Enrolled' },
      active: { bg: 'var(--success-soft, #ecfdf3)', color: '#15803d', label: 'Active' },
      settlement_pending: { bg: 'var(--warning-soft, #fef9e7)', color: '#a16207', label: 'Settlement Pending' },
      settlement_completed: { bg: 'var(--success-soft, #ecfdf3)', color: '#15803d', label: 'Settled' },
      rejected: { bg: 'var(--danger-soft, #fef2f2)', color: '#dc2626', label: 'Rejected' },
      cancelled: { bg: 'var(--danger-soft, #fef2f2)', color: '#dc2626', label: 'Cancelled' },
      completed: { bg: 'var(--info-soft, #eff4ff)', color: '#1d4ed8', label: 'Completed' },
    }
    const s = map[status] || { bg: 'var(--bg)', color: 'var(--ink-muted)', label: status }
    return (
      <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: s.bg, color: s.color }}>
        {s.label}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <CalendarClock className="text-emerald-600" />
            Daily Driver System
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Duty-time based daily plans - enrollment, capacity, settlement and ledger.
          </p>
        </div>

        {tab === 'plans' && (
          <button
            onClick={openCreatePlan}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
          >
            <Plus size={18} />
            Create Plan
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-sm font-semibold transition"
            style={{
              color: tab === t.id ? 'var(--ink)' : 'var(--ink-muted)',
              borderBottom: tab === t.id ? '2px solid #059669' : '2px solid transparent',
            }}
          >
            {t.label}
            {t.id === 'requests' && pendingRequests.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold w-4 h-4">
                {pendingRequests.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <PlansTab plans={plans} loading={plansLoading} onEdit={openEditPlan} onToggleStatus={togglePlanStatus} zones={zones} />
      )}

      {tab === 'requests' && (
        <RequestsTab
          requests={pendingRequests}
          loading={requestsLoading}
          riderName={riderName}
          onApprove={approveRequest}
          onReject={rejectRequest}
        />
      )}

      {tab === 'enrollments' && (
        <EnrollmentsTab
          enrollments={enrollments}
          loading={enrollmentsLoading}
          riderName={riderName}
          statusPill={statusPill}
          onOpenLedger={openLedger}
        />
      )}

      {tab === 'force-assign' && (
        <ForceAssignTab
          scheduledOrders={scheduledOrders}
          allRiders={allRiders}
          form={forceAssignForm}
          setForm={setForceAssignForm}
          onSubmit={handleForceAssign}
          busy={forceAssignBusy}
        />
      )}

      {/* PLAN CREATE/EDIT MODAL */}
      {planModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="rounded-2xl max-w-2xl w-full p-6 shadow-xl border max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
                {editingPlanId ? 'Edit Daily Driver Plan' : 'Create Daily Driver Plan'}
              </h2>
              <button onClick={() => setPlanModalOpen(false)} style={{ color: 'var(--ink-muted)' }} className="hover:opacity-80">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4">
              <Field label="Plan Name">
                <input
                  type="text"
                  required
                  value={planForm.plan_name}
                  onChange={(e) => setPlanForm({ ...planForm, plan_name: e.target.value })}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="e.g. Daily Pro"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Duty Start">
                  <input
                    type="time"
                    required
                    value={planForm.duty_start_time.slice(0, 5)}
                    onChange={(e) => setPlanForm({ ...planForm, duty_start_time: e.target.value + ':00' })}
                    className={inputClass}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Duty End">
                  <input
                    type="time"
                    required
                    value={planForm.duty_end_time.slice(0, 5)}
                    onChange={(e) => setPlanForm({ ...planForm, duty_end_time: e.target.value + ':00' })}
                    className={inputClass}
                    style={inputStyle}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Plan Price (₹/day)">
                  <input type="number" required value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
                <Field label="Required Duty Hours">
                  <input type="number" step="0.5" required value={planForm.required_duty_hours} onChange={(e) => setPlanForm({ ...planForm, required_duty_hours: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
                <Field label="Max Drivers">
                  <input type="number" required value={planForm.max_drivers} onChange={(e) => setPlanForm({ ...planForm, max_drivers: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Free KM">
                  <input type="number" required value={planForm.free_km} onChange={(e) => setPlanForm({ ...planForm, free_km: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
                <Field label="Extra KM Rate (₹/km)">
                  <input type="number" required value={planForm.extra_km_rate} onChange={(e) => setPlanForm({ ...planForm, extra_km_rate: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
                <Field label="Overtime Rate (₹/hr)">
                  <input type="number" required value={planForm.overtime_hourly_rate} onChange={(e) => setPlanForm({ ...planForm, overtime_hourly_rate: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
              </div>

              <Field label="Missing-Hour (Shortfall) Rate (₹/hr)">
                <input type="number" required value={planForm.shortfall_hourly_rate} onChange={(e) => setPlanForm({ ...planForm, shortfall_hourly_rate: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>

              <Field label="Assigned Service Zone (optional - restricts duty tracking to this geofence)">
                <select value={planForm.assigned_zone_id} onChange={(e) => setPlanForm({ ...planForm, assigned_zone_id: e.target.value })} className={inputClass} style={inputStyle}>
                  <option value="">-- No Zone Restriction (Any Location) --</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name} ({z.radius_km} km radius)</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="City (comma-separated ids, or 'all')">
                  <input type="text" value={planForm.city} onChange={(e) => setPlanForm({ ...planForm, city: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
                <Field label="Vehicle Categories (comma-separated, or 'all')">
                  <input type="text" value={planForm.package_categories} onChange={(e) => setPlanForm({ ...planForm, package_categories: e.target.value })} className={inputClass} style={inputStyle} />
                </Field>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPlanModalOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium hover:opacity-80" style={{ background: 'var(--bg)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>
                  Cancel
                </button>
                <button type="submit" className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm transition">
                  {editingPlanId ? 'Save Changes' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LEDGER MODAL */}
      {ledgerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="rounded-2xl max-w-3xl w-full p-6 shadow-2xl border max-h-[90vh] flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <BookOpen className="text-emerald-600" />
                Daily Driver Ledger: {riderName(selectedLedgerRider)}
              </h2>
              <button onClick={() => setLedgerModalOpen(false)} style={{ color: 'var(--ink-muted)' }} className="hover:opacity-80">
                <X size={20} />
              </button>
            </div>

            {ledgerLoading ? (
              <div className="flex justify-center py-10">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
              </div>
            ) : (
              <div className="overflow-y-auto space-y-4">
                {ledgerData?.summary && (
                  <div className="grid grid-cols-3 gap-3">
                    <SummaryCard label="Total Credits" value={ledgerData.summary.total_credits} tone="success" />
                    <SummaryCard label="Total Debits" value={ledgerData.summary.total_debits} tone="danger" />
                    <SummaryCard label="Net Balance" value={ledgerData.summary.net_balance} tone={ledgerData.summary.net_balance >= 0 ? 'success' : 'danger'} />
                  </div>
                )}

                {!ledgerData?.entries || ledgerData.entries.length === 0 ? (
                  <p className="text-center text-xs py-10" style={{ color: 'var(--ink-muted)' }}>No ledger entries found.</p>
                ) : (
                  <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                          <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Date</th>
                          <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Type</th>
                          <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Amount</th>
                          <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                        {ledgerData.entries.map((entry) => {
                          const isCredit = entry.balance_effect === 'CREDIT'
                          const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-'
                          return (
                            <tr key={entry.id}>
                              <td className="px-3.5 py-2.5 font-mono" style={{ color: 'var(--ink-muted)' }}>{dateStr}</td>
                              <td className="px-3.5 py-2.5" style={{ color: 'var(--ink)' }}>{entry.entry_type}</td>
                              <td className={`px-3.5 py-2.5 font-bold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {isCredit ? '+₹' : '-₹'}{Number(entry.amount).toLocaleString()}
                              </td>
                              <td className="px-3.5 py-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>{entry.notes || '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const inputClass = 'mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{label}</label>
      {children}
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const tones = {
    success: { bg: 'var(--success-soft, #ecfdf3)', color: '#15803d' },
    danger: { bg: 'var(--danger-soft, #fef2f2)', color: '#b91c1c' },
  }
  const t = tones[tone] || tones.success
  return (
    <div className="p-3.5 rounded-xl border" style={{ background: t.bg, borderColor: 'var(--border)' }}>
      <span className="text-[11px] font-semibold" style={{ color: t.color }}>{label}</span>
      <p className="text-lg font-bold mt-0.5" style={{ color: t.color }}>₹{Number(value).toLocaleString()}</p>
    </div>
  )
}

function PlansTab({ plans, loading, onEdit, onToggleStatus, zones }) {
  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }
  if (plans.length === 0) {
    return (
      <div className="rounded-2xl border p-12 text-center shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
        <CalendarClock size={40} className="mx-auto mb-3" style={{ color: 'var(--ink-faint)' }} />
        <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>No Daily Driver Plans Yet</h3>
        <p className="text-xs mt-1">Click "Create Plan" to set up your first Daily Driver plan.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {plans.map((p) => {
        const zone = zones.find((z) => z.id === p.assigned_zone_id)
        return (
          <div key={p.id} className="rounded-2xl border p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <div className="flex items-start justify-between">
                <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>{p.plan_name}</h3>
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: p.status ? 'var(--success-soft, #ecfdf3)' : 'var(--danger-soft, #fef2f2)', color: p.status ? '#15803d' : '#dc2626' }}
                >
                  {p.status ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>₹{Number(p.price).toLocaleString()}/day</p>

              <div className="mt-4 space-y-2 text-xs p-3.5 rounded-xl border" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
                <Row icon={<Clock size={14} className="text-blue-500" />} label="Duty" value={`${p.duty_start_time.slice(0, 5)} - ${p.duty_end_time.slice(0, 5)} (${p.required_duty_hours}h)`} />
                <Row icon={<DollarSign size={14} className="text-emerald-500" />} label="Shortfall Rate" value={`₹${p.shortfall_hourly_rate}/hr`} />
                <Row icon={<Gauge size={14} className="text-amber-500" />} label="Free KM / Extra" value={`${p.free_km} km / ₹${p.extra_km_rate}/km`} />
                <Row icon={<Users size={14} className="text-purple-500" />} label="Capacity" value={`${p.max_drivers} drivers`} />
                <Row icon={<MapPin size={14} className="text-orange-500" />} label="Zone" value={zone?.name || 'No restriction'} />
              </div>
            </div>

            <div className="mt-5 pt-4 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => onEdit(p)} className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-80 transition" style={{ background: 'var(--info-soft, #eff4ff)', color: '#1d4ed8' }}>
                Edit
              </button>
              <button
                onClick={() => onToggleStatus(p)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-85 transition"
                style={{ background: p.status ? 'var(--danger-soft, #fef2f2)' : 'var(--success-soft, #ecfdf3)', color: p.status ? '#dc2626' : '#15803d' }}
              >
                <Power size={13} />
                {p.status ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
      <span className="flex items-center gap-1.5 font-medium">{icon} {label}:</span>
      <span className="font-semibold" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  )
}

function RequestsTab({ requests, loading, riderName, onApprove, onReject }) {
  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }
  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border p-12 text-center shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
        No pending enrollment requests.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-2xl border p-4 shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{riderName(r.rider_id)}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {r.plan?.plan_name} - {new Date(r.enrollment_date).toLocaleDateString()} - requested {new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onApprove(r.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition">
              <Check size={14} /> Approve
            </button>
            <button onClick={() => onReject(r.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition">
              <Ban size={14} /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function EnrollmentsTab({ enrollments, loading, riderName, statusPill, onOpenLedger }) {
  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    )
  }
  if (enrollments.length === 0) {
    return (
      <div className="rounded-2xl border p-12 text-center shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
        No Daily Driver enrollments for today.
      </div>
    )
  }
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
            <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Driver</th>
            <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Plan</th>
            <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Status</th>
            <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Rides</th>
            <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Eligible / Final</th>
            <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}></th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {enrollments.map((e) => (
            <tr key={e.id}>
              <td className="px-3.5 py-2.5 font-semibold" style={{ color: 'var(--ink)' }}>{e.rider_name}</td>
              <td className="px-3.5 py-2.5" style={{ color: 'var(--ink)' }}>{e.plan?.plan_name}</td>
              <td className="px-3.5 py-2.5">{statusPill(e.status)}</td>
              <td className="px-3.5 py-2.5" style={{ color: 'var(--ink-muted)' }}>{e.duty_log?.rides_completed ?? '-'}</td>
              <td className="px-3.5 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                {e.duty_log ? `₹${Number(e.duty_log.eligible_plan_amount).toLocaleString()} / ₹${Number(e.duty_log.final_settlement_amount).toLocaleString()}` : '-'}
              </td>
              <td className="px-3.5 py-2.5">
                <button onClick={() => onOpenLedger(e.rider_id)} className="text-emerald-600 font-semibold hover:underline">
                  Ledger
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ForceAssignTab({ scheduledOrders, allRiders, form, setForm, onSubmit, busy }) {
  return (
    <div className="rounded-2xl border p-6 shadow-sm max-w-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <h3 className="text-sm font-bold flex items-center gap-2 mb-1" style={{ color: 'var(--ink)' }}>
        <Navigation size={16} className="text-emerald-600" />
        Force Assign Scheduled Booking
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Directly assigns a still-pending scheduled order to a specific driver, bypassing the normal priority/dispatch round. Any driver already offered this order loses their popup immediately.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Scheduled Order">
          <select required value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} className={inputClass} style={inputStyle}>
            <option value="">-- Select a pending scheduled order --</option>
            {scheduledOrders.map((o) => (
              <option key={o.id} value={o.id}>
                #{o.id} - {o.pick_name?.slice(0, 24)} to {o.drop_name?.slice(0, 24)} @ {o.schedule_date_time} (₹{o.total_dcharge})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Driver">
          <select required value={form.rider_id} onChange={(e) => setForm({ ...form, rider_id: e.target.value })} className={inputClass} style={inputStyle}>
            <option value="">-- Select driver --</option>
            {allRiders.map((r) => {
              const name = r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || `Driver #${r.id}`
              return <option key={r.id} value={r.id}>#{r.id} - {name}</option>
            })}
          </select>
        </Field>

        <button type="submit" disabled={busy} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50">
          {busy ? 'Assigning…' : 'Force Assign'}
        </button>
      </form>
    </div>
  )
}
