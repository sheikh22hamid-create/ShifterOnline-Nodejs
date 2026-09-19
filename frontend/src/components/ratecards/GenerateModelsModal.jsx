import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, Plus, Trash2, CheckCircle2, Award, RotateCcw } from 'lucide-react'
import api from '../../services/api'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'
import { formatCurrency } from '../../utils/format'

// Standard templates with titles
const BASE_MODEL_TEMPLATES = [
  { model_number: 1, title: 'Model 1', user_title: 'Super Saver', driver_title: 'Standard Tier' },
  { model_number: 2, title: 'Model 2', user_title: 'Saver Plus', driver_title: 'Silver Tier' },
  { model_number: 3, title: 'Model 3', user_title: 'Comfort', driver_title: 'Prime Tier' },
  { model_number: 4, title: 'Model 4', user_title: 'Express', driver_title: 'Gold Beast' },
  { model_number: 5, title: 'Model 5', user_title: 'Priority', driver_title: 'Earning Beast' },
]

/**
 * Returns dynamic relative offsets depending on which model is selected as the Base (Anchor = 0%).
 * If Model 3 is Base: Model 1 (-13%), Model 2 (-7%), Model 3 (0%), Model 4 (+20%), Model 5 (+40%).
 * If Model 1 is Base: Model 1 (0%), Model 2 (+7%), Model 3 (+15%), Model 4 (+35%), Model 5 (+55%).
 * If Model 2 is Base: Model 1 (-7%), Model 2 (0%), Model 3 (+8%), Model 4 (+25%), Model 5 (+45%).
 */
function getOffsetForModel(modelNum, baseModelNum) {
  if (modelNum === baseModelNum) return 0

  if (baseModelNum === 3) {
    if (modelNum === 1) return -13
    if (modelNum === 2) return -7
    if (modelNum === 4) return 20
    if (modelNum === 5) return 40
    if (modelNum > 5) return 40 + (modelNum - 5) * 15
  } else if (baseModelNum === 1) {
    if (modelNum === 2) return 7
    if (modelNum === 3) return 15
    if (modelNum === 4) return 35
    if (modelNum === 5) return 55
    if (modelNum > 5) return 55 + (modelNum - 5) * 15
  } else if (baseModelNum === 2) {
    if (modelNum === 1) return -7
    if (modelNum === 3) return 8
    if (modelNum === 4) return 25
    if (modelNum === 5) return 45
    if (modelNum > 5) return 45 + (modelNum - 5) * 15
  } else if (baseModelNum === 4) {
    if (modelNum === 1) return -28
    if (modelNum === 2) return -22
    if (modelNum === 3) return -16
    if (modelNum === 5) return 17
    if (modelNum > 5) return 17 + (modelNum - 5) * 15
  } else if (baseModelNum === 5) {
    if (modelNum === 1) return -38
    if (modelNum === 2) return -33
    if (modelNum === 3) return -27
    if (modelNum === 4) return -14
    if (modelNum > 5) return (modelNum - 5) * 12
  }

  // Fallback linear scaling if custom base number
  return (modelNum - baseModelNum) * 10
}

