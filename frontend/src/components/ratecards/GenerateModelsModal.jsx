import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import api from '../../services/api'
import Modal from '../common/Modal'
import { formatCurrency } from '../../utils/format'

const DEFAULT_MODEL_TEMPLATES = [
  { id: 'm1', model_number: 1, title: 'Model 1', user_title: 'Super Saver', driver_title: 'Standard Tier', offset_percent: -13, enabled: true },
  { id: 'm2', model_number: 2, title: 'Model 2', user_title: 'Saver Plus', driver_title: 'Silver Tier', offset_percent: -7, enabled: true },
  { id: 'm3', model_number: 3, title: 'Model 3', user_title: 'Comfort', driver_title: 'Prime Tier', offset_percent: 0, enabled: true },
  { id: 'm4', model_number: 4, title: 'Model 4', user_title: 'Express', driver_title: 'Gold Beast', offset_percent: 20, enabled: true },
  { id: 'm5', model_number: 5, title: 'Model 5', user_title: 'Priority', driver_title: 'Earning Beast', offset_percent: 40, enabled: true },
]

export default function GenerateModelsModal({ open, baseRateCard, onClose, onGenerated }) {
  const [models, setModels] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Initialize models excluding whichever model is the base itself
  useEffect(() => {
    if (!open || !baseRateCard) return
    setError('')

    const baseTitle = String(baseRateCard.title || '').toLowerCase()
    const baseNumMatch = baseTitle.match(/\d+/)
    const baseModelNum = baseNumMatch ? parseInt(baseNumMatch[0], 10) : null

    const initial = DEFAULT_MODEL_TEMPLATES.map((tmpl) => {
      const isSelf = baseModelNum ? tmpl.model_number === baseModelNum : baseTitle === tmpl.title.toLowerCase()
      return {
        ...tmpl,
        isBase: isSelf,
        enabled: !isSelf, // default enabled unless it is the base itself
      }
    })

    setModels(initial)
  }, [open, baseRateCard])

  const baseMin = useMemo(() => Number(baseRateCard?.min_charge) || 0, [baseRateCard])
  const basePerKm = useMemo(() => Number(baseRateCard?.per_km_charge) || 0, [baseRateCard])
  const basePickupKm = useMemo(() => (baseRateCard?.pickup_per_km_charge ? Number(baseRateCard.pickup_per_km_charge) : null), [baseRateCard])

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
      offset_percent: 50,
      enabled: true,
      isBase: false,
    }
    setModels((prev) => [...prev, newModel])
  }

  function handleRemoveModel(id) {
    setModels((prev) => prev.filter((m) => m.id !== id))
  }

  const selectedCount = models.filter((m) => m.enabled && !m.isBase).length

  async function handleSubmit() {
    const targetModels = models.filter((m) => m.enabled && !m.isBase)
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
      width={780}
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
              Source: {vehicleName} ({baseRateCard.title}) — applies percentage offsets & copies all common rules.
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
              {submitting ? 'Generating…' : `Generate ${selectedCount} Model${selectedCount === 1 ? '' : 's'}`}
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

      {/* Base Rate Card Summary Banner */}
      <div
        className="mb-3 rounded-xl border p-3 text-[12px]"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-[10.5px]">
              Base Model (Anchor Source)
            </span>
            <div className="text-[13.5px] font-bold" style={{ color: 'var(--ink)' }}>
              {vehicleName} — {baseRateCard.title}
              <span className="ml-2 text-[11.5px] font-normal" style={{ color: 'var(--ink-faint)' }}>
                ({baseRateCard.type === 'USER' ? 'Customer Fare' : 'Driver Earning'})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-[12px]">
            <div className="rounded-md border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <span className="text-[10px] text-gray-500 block">Min Fare</span>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(baseMin)}</span>
            </div>
            <div className="rounded-md border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <span className="text-[10px] text-gray-500 block">Per KM</span>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(basePerKm)}/km</span>
            </div>
            {basePickupKm != null && (
              <div className="rounded-md border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                <span className="text-[10px] text-gray-500 block">Pickup Rate</span>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(basePickupKm)}/km</span>
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
          <span>
            City, Cancellation fees, Free waiting ({baseRateCard.free_waiting_time || 5}m), Waiting rate ({formatCurrency(baseRateCard.waiting_charge || 0)}/m), Driver share ({baseRateCard.driver_per_percent || 80}%), and Night timings will be copied automatically.
          </span>
        </div>
      </div>

      {/* Target Models Table */}
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              <th className="w-8 px-3 py-2 text-center text-[11px]">Select</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Model Title</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>User App Title</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Driver App Title</th>
              <th className="w-24 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Offset %</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>Calculated Rates</th>
              <th className="w-8 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const multiplier = 1 + (m.offset_percent || 0) / 100
              const calcMin = Math.round(baseMin * multiplier * 100) / 100
              const calcPerKm = Math.round(basePerKm * multiplier * 100) / 100

              if (m.isBase) {
                return (
                  <tr
                    key={m.id}
                    className="opacity-60"
                    style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)' }}
                  >
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Source Base Model" />
                    </td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--ink)' }}>
                      {m.title}{' '}
                      <span className="ml-1 rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                        Current Base
                      </span>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--ink-muted)' }}>{baseRateCard.user_title || m.user_title}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--ink-muted)' }}>{baseRateCard.driver_title || m.driver_title}</td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>0% (Base)</td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(baseMin)} | {formatCurrency(basePerKm)}/km
                    </td>
                    <td className="px-2 py-2.5"></td>
                  </tr>
                )
              }

              return (
                <tr
                  key={m.id}
                  className={`transition-colors ${m.enabled ? 'hover:bg-black/2 dark:hover:bg-white/2' : 'opacity-40'}`}
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

                  {/* Model Title */}
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={!m.enabled}
                      value={m.title}
                      onChange={(e) => handleFieldChange(m.id, 'title', e.target.value)}
                      className="w-24 rounded border px-2 py-1 text-[12px] font-semibold outline-none"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                    />
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
                        disabled={!m.enabled}
                        value={m.offset_percent}
                        onChange={(e) => handleFieldChange(m.id, 'offset_percent', e.target.value)}
                        className="w-16 rounded border px-2 py-1 text-[12px] font-mono font-semibold outline-none text-right"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
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
                      {m.offset_percent > 0 ? `+${m.offset_percent}% vs base` : `${m.offset_percent}% vs base`}
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
