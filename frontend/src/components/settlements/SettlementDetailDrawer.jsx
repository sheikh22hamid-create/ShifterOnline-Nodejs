import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Clock, User, ShieldAlert, CheckCircle2, RefreshCw, FileText, ArrowRight } from 'lucide-react'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import Drawer from '../common/Drawer'
import Badge from '../common/Badge'
import ReceiverPayPanel from './ReceiverPayPanel'
import { formatCurrency, formatDateTime } from '../../utils/format'

const OUTCOME_DESCRIPTIONS = {
  cash_received: {
    label: 'Cash Received (Driver)',
    tone: 'success',
    effect: 'Debit driver commission (normal cash trip). Driver keeps collected cash.',
  },
  paid_online: {
    label: 'Paid Online (Company)',
    tone: 'info',
    effect: 'Credit driver net earning (fare minus commission). Company collected payment online via Razorpay.',
  },
  waived: {
    label: 'Waive Payment (Absorbed)',
    tone: 'neutral',
    effect: 'Credit driver net earning (fare minus commission). Company absorbs the unpaid amount as a goodwill loss.',
  },
  customer_owes: {
    label: 'Customer Owes (Blocked)',
    tone: 'brand',
    effect: 'Credit driver net earning (fare minus commission). Customer owes this amount and is blocked from new bookings until settled.',
  },
}

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

