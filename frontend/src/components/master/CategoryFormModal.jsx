import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'
import { resolveImageUrl } from '../../utils/imageUrl'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { cat_name: '', cat_img: '', city_id: '', sort_order: '0', cat_status: 1 }

export default function CategoryFormModal({ open, category, onClose, onSaved }) {
  const isEdit = Boolean(category)
  const citiesFetcher = useCallback(() => api.get('/cities').then((res) => res.data.data), [])
  const { data: cities } = useApiQuery(citiesFetcher)

  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which category
    // it targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(
      category
        ? { cat_name: category.cat_name, cat_img: category.cat_img, city_id: category.city_id ?? '', sort_order: String(category.sort_order ?? 0), cat_status: category.cat_status }
        : EMPTY_FORM
    )
  }, [open, category])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/categories/${category.id}`, form)
      else await api.post('/categories', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this category.')
    } finally {
      setSubmitting(false)
    }
  }

  const previewUrl = resolveImageUrl(form.cat_img)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${category.cat_name}` : 'New category'}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.cat_name || !form.cat_img}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create category'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
          ) : (
            <span className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
              No icon
            </span>
          )}
        </div>
        <div className="flex-1">
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-img">
            Icon path
          </label>
          <input
            id="cat-img"
            value={form.cat_img}
            onChange={(e) => setForm((f) => ({ ...f, cat_img: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
            placeholder="images/category/bike.png"
          />
        </div>
      </div>

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-name">
        Category name
      </label>
      <input id="cat-name" value={form.cat_name} onChange={(e) => setForm((f) => ({ ...f, cat_name: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. Bike" />

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-city">
            City (optional)
          </label>
          <select id="cat-city" value={form.city_id} onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value="">All cities</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-sort">
            Sort order
          </label>
          <input id="cat-sort" type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
      </div>

      {isEdit && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-status">
            Status
          </label>
          <select id="cat-status" value={form.cat_status} onChange={(e) => setForm((f) => ({ ...f, cat_status: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value={1}>Active</option>
            <option value={0}>Inactive</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
