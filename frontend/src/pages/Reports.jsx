import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import useApiQuery from '../hooks/useApiQuery'
import { formatCurrency } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }

function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}

function downloadCsv(filename, rows, columns) {
  const header = columns.map((c) => c.label).join(',')
  const body = rows.map((r) => columns.map((c) => JSON.stringify(c.value(r) ?? '')).join(',')).join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const { hasRole } = useAuth()
  const isSuperadmin = hasRole('superadmin')
  const today = toDateStr(new Date())

  // --- Daily snapshot ---
  const [dailyDate, setDailyDate] = useState(today)
  const dailyFetcher = useCallback(() => api.post('/analytics/sales-report', { start_date: dailyDate, end_date: dailyDate }).then((res) => res.data), [dailyDate])
  const { data: daily, loading: dailyLoading } = useApiQuery(dailyFetcher)

  // --- Range sales report ---
  const [startDate, setStartDate] = useState(() => toDateStr(new Date(Date.now() - 6 * 86400000)))
  const [endDate, setEndDate] = useState(today)
  const rangeFetcher = useCallback(() => api.post('/analytics/sales-report', { start_date: startDate, end_date: endDate }).then((res) => res.data), [startDate, endDate])
  const { data: range, loading: rangeLoading, error: rangeError } = useApiQuery(rangeFetcher)

  // --- City comparison (superadmin bonus) ---
  const cityFetcher = useCallback(() => (isSuperadmin ? api.get('/analytics/city-comparison').then((res) => res.data) : Promise.resolve(null)), [isSuperadmin])
  const { data: cityData } = useApiQuery(cityFetcher)

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Reports & Analytics
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Daily snapshots, date-range GMV, and city comparisons.
      </p>

      <section className="surface-card mt-4 rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Daily snapshot
          </h3>
          <input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE} max={today} />
        </div>
        {dailyLoading ? (
          <div className="h-16 animate-pulse rounded-lg" style={{ background: 'var(--border)' }} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Completed bookings
              </div>
              <div className="font-mono-data text-[20px] font-semibold" style={{ color: 'var(--ink)' }}>
                {daily?.totals?.bookings ?? 0}
              </div>
            </div>
            <div>
              <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Revenue
              </div>
              <div className="font-mono-data text-[20px] font-semibold" style={{ color: 'var(--brand)' }}>
                {formatCurrency(daily?.totals?.revenue ?? 0)}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="surface-card mt-4 rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Sales report
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE} max={endDate} />
            <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              to
            </span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE} max={today} />
            <button
              type="button"
              disabled={!range?.data?.length}
              onClick={() =>
                downloadCsv(`sales-report-${startDate}-to-${endDate}.csv`, range.data, [
                  { label: 'Date', value: (r) => new Date(r.date).toISOString().slice(0, 10) },
                  { label: 'Bookings', value: (r) => r.bookings },
                  { label: 'Revenue', value: (r) => r.revenue },
                ])
              }
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              <Download size={13} /> Export CSV
            </button>
          </div>
        </div>

        {rangeLoading && <div className="h-24 animate-pulse rounded-lg" style={{ background: 'var(--border)' }} />}
        {!rangeLoading && rangeError && (
          <p className="text-[13px]" style={{ color: 'var(--danger)' }}>
            {rangeError}
          </p>
        )}
        {!rangeLoading && !rangeError && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Total bookings
                </div>
                <div className="font-mono-data text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {range?.totals?.bookings ?? 0}
                </div>
              </div>
              <div>
                <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Total GMV
                </div>
                <div className="font-mono-data text-[18px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {formatCurrency(range?.totals?.revenue ?? 0)}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>
                      Date
                    </th>
                    <th className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>
                      Bookings
                    </th>
                    <th className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(range?.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center" style={{ color: 'var(--ink-faint)' }}>
                        No completed orders in this range.
                      </td>
                    </tr>
                  )}
                  {(range?.data ?? []).map((r) => (
                    <tr key={r.date} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--ink)' }}>
                        {new Date(r.date).toISOString().slice(0, 10)}
                      </td>
                      <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                        {r.bookings}
                      </td>
                      <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(r.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {isSuperadmin && cityData?.data?.length > 0 && (
        <section className="surface-card mt-4 rounded-xl p-4">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            City comparison
          </h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['City', 'Revenue', 'Trips', 'Fulfillment', 'Drivers'].map((h) => (
                    <th key={h} className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cityData.data.map((c) => (
                  <tr key={c.city_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-3 py-1.5" style={{ color: 'var(--ink)' }}>
                      {c.city_name}
                    </td>
                    <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--brand)' }}>
                      {formatCurrency(c.revenue)}
                    </td>
                    <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.completed_trips}/{c.total_trips}
                    </td>
                    <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.fulfillment_rate}%
                    </td>
                    <td className="font-mono-data px-3 py-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.driver_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
