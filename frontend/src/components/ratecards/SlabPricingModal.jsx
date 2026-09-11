import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bike,
  Truck,
  Car,
  Zap,
  Layers,
  Sliders,
  Calculator,
  Save,
  RefreshCw,
  Info,
  Check,
  TrendingUp,
  RotateCcw,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import api from '../../services/api'
import Modal from '../common/Modal'
import Badge from '../common/Badge'
import { useToast } from '../../context/ToastContext'
import { formatCurrency } from '../../utils/format'

const SLAB_INTERVALS = [
  { from_km: 0, to_km: 1, label: '0–1 km' },
  { from_km: 1, to_km: 5, label: '1–5 km' },
  { from_km: 5, to_km: 10, label: '5–10 km' },
  { from_km: 10, to_km: 15, label: '10–15 km' },
  { from_km: 15, to_km: 20, label: '15–20 km' },
  { from_km: 20, to_km: 25, label: '20–25 km' },
  { from_km: 25, to_km: 30, label: '25–30 km' },
  { from_km: 30, to_km: 40, label: '30–40 km' },
  { from_km: 40, to_km: 50, label: '40–50 km' },
  { from_km: 50, to_km: 60, label: '50–60 km' },
]

function getVehicleIcon(type) {
  const name = String(type || '').toLowerCase()
  if (name.includes('bike') || name.includes('scooter')) return <Bike size={14} />
  if (name.includes('loader') || name.includes('electric') || name.includes('e-loader')) return <Zap size={14} />
  if (name.includes('3') || name.includes('auto') || name.includes('rickshaw')) return <Car size={14} />
  return <Truck size={14} />
}

