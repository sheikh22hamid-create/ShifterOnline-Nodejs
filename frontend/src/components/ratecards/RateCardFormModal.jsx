import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

const EMPTY_FORM = {
  title: '',
  type: 'USER',
  cat_id: '',
  city_id: '',
  min_charge: '',
  per_km_charge: '',
  free_waiting_time: '5',
  waiting_charge: '',
  start_time: '00:00',
  end_time: '00:00',
  night_charge_percent: '0',
  service_charge_percent: '0',
  driver_per_percent: '80',
  status: 1,
}

function Label({ children, htmlFor }) {
  return (
    <label className="mb-1.5 block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor={htmlFor}>
      {children}
    </label>
  )
}

function Input(props) {
  return <input {...props} className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE} />
}

export default function RateCardFormModal({ open, rateCard, onClose, onSaved }) {
  const isEdit = Boolean(rateCard)
  const categoriesFetcher = useCallback(() => api.get('/categories').then((res) => res.data.data), [])
  const { data: categories } = useApiQuery(categoriesFetcher)

  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which rate card
    // it targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(
      rateCard
        ? {
            title: rateCard.title,
            type: rateCard.type,
            cat_id: rateCard.cat_id,
            city_id: rateCard.city_id,
            min_charge: rateCard.min_charge,
            per_km_charge: rateCard.per_km_charge,
            free_waiting_time: rateCard.free_waiting_time,
            waiting_charge: rateCard.waiting_charge,
            start_time: rateCard.start_time,
            end_time: rateCard.end_time,
            night_charge_percent: rateCard.night_charge_percent,
            service_charge_percent: rateCard.service_charge_percent,
            driver_per_percent: rateCard.driver_per_percent,
            status: rateCard.status,
          }
        : EMPTY_FORM
    )
  }, [open, rateCard])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) {
        await api.put(`/rate-cards/${rateCard.id}`, form)
      } else {
        await api.post('/rate-cards', form)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this rate card.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${rateCard.title}` : 'New rate card'}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create rate card'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Model 1" />
          </div>
          <div>
            <Label htmlFor="cat_id">Category</Label>
            <select id="cat_id" value={form.cat_id} onChange={(e) => set('cat_id', e.target.value)} className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE}>
              <option value="">Select category</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cat_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="city_id">City ID(s)</Label>
            <Input id="city_id" value={form.city_id} onChange={(e) => set('city_id', e.target.value)} placeholder="1 or 1,2,3" />
          </div>
          <div>
            <Label htmlFor="type">Applies to</Label>
            <select id="type" value={form.type} onChange={(e) => set('type', e.target.value)} className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE}>
              <option value="USER">Customer fare</option>
              <option value="DRIVER">Driver earning</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="min_charge">Min fare (₹)</Label>
            <Input id="min_charge" type="number" value={form.min_charge} onChange={(e) => set('min_charge', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="per_km_charge">Per km (₹)</Label>
            <Input id="per_km_charge" type="number" value={form.per_km_charge} onChange={(e) => set('per_km_charge', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="free_waiting_time">Free wait (min)</Label>
            <Input id="free_waiting_time" type="number" value={form.free_waiting_time} onChange={(e) => set('free_waiting_time', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="waiting_charge">Waiting charge (₹/min)</Label>
            <Input id="waiting_charge" type="number" value={form.waiting_charge} onChange={(e) => set('waiting_charge', e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Night-surge window</Label>
          <div className="flex items-center gap-2">
            <Input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
            <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              to
            </span>
            <Input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="night_charge_percent">Night surge %</Label>
            <Input id="night_charge_percent" type="number" value={form.night_charge_percent} onChange={(e) => set('night_charge_percent', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="service_charge_percent">Commission %</Label>
            <Input id="service_charge_percent" type="number" value={form.service_charge_percent} onChange={(e) => set('service_charge_percent', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="driver_per_percent">Driver share %</Label>
            <Input id="driver_per_percent" type="number" value={form.driver_per_percent} onChange={(e) => set('driver_per_percent', e.target.value)} />
          </div>
        </div>

        {isEdit && (
          <div>
            <Label htmlFor="status">Status</Label>
            <select id="status" value={form.status} onChange={(e) => set('status', e.target.value)} className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE}>
              <option value={1}>Active</option>
              <option value={0}>Inactive</option>
            </select>
          </div>
        )}
      </div>
    </Modal>
  )
}
