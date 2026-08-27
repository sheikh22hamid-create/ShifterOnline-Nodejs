import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

export default function PayoutRejectModal({ open, payout, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleReject() {
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/payouts/${payout.id}/reject`, { rejection_reason: reason })
      onDone()
      setReason('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reject this payout.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reject payout — ${payout?.rider_name || `#${payout?.id}`}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleReject}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--danger)' }}
          >
            {submitting ? 'Rejecting…' : 'Reject request'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="reject-reason">
        Reason
      </label>
      <textarea
        id="reject-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Bank IFSC code mismatch"
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </Modal>
  )
}
