import { useState } from 'react'
import { Users, Link2 } from 'lucide-react'
import Badge from '../common/Badge'
import { formatCurrency, formatDateTime } from '../../utils/format'

const RP_STATUS_TONE = { active: 'warning', paid: 'success', declined: 'danger', closed: 'neutral' }

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[12.5px]">
      <span style={{ color: 'var(--ink-faint)' }}>{label}</span>
      <div className="text-right font-medium" style={{ color: 'var(--ink)' }}>{children}</div>
    </div>
  )
}

// Shown only for receiver-mode settlements (payer === 'receiver') or ones that were converted
// (advance_held > 0 / a receiver row exists), so a normal settlement never renders this.
export default function ReceiverPayPanel({ settlement, receiverPay, onConvert, converting }) {
  const [confirming, setConfirming] = useState(false)

  const isReceiver = settlement.payer === 'receiver'
  const hasHistory = Boolean(receiverPay) || Number(settlement.advance_held) > 0
  if (!isReceiver && !hasHistory) return null

  const amountDue = Number(settlement.amount_due) || 0
  const markup = Number(settlement.receiver_markup) || 0
  const advanceHeld = Number(settlement.advance_held) || 0
  const shortfall = Number(settlement.reversal_shortfall) || 0
  const canConvert = isReceiver && settlement.status === 'pending'

  async function handleConvert() {
    await onConvert()
    setConfirming(false)
  }

  return (
    <div className="surface-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
          <Users size={13} /> Receiver Pays
        </h3>
        <Badge tone={isReceiver ? 'brand' : 'neutral'}>{isReceiver ? 'Receiver is payer' : 'Converted to customer'}</Badge>
      </div>

      <div className="mt-3 divide-y divide-[color:var(--border)]">
        {receiverPay && (
          <>
            <Row label="Receiver">
              {receiverPay.receiver_name || '—'}
              {receiverPay.receiver_phone ? <span className="font-mono-data"> ({receiverPay.receiver_phone})</span> : null}
            </Row>
            <Row label="Pay link">
              <span className="inline-flex items-center gap-1">
                <Link2 size={12} />
                <Badge tone={RP_STATUS_TONE[receiverPay.status] || 'neutral'}>{receiverPay.status}</Badge>
              </span>
              <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Sent {receiverPay.link_send_count || 0}×{receiverPay.link_sent_at ? ` · last ${formatDateTime(receiverPay.link_sent_at)}` : ''}
              </div>
            </Row>
            {receiverPay.declined_by && (
              <Row label="Declined by">{receiverPay.declined_by}{receiverPay.declined_at ? ` · ${formatDateTime(receiverPay.declined_at)}` : ''}</Row>
            )}
            <Row label="Commission set by booker">{Number(receiverPay.commission_percent)}%</Row>
          </>
        )}
        {isReceiver && (
          <>
            <Row label="Fare due (after coupon / points)"><span className="font-mono-data">{formatCurrency(amountDue)}</span></Row>
            <Row label="Service fee (booker commission)"><span className="font-mono-data">{formatCurrency(markup)}</span></Row>
            <Row label="Receiver pays in total"><span className="font-mono-data font-bold">{formatCurrency(amountDue + markup)}</span></Row>
          </>
        )}
        <Row label="Booker advance held">
          <span className="font-mono-data">{formatCurrency(advanceHeld)}</span>
        </Row>
        <Row label="Booker wallet credited">
          {settlement.receiver_credited ? `Yes (advance refund${markup > 0 ? ' + commission' : ''})` : 'No'}
        </Row>
        {shortfall > 0 && (
          <Row label="Reversal shortfall">
            <span className="font-mono-data font-semibold" style={{ color: 'var(--danger)' }}>{formatCurrency(shortfall)}</span>
            <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>Booker had already spent this; resolve as Customer Owes if it must be collected.</div>
          </Row>
        )}
      </div>

      {canConvert && (
        <div className="mt-3">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="w-full rounded-lg border py-2 text-[12.5px] font-semibold transition-colors hover:bg-[var(--bg)]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              Convert to customer payment
            </button>
          ) : (
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <p className="text-[12px] font-medium" style={{ color: 'var(--ink)' }}>
                Switch this order to normal payment? The receiver&apos;s link is closed, the booker&apos;s advance of {formatCurrency(advanceHeld)} is applied to the fare and the booker (or driver cash) pays the rest.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={converting}
                  onClick={handleConvert}
                  className="flex-1 rounded-lg py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                >
                  {converting ? 'Converting...' : 'Yes, convert'}
                </button>
                <button
                  type="button"
                  disabled={converting}
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
