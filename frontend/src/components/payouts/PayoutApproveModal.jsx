import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

export default function PayoutApproveModal({ open, payout, onClose, onDone }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleApprove() {
    setSubmitting(true)
    setError('')
    try {
      const response = await api.post(`/payouts/${payout.id}/approve`, {})
      onDone(response.data?.message)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not approve this payout.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Approve payout — ${payout?.rider_name || `#${payout?.id}`}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleApprove}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--success)', color: '#fff' }}
          >
            {submitting ? 'Approving…' : 'Approve & pay out'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Sends <span className="font-mono-data">₹{payout?.amount}</span> to the driver's UPI/bank immediately via
        Razorpay. This can't be undone once the bank accepts it.
      </p>
    </Modal>
  )
}
