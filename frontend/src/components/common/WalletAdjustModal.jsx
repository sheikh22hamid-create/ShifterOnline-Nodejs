import { useState } from 'react'
import api from '../../services/api'
import Modal from './Modal'
import { formatCurrency } from '../../utils/format'

const REASON_PRESETS = [
  'App problem compensation',
  'Delayed delivery compensation',
  'Refund',
  'Promotional credit',
  'Referral bonus',
  'Fraud / abuse recovery',
  'Other',
]

// Adjustments at or above this amount ask for an explicit second confirmation
// before submitting, to catch fat-finger entry on a debit/credit that size.
const CONFIRM_THRESHOLD = 1000

/**
 * Credit/debit modal shared by the Customer and Driver detail drawers.
 * `endpoint` is the wallet-adjust API path for the entity being adjusted
 * (e.g. `/customers/5/wallet-adjust` or `/riders/5/wallet-adjust`).
 */
export default function WalletAdjustModal({ open, endpoint, name, onClose, onDone }) {
  const [type, setType] = useState('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState(REASON_PRESETS[0])
  const [remark, setRemark] = useState(REASON_PRESETS[0])
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setAmount('')
    setReason(REASON_PRESETS[0])
    setRemark(REASON_PRESETS[0])
    setConfirming(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleReasonChange(value) {
    setReason(value)
    if (value !== 'Other') setRemark(value)
    else setRemark('')
  }

  async function handleSubmit() {
    const amt = Number(amount)
    if (!confirming && amt >= CONFIRM_THRESHOLD) {
      setConfirming(true)
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await api.post(endpoint, { amount: amt, type, remark })
      onDone()
      reset()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not adjust this wallet.')
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }

  const amt = Number(amount)
  const canSubmit = amount && amt > 0 && remark.trim()

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Adjust wallet — ${name || ''}`}
      footer={
        <>
          <button type="button" onClick={handleClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !canSubmit}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: type === 'credit' ? 'var(--success)' : 'var(--danger)', color: '#fff' }}
          >
            {submitting
              ? 'Saving…'
              : confirming
              ? `Confirm ${type === 'credit' ? 'credit' : 'debit'} of ${formatCurrency(amt)}`
              : type === 'credit'
              ? 'Credit wallet'
              : 'Debit wallet'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {confirming && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning-soft-border)', color: 'var(--warning)' }}>
          This is a large adjustment ({formatCurrency(amt)}). Double-check the amount and remark, then click Confirm to proceed.
        </div>
      )}

      <div className="mb-3 flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
        {['credit', 'debit'].map((t) => (
          <button
            key={t}
            type="button"
            disabled={confirming}
            onClick={() => {
              setType(t)
              setConfirming(false)
            }}
            className="flex-1 rounded-md py-1.5 text-[12.5px] font-semibold capitalize disabled:opacity-60"
            style={{ background: type === t ? (t === 'credit' ? 'var(--success-soft)' : 'var(--danger-soft)') : 'transparent', color: type === t ? (t === 'credit' ? 'var(--success)' : 'var(--danger)') : 'var(--ink-muted)' }}
          >
            {t}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="wallet-amount">
        Amount (₹)
      </label>
      <input
        id="wallet-amount"
        type="number"
        min="0"
        disabled={confirming}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value)
          setConfirming(false)
        }}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none disabled:opacity-60"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="wallet-reason">
        Reason
      </label>
      <select
        id="wallet-reason"
        disabled={confirming}
        value={reason}
        onChange={(e) => handleReasonChange(e.target.value)}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none disabled:opacity-60"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      >
        {REASON_PRESETS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="wallet-remark">
        Remark {reason === 'Other' ? '' : '(shown to the user — edit if needed)'}
      </label>
      <input
        id="wallet-remark"
        disabled={confirming}
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder="e.g. Amount added for app problem"
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none disabled:opacity-60"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </Modal>
  )
}
