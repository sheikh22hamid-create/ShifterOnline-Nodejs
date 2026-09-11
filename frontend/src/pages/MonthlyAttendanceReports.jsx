import { useState, useEffect } from 'react'
import { CalendarCheck, Search, Filter, Download, Clock, DollarSign, CheckCircle2, TrendingUp } from 'lucide-react'
import api from '../services/api'

export default function MonthlyAttendanceReports() {
  const [logs, setLogs] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDriver, setSelectedDriver] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    fetchDrivers()
    fetchLogs()
  }, [])

  function fetchDrivers() {
    api.get('/monthly-drivers').then((res) => setDrivers(res.data.data || [])).catch(() => {})
  }

  function fetchLogs() {
    setLoading(true)
    const params = {}
    if (selectedDriver) params.rider_id = selectedDriver
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate

    api
      .get('/monthly-drivers/attendance', { params })
      .then((res) => setLogs(res.data.data || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false))
  }

  // Summary Metrics
  const totalDutyDays = logs.length
  const totalInZoneMins = logs.reduce((acc, l) => acc + (l.total_in_zone_minutes || 0), 0)
  const totalCalculatedSalary = logs.reduce((acc, l) => acc + (Number(l.calculated_daily_salary) || 0), 0)
  const totalOvertimePay = logs.reduce((acc, l) => acc + (Number(l.overtime_pay) || 0), 0)
  const totalCashCollected = logs.reduce((acc, l) => acc + (Number(l.cash_collected) || 0), 0)
  const totalOrders = logs.reduce((acc, l) => acc + (l.orders_completed || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="text-blue-600 dark:text-blue-400" />
            Monthly Driver Duty & Salary Reports
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Track live working hours inside geofenced zones, attendance compliance, overtime pay, and cash collections.
          </p>
        </div>
      </div>

      {/* STATS OVERVIEW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Duty Shifts Logged</span>
            <CheckCircle2 size={18} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-2">{totalDutyDays} Days</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Live In-Zone</span>
            <Clock size={18} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
            {(totalInZoneMins / 60).toFixed(1)} hrs
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Base Salary</span>
            <DollarSign size={18} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
            ₹{totalCalculatedSalary.toLocaleString()}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Overtime Pay Earned</span>
            <TrendingUp size={18} className="text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-2">
            ₹{totalOvertimePay.toLocaleString()}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Cash Collected</span>
            <DollarSign size={18} className="text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-2">
            ₹{totalCashCollected.toLocaleString()}
          </p>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <select
            value={selectedDriver}
            onChange={(e) => setSelectedDriver(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none"
          >
            <option value="">-- All Monthly Drivers --</option>
            {drivers.map((d) => {
              const name = d.rider?.full_name || d.rider?.title || `Driver #${d.rider_id}`
              const phone = d.rider?.fmobile || d.rider?.mobile || ''
              return (
                <option key={d.rider_id} value={d.rider_id}>
                  Driver #{d.rider_id} - {name} {phone ? `(${phone})` : ''}
                </option>
              )
            })}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white outline-none"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white outline-none"
          />
        </div>

        <button
          onClick={fetchLogs}
          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
        >
          Apply Filters
        </button>
      </div>

      {/* LOGS TABLE */}
      {loading ? (
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-500">
          <p>No duty logs found for the selected criteria.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3.5">Duty Date</th>
                  <th className="px-4 py-3.5">Driver</th>
                  <th className="px-4 py-3.5">Punch In / Out</th>
                  <th className="px-4 py-3.5">In-Zone Live</th>
                  <th className="px-4 py-3.5">Out-of-Zone</th>
                  <th className="px-4 py-3.5">Orders</th>
                  <th className="px-4 py-3.5">Daily Salary</th>
                  <th className="px-4 py-3.5">Overtime Pay</th>
                  <th className="px-4 py-3.5">Cash Collected</th>
                  <th className="px-4 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => {
                  const inZoneHours = (log.total_in_zone_minutes / 60).toFixed(1)
                  const outZoneHours = (log.total_out_zone_minutes / 60).toFixed(1)
                  const overtimeHours = (log.overtime_minutes ? log.overtime_minutes / 60 : 0).toFixed(1)
                  const dateStr = log.duty_date ? new Date(log.duty_date).toLocaleDateString() : 'N/A'
                  const punchInStr = log.punch_in_at ? new Date(log.punch_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'
                  const punchOutStr = log.punch_out_at ? new Date(log.punch_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'
                  const driverName = log.rider?.full_name || log.rider?.title || `Driver #${log.rider_id}`
                  const driverPhone = log.rider?.fmobile || log.rider?.mobile || ''

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3.5 font-medium text-slate-900 dark:text-white">{dateStr}</td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-white">
                        {driverName}
                        {driverPhone ? (
                          <span className="block text-[10px] font-normal text-slate-400 font-mono">📱 {driverPhone}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-slate-500">
                        {punchInStr} ➔ {punchOutStr}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-emerald-600 dark:text-emerald-400">
                        {inZoneHours} hrs
                      </td>
                      <td className="px-4 py-3.5 text-rose-500 font-medium">
                        {outZoneHours} hrs
                      </td>
                      <td className="px-4 py-3.5">{log.orders_completed || 0}</td>
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">
                        ₹{log.calculated_daily_salary?.toLocaleString() || '0'}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-amber-600 dark:text-amber-400">
                        {Number(log.overtime_pay) > 0 ? `₹${log.overtime_pay} (${overtimeHours}h)` : '₹0'}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-rose-600 dark:text-rose-400">
                        ₹{Number(log.cash_collected || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            log.status === 'in_progress'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                          }`}
                        >
                          {log.status === 'in_progress' ? '🟢 In Progress' : '✅ Completed'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
