import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

export default function PayoutApproveModal({ open, payout, onClose, onDone }) {
  const [transactionReference, setTransactionReference] = useState('')
  const [paymentProofUrl, setPaymentProofUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleApprove() {
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/payouts/${payout.id}/approve`, {
        transaction_reference: transactionReference || undefined,
        payment_proof_url: paymentProofUrl || undefined,
      })
      onDone()
      setTransactionReference('')
      setPaymentProofUrl('')
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
      <p className="mb-3 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Approving debits <span className="font-mono-data">₹{payout?.amount}</span> from the driver's wallet and marks
        this withdrawal request as paid.
      </p>
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="txn-ref">
        Transaction reference (optional)
      </label>
      <input
        id="txn-ref"
        value={transactionReference}
        onChange={(e) => setTransactionReference(e.target.value)}
        placeholder="e.g. UTR98342084923"
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="proof-url">
        Payment proof URL (optional)
      </label>
      <input
        id="proof-url"
        value={paymentProofUrl}
        onChange={(e) => setPaymentProofUrl(e.target.value)}
        placeholder="/uploads/payouts/proof.jpg"
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </Modal>
  )
}
