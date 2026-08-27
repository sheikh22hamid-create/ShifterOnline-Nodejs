import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

export default function CancelOrderModal({ open, order, onClose, onCancelled }) {
  const [comment, setComment] = useState('')
  const [applyFee, setApplyFee] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleCancel() {
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/orders/${order.id}/cancel`, { comment, apply_cancellation_fee: applyFee })
      onCancelled()
      setComment('')
      setApplyFee(false)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not cancel this order.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cancel order #${order?.id}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Keep order
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleCancel}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--danger)' }}
          >
            {submitting ? 'Cancelling…' : 'Cancel order'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cancel-comment">
        Reason
      </label>
      <textarea
        id="cancel-comment"
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="e.g. Driver breakdown, no alternative vehicle found"
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--bg)' }}
      />

      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        <input type="checkbox" checked={applyFee} onChange={(e) => setApplyFee(e.target.checked)} />
        Charge the customer's cancellation fee for this order's rate card
      </label>
    </Modal>
  )
}
