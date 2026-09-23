import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

const EMPTY_FORM = {
  title: 'Model 3',
  user_title: '',
  driver_title: '',
  driver_card_subtitle: '',
  driver_info_subtitle: '',
  driver_info_sections: [],
  type: 'USER',
  cat_id: '',
  city_id: '',
  min_charge: '',
  per_km_charge: '',
  pickup_per_km_charge: '',
  cancellation_charge_customer: '0',
  admin_earning: '0',
  driver_earning: '0',
  cancellation_charge_driver: '0',
  driver_cancel_admin_earning: '0',
  driver_cancel_user_earning: '0',
  outside_min_charge: '0',
  outside_per_km_charge: '0',
  outside_surcharge: '0',
  cancellation_charge: '',
  free_waiting_time: '5',
  waiting_charge: '',
  start_time: '00:00',
  end_time: '00:00',
  night_charge_percent: '0',
  service_charge_percent: '0',
  commission_percent: '10',
  driver_share_percent: '90',
  driver_per_percent: '10',
  status: 1,
}

function getCommissionAndShare(rawVal) {
  const n = parseFloat(rawVal);
  if (!Number.isFinite(n) || n < 0) return { commission: '10', driverShare: '90' };
  if (n > 50 && n <= 100) {
    const comm = Math.round((100 - n) * 100) / 100;
    return { commission: String(comm), driverShare: String(n) };
  }
  const share = Math.round((100 - n) * 100) / 100;
  return { commission: String(n), driverShare: String(share) };
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
  const categoriesFetcher = useCallback(() => api.get('/categories').then((res) => res.data?.data || res.data || []), [])
  const { data: rawCategories } = useApiQuery(categoriesFetcher)
  const categories = Array.isArray(rawCategories) ? rawCategories : (Array.isArray(rawCategories?.data) ? rawCategories.data : [])

  const slabsFetcher = useCallback(() => api.get('/rate-cards/slabs').then((res) => res.data?.data || {}), [])
  const { data: slabConfig } = useApiQuery(slabsFetcher)

  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

// Helper to match category id or name to vehicle slab config
function matchVehicleSlab(vehicleSlabs, catId, catName = '') {
  if (!vehicleSlabs || !vehicleSlabs.length) return null
  const strId = String(catId || '').trim()
  const rawName = String(catName || '').toLowerCase().trim()
  const normName = rawName.replace(/[^a-z0-9]/g, '_')

  // 1. Direct category ID match
  let matched = vehicleSlabs.find((v) => String(v.category_id) === strId)
  if (matched) return matched

  // 2. Direct vehicle_key or vehicle_type match
  matched = vehicleSlabs.find((v) => {
    const vk = (v.vehicle_key || '').toLowerCase()
    const vt = (v.vehicle_type || '').toLowerCase()
    return (
      vk === normName ||
      vt === rawName ||
      (vt && rawName.includes(vt)) ||
      (rawName && vt.includes(rawName))
    )
  })
  if (matched) return matched

  // 3. 4-Wheeler categories (catId 25, 11, 17, or "4 wheeler", "four", "ace", "tata", "4w")
  if (
    rawName.includes('4') ||
    rawName.includes('four') ||
    rawName.includes('ace') ||
    rawName.includes('4w') ||
    ['25', '11', '17', '5'].includes(strId)
  ) {
    return vehicleSlabs.find(
      (v) =>
        v.vehicle_key === 'four_wheeler' ||
        (v.vehicle_type || '').toLowerCase().includes('4w') ||
        (v.vehicle_type || '').toLowerCase().includes('tata') ||
        (v.vehicle_type || '').toLowerCase().includes('4 wheeler')
    )
  }

  // 4. 3-Wheeler categories (catId 24, 15, 9, or "3 wheeler", "three", "3w")
  if (
    rawName.includes('3') ||
    rawName.includes('three') ||
    rawName.includes('3w') ||
    ['24', '15', '9', '4'].includes(strId)
  ) {
    return vehicleSlabs.find(
      (v) =>
        v.vehicle_key === 'three_wheeler' ||
        v.vehicle_key === 'mini_3w' ||
        (v.vehicle_type || '').toLowerCase().includes('3 wheeler')
    )
  }

  // 5. E-Loader categories (catId 23, 22, 3, or "loader", "electric")
  if (
    rawName.includes('loader') ||
    rawName.includes('electric') ||
    ['23', '22', '3'].includes(strId)
  ) {
    return vehicleSlabs.find(
      (v) => v.vehicle_key === 'e_loader' || (v.vehicle_type || '').toLowerCase().includes('loader')
    )
  }

  // 6. Scooter (catId 16, 2, or "scooter")
  if (rawName.includes('scooter') || ['16', '2'].includes(strId)) {
    return vehicleSlabs.find((v) => v.vehicle_key === 'scooter' || (v.vehicle_type || '').toLowerCase().includes('scooter'))
  }

  // 7. Bike (catId 8, 1, or "bike", "two")
  if (rawName.includes('bike') || rawName.includes('two') || ['8', '1'].includes(strId)) {
    return vehicleSlabs.find((v) => v.vehicle_key === 'bike' || (v.vehicle_type || '').toLowerCase().includes('bike'))
  }

  return null
}

function computeSlabRateValues(vConfig, modelTitle = 'Model 1', slabConfig) {
  if (!vConfig) return null

  const rawBaseMin = Number(vConfig.min_charge) || 0
  const lastFiniteRate =
    (vConfig.slabs || []).find((s) => s.key === '5_10')?.rate ||
    (vConfig.slabs || []).find((s) => s.key === '1_5')?.rate ||
    10
  const anchorMarkup =
    Number(vConfig.markup_percent) || Number(slabConfig?.anchor_model?.markup_percent) || 10
  const anchorMultiplier = 1 + anchorMarkup / 100

  const title = String(modelTitle || '').trim().toLowerCase()
  const modelMatch =
    (slabConfig?.model_multipliers || []).find((m) => {
      const mName = String(m.name || m.model || '').toLowerCase()
      return title.includes(mName) || title.includes(`model ${m.model_number}`)
    }) || {
      model_number: 1,
      name: modelTitle,
      percent_offset: 0,
      user_title: 'Super Saver',
      driver_title: 'Standard Tier',
    }

  const offset = Number(modelMatch.percent_offset) || 0
  const effectiveMultiplier = anchorMultiplier * (1 + offset / 100)

  const calcMin = Math.round(rawBaseMin * effectiveMultiplier * 100) / 100
  const calcPerKm = Math.round(lastFiniteRate * effectiveMultiplier * 100) / 100
  const calcPickup = Math.round(calcPerKm * 0.5 * 100) / 100

  return {
    vConfig,
    vehicleName: vConfig.vehicle_type || vConfig.vehicle_name || 'Vehicle',
    modelMatch,
    modelTitle: modelMatch.name || modelMatch.model || modelTitle,
    offset,
    calcMin,
    calcPerKm,
    calcPickup,
    user_title: modelMatch.user_title || 'Super Saver',
    driver_title: modelMatch.driver_title || 'Standard Tier',
  }
}

  // Slab calculation helper based on selected category and model
  const slabCalculation = useMemo(() => {
    if (!form.cat_id || !slabConfig) return null
    const cat = categories.find((c) => String(c.id) === String(form.cat_id))
    const catName = cat?.cat_name || ''
    const vConfig = matchVehicleSlab(slabConfig.vehicle_slabs || [], form.cat_id, catName)
    return computeSlabRateValues(vConfig, form.title || 'Model 1', slabConfig)
  }, [form.cat_id, form.title, categories, slabConfig])

  function applySlabAutofill(calc = slabCalculation) {
    if (!calc) return
    setForm((f) => ({
      ...f,
      min_charge: String(calc.calcMin),
      per_km_charge: String(calc.calcPerKm),
      pickup_per_km_charge: f.pickup_per_km_charge && isEdit ? f.pickup_per_km_charge : String(calc.calcPickup),
      user_title: f.user_title && isEdit ? f.user_title : calc.user_title,
      driver_title: f.driver_title && isEdit ? f.driver_title : calc.driver_title,
    }))
  }

  function handleCategoryChange(newCatId) {
    const cat = categories.find((c) => String(c.id) === String(newCatId))
    const catName = cat?.cat_name || ''
    const vConfig = matchVehicleSlab(slabConfig?.vehicle_slabs || [], newCatId, catName)
    const currentModelTitle = form.title || 'Model 1'
    const computed = computeSlabRateValues(vConfig, currentModelTitle, slabConfig)

    if (computed && !isEdit) {
      setForm((f) => ({
        ...f,
        cat_id: newCatId,
        min_charge: String(computed.calcMin),
        per_km_charge: String(computed.calcPerKm),
        pickup_per_km_charge: String(computed.calcPickup),
        user_title: f.user_title || computed.user_title,
        driver_title: f.driver_title || computed.driver_title,
      }))
    } else {
      setForm((f) => ({ ...f, cat_id: newCatId }))
    }
  }

  function handleModelSelect(mTitle) {
    const cat = categories.find((c) => String(c.id) === String(form.cat_id))
    const catName = cat?.cat_name || ''
    const vConfig = matchVehicleSlab(slabConfig?.vehicle_slabs || [], form.cat_id, catName)
    const computed = computeSlabRateValues(vConfig, mTitle, slabConfig)

    if (computed) {
      setForm((f) => ({
        ...f,
        title: mTitle,
        min_charge: String(computed.calcMin),
        per_km_charge: String(computed.calcPerKm),
        pickup_per_km_charge: String(computed.calcPickup),
        user_title: computed.user_title || f.user_title,
        driver_title: computed.driver_title || f.driver_title,
      }))
    } else {
      setForm((f) => ({ ...f, title: mTitle }))
    }
  }

  // If creating new rate card and category is selected, auto-fill if fields are empty
  useEffect(() => {
    if (!isEdit && open && form.cat_id && slabConfig && (!form.min_charge || !form.per_km_charge)) {
      const cat = categories.find((c) => String(c.id) === String(form.cat_id))
      const catName = cat?.cat_name || ''
      const vConfig = matchVehicleSlab(slabConfig.vehicle_slabs || [], form.cat_id, catName)
      const computed = computeSlabRateValues(vConfig, form.title || 'Model 1', slabConfig)
      if (computed) {
        setForm((f) => ({
          ...f,
          min_charge: f.min_charge || String(computed.calcMin),
          per_km_charge: f.per_km_charge || String(computed.calcPerKm),
          pickup_per_km_charge: f.pickup_per_km_charge || String(computed.calcPickup),
          user_title: f.user_title || computed.user_title,
          driver_title: f.driver_title || computed.driver_title,
        }))
      }
    }
  }, [isEdit, open, form.cat_id, form.title, form.min_charge, form.per_km_charge, slabConfig, categories])

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which rate card
    // it targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    const split = rateCard
      ? getCommissionAndShare(rateCard.commission_percent ?? rateCard.driver_per_percent)
      : { commission: '10', driverShare: '90' }

    setForm(
      rateCard
        ? {
            ...EMPTY_FORM,
            ...rateCard,
            type: rateCard.type,
            cat_id: rateCard.cat_id,
            city_id: rateCard.city_id,
            min_charge: rateCard.min_charge,
            per_km_charge: rateCard.per_km_charge,
            pickup_per_km_charge: rateCard.pickup_per_km_charge ?? '',
            cancellation_charge_customer: rateCard.cancellation_charge_customer ?? '0',
            admin_earning: rateCard.admin_earning ?? '0',
            driver_earning: rateCard.driver_earning ?? '0',
            cancellation_charge_driver: rateCard.cancellation_charge_driver ?? '0',
            driver_cancel_admin_earning: rateCard.driver_cancel_admin_earning ?? '0',
            driver_cancel_user_earning: rateCard.driver_cancel_user_earning ?? '0',
            driver_card_subtitle: rateCard.driver_card_subtitle ?? '',
            driver_info_subtitle: rateCard.driver_info_subtitle ?? '',
            driver_info_sections: Array.isArray(rateCard.driver_info_sections)
              ? rateCard.driver_info_sections
              : [],
            outside_min_charge: rateCard.outside_min_charge ?? '0',
            outside_per_km_charge: rateCard.outside_per_km_charge ?? '0',
            outside_surcharge: rateCard.outside_surcharge ?? '0',
            cancellation_charge: rateCard.cancellation_charge ?? '',
            free_waiting_time: rateCard.free_waiting_time,
            waiting_charge: rateCard.waiting_charge,
            start_time: rateCard.start_time,
            end_time: rateCard.end_time,
            night_charge_percent: rateCard.night_charge_percent,
            service_charge_percent: rateCard.service_charge_percent,
            commission_percent: split.commission,
            driver_share_percent: split.driverShare,
            driver_per_percent: split.commission,
            status: rateCard.status,
          }
        : EMPTY_FORM
    )
  }, [open, rateCard])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setSection(index, key, value) {
    setForm((f) => {
      const next = f.driver_info_sections.map((s, i) => (i === index ? { ...s, [key]: value } : s))
      return { ...f, driver_info_sections: next }
    })
  }

  function addSection() {
    setForm((f) => ({ ...f, driver_info_sections: [...f.driver_info_sections, { heading: '', body: '' }] }))
  }

  function removeSection(index) {
    setForm((f) => ({ ...f, driver_info_sections: f.driver_info_sections.filter((_, i) => i !== index) }))
  }

  function moveSection(index, delta) {
    setForm((f) => {
      const target = index + delta
      if (target < 0 || target >= f.driver_info_sections.length) return f
      const next = [...f.driver_info_sections]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return { ...f, driver_info_sections: next }
    })
  }

  function handleCommissionChange(val) {
    if (val === '') {
      setForm((f) => ({ ...f, commission_percent: '', driver_share_percent: '', driver_per_percent: '' }))
      return
    }
    const num = parseFloat(val)
    if (!Number.isFinite(num)) {
      setForm((f) => ({ ...f, commission_percent: val }))
      return
    }
    const clampedComm = Math.max(0, Math.min(100, num))
    const share = Math.max(0, Math.min(100, Math.round((100 - clampedComm) * 100) / 100))
    setForm((f) => ({
      ...f,
      commission_percent: val,
      driver_share_percent: String(share),
      driver_per_percent: String(clampedComm),
    }))
  }

  function handleDriverShareChange(val) {
    if (val === '') {
      setForm((f) => ({ ...f, commission_percent: '', driver_share_percent: '', driver_per_percent: '' }))
      return
    }
    const num = parseFloat(val)
    if (!Number.isFinite(num)) {
      setForm((f) => ({ ...f, driver_share_percent: val }))
      return
    }
    const clampedShare = Math.max(0, Math.min(100, num))
    const comm = Math.max(0, Math.min(100, Math.round((100 - clampedShare) * 100) / 100))
    setForm((f) => ({
      ...f,
      driver_share_percent: val,
      commission_percent: String(comm),
      driver_per_percent: String(comm),
    }))
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

  const vehicleLabel = rateCard?.vehicle_type || rateCard?.category_name

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${vehicleLabel ? `${vehicleLabel} - ` : ''}${rateCard.title}` : 'New rate card'}
      width={520}
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
        {/* Live Preview Box */}
        <div className="rounded-xl border p-3 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}>
          <div className="mb-1.5 font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--ink-faint)' }}>
            Display Preview Across Apps & Admin
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[10px] text-emerald-600 font-semibold">👤 User App Sees</div>
              <div className="mt-0.5 truncate font-medium" style={{ color: 'var(--ink)' }}>
                {form.user_title || form.title || 'Super Saver'}
              </div>
            </div>
            <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[10px] text-blue-600 font-semibold">🚗 Driver App Sees</div>
              <div className="mt-0.5 truncate font-medium" style={{ color: 'var(--ink)' }}>
                {form.driver_title || form.title || 'Earning Beast'}
              </div>
            </div>
            <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[10px] text-amber-600 font-semibold">⚙️ Admin Model</div>
              <div className="mt-0.5 truncate font-medium" style={{ color: 'var(--ink)' }}>
                {form.title || 'Model 1'}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cat_id">Vehicle Category</Label>
            <select
              id="cat_id"
              value={form.cat_id}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              style={FIELD_STYLE}
            >
              <option value="">Select Vehicle (Bike, 3 Wheeler...)</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cat_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="title">Admin Model Title</Label>
            <Input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Model 1" />
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              {['Model 1', 'Model 2', 'Model 3', 'Model 4', 'Model 5'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModelSelect(m)}
                  className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold border transition-all ${
                    String(form.title).toLowerCase() === m.toLowerCase()
                      ? 'bg-amber-500/15 border-amber-500 text-amber-600 dark:text-amber-400'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    borderColor: String(form.title).toLowerCase() === m.toLowerCase() ? 'var(--brand)' : 'var(--border)',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="user_title">👤 Customer Display Name</Label>
            <Input
              id="user_title"
              value={form.user_title}
              onChange={(e) => set('user_title', e.target.value)}
              placeholder="e.g. Super Saver / Economy"
            />
          </div>
          <div>
            <Label htmlFor="driver_title">🚗 Driver Display Name</Label>
            <Input
              id="driver_title"
              value={form.driver_title}
              onChange={(e) => set('driver_title', e.target.value)}
              placeholder="e.g. Earning Beast / Prime Tier"
            />
          </div>
        </div>

        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Driver info
          </div>
          <p className="mb-3 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
            Shown in the driver app. Leave everything blank to hide the tier's Details button entirely.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="driver_card_subtitle">Card subtitle</Label>
              <Input
                id="driver_card_subtitle"
                value={form.driver_card_subtitle}
                onChange={(e) => set('driver_card_subtitle', e.target.value)}
                placeholder="e.g. Regular deliveries, steady earnings"
                maxLength={255}
              />
            </div>
            <div>
              <Label htmlFor="driver_info_subtitle">Popup subtitle</Label>
              <Input
                id="driver_info_subtitle"
                value={form.driver_info_subtitle}
                onChange={(e) => set('driver_info_subtitle', e.target.value)}
                placeholder="e.g. High demand & priority trips"
                maxLength={255}
              />
            </div>
          </div>

          <div className="mt-3">
            <Label>Info sections</Label>
            {form.driver_info_sections.length === 0 ? (
              <p className="mb-2 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                No sections yet — the Details button stays hidden for this tier.
              </p>
            ) : (
              form.driver_info_sections.map((section, index) => (
                <div key={index} className="mb-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Input
                      value={section.heading}
                      onChange={(e) => setSection(index, 'heading', e.target.value)}
                      placeholder="Heading, e.g. Earnings"
                      maxLength={120}
                    />
                    <button
                      type="button"
                      onClick={() => moveSection(index, -1)}
                      disabled={index === 0}
                      aria-label="Move section up"
                      className="px-1.5 disabled:opacity-30"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(index, 1)}
                      disabled={index === form.driver_info_sections.length - 1}
                      aria-label="Move section down"
                      className="px-1.5 disabled:opacity-30"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(index)}
                      aria-label="Remove section"
                      className="px-1.5"
                      style={{ color: 'var(--danger)' }}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={section.body}
                    onChange={(e) => setSection(index, 'body', e.target.value)}
                    placeholder="Body text shown under the heading"
                    maxLength={2000}
                    rows={3}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none resize-y"
                    style={FIELD_STYLE}
                  />
                </div>
              ))
            )}
            <button
              type="button"
              onClick={addSection}
              disabled={form.driver_info_sections.length >= 12}
              className="mt-1 rounded-lg border px-2.5 py-1 text-[12px] disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              + Add section
            </button>
            {form.driver_info_sections.length >= 12 && (
              <span className="ml-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Maximum of 12 sections reached.
              </span>
            )}
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

        {/* Distance Slabs Auto-Calculation & Autofill Helper Banner */}
        {slabCalculation && (
          <div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border p-2.5 text-[12px]"
            style={{ borderColor: 'rgba(234, 88, 12, 0.35)', background: 'rgba(234, 88, 12, 0.07)' }}
          >
            <div className="flex items-center gap-1.5" style={{ color: 'var(--brand)' }}>
              <Sparkles size={14} className="shrink-0" />
              <span>
                Slabs Rate ({slabCalculation.vehicleName} - {slabCalculation.modelTitle}): <strong>Min ₹{slabCalculation.calcMin}</strong> | <strong>₹{slabCalculation.calcPerKm}/km</strong>
                <span className="ml-1 text-[11px] opacity-80">
                  ({slabCalculation.offset > 0 ? `+${slabCalculation.offset}%` : `${slabCalculation.offset}%`} vs Anchor)
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => applySlabAutofill(slabCalculation)}
              className="self-start sm:self-auto rounded px-2.5 py-1 text-[11px] font-semibold shadow-xs transition-opacity hover:opacity-90 flex items-center gap-1 shrink-0"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Sparkles size={11} /> Autofill Slabs
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="min_charge">Min fare (₹)</Label>
            <Input id="min_charge" type="number" value={form.min_charge} onChange={(e) => set('min_charge', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="per_km_charge">Per km trip rate (₹)</Label>
            <Input id="per_km_charge" type="number" value={form.per_km_charge} onChange={(e) => set('per_km_charge', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pickup_per_km_charge">Pickup Per-KM (₹)</Label>
            <Input
              id="pickup_per_km_charge"
              type="number"
              value={form.pickup_per_km_charge}
              onChange={(e) => set('pickup_per_km_charge', e.target.value)}
              placeholder="Same as trip per-km"
            />
          </div>
          <div>
            <Label htmlFor="free_waiting_time">Free wait (min)</Label>
            <Input
              id="free_waiting_time"
              type="number"
              value={form.free_waiting_time}
              onChange={(e) => set('free_waiting_time', e.target.value)}
              placeholder="5"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            Customer Cancellation Fee & Split
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="cancellation_charge_customer">Total Fee (₹)</Label>
              <Input
                id="cancellation_charge_customer"
                type="number"
                value={form.cancellation_charge_customer}
                onChange={(e) => set('cancellation_charge_customer', e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="admin_earning">Admin Commission (₹)</Label>
              <Input
                id="admin_earning"
                type="number"
                value={form.admin_earning}
                onChange={(e) => set('admin_earning', e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="driver_earning">Driver Comp. (₹)</Label>
              <Input
                id="driver_earning"
                type="number"
                value={form.driver_earning}
                onChange={(e) => set('driver_earning', e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <p className="text-[12px] font-semibold pt-1 border-t" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
            Driver Cancellation Fee & Split
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="cancellation_charge_driver">Total Fee (₹)</Label>
              <Input
                id="cancellation_charge_driver"
                type="number"
                value={form.cancellation_charge_driver}
                onChange={(e) => set('cancellation_charge_driver', e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="driver_cancel_admin_earning">Admin Commission (₹)</Label>
              <Input
                id="driver_cancel_admin_earning"
                type="number"
                value={form.driver_cancel_admin_earning}
                onChange={(e) => set('driver_cancel_admin_earning', e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="driver_cancel_user_earning">Customer Comp. (₹)</Label>
              <Input
                id="driver_cancel_user_earning"
                type="number"
                value={form.driver_cancel_user_earning}
                onChange={(e) => set('driver_cancel_user_earning', e.target.value)}
                placeholder="0"
              />
            </div>
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

        <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            Outside service-zone pricing
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="outside_min_charge">Min fare (₹)</Label>
              <Input id="outside_min_charge" type="number" value={form.outside_min_charge} onChange={(e) => set('outside_min_charge', e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="outside_per_km_charge">Per km (₹)</Label>
              <Input id="outside_per_km_charge" type="number" value={form.outside_per_km_charge} onChange={(e) => set('outside_per_km_charge', e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="outside_surcharge">Surcharge (₹)</Label>
              <Input id="outside_surcharge" type="number" value={form.outside_surcharge} onChange={(e) => set('outside_surcharge', e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <Label htmlFor="cancellation_charge">Cancellation policy note (legacy text field)</Label>
            <Input id="cancellation_charge" value={form.cancellation_charge} onChange={(e) => set('cancellation_charge', e.target.value)} placeholder="Optional free-text note" />
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="night_charge_percent">Night surge (₹)</Label>
            <Input id="night_charge_percent" type="number" value={form.night_charge_percent} onChange={(e) => set('night_charge_percent', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="service_charge_percent">Customer Service Charge (%)</Label>
            <Input id="service_charge_percent" type="number" value={form.service_charge_percent} onChange={(e) => set('service_charge_percent', e.target.value)} placeholder="0 (added to user fare)" />
          </div>
        </div>

        {/* Earning & Commission Split */}
        <div className="rounded-xl border p-3.5 shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg-subtle, rgba(0,0,0,0.02))' }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-[12.5px]" style={{ color: 'var(--ink)' }}>
              Ride Earning & Commission Split
            </span>
            <span className="rounded bg-brand/10 px-2 py-0.5 text-[10.5px] font-medium text-brand">
              Auto-Balanced (Total = 100%)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="commission_percent">Admin Commission (%)</Label>
              <Input
                id="commission_percent"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.commission_percent ?? ''}
                onChange={(e) => handleCommissionChange(e.target.value)}
                placeholder="e.g. 10"
              />
              <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                Platform deduction per ride
              </p>
            </div>
            <div>
              <Label htmlFor="driver_share_percent">Driver Share (%)</Label>
              <Input
                id="driver_share_percent"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.driver_share_percent ?? ''}
                onChange={(e) => handleDriverShareChange(e.target.value)}
                placeholder="e.g. 90"
              />
              <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                Driver net earnings per ride
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <span>🚗 Driver:</span>
              <span className="font-bold text-[13px]">{form.driver_share_percent || 0}%</span>
              <span className="text-[11px] opacity-75">(₹{Math.round((form.driver_share_percent || 0) * 100) / 100} per ₹100 fare)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>🏢 Shifter:</span>
              <span className="font-bold text-[13px]">{form.commission_percent || 0}%</span>
              <span className="text-[11px] opacity-75">(₹{Math.round((form.commission_percent || 0) * 100) / 100} per ₹100 fare)</span>
            </div>
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
