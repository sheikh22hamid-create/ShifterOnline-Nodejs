import { useCallback, useState } from 'react'
import {
  Clock,
  Calendar,
  Search,
  Activity,
  User,
  MapPin,
  TrendingUp,
  Download,
} from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import { formatCurrency, formatDateTime } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '0h 0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export default function DriverActivity() {
  const [selectedDate, setSelectedDate] = useState('')
  const [search, setSearch] = useState('')

  const fetcher = useCallback(
    () =>
      api
        .get('/fleet/driver-activity', {
          params: {
            date: selectedDate || undefined,
          },
        })
        .then((res) => res.data.data),
    [selectedDate]
  )

  const { data: logs, loading, error, refetch } = useApiQuery(fetcher)

  useRealtimeSync(['admin:driver_status_update', 'admin:order_status_update'], refetch)

  const filteredLogs = (logs || []).filter((l) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      String(l.driver_id).includes(q) ||
      (l.zone && l.zone.toLowerCase().includes(q)) ||
      (l.driver_schudle_type && l.driver_schudle_type.toLowerCase().includes(q))
    )
  })

  // Summary Metrics
  const totalDutyMins = filteredLogs.reduce((acc, curr) => acc + (Number(curr.time_duration) || 0), 0)
  const totalRides = filteredLogs.reduce((acc, curr) => acc + (Number(curr.ride_count) || 0), 0)
  const activeDriversCount = new Set(filteredLogs.map((l) => l.driver_id)).size

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Driver Duty & Activity Logs
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Audit trail of driver online shifts, shift durations, completed ride counts, and operational zones.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Active Shift Drivers
            </span>
            <User size={15} style={{ color: 'var(--brand)' }} />
          </div>
          <div className="font-mono-data text-[22px] font-semibold mt-1" style={{ color: 'var(--ink)' }}>
            {activeDriversCount}
          </div>
        </div>

        <div className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Total Online Hours
            </span>
            <Clock size={15} style={{ color: 'var(--brand)' }} />
          </div>
          <div className="font-mono-data text-[22px] font-semibold mt-1" style={{ color: 'var(--brand)' }}>
            {formatDuration(totalDutyMins)}
          </div>
        </div>

        <div className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Total Shift Rides
            </span>
            <TrendingUp size={15} style={{ color: 'var(--success)' }} />
          </div>
          <div className="font-mono-data text-[22px] font-semibold mt-1" style={{ color: 'var(--success)' }}>
            {totalRides}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            <Calendar size={14} /> Filter by Date:
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
            style={FIELD_STYLE}
          />
          {selectedDate && (
            <button
              type="button"
              onClick={() => setSelectedDate('')}
              className="text-[12px] font-medium underline"
              style={{ color: 'var(--ink-muted)' }}
            >
              Clear Date
            </button>
          )}
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            placeholder="Search Driver ID, Zone, Schedule..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-lg border pl-8 pr-2.5 py-1.5 text-[12.5px] outline-none"
            style={FIELD_STYLE}
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="surface-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Driver', 'Shift Date', 'Online Duration', 'Ride Count', 'Schedule Type', 'Zone', 'Monthly Fair'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No driver activity logs found for the selected filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                filteredLogs.map((l) => (
                  <tr
                    key={l.id || `${l.driver_id}-${l.date}`}
                    className="transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>
                      Driver #{l.driver_id}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {l.date ? new Date(l.date).toISOString().slice(0, 10) : '—'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5 font-semibold" style={{ color: 'var(--brand)' }}>
                      {formatDuration(l.time_duration)}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      <Badge tone={l.ride_count > 0 ? 'success' : 'neutral'}>
                        {l.ride_count} {l.ride_count === 1 ? 'Trip' : 'Trips'}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone="info">{l.driver_schudle_type || 'Standard'}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {l.zone || 'Default Zone'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatCurrency(l.total_fair_monthly || 0)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