export default function SettlementDetailDrawer({ settlementId, open, onClose, onResolved }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Resolution state
  const [outcome, setOutcome] = useState('cash_received')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [converting, setConverting] = useState(false)
  // Which settlement the drawer currently shows; a slow request for another one must not overwrite it.
  const activeIdRef = useRef(null)

  useEffect(() => {
    activeIdRef.current = open && settlementId ? settlementId : null
    setConverting(false)
    setSubmitting(false)
    if (!open || !settlementId) {
      setData(null)
      setError(null)
      setNote('')
      setConfirming(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    api.get(`/settlements/${settlementId}`)
      .then((res) => {
        if (!cancelled) {
          setData(res.data.data)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Failed to load settlement details')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [open, settlementId])

  async function handleResolveSubmit(e) {
    if (e) e.preventDefault()
    if (!note.trim()) {
      toast.error('A mandatory resolution note is required.')
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/settlements/${settlementId}/resolve`, {
        outcome,
        note: note.trim(),
      })
      toast.success('Settlement resolved successfully.')
      setConfirming(false)
      setNote('')
      if (onResolved) onResolved()
      // Refresh current drawer data
      const res = await api.get(`/settlements/${settlementId}`)
      if (activeIdRef.current === settlementId) setData(res.data.data)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resolve settlement.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConvert() {
    setConverting(true)
    let converted = false
    try {
      const res = await api.post(`/settlements/${settlementId}/convert-to-customer`)
      converted = true
      const phase = res.data?.data?.phase
      toast.success(phase === 'already_normal' ? 'Already a normal customer payment.' : 'Converted to customer payment.')
      if (onResolved) onResolved()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to convert settlement.')
    }
    // Always refresh the drawer: after a failure (e.g. the driver confirmed cash meanwhile) it may be
    // stale, and a refetch problem after a successful convert must not be reported as a failed convert.
    try {
      const fresh = await api.get(`/settlements/${settlementId}`)
      if (activeIdRef.current === settlementId) setData(fresh.data.data)
    } catch {
      if (converted) toast.error('Converted, but the details could not be refreshed. Close and reopen this drawer.')
    }
    if (activeIdRef.current === settlementId) setConverting(false)
  }

  const settlement = data?.settlement
  const events = data?.events ?? []
  const order = data?.order
  const receiverPay = data?.receiver_pay ?? null

  const isAlreadyResolved = settlement && ['cash_received', 'paid_online', 'waived', 'customer_owes'].includes(settlement.status)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={settlement ? `Settlement #${settlement.id} · Order #${settlement.order_id}` : 'Settlement Details'}
      subtitle={settlement ? `Pending since ${formatDateTime(settlement.pending_since)}` : 'Loading...'}
      width={600}
    >
      {loading && (
        <div className="flex h-64 items-center justify-center">
          <div
            className="h-7 w-7 animate-spin rounded-full border-2 border-transparent"
            style={{ borderTopColor: 'var(--brand)', borderRightColor: 'var(--border)' }}
          />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-[13px] text-red-600 dark:text-red-400">
          <p className="font-semibold">Unable to load settlement</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {settlement && !loading && (
        <div className="space-y-6 pb-6">
          {/* Top Status & Amount Card */}
          <div className="surface-card rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
                  Amount Due
                </span>
                <div className="font-mono-data text-[24px] font-bold" style={{ color: 'var(--brand)' }}>
                  {formatCurrency(settlement.amount_due)}
                </div>
                <div className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  Total Trip Fare: <span className="font-mono-data font-semibold">{formatCurrency(settlement.fare)}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={statusTone(settlement.status)}>{settlement.status}</Badge>
                {settlement.escalated_at && (
                  <Badge tone="danger">Escalated</Badge>
                )}
                {settlement.method && (
                  <span className="text-[11px] capitalize" style={{ color: 'var(--ink-faint)' }}>
                    Method: {settlement.method}
                  </span>
                )}
              </div>
            </div>

            {/* Financial Breakdown */}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-[12px]" style={{ borderColor: 'var(--border)' }}>
              <div>
                <span style={{ color: 'var(--ink-faint)' }}>Commission:</span>
                <div className="font-mono-data font-medium">{formatCurrency(settlement.commission_amount ?? 0)}</div>
              </div>
              <div>
                <span style={{ color: 'var(--ink-faint)' }}>Per-Trip Charge:</span>
                <div className="font-mono-data font-medium">{formatCurrency(settlement.per_trip_charge ?? 0)}</div>
              </div>
              <div>
                <span style={{ color: 'var(--ink-faint)' }}>{settlement.payer === 'receiver' ? 'Prepaid (coupon / points):' : 'Prepaid / Advance:'}</span>
                <div className="font-mono-data font-medium">{formatCurrency(settlement.prepaid_amount ?? 0)}</div>
              </div>
            </div>

            {/* Wallet Effect Status */}
            <div className="mt-3 flex items-center justify-between rounded-lg bg-[var(--bg)] px-3 py-2 text-[12px]">
              <span style={{ color: 'var(--ink-muted)' }}>Driver Wallet Movement:</span>
              <span className="font-mono-data font-semibold uppercase" style={{ color: 'var(--ink)' }}>
                {settlement.wallet_effect || 'none'}
              </span>
            </div>
          </div>

          <ReceiverPayPanel settlement={settlement} receiverPay={receiverPay} onConvert={handleConvert} converting={converting} />

          {/* Dispute Notice if Raised */}
          {settlement.status === 'disputed' && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400 text-[13px]">
                <AlertTriangle size={16} />
                Dispute Raised by {settlement.dispute_raised_by === 'customer' ? 'Customer' : 'Driver'}
              </div>
              <p className="mt-2 text-[13px] text-red-700 dark:text-red-300">
                "{settlement.dispute_reason || 'No detailed reason provided'}"
              </p>
              {settlement.dispute_raised_at && (
                <p className="mt-1 text-[11px] text-red-500/80">
                  Raised on {formatDateTime(settlement.dispute_raised_at)}
                </p>
              )}
            </div>
          )}

          {/* Previous Resolution Note if already resolved */}
          {settlement.resolved_at && (
            <div className="surface-card rounded-xl p-4">
              <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                <CheckCircle2 size={14} className="text-emerald-500" />
                Previous Resolution Record
              </div>
              <p className="mt-2 text-[12.5px] italic" style={{ color: 'var(--ink)' }}>
                "{settlement.resolve_note || 'No note recorded'}"
              </p>
              <div className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                Resolved by Admin #{settlement.resolved_by ?? '—'} on {formatDateTime(settlement.resolved_at)}
              </div>
            </div>
          )}

          {/* Order & Route Summary */}
          {order && (
            <div className="surface-card rounded-xl p-4">
              <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
                Order #{order.id} Route & Fares
              </h3>
              <div className="space-y-2 text-[12.5px]">
                <div>
                  <span className="font-semibold text-emerald-600">Pickup:</span>{' '}
                  <span style={{ color: 'var(--ink)' }}>{order.paddress || '—'}</span>
                </div>
                <div>
                  <span className="font-semibold text-rose-600">Drop:</span>{' '}
                  <span style={{ color: 'var(--ink)' }}>{order.daddress || '—'}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-2 text-[12px]" style={{ borderColor: 'var(--border)' }}>
                <div>Order Status: <span className="font-semibold uppercase">{order.o_status}</span></div>
                <div>Total Delivery Charge: <span className="font-mono-data font-semibold">{formatCurrency(order.total_dcharge)}</span></div>
              </div>
            </div>
          )}

          {/* Admin Resolution Action Box */}
          <div className="surface-card rounded-xl p-4 border" style={{ borderColor: 'var(--brand-soft-border)' }}>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
              {isAlreadyResolved ? 'Re-resolve Settlement' : 'Admin Ruling / Resolution'}
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              Select an outcome and enter a mandatory explanation.
            </p>

            {settlement.payer === 'receiver' && !isAlreadyResolved && (
              <div className="mt-3 rounded-lg border p-3 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                <strong style={{ color: 'var(--ink)' }}>Receiver-paid order:</strong> <em>Cash Received</em> and <em>Paid Online</em> refund the booker&apos;s advance
                (Paid Online also credits the booker&apos;s commission). <em>Waive</em> and <em>Customer Owes</em> convert the order to normal customer payment and the
                advance is consumed against the fare, never refunded.
              </div>
            )}

            {isAlreadyResolved && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-300">
                <RefreshCw size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>Notice:</strong> This settlement is already settled as <code>{settlement.status}</code>. Selecting a different outcome will automatically reverse the previous driver wallet movement before applying the new effect.
                </span>
              </div>
            )}

            <form onSubmit={handleResolveSubmit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  Outcome Ruling
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(OUTCOME_DESCRIPTIONS).map(([key, item]) => {
                    const selected = outcome === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setOutcome(key)}
                        className="flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors"
                        style={{
                          borderColor: selected ? 'var(--brand)' : 'var(--border)',
                          background: selected ? 'var(--brand-soft)' : 'var(--bg)',
                        }}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-[12.5px] font-semibold" style={{ color: selected ? 'var(--brand)' : 'var(--ink)' }}>
                            {item.label}
                          </span>
                          <Badge tone={item.tone}>{key}</Badge>
                        </div>
                        <span className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {item.effect}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  Mandatory Resolution Note
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why this outcome was chosen (e.g. Driver verified cash in hand via phone call, or Customer confirmed online transfer failed)..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              {!confirming ? (
                <button
                  type="button"
                  disabled={!note.trim()}
                  onClick={() => setConfirming(true)}
                  className="w-full rounded-lg py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                >
                  Confirm Ruling for {OUTCOME_DESCRIPTIONS[outcome]?.label}
                </button>
              ) : (
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                  <p className="text-[12px] font-medium" style={{ color: 'var(--ink)' }}>
                    Are you sure you want to resolve this settlement as <strong>{outcome}</strong>?
                  </p>
                  <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {OUTCOME_DESCRIPTIONS[outcome]?.effect}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 rounded-lg py-1.5 text-[12px] font-semibold shadow-xs"
                      style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                    >
                      {submitting ? 'Applying Changes...' : 'Yes, Apply Ruling'}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => setConfirming(false)}
                      className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Event Audit Timeline */}
          <div className="surface-card rounded-xl p-4">
            <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
              Audit Event Timeline
            </h3>

            {events.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>No recorded events.</p>
            ) : (
              <div className="space-y-3">
                {events.map((evt, idx) => (
                  <div key={evt.id || idx} className="relative flex gap-3 text-[12px]">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg)] border" style={{ borderColor: 'var(--border)' }}>
                      <Clock size={12} style={{ color: 'var(--brand)' }} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold capitalize" style={{ color: 'var(--ink)' }}>
                          {evt.actor} {evt.actor_id ? `(#${evt.actor_id})` : ''}
                        </span>
                        {evt.from_status && evt.to_status ? (
                          <span className="flex items-center gap-1 font-mono-data text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                            <span>{evt.from_status}</span>
                            <ArrowRight size={10} />
                            <span className="font-semibold">{evt.to_status}</span>
                          </span>
                        ) : evt.to_status ? (
                          <span className="font-mono-data text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                            {evt.to_status}
                          </span>
                        ) : null}
                      </div>

                      {evt.note && (
                        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                          {evt.note}
                        </p>
                      )}

                      <span className="mt-1 block font-mono-data text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {formatDateTime(evt.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}
