import { useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import { formatCurrency } from '../../utils/format'

const dayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short' })

function last7DayRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 6)
  const toDateStr = (d) => d.toISOString().slice(0, 10)
  return { start: toDateStr(start), end: toDateStr(end) }
}

// Fills in zero-days the backend never returned a row for, so the last 7
// calendar days always render even on a fresh city with sparse orders.
function fillLast7Days(rows) {
  const byDate = new Map(rows.map((r) => [new Date(r.date).toISOString().slice(0, 10), r]))
  const out = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const row = byDate.get(key)
    out.push({ day: dayLabel.format(d), revenue: row?.revenue ?? 0, trips: row?.bookings ?? 0 })
  }
  return out
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const revenue = payload.find((p) => p.dataKey === 'revenue')?.value ?? 0
  const trips = payload.find((p) => p.dataKey === 'trips')?.value ?? 0
  return (
    <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}>
      <div className="font-semibold" style={{ color: 'var(--ink)' }}>{label}</div>
      <div className="mt-1 flex items-center gap-1.5" style={{ color: 'var(--brand)' }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--brand)' }} />
        {formatCurrency(revenue)}
      </div>
      <div className="flex items-center gap-1.5" style={{ color: 'var(--info)' }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--info)' }} />
        {trips} {trips === 1 ? 'trip' : 'trips'}
      </div>
    </div>
  )
}

export default function RevenueTripsChart() {
  const fetcher = useCallback(() => {
    const { start, end } = last7DayRange()
    return api.post('/analytics/sales-report', { start_date: start, end_date: end }).then((res) => fillLast7Days(res.data.data))
  }, [])
  const { data, loading, error } = useApiQuery(fetcher)

  return (
    <div className="surface-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          Revenue &amp; Trips, last 7 days
        </h3>
        <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--brand)' }} /> Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--info)' }} /> Trips
          </span>
        </div>
      </div>

      {error && (
        <p className="mt-6 py-8 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {!error && (
        <div className="mt-2 h-64 w-full">
          {loading ? (
            <div className="h-full w-full animate-pulse rounded-lg" style={{ background: 'var(--bg)' }} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tripsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--info)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fill: 'var(--ink-faint)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <YAxis yAxisId="revenue" hide />
                <YAxis yAxisId="trips" orientation="right" hide />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }} />
                <Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke="var(--brand)" strokeWidth={2} fill="url(#revenueGradient)" />
                <Area yAxisId="trips" type="monotone" dataKey="trips" stroke="var(--info)" strokeWidth={2} fill="url(#tripsGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}
