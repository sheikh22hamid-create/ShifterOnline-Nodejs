import { useState, useEffect } from 'react'
import {
  UserCheck,
  Plus,
  Clock,
  DollarSign,
  MapPin,
  ListOrdered,
  Search,
  ShieldCheck,
  X,
  Trash2,
  BookOpen,
  TrendingUp,
} from 'lucide-react'
import api from '../services/api'

export default function MonthlyDrivers() {
  const [drivers, setDrivers] = useState([])
  const [allRiders, setAllRiders] = useState([])
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Promotion Modal
  const [promoteModalOpen, setPromoteModalOpen] = useState(false)
  const [promoteForm, setPromoteForm] = useState({
    rider_id: '',
    assigned_zone_id: '',
    shift_start_time: '10:00:00',
    shift_end_time: '20:00:00',
    target_shift_hours: '10',
    monthly_base_salary: '15000',
    overtime_hourly_rate: '50',
    allowed_break_minutes: '45',
  })

  // Queue Modal
  const [queueModalOpen, setQueueModalOpen] = useState(false)
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [driverQueue, setDriverQueue] = useState([])
  const [availableOrders, setAvailableOrders] = useState([])
  const [assignOrderId, setAssignOrderId] = useState('')

  // Ledger Modal
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false)
  const [selectedLedgerDriver, setSelectedLedgerDriver] = useState(null)
  const [ledgerData, setLedgerData] = useState(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerStartDate, setLedgerStartDate] = useState('')
  const [ledgerEndDate, setLedgerEndDate] = useState('')

  // Ledger Adjustment Form
  const [showAdjForm, setShowAdjForm] = useState(false)
  const [adjForm, setAdjForm] = useState({
    entry_type: 'CASH_DEPOSIT',
    amount: '',
    balance_effect: 'CREDIT',
    notes: '',
  })

  useEffect(() => {
    fetchMonthlyDrivers()
    fetchRidersAndZones()
  }, [])

  function fetchMonthlyDrivers() {
    setLoading(true)
    api
      .get('/monthly-drivers')
      .then((res) => setDrivers(res.data.data || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false))
  }

  function fetchRidersAndZones() {
    api.get('/riders').then((res) => setAllRiders(res.data.data || res.data || [])).catch(() => {})
    api.get('/service-zones').then((res) => setZones(res.data.data || [])).catch(() => {})
  }

  async function handlePromote(e) {
    e.preventDefault()
    try {
      await api.post('/monthly-drivers/promote', promoteForm)
      setPromoteModalOpen(false)
      fetchMonthlyDrivers()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to promote driver')
    }
  }

  async function handleDemote(riderId) {
    if (!window.confirm('Are you sure you want to revert this driver back to freelance?')) return
    try {
      await api.post('/monthly-drivers/demote', { rider_id: riderId })
      fetchMonthlyDrivers()
    } catch (err) {
      alert('Failed to demote driver')
    }
  }

  // Queue Actions
  async function openQueueModal(driver) {
    setSelectedDriver(driver)
    setQueueModalOpen(true)
    fetchQueue(driver.rider_id)

    api.get('/orders', { params: { status: 'Pending' } }).then((res) => {
      setAvailableOrders(res.data.data || res.data?.orders || [])
    }).catch(() => {})
  }

  function fetchQueue(riderId) {
    api
      .get(`/monthly-drivers/${riderId}/queue`)
      .then((res) => setDriverQueue(res.data.data || []))
      .catch(() => {})
  }

  async function handleAssignOrderToQueue(e) {
    e.preventDefault()
    if (!assignOrderId) return
    try {
      await api.post('/monthly-drivers/queue/assign', {
        order_id: assignOrderId,
        rider_id: selectedDriver.rider_id,
        position: 'end',
      })
      setAssignOrderId('')
      fetchQueue(selectedDriver.rider_id)
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to assign order to queue')
    }
  }

  async function handleRemoveFromQueue(queueId) {
    try {
      await api.delete(`/monthly-drivers/queue/${queueId}`)
      fetchQueue(selectedDriver.rider_id)
    } catch (err) {
      alert('Failed to remove from queue')
    }
  }

  // Ledger Actions
  function openLedgerModal(driver) {
    setSelectedLedgerDriver(driver)
    setLedgerModalOpen(true)
    setShowAdjForm(false)
    fetchLedger(driver.rider_id)
  }

  function fetchLedger(riderId) {
    setLedgerLoading(true)
    const params = {}
    if (ledgerStartDate) params.start_date = ledgerStartDate
    if (ledgerEndDate) params.end_date = ledgerEndDate

    api
      .get(`/monthly-drivers/${riderId}/ledger`, { params })
      .then((res) => setLedgerData(res.data.data))
      .catch((err) => console.error(err))
      .finally(() => setLedgerLoading(false))
  }

  async function handleAddAdjustment(e) {
    e.preventDefault()
    if (!adjForm.amount || !selectedLedgerDriver) return

    try {
      await api.post(`/monthly-drivers/${selectedLedgerDriver.rider_id}/ledger-adjustment`, {
        ...adjForm,
        rider_id: selectedLedgerDriver.rider_id,
      })
      setAdjForm({
        entry_type: 'CASH_DEPOSIT',
        amount: '',
        balance_effect: 'CREDIT',
        notes: '',
      })
      setShowAdjForm(false)
      fetchLedger(selectedLedgerDriver.rider_id)
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to record ledger entry')
    }
  }

  const filtered = drivers.filter((d) => {
    const name = d.rider?.full_name || d.rider?.title || `Driver #${d.rider_id}`
    const phone = d.rider?.fmobile || d.rider?.mobile || ''
    const q = search.toLowerCase()
    return name.toLowerCase().includes(q) || phone.toLowerCase().includes(q) || String(d.rider_id).includes(q)
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <UserCheck className="text-emerald-600" />
            Monthly Dedicated Drivers
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Manage salaried drivers, shift overtime rates, cash collections, ledger balances, and order queues.
          </p>
        </div>

        <button
          onClick={() => {
            setPromoteForm({
              rider_id: allRiders[0]?.id || '',
              assigned_zone_id: zones[0]?.id || '',
              shift_start_time: '10:00:00',
              shift_end_time: '20:00:00',
              target_shift_hours: '10',
              monthly_base_salary: '15000',
              overtime_hourly_rate: '50',
              allowed_break_minutes: '45',
            })
            setPromoteModalOpen(true)
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
        >
          <Plus size={18} />
          Promote Driver to Monthly
        </button>
      </div>

      <div
        className="flex items-center gap-3 p-3 rounded-2xl border shadow-sm"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Search size={18} style={{ color: 'var(--ink-faint)' }} className="ml-2" />
        <input
          type="text"
          placeholder="Search monthly driver by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl border p-12 text-center shadow-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        >
          <UserCheck size={40} className="mx-auto mb-3" style={{ color: 'var(--ink-faint)' }} />
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>No Monthly Drivers Configured</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>Click "Promote Driver to Monthly" to assign fixed shifts and guaranteed salaries.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="rounded-2xl border p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                      {d.rider?.full_name || d.rider?.title || `Driver #${d.rider_id}`}
                    </h3>
                    <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      📱 {d.rider?.fmobile || d.rider?.mobile || 'No Phone'} • {d.rider?.vehicle || 'Bike'}
                    </p>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: 'var(--success-soft, #ecfdf3)', color: 'var(--success, #15803d)' }}
                  >
                    <ShieldCheck size={12} />
                    Monthly Active
                  </span>
                </div>

                <div
                  className="mt-4 space-y-2 text-xs p-3.5 rounded-xl border"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock size={14} className="text-blue-500" /> Duty Shift:
                    </span>
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                      {d.shift_start_time.slice(0, 5)} - {d.shift_end_time.slice(0, 5)} ({d.target_shift_hours}h)
                    </span>
                  </div>

                  <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
                    <span className="flex items-center gap-1.5 font-medium">
                      <DollarSign size={14} className="text-emerald-500" /> Base Salary:
                    </span>
                    <span className="font-bold text-emerald-600">₹{d.monthly_base_salary.toLocaleString()} / mo</span>
                  </div>

                  <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
                    <span className="flex items-center gap-1.5 font-medium">
                      <TrendingUp size={14} className="text-amber-500" /> Overtime Rate:
                    </span>
                    <span className="font-semibold text-amber-600">₹{d.overtime_hourly_rate || 50} / hr</span>
                  </div>

                  <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
                    <span className="flex items-center gap-1.5 font-medium">
                      <MapPin size={14} className="text-orange-500" /> Service Zone:
                    </span>
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>{d.zone?.name || 'All City'}</span>
                  </div>
                </div>
              </div>

              <div
                className="mt-5 pt-4 border-t flex items-center justify-between gap-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openLedgerModal(d)}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-80 transition"
                    style={{ background: 'var(--success-soft, #ecfdf3)', color: 'var(--success, #15803d)' }}
                  >
                    <BookOpen size={14} />
                    Ledger & Cash
                  </button>

                  <button
                    onClick={() => openQueueModal(d)}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-80 transition"
                    style={{ background: 'var(--info-soft, #eff4ff)', color: 'var(--info, #1d4ed8)' }}
                  >
                    <ListOrdered size={14} />
                    Queue
                  </button>
                </div>

                <button
                  onClick={() => handleDemote(d.rider_id)}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline"
                >
                  Demote
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PROMOTION MODAL */}
      {promoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className="rounded-2xl max-w-lg w-full p-6 shadow-xl border"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--ink)' }}>
              Promote Driver to Monthly Dedicated
            </h2>

            <form onSubmit={handlePromote} className="space-y-4">
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Select Driver</label>
                <select
                  value={promoteForm.rider_id}
                  onChange={(e) => setPromoteForm({ ...promoteForm, rider_id: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <option value="">-- Select Driver --</option>
                  {allRiders.map((r) => {
                    const name = r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.title || `Driver #${r.id}`
                    const phone = r.fmobile || r.mobile || 'No Phone'
                    return (
                      <option key={r.id} value={r.id}>
                        Driver #{r.id} - {name} ({phone})
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Shift Start (24hr)</label>
                  <input
                    type="time"
                    required
                    value={promoteForm.shift_start_time.slice(0, 5)}
                    onChange={(e) => setPromoteForm({ ...promoteForm, shift_start_time: e.target.value + ':00' })}
                    className="mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Shift End (24hr)</label>
                  <input
                    type="time"
                    required
                    value={promoteForm.shift_end_time.slice(0, 5)}
                    onChange={(e) => setPromoteForm({ ...promoteForm, shift_end_time: e.target.value + ':00' })}
                    className="mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Target Shift (Hrs)</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={promoteForm.target_shift_hours}
                    onChange={(e) => setPromoteForm({ ...promoteForm, target_shift_hours: e.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Salary (₹/mo)</label>
                  <input
                    type="number"
                    required
                    value={promoteForm.monthly_base_salary}
                    onChange={(e) => setPromoteForm({ ...promoteForm, monthly_base_salary: e.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Overtime (₹/hr)</label>
                  <input
                    type="number"
                    required
                    value={promoteForm.overtime_hourly_rate}
                    onChange={(e) => setPromoteForm({ ...promoteForm, overtime_hourly_rate: e.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Assigned Service Zone</label>
                <select
                  value={promoteForm.assigned_zone_id}
                  onChange={(e) => setPromoteForm({ ...promoteForm, assigned_zone_id: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <option value="">-- City Wide (No Specific Geofence) --</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({z.radius_km} km radius)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setPromoteModalOpen(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium transition hover:opacity-80"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 shadow-sm transition"
                >
                  Save Contract
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUEUE MODAL */}
      {queueModalOpen && selectedDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className="rounded-2xl max-w-2xl w-full p-6 shadow-xl border max-h-[90vh] flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div>
              <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
                    Order Queue: {selectedDriver.rider?.full_name || selectedDriver.rider?.title || `Driver #${selectedDriver.rider_id}`}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    📱 {selectedDriver.rider?.fmobile || selectedDriver.rider?.mobile || 'No Phone'} • Stacked orders automatically cascade to driver upon completing the active trip.
                  </p>
                </div>
                <button onClick={() => setQueueModalOpen(false)} style={{ color: 'var(--ink-muted)' }} className="hover:opacity-80">
                  <X size={20} />
                </button>
              </div>

              {/* Assign New Order to Queue */}
              <form onSubmit={handleAssignOrderToQueue} className="flex gap-2 mb-4">
                <select
                  value={assignOrderId}
                  onChange={(e) => setAssignOrderId(e.target.value)}
                  className="flex-1 rounded-xl border px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <option value="">-- Select Order to Add to Queue --</option>
                  {availableOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      #{o.id} - {o.pick_address?.slice(0, 30)} ➔ {o.drop_address?.slice(0, 30)} (₹{o.total_dcharge})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!assignOrderId}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  Add to Queue
                </button>
              </form>

              {/* Current Queue List */}
              <div className="space-y-2.5 overflow-y-auto max-h-[50vh] pr-1">
                {driverQueue.length === 0 ? (
                  <p className="text-center text-xs py-8" style={{ color: 'var(--ink-muted)' }}>No orders currently queued for this driver.</p>
                ) : (
                  driverQueue.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl border text-xs flex items-center justify-between"
                      style={{
                        background: item.status === 'active' ? 'var(--success-soft, #ecfdf3)' : 'var(--bg)',
                        borderColor: item.status === 'active' ? 'var(--success-soft-border, #b7e4c7)' : 'var(--border)',
                      }}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold" style={{ color: 'var(--ink)' }}>
                            #{item.order_id} ({item.status === 'active' ? '🟢 Active Trip' : `Queue Position #${idx + 1}`})
                          </span>
                          <span style={{ color: 'var(--ink-muted)' }}>₹{item.order?.total_dcharge || 0}</span>
                        </div>
                        <p style={{ color: 'var(--ink-muted)' }}>
                          📍 {item.order?.pick_address} ➔ 🏁 {item.order?.drop_address}
                        </p>
                      </div>

                      {item.status !== 'active' && (
                        <button
                          onClick={() => handleRemoveFromQueue(item.id)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 rounded-lg transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setQueueModalOpen(false)}
                className="rounded-xl px-4 py-2 text-xs font-semibold transition hover:opacity-80"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LEDGER & CASH SETTLEMENT MODAL */}
      {ledgerModalOpen && selectedLedgerDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className="rounded-2xl max-w-4xl w-full p-6 shadow-2xl border max-h-[92vh] flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="overflow-y-auto pr-1 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                    <BookOpen className="text-emerald-600" />
                    Ledger & Cash Settlement: {selectedLedgerDriver.rider?.full_name || `Driver #${selectedLedgerDriver.rider_id}`}
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    📱 {selectedLedgerDriver.rider?.fmobile || 'No Phone'} • Overtime: ₹{selectedLedgerDriver.overtime_hourly_rate || 50}/hr • Base Salary: ₹{selectedLedgerDriver.monthly_base_salary?.toLocaleString()}/mo
                  </p>
                </div>
                <button onClick={() => setLedgerModalOpen(false)} style={{ color: 'var(--ink-muted)' }} className="hover:opacity-80">
                  <X size={20} />
                </button>
              </div>

              {/* Financial Metrics Summary */}
              {ledgerData?.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div
                    className="p-3.5 rounded-xl border"
                    style={{ background: 'var(--info-soft, #eff4ff)', borderColor: 'var(--info-soft-border, #c3d4f7)' }}
                  >
                    <span className="text-[11px] font-semibold text-blue-700">Total Salary (Credit)</span>
                    <p className="text-lg font-bold text-blue-900 mt-0.5">
                      +₹{ledgerData.summary.total_base_salary.toLocaleString()}
                    </p>
                  </div>

                  <div
                    className="p-3.5 rounded-xl border"
                    style={{ background: 'var(--warning-soft, #fef9e7)', borderColor: 'var(--warning-soft-border, #f0dc9e)' }}
                  >
                    <span className="text-[11px] font-semibold text-amber-700">Overtime Pay (Credit)</span>
                    <p className="text-lg font-bold text-amber-900 mt-0.5">
                      +₹{ledgerData.summary.total_overtime_pay.toLocaleString()}
                    </p>
                  </div>

                  <div
                    className="p-3.5 rounded-xl border"
                    style={{ background: 'var(--danger-soft, #fef2f2)', borderColor: 'var(--danger-soft-border, #f2c2c2)' }}
                  >
                    <span className="text-[11px] font-semibold text-rose-700">Cash Collected (Debit)</span>
                    <p className="text-lg font-bold text-rose-900 mt-0.5">
                      -₹{ledgerData.summary.total_cash_collected.toLocaleString()}
                    </p>
                  </div>

                  <div
                    className="p-3.5 rounded-xl border"
                    style={{
                      background: ledgerData.summary.net_settlement_balance >= 0 ? 'var(--success-soft, #ecfdf3)' : 'var(--danger-soft, #fef2f2)',
                      borderColor: ledgerData.summary.net_settlement_balance >= 0 ? 'var(--success-soft-border, #b7e4c7)' : 'var(--danger-soft-border, #f2c2c2)',
                    }}
                  >
                    <span className="text-[11px] font-semibold" style={{ color: ledgerData.summary.net_settlement_balance >= 0 ? '#15803d' : '#b91c1c' }}>
                      {ledgerData.summary.net_settlement_balance >= 0 ? 'Net Payable to Driver' : 'Excess Cash with Driver'}
                    </span>
                    <p className="text-lg font-bold mt-0.5" style={{ color: ledgerData.summary.net_settlement_balance >= 0 ? '#15803d' : '#b91c1c' }}>
                      {ledgerData.summary.net_settlement_balance >= 0 ? '+' : ''}₹{ledgerData.summary.net_settlement_balance.toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              {/* Date Filter & Add Adjustment Button */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={ledgerStartDate}
                    onChange={(e) => setLedgerStartDate(e.target.value)}
                    className="rounded-xl border px-3 py-1.5 text-xs outline-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>to</span>
                  <input
                    type="date"
                    value={ledgerEndDate}
                    onChange={(e) => setLedgerEndDate(e.target.value)}
                    className="rounded-xl border px-3 py-1.5 text-xs outline-none"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                  <button
                    onClick={() => fetchLedger(selectedLedgerDriver.rider_id)}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold transition"
                    style={{ background: 'var(--ink)', color: 'var(--bg)' }}
                  >
                    Filter
                  </button>
                </div>

                <button
                  onClick={() => setShowAdjForm(!showAdjForm)}
                  className="rounded-xl bg-emerald-600 text-white px-3.5 py-1.5 text-xs font-semibold hover:bg-emerald-700 transition flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  {showAdjForm ? 'Close Entry Form' : 'Record Deposit / Payout'}
                </button>
              </div>

              {/* Add Adjustment Entry Form */}
              {showAdjForm && (
                <form
                  onSubmit={handleAddAdjustment}
                  className="p-4 rounded-xl border space-y-3"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink)' }}>
                    Record Settlement / Deposit Transaction
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>Entry Type</label>
                      <select
                        value={adjForm.entry_type}
                        onChange={(e) => {
                          const val = e.target.value
                          const effect = (val === 'CASH_DEPOSIT' || val === 'SETTLEMENT_PAYOUT') ? 'CREDIT' : 'DEBIT'
                          setAdjForm({ ...adjForm, entry_type: val, balance_effect: effect })
                        }}
                        className="mt-1 w-full rounded-xl border px-3 py-1.5 text-xs outline-none"
                        style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                      >
                        <option value="CASH_DEPOSIT">Cash Deposit (Driver handed over cash)</option>
                        <option value="SETTLEMENT_PAYOUT">Settlement Payout (Admin paid driver salary)</option>
                        <option value="BONUS">Bonus / Incentive (Credit)</option>
                        <option value="PENALTY">Penalty / Deduction (Debit)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>Amount (₹)</label>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 500"
                        value={adjForm.amount}
                        onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })}
                        className="mt-1 w-full rounded-xl border px-3 py-1.5 text-xs outline-none"
                        style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>Notes / Reference</label>
                      <input
                        type="text"
                        placeholder="e.g. UPI transfer / Cash in office"
                        value={adjForm.notes}
                        onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })}
                        className="mt-1 w-full rounded-xl border px-3 py-1.5 text-xs outline-none"
                        style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="submit"
                      className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition"
                    >
                      Save Transaction
                    </button>
                  </div>
                </form>
              )}

              {/* Transactions List */}
              {ledgerLoading ? (
                <div className="flex justify-center py-10">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                </div>
              ) : !ledgerData?.entries || ledgerData.entries.length === 0 ? (
                <p className="text-center text-xs py-10" style={{ color: 'var(--ink-muted)' }}>No ledger entries found for this driver.</p>
              ) : (
                <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                        <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Date & Time</th>
                        <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Type</th>
                        <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Order</th>
                        <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Amount</th>
                        <th className="px-3.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {ledgerData.entries.map((entry) => {
                        const isCredit = entry.balance_effect === 'CREDIT'
                        const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-'
                        return (
                          <tr key={entry.id} className="hover:opacity-90 transition">
                            <td className="px-3.5 py-2.5 font-mono" style={{ color: 'var(--ink-muted)' }}>{dateStr}</td>
                            <td className="px-3.5 py-2.5">
                              <span
                                className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                style={{
                                  background: entry.entry_type === 'BASE_SALARY' ? 'var(--info-soft, #eff4ff)' : entry.entry_type === 'OVERTIME_PAY' ? 'var(--warning-soft, #fef9e7)' : entry.entry_type === 'CASH_COLLECTED' ? 'var(--danger-soft, #fef2f2)' : 'var(--success-soft, #ecfdf3)',
                                  color: entry.entry_type === 'BASE_SALARY' ? '#1d4ed8' : entry.entry_type === 'OVERTIME_PAY' ? '#a16207' : entry.entry_type === 'CASH_COLLECTED' ? '#b91c1c' : '#15803d',
                                }}
                              >
                                {entry.entry_type}
                              </span>
                            </td>
                            <td className="px-3.5 py-2.5" style={{ color: 'var(--ink)' }}>
                              {entry.order_id ? `#${entry.order_id}` : '-'}
                            </td>
                            <td className={`px-3.5 py-2.5 font-bold ${
                              isCredit ? 'text-emerald-600' : 'text-rose-600'
                            }`}>
                              {isCredit ? '+₹' : '-₹'}{Number(entry.amount).toLocaleString()}
                            </td>
                            <td className="px-3.5 py-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                              {entry.notes || '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-4 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setLedgerModalOpen(false)}
                className="rounded-xl px-4 py-2 text-xs font-semibold transition hover:opacity-80"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
