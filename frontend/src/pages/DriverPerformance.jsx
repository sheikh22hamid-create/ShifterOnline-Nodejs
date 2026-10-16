import { useCallback, useEffect, useState } from 'react'
import { BarChart3, RefreshCw, Search, Eye, Ban } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import { formatCurrency, formatDateTime } from '../utils/format'

const TIER_TABS = [
  { id: '', label: 'All Drivers' },
  { id: 'free', label: 'Free Drivers' },
  { id: 'daily', label: 'Daily Drivers' },
  { id: 'normal', label: 'Normal Drivers' },
]
const STATUS_TONE = { Excellent: 'success', Good: 'info', Average: 'warning', Poor: 'danger', 'No data': 'neutral' }
const TIER_TONE = { free: 'brand', daily: 'info', normal: 'neutral' }
const EVENT_LABEL = {
  offered: 'Offered',
  accepted: 'Accepted',
  rejected: 'Rejected',
  skipped: 'Skipped',
  superseded: 'Taken by another driver',
  completed: 'Completed',
  cancel_requested: 'Cancel requested',
  cancelled: 'Cancelled',
  cancel_rejected: 'Cancel rejected',
  penalty: 'Penalty applied',
  penalty_waived: 'Penalty waived',
}
const EVENT_TONE = {
  accepted: 'success', completed: 'success', rejected: 'danger', skipped: 'warning', cancelled: 'danger',
  cancel_requested: 'warning', cancel_rejected: 'info', penalty: 'danger', penalty_waived: 'info',
}
const DETAIL_FILTERS = [
  { id: '', label: 'All activity' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'penalty', label: 'Penalties' },
]

const cardStyle = { background: 'var(--surface)', borderColor: 'var(--border)' }
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const thStyle = { color: 'var(--ink-muted)' }
const pct = (v) => (v == null ? '—' : `${v}%`)
const errMsg = (err, fallback) => err?.response?.data?.message || fallback

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border p-3" style={cardStyle}>
      <div className="text-[11px] font-semibold" style={thStyle}>{label}</div>
      <div className="mt-1 text-lg font-bold" style={{ color: 'var(--ink)' }}>{value}</div>
      {sub ? <div className="text-[11px]" style={thStyle}>{sub}</div> : null}
    </div>
  )
}

