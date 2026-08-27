import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'
import { resolveImageUrl } from '../../utils/imageUrl'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { img: '', city_id: '', status: 1 }

export default function BannerFormModal({ open, banner, onClose, onSaved }) {
  const isEdit = Boolean(banner)
  const citiesFetcher = useCallback(() => api.get('/cities').then((res) => res.data.data), [])
  const { data: cities } = useApiQuery(citiesFetcher)

  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which banner it
    // targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(banner ? { img: banner.img, city_id: banner.city_id, status: banner.status } : EMPTY_FORM)
  }, [open, banner])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/marketing/banners/${banner.id}`, form)
      else await api.post('/marketing/banners', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this banner.')
    } finally {
      setSubmitting(false)
    }
  }

  const previewUrl = resolveImageUrl(form.img)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit banner #${banner.id}` : 'New banner'}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.img || !form.city_id}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create banner'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3 flex h-32 w-full items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
        ) : (
          <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
            No image
          </span>
        )}
      </div>

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="banner-img">
        Image path
      </label>
      <input
        id="banner-img"
        value={form.img}
        onChange={(e) => setForm((f) => ({ ...f, img: e.target.value }))}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={FIELD_STYLE}
        placeholder="images/banner/promo.jpg"
      />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="banner-city">
        Target city
      </label>
      <select id="banner-city" value={form.city_id} onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
        <option value="">Select city</option>
        {cities?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>

      {isEdit && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="banner-status">
            Status
          </label>
          <select id="banner-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value={1}>Active</option>
            <option value={0}>Inactive</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
