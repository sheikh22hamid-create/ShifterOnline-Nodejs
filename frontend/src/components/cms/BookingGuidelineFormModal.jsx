import { useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { text: '', sort_order: 0, status: true }

export default function BookingGuidelineFormModal({ open, item, onClose, onSaved }) {
  const isEdit = Boolean(item)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which restricted item
    // it targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(item ? { text: item.text, sort_order: item.sort_order, status: item.status } : EMPTY_FORM)
  }, [open, item])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/booking-guidelines/${item.id}`, form)
      else await api.post('/booking-guidelines', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this guideline.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit guideline' : 'New guideline'}
      width={400}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.text.trim()}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create guideline'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="guideline-text">
        Guideline text
      </label>
      <textarea id="guideline-text" rows={3} value={form.text} maxLength={255} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. Toll and parking charges are paid by the customer." />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="guideline-sort">
        Sort order
      </label>
      <input id="guideline-sort" type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />

      {isEdit && (
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked }))} /> Active
        </label>
      )}
    </Modal>
  )
}