export default function GenerateModelsModal({ open, baseRateCard, onClose, onGenerated }) {
  // Default base model is Model 3 (Anchor), just like the system was originally designed
  const [selectedBaseModelNum, setSelectedBaseModelNum] = useState(3)
  const [models, setModels] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [customBaseRates, setCustomBaseRates] = useState(null)

  const slabsFetcher = useCallback(() => api.get('/rate-cards/slabs').then((res) => res.data?.data || {}), [])
  const { data: slabConfig } = useApiQuery(slabsFetcher)

  // Find vehicle slab configuration for this rate card
  const vehicleSlab = useMemo(() => {
    if (!baseRateCard || !slabConfig) return null
    const vehicleKey = String(baseRateCard.vehicle_type || baseRateCard.category_name || '').toLowerCase()
    const vehicleSlabs = slabConfig.vehicle_slabs || []
    return vehicleSlabs.find(
      (v) =>
        String(v.category_id) === String(baseRateCard.cat_id) ||
        v.vehicle_key?.toLowerCase() === vehicleKey.replace(/[^a-z0-9]/g, '_') ||
        (v.vehicle_type || '').toLowerCase().includes(vehicleKey) ||
        vehicleKey.includes((v.vehicle_type || '').toLowerCase())
    ) || null
  }, [baseRateCard, slabConfig])

  // Computed base rates from Slabs
  const slabCalculatedBase = useMemo(() => {
    if (!vehicleSlab) return null
    const rawMin = Number(vehicleSlab.min_charge) || 0
    const lastRate = (vehicleSlab.slabs || []).find((s) => s.key === '5_10')?.rate || (vehicleSlab.slabs || []).find((s) => s.key === '1_5')?.rate || 10
    const anchorMarkup = Number(vehicleSlab.markup_percent) || Number(slabConfig?.anchor_model?.markup_percent) || 10
    const anchorMultiplier = 1 + anchorMarkup / 100
    const min = Math.round(rawMin * anchorMultiplier * 100) / 100
    const perKm = Math.round(lastRate * anchorMultiplier * 100) / 100
    const pickup = Math.round(perKm * 0.5 * 100) / 100
    return { min, perKm, pickup }
  }, [vehicleSlab, slabConfig])

  // Build model rows whenever modal opens or base model changes
  useEffect(() => {
    if (!open || !baseRateCard) return
    setError('')
    setCustomBaseRates(null)

    // Default to Model 3 as Base Anchor
    const baseAnchor = 3
    setSelectedBaseModelNum(baseAnchor)

    const initial = BASE_MODEL_TEMPLATES.map((tmpl) => {
      const isBase = tmpl.model_number === baseAnchor
      return {
        id: `m${tmpl.model_number}`,
        model_number: tmpl.model_number,
        title: tmpl.title,
        user_title: tmpl.user_title,
        driver_title: tmpl.driver_title,
        offset_percent: getOffsetForModel(tmpl.model_number, baseAnchor),
        enabled: true, // All models enabled so everything is created/synced cleanly
        isBase,
      }
    })

    setModels(initial)
  }, [open, baseRateCard])

  const baseMin = useMemo(() => {
    if (customBaseRates) return customBaseRates.min
    return Number(baseRateCard?.min_charge) || 0
  }, [baseRateCard, customBaseRates])

  const basePerKm = useMemo(() => {
    if (customBaseRates) return customBaseRates.perKm
    return Number(baseRateCard?.per_km_charge) || 0
  }, [baseRateCard, customBaseRates])

  const basePickupKm = useMemo(() => {
    if (customBaseRates) return customBaseRates.pickup
    return baseRateCard?.pickup_per_km_charge ? Number(baseRateCard.pickup_per_km_charge) : null
  }, [baseRateCard, customBaseRates])

  // Handler when admin explicitly changes which model is the Base Model
  function handleBaseModelChange(newBaseNum) {
    setSelectedBaseModelNum(newBaseNum)
    setModels((prev) =>
      prev.map((m) => {
        const isBase = m.model_number === newBaseNum
        return {
          ...m,
          isBase,
          offset_percent: getOffsetForModel(m.model_number, newBaseNum),
        }
      })
    )
  }

  function handleToggle(id) {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    )
  }

  function handleFieldChange(id, field, value) {
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m
        return {
          ...m,
          [field]: field === 'offset_percent' ? (parseFloat(value) || 0) : value,
        }
      })
    )
  }

  function handleAddModel() {
    const nextNum = models.length + 1
    const newModel = {
      id: `custom_${Date.now()}`,
      model_number: nextNum,
      title: `Model ${nextNum}`,
      user_title: `Tier ${nextNum}`,
      driver_title: `Tier ${nextNum}`,
      offset_percent: getOffsetForModel(nextNum, selectedBaseModelNum),
      enabled: true,
      isBase: false,
    }
    setModels((prev) => [...prev, newModel])
  }

  function handleRemoveModel(id) {
    setModels((prev) => prev.filter((m) => m.id !== id))
  }

  const selectedCount = models.filter((m) => m.enabled).length

  async function handleSubmit() {
    const targetModels = models.filter((m) => m.enabled)
    if (targetModels.length === 0) {
      setError('Please select at least one model to generate.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const res = await api.post('/rate-cards/generate-models', {
        baseRateCardId: baseRateCard.id,
        models: targetModels.map((m) => ({
          title: m.title,
          user_title: m.user_title,
          driver_title: m.driver_title,
          offset_percent: m.offset_percent,
          sort_order: m.model_number,
        })),
      })
      onGenerated(res.data?.message || 'Models generated successfully!')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to auto-generate models.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!baseRateCard) return null

  const vehicleName = baseRateCard.vehicle_type || baseRateCard.category_name || 'Vehicle'

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      title={
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'rgba(234, 88, 12, 0.12)', color: 'var(--brand)' }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              Auto-Generate Models from Base Rate Card
            </div>
            <div className="text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
              Select which model represents the Base (Anchor), and auto-calculate all other model tiers.
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={handleAddModel}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            <Plus size={13} /> Add Custom Model
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || selectedCount === 0}
              onClick={handleSubmit}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Sparkles size={14} />
              {submitting ? 'Generating…' : `Generate / Sync ${selectedCount} Models`}
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <div
          className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {/* Base Rate Card Summary & Anchor Selector Banner */}
      <div
        className="mb-3 rounded-xl border p-3.5 text-[12px]"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
          {/* Base Rate Card Details */}
          <div>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-[10.5px]">
              Source Rate Card
            </span>
            <div className="text-[14px] font-bold" style={{ color: 'var(--ink)' }}>
              {vehicleName}
              <span className="ml-2 text-[11.5px] font-normal" style={{ color: 'var(--ink-faint)' }}>
                ({baseRateCard.type === 'USER' ? 'Customer Fare' : 'Driver Earning'})
              </span>
            </div>
          </div>

          {/* Current Source Numbers & Slabs Matrix Autofill */}
          <div className="flex items-center gap-2 font-mono text-[12px] flex-wrap">
            <div className="rounded-md border px-2.5 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <span className="text-[10px] text-gray-500 block font-sans">Base Min Fare</span>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(baseMin)}</span>
            </div>
            <div className="rounded-md border px-2.5 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <span className="text-[10px] text-gray-500 block font-sans">Base Per KM</span>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(basePerKm)}/km</span>
            </div>
            {slabCalculatedBase && (
              <button
                type="button"
                onClick={() => setCustomBaseRates(slabCalculatedBase)}
                className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-all hover:opacity-90"
                style={{
                  borderColor: customBaseRates ? 'var(--brand)' : 'rgba(234, 88, 12, 0.4)',
                  background: customBaseRates ? 'var(--brand)' : 'rgba(234, 88, 12, 0.1)',
                  color: customBaseRates ? 'var(--brand-ink)' : 'var(--brand)',
                }}
                title={`Autofill Base directly from Slabs Matrix (Min ₹${slabCalculatedBase.min}, Per KM ₹${slabCalculatedBase.perKm})`}
              >
                <Sparkles size={11} />
                {customBaseRates ? 'Using Slabs Matrix Base' : 'Autofill from Slabs'}
              </button>
            )}
            {customBaseRates && (
              <button
                type="button"
                onClick={() => setCustomBaseRates(null)}
                className="text-[11px] font-sans underline text-gray-400 hover:text-gray-600 px-1"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Base Model Selector Dropdown & Pills */}
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Award size={15} className="text-amber-500 shrink-0" />
            <span className="font-semibold text-[12.5px]" style={{ color: 'var(--ink)' }}>
              Which Model is this Base rate for?
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {BASE_MODEL_TEMPLATES.map((tmpl) => {
              const isSelected = selectedBaseModelNum === tmpl.model_number
              return (
                <button
                  key={tmpl.model_number}
                  type="button"
                  onClick={() => handleBaseModelChange(tmpl.model_number)}
                  className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-all ${
                    isSelected
                      ? 'shadow-xs border'
                      : 'border opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    background: isSelected ? 'rgba(234, 88, 12, 0.15)' : 'var(--bg)',
                    borderColor: isSelected ? 'var(--brand)' : 'var(--border)',
                    color: isSelected ? 'var(--brand)' : 'var(--ink-muted)',
                  }}
                >
                  {tmpl.title} {tmpl.model_number === 3 ? '(Anchor)' : ''}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
          <span>
            Model {selectedBaseModelNum} will be the <strong>0% Anchor</strong>. Other models automatically get their relative offsets.
          </span>
        </div>
      </div>

      {/* Target Models Table */}
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th className="w-8 px-3 py-2 text-center text-[11px]">Select</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Model</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Customer Title</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Driver Title</th>
              <th className="w-28 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Offset %</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Calculated Rates</th>
              <th className="w-8 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const isAnchor = m.model_number === selectedBaseModelNum
              const multiplier = 1 + (m.offset_percent || 0) / 100
              const calcMin = Math.round(baseMin * multiplier * 100) / 100
              const calcPerKm = Math.round(basePerKm * multiplier * 100) / 100

              return (
                <tr
                  key={m.id}
                  className={`transition-colors ${
                    isAnchor
                      ? 'bg-amber-500/5 dark:bg-amber-400/5'
                      : m.enabled
                      ? 'hover:bg-black/2 dark:hover:bg-white/2'
                      : 'opacity-40'
                  }`}
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  {/* Toggle Checkbox */}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={() => handleToggle(m.id)}
                      className="rounded accent-orange-600"
                    />
                  </td>

                  {/* Model Title & Base Badge */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        disabled={!m.enabled}
                        value={m.title}
                        onChange={(e) => handleFieldChange(m.id, 'title', e.target.value)}
                        className="w-20 rounded border px-2 py-1 text-[12px] font-semibold outline-none"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                      />
                      {isAnchor ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                          ⭐ Base
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleBaseModelChange(m.model_number)}
                          className="text-[10px] text-gray-400 hover:text-amber-600 underline whitespace-nowrap"
                          title="Click to make this the Base model"
                        >
                          Make Base
                        </button>
                      )}
                    </div>
                  </td>

                  {/* User App Title */}
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={!m.enabled}
                      value={m.user_title}
                      onChange={(e) => handleFieldChange(m.id, 'user_title', e.target.value)}
                      placeholder="e.g. Super Saver"
                      className="w-full rounded border px-2 py-1 text-[12px] outline-none"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                    />
                  </td>

                  {/* Driver App Title */}
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={!m.enabled}
                      value={m.driver_title}
                      onChange={(e) => handleFieldChange(m.id, 'driver_title', e.target.value)}
                      placeholder="e.g. Standard Tier"
                      className="w-full rounded border px-2 py-1 text-[12px] outline-none"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                    />
                  </td>

                  {/* Offset % */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        disabled={!m.enabled || isAnchor}
                        value={m.offset_percent}
                        onChange={(e) => handleFieldChange(m.id, 'offset_percent', e.target.value)}
                        className={`w-16 rounded border px-2 py-1 text-[12px] font-mono font-semibold outline-none text-right ${
                          isAnchor ? 'bg-amber-500/10 text-amber-600 font-bold' : ''
                        }`}
                        style={{ borderColor: 'var(--border)', background: isAnchor ? undefined : 'var(--bg)', color: isAnchor ? undefined : 'var(--ink)' }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>%</span>
                    </div>
                  </td>

                  {/* Calculated Rates */}
                  <td className="px-3 py-2 font-mono text-[11.5px]">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                      <span>{formatCurrency(calcMin)}</span>
                      <span className="text-gray-400 font-normal">min</span>
                      <span className="text-gray-400 font-normal">|</span>
                      <span>{formatCurrency(calcPerKm)}</span>
                      <span className="text-gray-400 font-normal">/km</span>
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                      {isAnchor ? (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">Exact Base Rate (0%)</span>
                      ) : m.offset_percent > 0 ? (
                        `+${m.offset_percent}% vs Model ${selectedBaseModelNum}`
                      ) : (
                        `${m.offset_percent}% vs Model ${selectedBaseModelNum}`
                      )}
                    </div>
                  </td>

                  {/* Remove custom model button */}
                  <td className="px-2 py-2 text-center">
                    {String(m.id).startsWith('custom_') && (
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(m.id)}
                        className="rounded p-1 text-red-500 hover:bg-red-500/10"
                        title="Remove model"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
