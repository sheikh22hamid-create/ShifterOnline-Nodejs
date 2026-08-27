import { useEffect, useState } from 'react'
import { Check, X, FileWarning } from 'lucide-react'
import Badge from '../common/Badge'
import { DOC_STATUS_LABELS, DOC_STATUS_TONES, REJECTION_CHIPS } from '../../utils/kycDoc'

export default function DocumentDecisionCard({ docType, active, onFocus, onDecide, busy, rejectSignal }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  // rejectSignal increments only while this card is the active one (see
  // KycApproval's keydown handler) — opens the reason-chip flow on "R".
  useEffect(() => {
    // Guarded so it never fires on mount (rejectSignal starts undefined) —
    // only on a real "R" keypress bump from the parent, a genuine external
    // event this effect is syncing from.
    if (rejectSignal) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRejecting(true)
    }
  }, [rejectSignal])

  const status = docType.status
  const hasRecord = status !== undefined && status !== null
  const disabled = !hasRecord || busy

  function approve() {
    onDecide(docType.key, docType.recordId, 1)
  }
  function confirmReject() {
    onDecide(docType.key, docType.recordId, 0, reason)
    setRejecting(false)
    setReason('')
  }

  return (
    <div
      className="cursor-pointer rounded-xl border p-3.5 transition-colors"
      style={{
        borderColor: active ? 'var(--brand)' : 'var(--border)',
        background: active ? 'var(--brand-soft)' : 'var(--surface)',
      }}
      onClick={() => onFocus(docType.key)}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
          {docType.label}
        </span>
        {hasRecord ? (
          <Badge tone={DOC_STATUS_TONES[status]}>{DOC_STATUS_LABELS[status]}</Badge>
        ) : (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
            <FileWarning size={12} /> not submitted
          </span>
        )}
      </div>

      {hasRecord && !rejecting && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={approve}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
          >
            <Check size={13} /> Approve <kbd className="opacity-60">A</kbd>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setRejecting(true)}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            <X size={13} /> Reject <kbd className="opacity-60">R</kbd>
          </button>
        </div>
      )}

      {rejecting && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {REJECTION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setReason(chip)}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: reason === chip ? 'var(--danger)' : 'var(--border)',
                  color: reason === chip ? 'var(--danger)' : 'var(--ink-muted)',
                  background: reason === chip ? 'var(--danger-soft)' : 'transparent',
                }}
              >
                {chip}
              </button>
            ))}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Rejection reason"
            className="w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRejecting(false)} className="rounded-lg border px-2.5 py-1 text-[11.5px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!reason || busy}
              onClick={confirmReject}
              className="rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--danger)' }}
            >
              Confirm reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
