import { useCallback, useState } from 'react'
import { Search, AlertTriangle, RefreshCw, Eye, Clock, User, Phone, CheckCircle2, DollarSign } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import SettlementDetailDrawer from '../components/settlements/SettlementDetailDrawer'
import { formatCurrency, formatDateTime } from '../utils/format'

const STATUS_TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'unsettled', label: 'Unsettled (Overdue)' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

function statusTone(status) {
  switch (status) {
    case 'cash_received': return 'success'
    case 'paid_online': return 'info'
    case 'pending': return 'warning'
    case 'disputed': return 'danger'
    case 'customer_owes': return 'brand'
    case 'waived': return 'neutral'
    default: return 'neutral'
  }
}

export default function Settlements() {
  const [status, setStatus] = useState('pending')
  const [riderIdInput, setRiderIdInput] = useState('')
  const [userIdInput, setUserIdInput] = useState('')
  const [appliedRiderId, setAppliedRiderId] = useState('')
  const [appliedUserId, setAppliedUserId] = useState('')
  const [page, setPage] = useState(1)
  const [selectedSettlementId, setSelectedSettlementId] = useState(null)
  const limit = 20

  const fetcher = useCallback(() => {
    const params = {
      status: status || undefined,
      rider_id: appliedRiderId || undefined,
      user_id: appliedUserId || undefined,
      page,
      limit,
    }
    return api.get('/settlements', { params }).then((res) => res.data)
  }, [status, appliedRiderId, appliedUserId, page])

  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const settlements = data?.data ?? []
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0 }

  useRealtimeSync(['settlement:updated', 'admin:settlement_updated'], refetch)

  function handleFilterSubmit(e) {
    if (e) e.preventDefault()
    setAppliedRiderId(riderIdInput.trim())
    setAppliedUserId(userIdInput.trim())
    setPage(1)
  }

  function handleResetFilters() {
    setRiderIdInput('')
    setUserIdInput('')
    setAppliedRiderId('')
    setAppliedUserId('')
    setPage(1)
  }

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Trip Payment Settlements
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Post-trip cash and online payment verification, driver commission debits, and dispute arbitration.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg)] sm:self-auto"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => {
          const isSelected = status === t.value
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setStatus(t.value)
                setPage(1)
              }}
              className="rounded-full border px-3.5 py-1 text-[12.5px] font-medium transition-colors"
              style={{
                borderColor: isSelected ? 'var(--brand)' : 'var(--border)',
                background: isSelected ? 'var(--brand-soft)' : 'transparent',
                color: isSelected ? 'var(--brand)' : 'var(--ink-muted)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Filter Form */}
      <form onSubmit={handleFilterSubmit} className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            placeholder="Filter by Rider ID..."
            value={riderIdInput}
            onChange={(e) => setRiderIdInput(e.target.value)}
            className="w-40 rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
          <input
            type="number"
            min="1"
            placeholder="Filter by User ID..."
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            className="w-40 rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>

        <button
          type="submit"
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          <Search size={13} /> Filter
        </button>

        {(appliedRiderId || appliedUserId || riderIdInput || userIdInput) && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="rounded-lg border px-2.5 py-1.5 text-[12px] font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          >
            Reset
          </button>
        )}
      </form>

      {/* Data Table */}
      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order / ID', 'Customer', 'Driver', 'Amount Due', 'Fare', 'Status', 'Pending Since', 'Dispute / Notes', ''].map((h) => (
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
                    <td colSpan={9} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}

              {!loading && error && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && settlements.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No settlements match the selected filter.
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                settlements.map((s) => {
                  return (
                    <tr
                      key={s.id}
                      style={{ borderTop: '1px solid var(--border)' }}
                      className="hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
                      onClick={() => setSelectedSettlementId(s.id)}
                    >
                      {/* Order / ID */}
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                          Order #{s.order_id}
                        </div>
                        <div className="font-mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          Settle #{s.id}
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <div style={{ color: 'var(--ink)' }}>{s.customer_name || 'Customer'}</div>
                        <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                          {s.customer_mobile || '—'}
                        </div>
                      </td>

                      {/* Driver */}
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <div style={{ color: 'var(--ink)' }}>{s.rider_name || 'Driver'}</div>
                        <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                          {s.rider_mobile || '—'}
                        </div>
                      </td>

                      {/* Amount Due */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-2.5 font-bold" style={{ color: 'var(--brand)' }}>
                        {formatCurrency(s.amount_due)}
                        {s.payer === 'receiver' && (
                          <div className="mt-0.5 flex flex-col items-start gap-0.5 font-sans text-[11px] font-medium">
                            <Badge tone="brand">Receiver pays</Badge>
                            <span style={{ color: 'var(--ink-faint)' }}>
                              + {formatCurrency(Number(s.receiver_markup) || 0)} fee · advance held {formatCurrency(Number(s.advance_held) || 0)}
                            </span>
                          </div>
                        )}
                        {Number(s.reversal_shortfall) > 0 && (
                          <div className="mt-0.5 font-sans">
                            <Badge tone="danger">Shortfall {formatCurrency(Number(s.reversal_shortfall))}</Badge>
                          </div>
                        )}
                      </td>

                      {/* Total Fare */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                        {formatCurrency(s.fare)}
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                          {s.escalated && (
                            <Badge tone="danger">Escalated</Badge>
                          )}
                          {s.method && (
                            <span className="text-[10.5px] uppercase font-mono-data" style={{ color: 'var(--ink-faint)' }}>
                              {s.method}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Pending Since & Minutes */}
                      <td className="whitespace-nowrap px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        <div>{formatDateTime(s.pending_since)}</div>
                        <div className="font-mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          {s.minutes_pending != null ? `${s.minutes_pending}m pending` : '—'}
                        </div>
                      </td>

                      {/* Dispute */}
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-[12px]">
                        {s.dispute_reason ? (
                          <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span className="truncate" title={s.dispute_reason}>
                              {s.dispute_reason}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--ink-faint)' }}>—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="whitespace-nowrap px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedSettlementId(s.id)}
                          className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors hover:bg-[var(--bg)]"
                          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                        >
                          <Eye size={12} /> View / Resolve
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pagination.page}
          limit={pagination.limit}
          total={pagination.total}
          onPageChange={(p) => setPage(p)}
        />
      </div>

      {/* Detail Drawer */}
      <SettlementDetailDrawer
        settlementId={selectedSettlementId}
        open={Boolean(selectedSettlementId)}
        onClose={() => setSelectedSettlementId(null)}
        onResolved={() => refetch()}
      />
    </div>
  )
}
