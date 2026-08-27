import { useCallback, useState } from 'react'
import { Check, X } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import PayoutApproveModal from '../components/payouts/PayoutApproveModal'
import PayoutRejectModal from '../components/payouts/PayoutRejectModal'
import { PAYOUT_STATUS_FILTERS, payoutStatusTone } from '../utils/payoutStatus'
import { formatCurrency, formatDateTime } from '../utils/format'

export default function Payouts() {
  const [status, setStatus] = useState('')
  const [approveTarget, setApproveTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)

  const fetcher = useCallback(() => api.get('/payouts', { params: { status: status || undefined } }).then((res) => res.data), [status])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const payouts = data?.data ?? []

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Payouts
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Driver withdrawal requests.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {PAYOUT_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className="rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors"
            style={{
              borderColor: status === f.value ? 'var(--brand)' : 'var(--border)',
              background: status === f.value ? 'var(--brand-soft)' : 'transparent',
              color: status === f.value ? 'var(--brand)' : 'var(--ink-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Driver', 'Amount', 'Bank account', 'Status', 'Requested', ''].map((h) => (
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
              {!loading && !error && payouts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No withdrawal requests match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                payouts.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{p.rider_name || `Driver #${p.rider_id}`}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {p.rider_mobile}
                      </div>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {p.bank_account ? (
                        <>
                          {p.bank_account.bank_name}
                          <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                            {p.bank_account.account_no} · {p.bank_account.ifsc}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--ink-faint)' }}>No bank on file</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={payoutStatusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(p.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {p.status === 'pending' && (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setApproveTarget(p)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold"
                            style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
                          >
                            <Check size={12} /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTarget(p)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold"
                            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                          >
                            <X size={12} /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <PayoutApproveModal
        open={Boolean(approveTarget)}
        payout={approveTarget}
        onClose={() => setApproveTarget(null)}
        onDone={() => {
          setApproveTarget(null)
          refetch()
        }}
      />
      <PayoutRejectModal
        open={Boolean(rejectTarget)}
        payout={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onDone={() => {
          setRejectTarget(null)
          refetch()
        }}
      />
    </div>
  )
}
