import { useCallback, useState } from 'react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import { formatCurrency, formatDateTime } from '../utils/format'

const LIMIT = 25

const ENTITY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'driver', label: 'Drivers' },
  { value: 'user', label: 'Customers' },
]

const TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'credit', label: 'Credits' },
  { value: 'debit', label: 'Debits' },
]

export default function WalletAdjustments() {
  const [walletType, setWalletType] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)

  const fetcher = useCallback(
    () =>
      api
        .get('/wallet-adjustments', { params: { wallet_type: walletType || undefined, type: type || undefined, page, limit: LIMIT } })
        .then((res) => res.data),
    [walletType, type, page]
  )
  const { data, loading, error } = useApiQuery(fetcher)
  const rows = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Wallet Adjustments
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Audit trail of every manual credit/debit an admin has made to a driver's or customer's wallet.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
          {ENTITY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setWalletType(f.value)
                setPage(1)
              }}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ background: walletType === f.value ? 'var(--brand-soft)' : 'transparent', color: walletType === f.value ? 'var(--brand)' : 'var(--ink-muted)' }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setType(f.value)
                setPage(1)
              }}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ background: type === f.value ? 'var(--brand-soft)' : 'transparent', color: type === f.value ? 'var(--brand)' : 'var(--ink-muted)' }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Entity', 'Amount', 'Remark', 'Adjusted by', 'Date', ''].map((h) => (
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
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No manual wallet adjustments match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{r.entity_name}</div>
                      <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        <Badge tone={r.wallet_type === 'driver' ? 'info' : 'neutral'}>{r.wallet_type === 'driver' ? 'Driver' : 'Customer'}</Badge>
                        <span className="font-mono-data">{r.entity_mobile}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="font-mono-data font-semibold text-[12.5px]" style={{ color: r.type === 'credit' ? 'var(--success)' : 'var(--danger)' }}>
                        {r.type === 'credit' ? '+' : '−'} {formatCurrency(r.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 max-w-[280px] truncate" style={{ color: 'var(--ink-muted)' }} title={r.remark}>
                      {r.remark || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {r.admin_name}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(r.created_at)}
                    </td>
                    <td />
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
