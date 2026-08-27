import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Wallet, Clock, Truck, Package } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import useApiQuery from '../hooks/useApiQuery'
import KpiCard from '../components/common/KpiCard'
import RecentOrdersTicker from '../components/dashboard/RecentOrdersTicker'
import { ROLE_LABELS } from '../config/navigation'

// Leaflet and Recharts are ~150KB+ each and only this page needs them —
// code-split both out so every other screen's initial load doesn't pay for
// map/chart bytes (this pushed the main bundle from ~445KB to ~845KB
// unsplit — see the plain <script> import that caused it).
const LiveFleetMap = lazy(() => import('../components/dashboard/LiveFleetMap'))
const RevenueTripsChart = lazy(() => import('../components/dashboard/RevenueTripsChart'))

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const toDateStr = (d) => d.toISOString().slice(0, 10)

// A real day-over-day delta, or null when there's no honest baseline to
// compare against (e.g. yesterday had zero orders) — we never fabricate a
// percentage, we just omit the trend pill in that case.
function computeTrend(today, yesterday) {
  if (!yesterday) return today > 0 ? { label: 'New today', tone: 'success' } : null
  const pct = ((today - yesterday) / yesterday) * 100
  const sign = pct >= 0 ? '+' : ''
  return { label: `${sign}${pct.toFixed(1)}% vs yesterday`, tone: pct >= 0 ? 'success' : 'danger' }
}

export default function Dashboard() {
  const { user, hasRole } = useAuth()
  const { socket } = useSocket()
  const canSeeKpis = hasRole('superadmin', 'admin')

  const kpiFetcher = useCallback(() => (canSeeKpis ? api.get('/analytics/overview').then((res) => res.data.kpis) : Promise.resolve(null)), [canSeeKpis])
  const { data: kpis, loading, error, refetch } = useApiQuery(kpiFetcher)

  const [dayTrends, setDayTrends] = useState(null)

  // Live-refresh on the same events the admin socket layer already emits
  // (Phase 5) — no polling.
  useEffect(() => {
    if (!socket || !canSeeKpis) return
    socket.on('admin:new_order', refetch)
    socket.on('admin:order_status_update', refetch)
    return () => {
      socket.off('admin:new_order', refetch)
      socket.off('admin:order_status_update', refetch)
    }
  }, [socket, canSeeKpis, refetch])

  // A lightweight two-day pull (today + yesterday) just for real trend deltas
  // on the revenue/orders cards — the 7-day chart below fetches its own
  // wider range independently.
  useEffect(() => {
    if (!canSeeKpis) return
    let cancelled = false
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 1)
    api
      .post('/analytics/sales-report', { start_date: toDateStr(start), end_date: toDateStr(end) })
      .then((res) => {
        if (cancelled) return
        const rows = res.data.data || []
        const byDate = Object.fromEntries(rows.map((r) => [new Date(r.date).toISOString().slice(0, 10), r]))
        const todayKey = toDateStr(end)
        const yestKey = toDateStr(start)
        setDayTrends({
          revenueToday: byDate[todayKey]?.revenue ?? 0,
          revenueYesterday: byDate[yestKey]?.revenue ?? 0,
          ordersToday: byDate[todayKey]?.bookings ?? 0,
          ordersYesterday: byDate[yestKey]?.bookings ?? 0,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [canSeeKpis])

  const revenueTrend = useMemo(
    () => (dayTrends ? computeTrend(dayTrends.revenueToday, dayTrends.revenueYesterday) : null),
    [dayTrends]
  )
  const ordersTrend = useMemo(
    () => (dayTrends ? computeTrend(dayTrends.ordersToday, dayTrends.ordersYesterday) : null),
    [dayTrends]
  )
  const driverRatio = kpis && kpis.total_drivers > 0 ? Math.round((kpis.online_drivers / kpis.total_drivers) * 100) : null

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Welcome back, {user?.name || user?.username}
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {ROLE_LABELS[user?.role]}
        {user?.city_name ? ` · ${user.city_name}` : ' · Pan-India'}
      </p>

      {canSeeKpis && error && (
        <div className="surface-card mt-5 rounded-xl p-4 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {canSeeKpis && !error && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Today's revenue"
              value={loading ? '' : currency.format(kpis?.today_revenue ?? 0)}
              loading={loading}
              icon={Wallet}
              iconColor="var(--success)"
              iconBg="var(--success-soft)"
              trendLabel={revenueTrend?.label}
              trendTone={revenueTrend?.tone}
            />
            <KpiCard
              label="Orders today"
              value={loading ? '' : dayTrends?.ordersToday ?? 0}
              loading={loading}
              icon={Package}
              iconColor="var(--warning)"
              iconBg="var(--warning-soft)"
              trendLabel={ordersTrend?.label}
              trendTone={ordersTrend?.tone}
            />
            <KpiCard
              label="Active trips"
              value={loading ? '' : kpis?.active_orders ?? 0}
              loading={loading}
              icon={Clock}
              iconColor="var(--brand)"
              iconBg="var(--brand-soft)"
              trendLabel="Live right now"
              trendTone="neutral"
            />
            <KpiCard
              label="Online drivers"
              value={loading ? '' : kpis?.online_drivers ?? 0}
              loading={loading}
              icon={Truck}
              iconColor="var(--info)"
              iconBg="var(--info-soft)"
              trendLabel={driverRatio !== null ? `${driverRatio}% of fleet online` : undefined}
              trendTone="neutral"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Total revenue" value={loading ? '' : currency.format(kpis?.total_revenue ?? 0)} loading={loading} size="sm" />
            <KpiCard label="Total orders" value={loading ? '' : kpis?.total_orders ?? 0} loading={loading} size="sm" />
            <KpiCard label="Total drivers" value={loading ? '' : kpis?.total_drivers ?? 0} loading={loading} size="sm" />
            <KpiCard label="KYC pending" value={loading ? '' : kpis?.kyc_pending_count ?? 0} loading={loading} size="sm" />
          </div>
        </>
      )}

      <div className="mt-5 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_1fr]">
        <Suspense fallback={<div className="surface-card flex items-center justify-center rounded-xl" style={{ height: 340, color: 'var(--ink-faint)' }}>Loading map…</div>}>
          <LiveFleetMap />
        </Suspense>
        <RecentOrdersTicker />
      </div>

      {canSeeKpis && (
        <div className="mt-5">
          <Suspense fallback={<div className="surface-card flex items-center justify-center rounded-xl" style={{ height: 280, color: 'var(--ink-faint)' }}>Loading chart…</div>}>
            <RevenueTripsChart />
          </Suspense>
        </div>
      )}
    </div>
  )
}
