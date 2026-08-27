import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

export default function WalletAdjustModal({ open, customer, onClose, onDone }) {
  const [type, setType] = useState('credit')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/customers/${customer.id}/wallet-adjust`, { amount: Number(amount), type, remark })
      onDone()
      setAmount('')
      setRemark('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not adjust this wallet.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust wallet — ${customer?.name || customer?.fname || `#${customer?.id}`}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !amount || Number(amount) <= 0}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: type === 'credit' ? 'var(--success)' : 'var(--danger)', color: '#fff' }}
          >
            {submitting ? 'Saving…' : type === 'credit' ? 'Credit wallet' : 'Debit wallet'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3 flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
        {['credit', 'debit'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 rounded-md py-1.5 text-[12.5px] font-semibold capitalize"
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
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="wallet-remark">
        Remark
      </label>
      <input
        id="wallet-remark"
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder="e.g. Delayed delivery promotional refund"
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </Modal>
  )
}