export default function DriverPerformance() {
  const toast = useToast()
  const { user } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const canWaive = user?.role === 'superadmin' || user?.role === 'admin'

  const [tier, setTier] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cityId, setCityId] = useState('')
  const [cities, setCities] = useState([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('score')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({ drivers: [], totals: null, truncated: false })

  const [detailRider, setDetailRider] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFilter, setDetailFilter] = useState('')
  const [waiveTarget, setWaiveTarget] = useState(null)

  const params = useCallback(() => {
    const p = { sort }
    if (tier) p.tier = tier
    if (from) p.from = from
    if (to) p.to = to
    if (search.trim()) p.search = search.trim()
    if (isSuper && cityId) p.city_id = cityId
    return p
  }, [tier, from, to, search, sort, isSuper, cityId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/driver-performance', { params: params() })
      setData(res.data?.data || { drivers: [], totals: null, truncated: false })
    } catch (err) {
      toast.error(errMsg(err, 'Could not load driver performance'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities').then((res) => setCities(res.data?.data || res.data || [])).catch(() => {})
  }, [isSuper])

  const openDetail = useCallback(async (driver) => {
    setDetailRider(driver)
    setDetail(null)
    setDetailFilter('')
    setDetailLoading(true)
    try {
      const p = {}
      if (tier) p.tier = tier
      if (from) p.from = from
      if (to) p.to = to
      const res = await api.get(`/driver-performance/${driver.rider_id}`, { params: p })
      setDetail(res.data?.data || null)
    } catch (err) {
      toast.error(errMsg(err, 'Could not load driver details'))
    } finally {
      setDetailLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, from, to])

  async function handleWaive() {
    if (!waiveTarget) return
    try {
      const res = await api.post(`/tier-dispatch/penalties/${waiveTarget.id}/waive`)
      toast.success(res.data?.message || 'Penalty waived')
      setWaiveTarget(null)
      if (detailRider) openDetail(detailRider)
      load()
    } catch (err) {
      toast.error(errMsg(err, 'Could not waive penalty'))
    }
  }

  const totals = data.totals
  const visibleEvents = (detail?.events || []).filter((e) => {
    if (!detailFilter) return true
    if (detailFilter === 'penalty') return e.event === 'penalty' || e.event === 'penalty_waived'
    return e.event === detailFilter
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={20} style={{ color: 'var(--brand)' }} />
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Driver Performance</h1>
          <p className="text-xs" style={thStyle}>
            Offers, accepts, rejects, skips, completions, cancellations and penalties per driver. Offers taken by
            another driver while a popup was live are not counted against the driver.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TIER_TABS.map((t) => (
          <button
            key={t.id || 'all'}
            type="button"
            onClick={() => setTier(t.id)}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
            style={tier === t.id
              ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
              : { ...inputStyle }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-4" style={cardStyle}>
        <label className="flex items-center gap-1.5 text-xs" style={thStyle}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border px-2 py-1 text-xs outline-none" style={inputStyle} />
        </label>
        <label className="flex items-center gap-1.5 text-xs" style={thStyle}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border px-2 py-1 text-xs outline-none" style={inputStyle} />
        </label>
        {isSuper && (
          <select value={cityId} onChange={(e) => setCityId(e.target.value)}
            className="rounded-lg border px-2.5 py-1 text-xs font-semibold outline-none" style={inputStyle}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border px-2.5 py-1 text-xs font-semibold outline-none" style={inputStyle}>
          <option value="score">Best score first</option>
          <option value="score_asc">Lowest score first</option>
          <option value="offered">Most orders received</option>
          <option value="penalty">Highest penalty</option>
          <option value="name">Name</option>
        </select>
        <div className="relative">
          <input type="text" placeholder="Name, mobile or ID..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-44 rounded-lg border py-1 pl-7 pr-2.5 text-xs outline-none" style={inputStyle} />
          <Search size={12} className="absolute left-2 top-2 text-zinc-400" />
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Stat label="Drivers" value={data.drivers.length} />
          <Stat label="Orders received" value={totals.offered} />
          <Stat label="Accepted" value={totals.accepted} />
          <Stat label="Rejected" value={totals.rejected} />
          <Stat label="Skipped" value={totals.skipped} />
          <Stat label="Completed" value={totals.completed} sub={`${totals.cancelled} cancelled`} />
          <Stat label="Penalties" value={formatCurrency(totals.penalty_total)} sub={`${totals.penalty_count} applied`} />
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border" style={cardStyle}>
        <table className="w-full text-left text-xs">
          <thead style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
            <tr>
              {['Driver', 'Received', 'Accepted', 'Rejected', 'Skipped', 'Completed', 'Cancelled', 'Penalty',
                'Accept %', 'Complete %', 'Reject %', 'Skip %', 'Score', ''].map((h) => (
                <th key={h || 'actions'} className="px-3 py-3 font-semibold whitespace-nowrap" style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {loading && data.drivers.length === 0 ? (
              <tr><td colSpan={14} className="py-8 text-center" style={thStyle}>Loading...</td></tr>
            ) : data.drivers.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-8 text-center" style={thStyle}>
                  No driver activity for these filters. Data starts from the day offer tracking went live.
                </td>
              </tr>
            ) : (
              data.drivers.map((d) => (
                <tr key={d.rider_id}>
                  <td className="px-3 py-3">
                    <div className="font-semibold" style={{ color: 'var(--ink)' }}>{d.rider_name || `Driver #${d.rider_id}`}</div>
                    <div style={thStyle}>#{d.rider_id} {d.rider_mobile ? `· ${d.rider_mobile}` : ''}</div>
                  </td>
                  <td className="px-3 py-3">{d.offered}</td>
                  <td className="px-3 py-3">{d.accepted}</td>
                  <td className="px-3 py-3">{d.rejected}</td>
                  <td className="px-3 py-3">{d.skipped}</td>
                  <td className="px-3 py-3">{d.completed}</td>
                  <td className="px-3 py-3">{d.cancelled}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {formatCurrency(d.penalty_total)}
                    {d.penalty_count > 0 ? <span style={thStyle}> ({d.penalty_count})</span> : null}
                  </td>
                  <td className="px-3 py-3">{pct(d.acceptance_rate)}</td>
                  <td className="px-3 py-3">{pct(d.completion_rate)}</td>
                  <td className="px-3 py-3">{pct(d.rejection_rate)}</td>
                  <td className="px-3 py-3">{pct(d.skip_rate)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Badge tone={STATUS_TONE[d.status] || 'neutral'}>
                      {d.score == null ? d.status : `${d.score} · ${d.status}`}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" onClick={() => openDetail(d)}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                      <Eye size={12} /> Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data.truncated && (
        <p className="text-[11px]" style={thStyle}>Showing the first 500 drivers. Narrow the filters to see the rest.</p>
      )}

      <Modal
        open={!!detailRider}
        onClose={() => setDetailRider(null)}
        title={detailRider ? `${detailRider.rider_name || 'Driver'} (#${detailRider.rider_id}) — activity` : ''}
        width={860}
      >
        {detailLoading || !detail ? (
          <div className="py-8 text-center text-xs" style={thStyle}>Loading...</div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {DETAIL_FILTERS.map((f) => (
                <button key={f.id || 'all'} type="button" onClick={() => setDetailFilter(f.id)}
                  className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold"
                  style={detailFilter === f.id
                    ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
                    : inputStyle}>
                  {f.label}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-left text-xs">
                <thead style={{ background: 'var(--bg)' }}>
                  <tr>
                    {['Date / time', 'Order', 'Tier', 'Activity', 'Reason / amount'].map((h) => (
                      <th key={h} className="px-3 py-2 font-semibold" style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {visibleEvents.length === 0 ? (
                    <tr><td colSpan={5} className="py-5 text-center" style={thStyle}>Nothing recorded.</td></tr>
                  ) : visibleEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                      <td className="px-3 py-2">#{e.order_id}</td>
                      <td className="px-3 py-2"><Badge tone={TIER_TONE[e.tier] || 'neutral'}>{e.tier}</Badge></td>
                      <td className="px-3 py-2">
                        <Badge tone={EVENT_TONE[e.event] || 'neutral'}>{EVENT_LABEL[e.event] || e.event}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {e.event === 'penalty' || e.event === 'penalty_waived'
                          ? `${formatCurrency(e.penalty_amount)}${e.penalty_pct ? ` (${e.penalty_pct}%)` : ''}${e.reason ? ` · ${e.reason}` : ''}`
                          : (e.reason || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Penalties</h3>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-left text-xs">
                  <thead style={{ background: 'var(--bg)' }}>
                    <tr>
                      {['Date / time', 'Order', 'Tier', 'Reason', 'Miss #', 'Amount', 'Status', ''].map((h) => (
                        <th key={h || 'a'} className="px-3 py-2 font-semibold" style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {detail.penalties.length === 0 ? (
                      <tr><td colSpan={8} className="py-5 text-center" style={thStyle}>No penalties.</td></tr>
                    ) : detail.penalties.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                        <td className="px-3 py-2">#{p.order_id}</td>
                        <td className="px-3 py-2"><Badge tone={TIER_TONE[p.tier] || 'neutral'}>{p.tier}</Badge></td>
                        <td className="px-3 py-2">{p.kind === 'cancel' ? 'Cancel (admin approved)' : p.event}</td>
                        <td className="px-3 py-2">{p.miss_no ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatCurrency(p.amount)} ({p.pct}%)</td>
                        <td className="px-3 py-2">
                          <Badge tone={p.status === 'waived' ? 'info' : p.status === 'pending_daily' ? 'warning' : 'danger'}>
                            {p.status === 'pending_daily' ? 'deferred to settlement' : p.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canWaive && p.status !== 'waived' && (
                            <button type="button" onClick={() => setWaiveTarget(p)}
                              className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold text-rose-600"
                              style={{ borderColor: 'var(--border)' }}>
                              <Ban size={11} /> Waive
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!waiveTarget}
        onClose={() => setWaiveTarget(null)}
        title={waiveTarget ? `Waive penalty #${waiveTarget.id}?` : ''}
        footer={(
          <>
            <button type="button" onClick={() => setWaiveTarget(null)}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>Cancel</button>
            <button type="button" onClick={handleWaive}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white">Waive</button>
          </>
        )}
      >
        {waiveTarget && (
          <p className="text-xs" style={{ color: 'var(--ink)' }}>
            This credits {formatCurrency(waiveTarget.amount)} back to the driver and is logged under your admin id.
          </p>
        )}
      </Modal>
    </div>
  )
}