export default function SlabPricingModal({ open, onClose, onSynced }) {
  const toast = useToast()

  const [activeTab, setActiveTab] = useState('slabs') // 'slabs' | 'multipliers' | 'simulator'
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const [vehicleSlabs, setVehicleSlabs] = useState([])
  const [modelMultipliers, setModelMultipliers] = useState([])
  const [anchorModel, setAnchorModel] = useState({ model_number: 3, name: 'Model 3', markup_percent: 10 })

  // Live Simulator state
  const [simVehicle, setSimVehicle] = useState('Bike')
  const [simDistance, setSimDistance] = useState(20)

  // Fetch slab pricing config
  const fetchSlabConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/rate-cards/slabs')
      const data = res.data?.data || {}
      if (Array.isArray(data.vehicle_slabs)) {
        setVehicleSlabs(data.vehicle_slabs)
      }
      if (Array.isArray(data.model_multipliers)) {
        setModelMultipliers(data.model_multipliers)
      }
      if (data.anchor_model) {
        setAnchorModel(data.anchor_model)
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load slab pricing configuration.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (open) {
      fetchSlabConfig()
    }
  }, [open, fetchSlabConfig])

  // Handlers for Slab editing
  function handleMinChargeChange(vehicleIndex, value) {
    setVehicleSlabs((prev) => {
      const copy = [...prev]
      copy[vehicleIndex] = {
        ...copy[vehicleIndex],
        min_charge: parseFloat(value) || 0,
      }
      return copy
    })
  }

  function handleSlabRateChange(vehicleIndex, slabIndex, value) {
    setVehicleSlabs((prev) => {
      const copy = [...prev]
      const targetVehicle = { ...copy[vehicleIndex] }
      const slabsCopy = [...targetVehicle.slabs]
      slabsCopy[slabIndex] = {
        ...slabsCopy[slabIndex],
        rate: parseFloat(value) || 0,
      }
      targetVehicle.slabs = slabsCopy
      copy[vehicleIndex] = targetVehicle
      return copy
    })
  }

  // Handlers for Multiplier editing
  function handleModelChange(modelIndex, key, value) {
    setModelMultipliers((prev) => {
      const copy = [...prev]
      copy[modelIndex] = {
        ...copy[modelIndex],
        [key]: key === 'percent_offset' ? parseFloat(value) || 0 : value,
      }
      return copy
    })
  }

  function handleAnchorMarkupChange(value) {
    setAnchorModel((prev) => ({
      ...prev,
      markup_percent: parseFloat(value) || 0,
    }))
  }

  function handleAnchorModelNumberChange(val) {
    const num = parseInt(val, 10) || 3
    setAnchorModel((prev) => ({
      ...prev,
      model_number: num,
      name: `Model ${num}`,
    }))
  }

  // Save changes
  async function handleSave() {
    setSaving(true)
    try {
      await api.put('/rate-cards/slabs', {
        vehicle_slabs: vehicleSlabs,
        model_multipliers: modelMultipliers,
        anchor_model: anchorModel,
      })
      toast.success('Distance slab pricing and multipliers saved successfully!')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save slab pricing.')
    } finally {
      setSaving(false)
    }
  }

  // Sync models to DB (tbl_package_model)
  async function handleSyncToRateCards() {
    setSyncing(true)
    try {
      // First save current edits
      await api.put('/rate-cards/slabs', {
        vehicle_slabs: vehicleSlabs,
        model_multipliers: modelMultipliers,
        anchor_model: anchorModel,
      })

      // Then trigger sync
      const res = await api.post('/rate-cards/slabs/sync')
      toast.success(res.data?.message || 'All vehicle models synchronized successfully!')
      if (onSynced) onSynced()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to sync models to rate cards.')
    } finally {
      setSyncing(false)
    }
  }

  // Live Local Simulation Calculation (for immediate reactivity without roundtrips)
  const simulationResult = useMemo(() => {
    const vConfig = vehicleSlabs.find(
      (v) => v.vehicle_type?.toLowerCase() === simVehicle.toLowerCase()
    ) || vehicleSlabs[0]

    if (!vConfig) return null

    const dist = Math.max(0, parseFloat(simDistance) || 0)
    const minCharge = vConfig.min_charge || 0
    let accumulatedSlabCost = 0
    const slabBreakdown = []

    for (const slab of vConfig.slabs || []) {
      const from = slab.from_km
      const to = slab.to_km
      const rate = slab.rate || 0

      if (dist > from) {
        const kmInSlab = Math.min(dist, to) - from
        const cost = kmInSlab * rate
        accumulatedSlabCost += cost
        slabBreakdown.push({
          label: slab.label,
          km_used: kmInSlab,
          rate,
          cost: Math.round(cost * 100) / 100,
        })
      } else {
        slabBreakdown.push({
          label: slab.label,
          km_used: 0,
          rate,
          cost: 0,
        })
      }
    }

    const rawBaseFare = minCharge + accumulatedSlabCost
    const anchorMarkupPct = anchorModel?.markup_percent ?? 10
    const anchorFactor = 1 + anchorMarkupPct / 100
    const anchorFare = rawBaseFare * anchorFactor

    const models = (modelMultipliers || []).map((m) => {
      const offsetPct = m.percent_offset || 0
      const isAnchor = m.model_number === anchorModel?.model_number
      const calculatedFare = Math.round(anchorFare * (1 + offsetPct / 100))
      return {
        ...m,
        isAnchor,
        calculatedFare,
        offsetDisplay: offsetPct > 0 ? `+${offsetPct}%` : `${offsetPct}%`,
      }
    })

    return {
      vehicle_type: vConfig.vehicle_type,
      distance_km: dist,
      min_charge: minCharge,
      accumulated_slab_cost: Math.round(accumulatedSlabCost * 100) / 100,
      raw_base_fare: Math.round(rawBaseFare * 100) / 100,
      anchor_fare: Math.round(anchorFare * 100) / 100,
      anchor_markup_pct: anchorMarkupPct,
      slab_breakdown: slabBreakdown,
      models,
    }
  }, [vehicleSlabs, modelMultipliers, anchorModel, simVehicle, simDistance])

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={1060}
      title={
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand" style={{ background: 'rgba(234, 88, 12, 0.12)', color: 'var(--brand)' }}>
            <Sliders size={16} />
          </div>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              Distance Slabs & Multiplier Configuration
            </div>
            <div className="text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>
              Configure base distance slab matrix, Anchor Markup (+10%), and dynamic model tiers.
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex w-full flex-col-reverse items-center justify-between gap-2.5 sm:flex-row">
          <div className="flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            <Info size={13} style={{ color: 'var(--brand)' }} />
            <span>Changes affect live app fare calculations and package models.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Close
            </button>
            <button
              type="button"
              disabled={syncing || saving || loading}
              onClick={handleSyncToRateCards}
              className="flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold transition-all hover:opacity-90 disabled:opacity-50"
              style={{ borderColor: 'var(--brand)', color: 'var(--brand)', background: 'transparent' }}
              title="Apply slab base minimums & model titles to all rate card models in database"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync to Rate Cards'}
            </button>
            <button
              type="button"
              disabled={saving || syncing || loading}
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[12.5px] font-semibold text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
            >
              <Save size={13} />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('slabs')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all ${
              activeTab === 'slabs' ? 'font-semibold shadow-xs' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              background: activeTab === 'slabs' ? 'var(--brand)' : 'var(--bg-muted)',
              color: activeTab === 'slabs' ? 'var(--brand-ink)' : 'var(--ink)',
            }}
          >
            <Layers size={13} />
            1. Distance Slabs Matrix ({vehicleSlabs.length} Vehicles)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('multipliers')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all ${
              activeTab === 'multipliers' ? 'font-semibold shadow-xs' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              background: activeTab === 'multipliers' ? 'var(--brand)' : 'var(--bg-muted)',
              color: activeTab === 'multipliers' ? 'var(--brand-ink)' : 'var(--ink)',
            }}
          >
            <Sliders size={13} />
            2. Model Offsets & Titles (Model 1–5)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all ${
              activeTab === 'simulator' ? 'font-semibold shadow-xs' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              background: activeTab === 'simulator' ? 'var(--brand)' : 'var(--bg-muted)',
              color: activeTab === 'simulator' ? 'var(--brand-ink)' : 'var(--ink)',
            }}
          >
            <Calculator size={13} />
            3. Interactive Fare Simulator
          </button>
        </div>

        {/* TAB 1: Distance Slabs Matrix */}
        {activeTab === 'slabs' && (
          <div className="space-y-3">
            <div className="rounded-xl border p-3 text-[12px] flex items-start gap-2.5" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
              <Info size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--brand)' }} />
              <div>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                  Slab Pricing Formula:
                </span>{' '}
                <span style={{ color: 'var(--ink-muted)' }}>
                  <code className="rounded bg-black/5 dark:bg-white/10 px-1 py-0.5 font-mono text-[11px]">Final Fare = Minimum Charge + Σ (km in each slab × slab rate)</code>.
                  Each kilometer is charged strictly within its respective distance bracket. Anchor model (Model 3) automatically adds +{anchorModel.markup_percent}% to this base sum.
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full min-w-[920px] text-left text-[12px]">
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th className="sticky left-0 z-10 whitespace-nowrap px-3 py-2.5 font-semibold" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
                      Vehicle
                    </th>
                    <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold text-center" style={{ color: 'var(--brand)' }}>
                      Min Charge (₹)
                    </th>
                    {SLAB_INTERVALS.map((slab) => (
                      <th key={slab.label} className="whitespace-nowrap px-2 py-2.5 font-medium text-center" style={{ color: 'var(--ink-muted)' }}>
                        {slab.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vehicleSlabs.map((v, vIdx) => (
                    <tr key={v.vehicle_type} className="border-t transition-colors hover:bg-black/2 dark:hover:bg-white/2" style={{ borderColor: 'var(--border)' }}>
                      {/* Vehicle Name */}
                      <td className="sticky left-0 z-10 whitespace-nowrap px-3 py-2 font-medium" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                        <div className="flex items-center gap-1.5 font-semibold text-[12.5px]">
                          {getVehicleIcon(v.vehicle_type)}
                          {v.vehicle_type}
                        </div>
                      </td>

                      {/* Min Charge Input */}
                      <td className="px-2 py-2 text-center">
                        <div className="relative inline-block w-20">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                            ₹
                          </span>
                          <input
                            type="number"
                            step="any"
                            value={v.min_charge}
                            onChange={(e) => handleMinChargeChange(vIdx, e.target.value)}
                            className="w-full rounded-lg border py-1 pl-5 pr-1.5 text-center font-mono-data text-[12px] font-semibold outline-none focus:border-brand"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                          />
                        </div>
                      </td>

                      {/* Slab Rates Inputs */}
                      {(v.slabs || []).map((slab, sIdx) => (
                        <td key={sIdx} className="px-1.5 py-2 text-center">
                          <div className="relative inline-block w-16">
                            <input
                              type="number"
                              step="any"
                              value={slab.rate}
                              onChange={(e) => handleSlabRateChange(vIdx, sIdx, e.target.value)}
                              className="w-full rounded-lg border py-1 px-1 text-center font-mono-data text-[11.5px] outline-none focus:border-brand"
                              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: Model Offsets & Titles */}
        {activeTab === 'multipliers' && (
          <div className="space-y-4">
            {/* Anchor Setting Card */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <TrendingUp size={16} />
                  </div>
                  <div>
                    <h3 className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                      Anchor Model & Baseline Markup
                    </h3>
                    <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      Raw slab rates have a default +{anchorModel.markup_percent}% baseline markup applied for the anchor model ({anchorModel.name}). All other models offset from this baseline.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Anchor:</span>
                    <select
                      value={anchorModel.model_number}
                      onChange={(e) => handleAnchorModelNumberChange(e.target.value)}
                      className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold outline-none"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          Model {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Markup %:</span>
                    <div className="relative w-20">
                      <input
                        type="number"
                        step="any"
                        value={anchorModel.markup_percent}
                        onChange={(e) => handleAnchorMarkupChange(e.target.value)}
                        className="w-full rounded-lg border py-1 pl-2 pr-5 font-mono-data text-[12px] font-semibold outline-none text-right"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Model 1-5 Configuration Table */}
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th className="px-4 py-2.5 font-semibold" style={{ color: 'var(--ink)' }}>Model Tier</th>
                    <th className="px-4 py-2.5 font-semibold" style={{ color: 'var(--ink)' }}>Customer App Title (user_title)</th>
                    <th className="px-4 py-2.5 font-semibold" style={{ color: 'var(--ink)' }}>Driver App Title (driver_title)</th>
                    <th className="px-4 py-2.5 font-semibold text-center" style={{ color: 'var(--ink)' }}>Offset % (vs Anchor)</th>
                    <th className="px-4 py-2.5 font-semibold text-right" style={{ color: 'var(--ink)' }}>Effective Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {modelMultipliers.map((m, mIdx) => {
                    const isAnchor = m.model_number === anchorModel.model_number
                    const effectiveFactor = (1 + (anchorModel.markup_percent || 0) / 100) * (1 + (m.percent_offset || 0) / 100)
                    
                    return (
                      <tr
                        key={m.model_number}
                        className={`border-t transition-colors ${
                          isAnchor ? 'bg-amber-500/5' : 'hover:bg-black/2 dark:hover:bg-white/2'
                        }`}
                        style={{ borderColor: 'var(--border)' }}
                      >
                        {/* Model Name & Badge */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                              {m.name || `Model ${m.model_number}`}
                            </span>
                            {isAnchor && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-600 dark:text-amber-400">
                                ANCHOR
                              </span>
                            )}
                          </div>
                        </td>

                        {/* User Title */}
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={m.user_title || ''}
                            onChange={(e) => handleModelChange(mIdx, 'user_title', e.target.value)}
                            placeholder="e.g. Super Saver"
                            className="w-full rounded-lg border px-2.5 py-1 text-[12.5px] outline-none focus:border-brand"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                          />
                        </td>

                        {/* Driver Title */}
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={m.driver_title || ''}
                            onChange={(e) => handleModelChange(mIdx, 'driver_title', e.target.value)}
                            placeholder="e.g. Earning Beast"
                            className="w-full rounded-lg border px-2.5 py-1 text-[12.5px] outline-none focus:border-brand"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                          />
                        </td>

                        {/* Offset Percentage */}
                        <td className="px-4 py-3 text-center">
                          <div className="relative inline-block w-24">
                            <input
                              type="number"
                              step="any"
                              value={m.percent_offset}
                              onChange={(e) => handleModelChange(mIdx, 'percent_offset', e.target.value)}
                              className="w-full rounded-lg border py-1 pl-2 pr-6 text-center font-mono-data text-[12px] font-semibold outline-none focus:border-brand"
                              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-brand">
                              %
                            </span>
                          </div>
                        </td>

                        {/* Effective Factor Display */}
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono-data text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                            {(effectiveFactor * 100).toFixed(1)}%
                          </span>
                          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {effectiveFactor >= 1 ? `+${((effectiveFactor - 1) * 100).toFixed(1)}% vs Raw` : `${((effectiveFactor - 1) * 100).toFixed(1)}% vs Raw`}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Interactive Fare Simulator */}
        {activeTab === 'simulator' && simulationResult && (
          <div className="space-y-4">
            {/* Controls Bar */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                {/* Vehicle Selection */}
                <div>
                  <label className="block text-[11.5px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Select Vehicle
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {vehicleSlabs.map((v) => {
                      const isSel = simVehicle.toLowerCase() === v.vehicle_type.toLowerCase()
                      return (
                        <button
                          key={v.vehicle_type}
                          type="button"
                          onClick={() => setSimVehicle(v.vehicle_type)}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all ${
                            isSel ? 'font-semibold shadow-xs' : 'opacity-70 hover:opacity-100'
                          }`}
                          style={{
                            background: isSel ? 'var(--brand)' : 'var(--bg-muted)',
                            color: isSel ? 'var(--brand-ink)' : 'var(--ink)',
                            border: '1px solid',
                            borderColor: isSel ? 'var(--brand)' : 'var(--border)',
                          }}
                        >
                          {getVehicleIcon(v.vehicle_type)}
                          {v.vehicle_type}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Distance Slider & Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                      Trip Distance: <span className="font-mono-data font-bold text-[13px]" style={{ color: 'var(--ink)' }}>{simDistance} km</span>
                    </label>
                    <div className="flex items-center gap-1">
                      {[5, 12, 20, 35, 50].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setSimDistance(preset)}
                          className="rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5 text-[10.5px] font-medium hover:bg-brand/20 transition-colors"
                          style={{ color: 'var(--ink)' }}
                        >
                          {preset}km
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0.5"
                      max="60"
                      step="0.5"
                      value={simDistance}
                      onChange={(e) => setSimDistance(parseFloat(e.target.value) || 0)}
                      className="flex-1 accent-orange-500 cursor-pointer"
                    />
                    <div className="relative w-20">
                      <input
                        type="number"
                        min="0"
                        max="150"
                        step="0.5"
                        value={simDistance}
                        onChange={(e) => setSimDistance(parseFloat(e.target.value) || 0)}
                        className="w-full rounded-lg border py-1 pl-2 pr-6 text-right font-mono-data text-[12px] font-semibold outline-none focus:border-brand"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                        km
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step-by-Step Breakdown Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left Column: Raw Slab Breakdown */}
              <div className="lg:col-span-6 space-y-3">
                <div className="surface-card rounded-xl border p-3.5 space-y-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
                    <div className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                      1. Base Distance Slab Breakdown
                    </div>
                    <span className="font-mono-data text-[11.5px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
                      Total: {simulationResult.distance_km} km
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[12px]">
                    <div className="flex items-center justify-between py-0.5">
                      <span className="flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
                        <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Minimum Base Charge
                      </span>
                      <span className="font-mono-data font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(simulationResult.min_charge)}
                      </span>
                    </div>

                    {simulationResult.slab_breakdown
                      .filter((s) => s.km_used > 0)
                      .map((s) => (
                        <div key={s.label} className="flex items-center justify-between py-0.5 text-[11.5px]">
                          <span style={{ color: 'var(--ink-muted)' }}>
                            {s.label} <span className="text-[10.5px]">({s.km_used} km × {formatCurrency(s.rate)}/km)</span>
                          </span>
                          <span className="font-mono-data" style={{ color: 'var(--ink)' }}>
                            +{formatCurrency(s.cost)}
                          </span>
                        </div>
                      ))}

                    <div className="border-t pt-2 flex items-center justify-between font-semibold" style={{ borderColor: 'var(--border)' }}>
                      <span style={{ color: 'var(--ink)' }}>Raw Base Fare</span>
                      <span className="font-mono-data text-[13.5px] text-brand" style={{ color: 'var(--brand)' }}>
                        {formatCurrency(simulationResult.raw_base_fare)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11.5px] pt-1" style={{ color: 'var(--ink-muted)' }}>
                      <span>Anchor (Model 3) with +{simulationResult.anchor_markup_pct}% Markup</span>
                      <span className="font-mono-data font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(simulationResult.anchor_fare)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Dynamic Model Fares */}
              <div className="lg:col-span-6 space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-wider px-1" style={{ color: 'var(--ink-muted)' }}>
                  2. Final Calculated Fares Across Models
                </div>

                <div className="space-y-2">
                  {simulationResult.models.map((m) => (
                    <div
                      key={m.model_number}
                      className={`surface-card flex items-center justify-between rounded-xl border p-3 transition-all ${
                        m.isAnchor ? 'border-amber-500/40 bg-amber-500/5' : ''
                      }`}
                      style={{ borderColor: m.isAnchor ? undefined : 'var(--border)' }}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                            {m.name || `Model ${m.model_number}`}
                          </span>
                          {m.isAnchor && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                              ANCHOR (+{simulationResult.anchor_markup_pct}%)
                            </span>
                          )}
                          <span
                            className="rounded px-1.5 py-0.2 text-[10.5px] font-semibold"
                            style={{
                              background: m.percent_offset >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                              color: m.percent_offset >= 0 ? '#10b981' : '#ef4444',
                            }}
                          >
                            {m.offsetDisplay}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px]">
                          <span className="text-emerald-600 dark:text-emerald-400">👤 {m.user_title || m.name}</span>
                          <span className="text-blue-600 dark:text-blue-400">🚗 {m.driver_title || m.name}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono-data text-[17px] font-bold" style={{ color: 'var(--ink)' }}>
                          {formatCurrency(m.calculatedFare)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                          Customer Total
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
