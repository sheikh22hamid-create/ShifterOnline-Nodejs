import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'
import ImageUploadField from '../common/ImageUploadField'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const BODY_TYPES = [
  { id: 'open', label: '🛻 Open Body', desc: 'Open dala' },
  { id: 'half', label: '🚚 Half Body', desc: 'Half dala' },
  { id: 'covered', label: '📦 Covered', desc: 'Closed / Tirpal' },
]

const EMPTY_FORM = {
  cat_name: '', cat_img: '', city_id: '', sort_order: '0', cat_status: 1,
  max_load_kg: '', dim_length: '', dim_width: '', dim_height: '', dim_unit: 'ft', detail_image: '', max_extra_stops: '', extra_stop_charge: '',
  allowed_body_types: 'open,half,covered',
  driver_body_types: 'open,half,covered',
}

export default function CategoryFormModal({ open, category, onClose, onSaved }) {
  const isEdit = Boolean(category)
  const citiesFetcher = useCallback(() => api.get('/cities').then((res) => res.data.data), [])
  const { data: cities } = useApiQuery(citiesFetcher)

  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (category) {
      let resolvedAllowed = category.allowed_body_types;
      let resolvedDriver = category.driver_body_types;
      const is2W = /bike|scooter|motorcycle|2\s*wheeler/i.test(category.cat_name || '');
      if (resolvedAllowed === undefined || resolvedAllowed === null) {
        resolvedAllowed = is2W ? '' : 'open,half,covered';
      }
      if (resolvedDriver === undefined || resolvedDriver === null) {
        resolvedDriver = resolvedAllowed;
      }
      setForm({
        cat_name: category.cat_name, cat_img: category.cat_img, city_id: category.city_id ?? '',
        sort_order: String(category.sort_order ?? 0), cat_status: category.cat_status,
        max_load_kg: category.max_load_kg ?? '', dim_length: category.dim_length ?? '',
        dim_width: category.dim_width ?? '', dim_height: category.dim_height ?? '',
        dim_unit: category.dim_unit || 'ft', detail_image: category.detail_image ?? '',
        max_extra_stops: category.max_extra_stops ?? '', extra_stop_charge: category.extra_stop_charge ?? '',
        allowed_body_types: resolvedAllowed,
        driver_body_types: resolvedDriver,
      })
    } else {
      setForm(EMPTY_FORM)
    }
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

      <div className="mb-3">
        <ImageUploadField
          label="Icon"
          value={form.cat_img}
          onChange={(v) => setForm((f) => ({ ...f, cat_img: v }))}
          folder="category"
          placeholder="images/category/bike.png"
        />
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

      <div className="mb-3">
        <ImageUploadField
          label="Detail photo (shown on the customer app's vehicle Details screen)"
          value={form.detail_image}
          onChange={(v) => setForm((f) => ({ ...f, detail_image: v }))}
          folder="category"
          placeholder="images/category/bike_detail.png (falls back to the icon above if left blank)"
        />
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Max load capacity
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={form.max_load_kg}
            onChange={(e) => setForm((f) => ({ ...f, max_load_kg: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
            placeholder="e.g. 20"
          />
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>kg</span>
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Add-stop limit for this vehicle (leave blank to use the global Settings value)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="0" value={form.max_extra_stops} onChange={(e) => setForm((f) => ({ ...f, max_extra_stops: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Max extra stops" />
          <input type="number" min="0" value={form.extra_stop_charge} onChange={(e) => setForm((f) => ({ ...f, extra_stop_charge: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="₹ per stop" />
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Dimensions (shown on the Details screen; leave any blank to hide this section)
        </label>
        <div className="grid grid-cols-4 gap-2">
          <input type="number" value={form.dim_length} onChange={(e) => setForm((f) => ({ ...f, dim_length: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Length" />
          <input type="number" value={form.dim_width} onChange={(e) => setForm((f) => ({ ...f, dim_width: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Width" />
          <input type="number" value={form.dim_height} onChange={(e) => setForm((f) => ({ ...f, dim_height: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Height" />
          <select value={form.dim_unit} onChange={(e) => setForm((f) => ({ ...f, dim_unit: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value="ft">ft</option>
            <option value="cm">cm</option>
          </select>
        </div>
      </div>

      {/* Customer Body Types */}
      <div className="mb-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(0,0,0,0.015)' }}>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
            <span>👤 Customer Body Types (कस्टमर को दिखने वाले विकल्प)</span>
          </label>
        </div>
        <p className="mb-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          Customer ride booking screen par ye options chun sakega. 2-Wheeler ke liye sabhi uncheck rakhein.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {BODY_TYPES.map((type) => {
            const currentList = form.allowed_body_types
              ? form.allowed_body_types.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
              : [];
            const isChecked = currentList.includes(type.id);
            return (
              <label
                key={type.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition-all select-none"
                style={{
                  borderColor: isChecked ? 'var(--brand)' : 'var(--border)',
                  background: isChecked ? 'rgba(37,99,235,0.06)' : 'var(--bg)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    let updated = e.target.checked
                      ? [...currentList, type.id]
                      : currentList.filter((t) => t !== type.id);
                    setForm((f) => ({ ...f, allowed_body_types: updated.join(',') }));
                  }}
                  className="mt-0.5 rounded cursor-pointer"
                />
                <div>
                  <div className="text-[12px] font-medium leading-tight" style={{ color: isChecked ? 'var(--brand)' : 'var(--ink)' }}>
                    {type.label}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                    {type.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Driver Body Types */}
      <div className="mb-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(0,0,0,0.015)' }}>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
            <span>🚚 Driver Body Types (ड्राइवर को दिखने वाले विकल्प)</span>
          </label>
        </div>
        <p className="mb-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          Driver app me vehicle selection popup aur settings me driver inme se apna body type chun sakega.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {BODY_TYPES.map((type) => {
            const currentList = form.driver_body_types
              ? form.driver_body_types.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
              : [];
            const isChecked = currentList.includes(type.id);
            return (
              <label
                key={type.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition-all select-none"
                style={{
                  borderColor: isChecked ? '#ea580c' : 'var(--border)',
                  background: isChecked ? 'rgba(234,88,12,0.06)' : 'var(--bg)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    let updated = e.target.checked
                      ? [...currentList, type.id]
                      : currentList.filter((t) => t !== type.id);
                    setForm((f) => ({ ...f, driver_body_types: updated.join(',') }));
                  }}
                  className="mt-0.5 rounded cursor-pointer"
                />
                <div>
                  <div className="text-[12px] font-medium leading-tight" style={{ color: isChecked ? '#ea580c' : 'var(--ink)' }}>
                    {type.label}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                    {type.desc}
                  </div>
                </div>
              </label>
            );
          })}
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
