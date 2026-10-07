import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Badge from '../common/Badge'
import Pagination from '../common/Pagination'
import { formatCurrency, formatDateTime } from '../../utils/format'

const LIMIT = 25
const COLUMNS = ['Purchased', 'Buyer', 'Plan', 'Amount paid', 'Payment', 'Validity', 'Status']
const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }
const STATUS_TONE = { active: 'success', expired: 'neutral', cancelled: 'danger', pending: 'warning' }
const PLAN_FOR_FILTERS = [
  { value: 'all', label: 'All buyers' },
  { value: 'USER', label: 'Customers' },
  { value: 'DRIVER', label: 'Drivers' },
]
const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'pending', label: 'Pending' },
]

// start_date / end_date are plain dates (no time), so format them in UTC to avoid a day shift.
function formatDay(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function paymentLabel(row) {
  if (row.payment_method) return row.payment_method
  return row.amount_paid > 0 ? 'online' : 'free'
}

// Every plan purchase (customer or driver, paid online, with points, or granted by an admin) as one row.
export default function PlanPurchaseHistory() {
  const [page, setPage] = useState(1)
  const [planFor, setPlanFor] = useState('all')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Wait for a pause in typing before querying.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetcher = useCallback(
    () =>
      api
        .get('/marketing/premium-plans/purchases', {
          params: {
            page,
            limit: LIMIT,
            plan_for: planFor === 'all' ? undefined : planFor,
            status: status === 'all' ? undefined : status,
            from: from || undefined,
            to: to || undefined,
            q: search || undefined,
          },
        })
        .then((res) => res.data),
    [page, planFor, status, from, to, search],
  )
  const { data, loading, error } = useApiQuery(fetcher)
  const rows = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <Search size={14} style={{ color: 'var(--ink-faint)' }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, exact mobile or transaction id…"
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>
        <select
          value={planFor}
          onChange={(e) => {
            setPlanFor(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          {PLAN_FOR_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border px-2 py-1 text-[13px] outline-none"
            style={FIELD_STYLE}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border px-2 py-1 text-[13px] outline-none"
            style={FIELD_STYLE}
          />
        </label>
      </div>

      {!loading && !error && (
        <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          <span className="font-mono-data font-semibold" style={{ color: 'var(--ink)' }}>{total}</span> purchases ·{' '}
          <span className="font-mono-data font-semibold" style={{ color: 'var(--ink)' }}>
            {formatCurrency(data?.summary?.total_amount_paid)}
          </span>{' '}
          collected
        </p>
      )}

      <div className="surface-card mt-3 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {COLUMNS.map((h) => (
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
                    <td colSpan={COLUMNS.length} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No plan purchases found.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(r.purchased_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{r.buyer.name}</span>
                        <Badge tone={r.buyer.type === 'DRIVER' ? 'success' : 'info'}>{r.buyer.type === 'DRIVER' ? 'Driver' : 'Customer'}</Badge>
                      </div>
                      <div className="font-mono-data mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                        {r.buyer.mobile || `ID #${r.buyer.id}`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>{r.plan.name}</div>
                      <div className="font-mono-data mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                        {r.plan.type}
                        {r.plan.list_price !== null && r.plan.list_price !== r.amount_paid + r.points_amount
                          ? ` · list ${formatCurrency(r.plan.list_price)}`
                          : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="font-mono-data text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(r.amount_paid)}</div>
                      {r.points_used > 0 && (
                        <div className="font-mono-data mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          + {r.points_used} pts ({formatCurrency(r.points_amount)})
                        </div>
                      )}
                      {r.wallet_bonus_credited > 0 && (
                        <div className="font-mono-data mt-0.5 text-[11px]" style={{ color: 'var(--success)' }}>
                          {formatCurrency(r.wallet_bonus_credited)} bonus credited
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="text-[12.5px] capitalize" style={{ color: 'var(--ink-muted)' }}>{paymentLabel(r)}</div>
                      <div className="font-mono-data mt-0.5 max-w-[180px] truncate text-[11px]" style={{ color: 'var(--ink-faint)' }} title={r.payment_txn_id || ''}>
                        {r.payment_txn_id || '—'}
                      </div>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {formatDay(r.start_date)} → {formatDay(r.end_date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      </div>
    </div>
  )
}
