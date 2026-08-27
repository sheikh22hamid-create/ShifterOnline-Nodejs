import { useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { c_title: '', c_desc: '', c_value: '', min_amt: '', ulimit: '1', status: 1 }

export default function CouponFormModal({ open, coupon, onClose, onSaved }) {
  const isEdit = Boolean(coupon)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which coupon it
    // targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(
      coupon
        ? { c_title: coupon.c_title, c_desc: coupon.c_desc, c_value: coupon.c_value, min_amt: String(coupon.min_amt), ulimit: String(coupon.ulimit), status: coupon.status }
        : EMPTY_FORM
    )
  }, [open, coupon])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/marketing/coupons/${coupon.id}`, form)
      else await api.post('/marketing/coupons', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this coupon.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${coupon.c_title}` : 'New coupon'}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.c_title || !form.c_value || !form.min_amt}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create coupon'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="coup-title">
        Code / title
      </label>
      <input id="coup-title" value={form.c_title} onChange={(e) => setForm((f) => ({ ...f, c_title: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. WELCOME50" />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="coup-desc">
        Description
      </label>
      <input id="coup-desc" value={form.c_desc} onChange={(e) => setForm((f) => ({ ...f, c_desc: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Flat ₹50 off on your first order" />

      <div className="mb-3 grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="coup-value">
            Value (₹ or %)
          </label>
          <input id="coup-value" value={form.c_value} onChange={(e) => setForm((f) => ({ ...f, c_value: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="coup-min">
            Min cart (₹)
          </label>
          <input id="coup-min" type="number" value={form.min_amt} onChange={(e) => setForm((f) => ({ ...f, min_amt: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="coup-limit">
            Uses/user
          </label>
          <input id="coup-limit" type="number" value={form.ulimit} onChange={(e) => setForm((f) => ({ ...f, ulimit: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
      </div>

      {isEdit && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="coup-status">
            Status
          </label>
          <select id="coup-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value={1}>Active</option>
            <option value={0}>Inactive</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
