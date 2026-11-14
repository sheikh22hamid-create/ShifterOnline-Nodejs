import { useCallback, useState } from 'react'
import { Check, RefreshCw, X } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import PayoutApproveModal from '../components/payouts/PayoutApproveModal'
import PayoutRejectModal from '../components/payouts/PayoutRejectModal'
import { PAYOUT_STATUS_FILTERS, payoutStatusTone } from '../utils/payoutStatus'
import { formatCurrency, formatDateTime } from '../utils/format'

const NOTICE_STYLES = {
  error: { background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' },
  warning: { background: 'var(--warning-soft)', borderColor: 'var(--warning-soft-border)', color: 'var(--warning)' },
  success: { background: 'var(--success-soft)', borderColor: 'var(--border)', color: 'var(--success)' },
}

// Tone for a "Check status" result: only a confirmed payment is green.
const SYNC_TONES = { paid: 'success', processing: 'warning', refused: 'warning', failed: 'error' }

// A processing payout, or a paid one RazorpayX can still reverse.
function canCheckStatus(p) {
  return p.status === 'processing' || (p.status === 'paid' && Boolean(p.razorpay_payout_id))
}

export default function Payouts() {
  const [status, setStatus] = useState('')
  const [approveTarget, setApproveTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const [syncingIds, setSyncingIds] = useState([])

  const fetcher = useCallback(() => api.get('/payouts', { params: { status: status || undefined } }).then((res) => res.data), [status])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const payouts = data?.data ?? []

  useRealtimeSync(['admin:payout_request', 'admin:payout_update'], refetch)

  async function handleSync(p) {
    setSyncingIds((ids) => [...ids, p.id])
    try {
      const res = await api.post(`/payouts/${p.id}/sync`)
      const result = res.data?.status
      setNotice({
        tone: SYNC_TONES[result] || 'warning',
        text: `Payout #${p.id}: ${res.data?.message || `status ${result || 'unknown'}`}`,
      })
      refetch()
    } catch (err) {
      setNotice({ tone: 'error', text: err.response?.data?.message || 'Could not check this payout.' })
    } finally {
      setSyncingIds((ids) => ids.filter((id) => id !== p.id))
    }
  }

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Payouts
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Driver withdrawal requests. Approving a request pays the driver out through RazorpayX.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {PAYOUT_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setStatus(f.value)
              setNotice(null)
            }}
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

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[12.5px]"
          style={NOTICE_STYLES[notice.tone] || NOTICE_STYLES.success}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

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
                      {p.payout_detail ? (
                        // What the driver actually picked when requesting this
                        // withdrawal (see customerWalletController.withdrawWallet) -
                        // preferred over bank_account below, which reflects their
                        // *current* saved profile and may have changed since.
                        <span className="font-mono-data text-[12px]">{p.payout_detail}</span>
                      ) : p.bank_account ? (
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
                      {p.status === 'paid' && p.utr && (
                        <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                          UTR <span className="font-mono-data">{p.utr}</span>
                        </div>
                      )}
                      {p.failure_reason && ['failed', 'pending', 'processing'].includes(p.status) && (
                        <div className="mt-1 max-w-[240px] whitespace-normal text-[11.5px]" style={{ color: 'var(--danger)' }}>
                          {p.failure_reason}
                        </div>
                      )}
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
                      {canCheckStatus(p) && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={syncingIds.includes(p.id)}
                            onClick={() => handleSync(p)}
                            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-semibold disabled:opacity-50"
                            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                          >
                            <RefreshCw size={12} className={syncingIds.includes(p.id) ? 'animate-spin' : ''} /> Check status
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
        onDone={(message, tone) => {
          setApproveTarget(null)
          setNotice(message ? { tone: tone || 'success', text: message } : null)
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
