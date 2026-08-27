import { useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { title: '', v_rquired: '', status: 1 }

export default function VehicleFormModal({ open, vehicle, onClose, onSaved }) {
  const isEdit = Boolean(vehicle)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which vehicle
    // type it targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(vehicle ? { title: vehicle.title, v_rquired: vehicle.v_rquired, status: vehicle.status } : EMPTY_FORM)
  }, [open, vehicle])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/vehicles/${vehicle.id}`, form)
      else await api.post('/vehicles', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this vehicle type.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${vehicle.title}` : 'New vehicle type'}
      width={400}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.title}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create vehicle type'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="vehicle-title">
        Vehicle name
      </label>
      <input id="vehicle-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. 3 Wheeler" />
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="vehicle-required">
        Required kit items (comma-separated)
      </label>
      <input
        id="vehicle-required"
        value={form.v_rquired}
        onChange={(e) => setForm((f) => ({ ...f, v_rquired: e.target.value }))}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={FIELD_STYLE}
        placeholder="e.g. Reflective Jacket, Phone Mount"
      />
      {isEdit && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="vehicle-status">
            Status
          </label>
          <select id="vehicle-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value={1}>Active</option>
            <option value={0}>Inactive</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
