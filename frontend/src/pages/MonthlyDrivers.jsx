import { useState, useEffect } from 'react'
import { UserCheck, Plus, Clock, DollarSign, MapPin, ListOrdered, Search, ShieldCheck, X, Trash2 } from 'lucide-react'
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
    allowed_break_minutes: '45',
  })

  // Queue Modal
  const [queueModalOpen, setQueueModalOpen] = useState(false)
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [driverQueue, setDriverQueue] = useState([])
  const [availableOrders, setAvailableOrders] = useState([])
  const [assignOrderId, setAssignOrderId] = useState('')

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

  async function openQueueModal(driver) {
    setSelectedDriver(driver)
    setQueueModalOpen(true)
    fetchQueue(driver.rider_id)

    // Fetch unassigned / pending orders that can be queued
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

  const filtered = drivers.filter(
    (d) =>
      d.rider?.title?.toLowerCase().includes(search.toLowerCase()) ||
      d.rider?.mobile?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <UserCheck className="text-emerald-600 dark:text-emerald-400" />
            Monthly Dedicated Drivers
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage salaried drivers, working shifts, mandatory order dispatch, and advance stacked queues.
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

      <div className="flex items-center gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <Search size={18} className="text-slate-400 ml-2" />
        <input
          type="text"
          placeholder="Search monthly driver by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent text-sm text-slate-900 dark:text-white outline-none"
        />
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-500">
          <UserCheck size={40} className="mx-auto text-slate-400 mb-3" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-300">No Monthly Drivers Configured</h3>
          <p className="text-sm mt-1">Click "Promote Driver to Monthly" to assign fixed shifts and guaranteed salaries.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{d.rider?.title || `Rider #${d.rider_id}`}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      📱 {d.rider?.mobile} • {d.rider?.vehicle || 'Bike'}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <ShieldCheck size={12} />
                    Monthly Active
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Clock size={14} className="text-blue-500" /> Duty Shift:
                    </span>
                    <span className="font-semibold">{d.shift_start_time.slice(0, 5)} - {d.shift_end_time.slice(0, 5)} ({d.target_shift_hours}h)</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                    <span className="flex items-center gap-1.5 font-medium">
                      <DollarSign size={14} className="text-emerald-500" /> Base Salary:
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">₹{d.monthly_base_salary.toLocaleString()} / mo</span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                    <span className="flex items-center gap-1.5 font-medium">
                      <MapPin size={14} className="text-orange-500" /> Service Zone:
                    </span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{d.zone?.name || 'All City'}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => openQueueModal(d)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 px-3 py-1.5 text-xs font-semibold hover:bg-blue-100 transition"
                >
                  <ListOrdered size={14} />
                  Order Queue
                </button>

                <button
                  onClick={() => handleDemote(d.rider_id)}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline"
                >
                  Revert to Freelance
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PROMOTION MODAL */}
      {promoteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
              Promote Driver to Monthly Dedicated
            </h2>

            <form onSubmit={handlePromote} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Select Driver</label>
                <select
                  value={promoteForm.rider_id}
                  onChange={(e) => setPromoteForm({ ...promoteForm, rider_id: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {allRiders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title || `Driver #${r.id}`} ({r.mobile})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Shift Start (24hr)</label>
                  <input
                    type="time"
                    required
                    value={promoteForm.shift_start_time.slice(0, 5)}
                    onChange={(e) => setPromoteForm({ ...promoteForm, shift_start_time: e.target.value + ':00' })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Shift End (24hr)</label>
                  <input
                    type="time"
                    required
                    value={promoteForm.shift_end_time.slice(0, 5)}
                    onChange={(e) => setPromoteForm({ ...promoteForm, shift_end_time: e.target.value + ':00' })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Target Duty Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={promoteForm.target_shift_hours}
                    onChange={(e) => setPromoteForm({ ...promoteForm, target_shift_hours: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Monthly Base Salary (₹)</label>
                  <input
                    type="number"
                    required
                    value={promoteForm.monthly_base_salary}
                    onChange={(e) => setPromoteForm({ ...promoteForm, monthly_base_salary: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Assigned Service Zone</label>
                <select
                  value={promoteForm.assigned_zone_id}
                  onChange={(e) => setPromoteForm({ ...promoteForm, assigned_zone_id: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
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
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Order Queue: {selectedDriver.rider?.title}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Stacked orders automatically cascade to driver upon completing the active trip.
                  </p>
                </div>
                <button onClick={() => setQueueModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>

              {/* Assign New Order to Queue */}
              <form onSubmit={handleAssignOrderToQueue} className="flex gap-2 mb-4">
                <select
                  value={assignOrderId}
                  onChange={(e) => setAssignOrderId(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
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
                  <p className="text-center text-xs text-slate-400 py-8">No orders currently queued for this driver.</p>
                ) : (
                  driverQueue.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
                        item.status === 'active'
                          ? 'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/40'
                          : 'bg-slate-50 border-slate-200 dark:bg-slate-800/60 dark:border-slate-700'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            #{item.order_id} ({item.status === 'active' ? '🟢 Active Trip' : `Queue Position #${idx + 1}`})
                          </span>
                          <span className="text-slate-500">₹{item.order?.total_dcharge || 0}</span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">
                          📍 {item.order?.pick_address} ➔ 🏁 {item.order?.drop_address}
                        </p>
                      </div>

                      {item.status !== 'active' && (
                        <button
                          onClick={() => handleRemoveFromQueue(item.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setQueueModalOpen(false)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
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
