import { useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

export default function AdjustPointsModal({ open, onClose, onDone }) {
  const [userId, setUserId] = useState('')
  const [userType, setUserType] = useState('USER')
  const [points, setPoints] = useState('')
  const [type, setType] = useState('credit')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      await api.post('/referrals/adjust-points', { user_id: Number(userId), user_type: userType, points: Number(points), type, reason })
      onDone()
      setUserId('')
      setPoints('')
      setReason('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not adjust points.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manual point adjustment"
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !userId || !points}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : 'Apply adjustment'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="adj-userid">
            User/Driver ID
          </label>
          <input id="adj-userid" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="adj-usertype">
            Type
          </label>
          <select id="adj-usertype" value={userType} onChange={(e) => setUserType(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value="USER">Customer</option>
            <option value="DRIVER">Driver</option>
          </select>
        </div>
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
        {['credit', 'debit'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 rounded-md py-1.5 text-[12.5px] font-semibold capitalize"
            style={{ background: type === t ? 'var(--brand-soft)' : 'transparent', color: type === t ? 'var(--brand)' : 'var(--ink-muted)' }}
          >
            {t}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="adj-points">
        Points
      </label>
      <input id="adj-points" type="number" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="adj-reason">
        Reason
      </label>
      <input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. Goodwill credit for referral tracking bug" />
    </Modal>
  )
}
