import { useCallback, useEffect, useState } from 'react'
import { Upload, Image, Loader2 } from 'lucide-react'
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
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(
      category
        ? { cat_name: category.cat_name, cat_img: category.cat_img, city_id: category.city_id ?? '', sort_order: String(category.sort_order ?? 0), cat_status: category.cat_status }
        : EMPTY_FORM
    )
  }, [open, category])

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    const formData = new FormData()
    formData.append('image', file)
    formData.append('folder', 'category')
    try {
      const res = await api.post('/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data?.path) {
        setForm((f) => ({ ...f, cat_img: res.data.path }))
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to upload image')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

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
      title={isEdit ? `Edit ${category.cat_name}` : 'New Vehicle Category'}
      width={440}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || uploading || !form.cat_name || !form.cat_img}
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

      {/* Category Name */}
      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-name">
          Category name
        </label>
        <input
          id="cat-name"
          value={form.cat_name}
          onChange={(e) => setForm((f) => ({ ...f, cat_name: e.target.value }))}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
          placeholder="e.g. Bike, 3 Wheeler"
        />
      </div>

      {/* Image / Icon Section */}
      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Vehicle Category Image / Icon
        </label>
        
        <div className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          {/* Image Preview Box */}
          <div className="relative flex h-16 w-16 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" className="h-full w-full object-contain p-1" onError={(e) => (e.currentTarget.style.display = 'none')} />
            ) : (
              <div className="flex flex-col items-center gap-1 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                <Image size={18} />
                <span>No icon</span>
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
                <Loader2 size={18} className="animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 space-y-2">
            {/* Upload Button */}
            <div>
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                  uploading ? 'pointer-events-none opacity-50' : ''
                }`}
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                <span>{uploading ? 'Uploading image...' : 'Upload Image / Icon'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              </label>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Supports PNG, JPG, WEBP, SVG
              </p>
            </div>

            {/* Manual URL Input Option */}
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }} htmlFor="cat-img">
                Or enter Image URL / Path manually:
              </label>
              <input
                id="cat-img"
                value={form.cat_img}
                onChange={(e) => setForm((f) => ({ ...f, cat_img: e.target.value }))}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[12px] outline-none"
                style={FIELD_STYLE}
                placeholder="images/category/bike.png or https://..."
              />
            </div>
          </div>
        </div>
      </div>

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

