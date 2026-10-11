import { useCallback, useEffect, useState } from 'react'
import {
  Layers,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldAlert,
  Clock,
  Sliders,
  User,
  Filter,
  Search,
  RefreshCw,
  Info,
  Check,
  Ban,
  ArrowRight,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import { formatCurrency, formatDateTime } from '../utils/format'

const TABS = [
  { id: 'cancels', label: 'Driver Cancel Requests' },
  { id: 'penalties', label: 'Penalty Ledger & Counters' },
  { id: 'settings', label: 'Cascade & Penalty Settings' },
]

const cardStyle = { background: 'var(--surface)', borderColor: 'var(--border)' }
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }

export default function TieredDispatch() {
  const toast = useToast()
  const { user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin'

  const [activeTab, setActiveTab] = useState('cancels')

  // --- Tab 1: Cancel Requests State ---
  const [cancelStatusFilter, setCancelStatusFilter] = useState('pending')
  const [cancelRequests, setCancelRequests] = useState([])
  const [cancelsLoading, setCancelsLoading] = useState(false)
  const [activeModalAction, setActiveModalAction] = useState(null) // { type: 'approve' | 'reject', request: object }
  const [actionSubmitting, setActionSubmitting] = useState(false)

  // --- Tab 2: Penalties State ---
  const [penalties, setPenalties] = useState([])
  const [penaltiesLoading, setPenaltiesLoading] = useState(false)
  const [penaltyTierFilter, setPenaltyTierFilter] = useState('')
  const [penaltyStatusFilter, setPenaltyStatusFilter] = useState('')
  const [penaltyRiderFilter, setPenaltyRiderFilter] = useState('')
  const [waiveTarget, setWaiveTarget] = useState(null)
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [resetForm, setResetForm] = useState({ rider_id: '', tier: 'free' })
  const [resetSubmitting, setResetSubmitting] = useState(false)

  // --- Tab 3: Settings State ---
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settings, setSettings] = useState({
    tiered_dispatch_enabled: false,
    penalty_enabled: false,
    ladder: '5,10,20,50,100',
    cancel_penalty_pct: 100,
  })

  // ==========================================
  // FETCHERS
  // ==========================================

  const fetchCancelRequests = useCallback(async () => {
    setCancelsLoading(true)
    try {
      const res = await api.get('/tier-dispatch/cancel-requests', {
        params: { status: cancelStatusFilter },
      })
      setCancelRequests(res.data?.data || [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load cancel requests')
    } finally {
      setCancelsLoading(false)
    }
  }, [cancelStatusFilter, toast])

  const fetchPenalties = useCallback(async () => {
    setPenaltiesLoading(true)
    try {
      const res = await api.get('/tier-dispatch/penalties', {
        params: {
          tier: penaltyTierFilter || undefined,
          status: penaltyStatusFilter || undefined,
          rider_id: penaltyRiderFilter || undefined,
        },
      })
      setPenalties(res.data?.data || [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load penalties')
    } finally {
      setPenaltiesLoading(false)
    }
  }, [penaltyTierFilter, penaltyStatusFilter, penaltyRiderFilter, toast])

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true)
    try {
      const res = await api.get('/tier-dispatch/settings')
      const s = res.data?.data || {}
      setSettings({
        tiered_dispatch_enabled: Boolean(s.tieredEnabled),
        penalty_enabled: Boolean(s.penaltyEnabled),
        ladder: Array.isArray(s.ladder) ? s.ladder.join(',') : String(s.ladder || '5,10,20,50,100'),
        cancel_penalty_pct: Number(s.cancelPenaltyPct ?? 100),
      })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load dispatch settings')
    } finally {
      setSettingsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (activeTab === 'cancels') fetchCancelRequests()
    if (activeTab === 'penalties') fetchPenalties()
    if (activeTab === 'settings') fetchSettings()
  }, [activeTab, fetchCancelRequests, fetchPenalties, fetchSettings])

  // ==========================================
  // HANDLERS
  // ==========================================

  async function handleConfirmCancelAction() {
    if (!activeModalAction) return
    setActionSubmitting(true)
    const { type, request } = activeModalAction
    try {
      if (type === 'approve') {
        const res = await api.post(`/tier-dispatch/cancel-requests/${request.id}/approve`)
        toast.success(res.data?.message || 'Cancel approved: order re-dispatched to next tier')
      } else {
        const res = await api.post(`/tier-dispatch/cancel-requests/${request.id}/reject`)
        toast.success(res.data?.message || 'Cancel rejected: driver notified to complete order')
      }
      setActiveModalAction(null)
      fetchCancelRequests()
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${type} cancel request`)
    } finally {
      setActionSubmitting(false)
    }
  }

  async function handleWaivePenalty() {
    if (!waiveTarget) return
    try {
      const res = await api.post(`/tier-dispatch/penalties/${waiveTarget.id}/waive`)
      toast.success(res.data?.message || 'Penalty successfully waived')
      setWaiveTarget(null)
      fetchPenalties()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not waive penalty')
    }
  }

  async function handleResetCounter(e) {
    e.preventDefault()
    if (!resetForm.rider_id) {
      toast.error('Driver/Rider ID is required')
      return
    }
    setResetSubmitting(true)
    try {
      const res = await api.post('/tier-dispatch/counters/reset', {
        rider_id: Number(resetForm.rider_id),
        tier: resetForm.tier,
      })
      toast.success(res.data?.message || 'Penalty counter reset to 0')
      setResetModalOpen(false)
      setResetForm({ rider_id: '', tier: 'free' })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reset counter')
    } finally {
      setResetSubmitting(false)
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault()
    if (!isSuperadmin) {
      toast.error('Only superadmin can modify dispatch settings')
      return
    }
    setSettingsSaving(true)
    try {
      const res = await api.put('/tier-dispatch/settings', {
        tiered_dispatch_enabled: settings.tiered_dispatch_enabled,
        penalty_enabled: settings.penalty_enabled,
        ladder: settings.ladder,
        cancel_penalty_pct: Number(settings.cancel_penalty_pct),
      })
      toast.success(res.data?.message || 'Dispatch settings saved successfully')
      fetchSettings()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save settings')
    } finally {
      setSettingsSaving(false)
    }
  }

  // Parse ladder array for visual cards
  const ladderArray = settings.ladder
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <Layers size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                Tiered Dispatch & Penalties
              </h1>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Free &rarr; Daily &rarr; Normal dispatch priority cascade, driver cancel queue, and penalty ladder
              </p>
            </div>
          </div>
        </div>

        {/* Global Status Pill */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold" style={cardStyle}>
            <span
              className={`h-2 w-2 rounded-full ${
                settings.tiered_dispatch_enabled ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span style={{ color: 'var(--ink)' }}>
              Cascade: {settings.tiered_dispatch_enabled ? 'Active (Free &rarr; Daily &rarr; Normal)' : 'Off (Standard Dispatch)'}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold" style={cardStyle}>
            <span className={`h-2 w-2 rounded-full ${settings.penalty_enabled ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
            <span style={{ color: 'var(--ink)' }}>
              Penalties: {settings.penalty_enabled ? 'Enforced' : 'Off'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === t.id
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent hover:text-emerald-500'
            }`}
            style={{ color: activeTab === t.id ? undefined : 'var(--ink-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/* TAB 1: CANCEL REQUESTS */}
      {/* ============================================================ */}
      {activeTab === 'cancels' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4" style={cardStyle}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                Filter Status:
              </span>
              {['pending', 'approved', 'rejected', 'stale'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setCancelStatusFilter(st)}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize transition-all ${
                    cancelStatusFilter === st
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'border hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  style={cancelStatusFilter !== st ? { borderColor: 'var(--border)', color: 'var(--ink)' } : {}}
                >
                  {st}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={fetchCancelRequests}
              disabled={cancelsLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              <RefreshCw size={13} className={cancelsLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* List Table */}
          <div className="overflow-hidden rounded-2xl border" style={cardStyle}>
            <table className="w-full text-left text-xs">
              <thead style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>ID</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Order ID</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Driver</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Tier</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Reason</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Requested At</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Status</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--ink-muted)' }}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {cancelsLoading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-emerald-600" />
                        Loading cancel requests...
                      </div>
                    </td>
                  </tr>
                ) : cancelRequests.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                      No {cancelStatusFilter} cancel requests found.
                    </td>
                  </tr>
                ) : (
                  cancelRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-zinc-500/5 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold" style={{ color: 'var(--ink)' }}>#{req.id}</td>
                      <td className="px-4 py-3 font-semibold text-emerald-600">Order #{req.order_id}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                          {req.rider_name || 'Driver'}
                        </div>
                        <div className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          ID: #{req.rider_id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={req.tier === 'free' ? 'info' : 'warning'}>
                          {req.tier === 'free' ? 'Free Pool Driver' : 'Daily Duty Driver'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate" style={{ color: 'var(--ink)' }}>
                        {req.reason || 'No reason provided'}
                      </td>
                      <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {formatDateTime(req.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            req.status === 'pending'
                              ? 'warning'
                              : req.status === 'approved'
                              ? 'success'
                              : req.status === 'rejected'
                              ? 'danger'
                              : 'neutral'
                          }
                        >
                          {req.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {req.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setActiveModalAction({ type: 'approve', request: req })}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveModalAction({ type: 'reject', request: req })}
                              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                            {req.decided_at ? formatDateTime(req.decided_at) : 'Decided'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: PENALTIES & COUNTERS */}
      {/* ============================================================ */}
      {activeTab === 'penalties' && (
        <div className="space-y-4">
          {/* Action & Filter Bar */}
          <div className="flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between" style={cardStyle}>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Filter size={14} style={{ color: 'var(--ink-muted)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>Filters:</span>
              </div>

              {/* Tier Filter */}
              <select
                value={penaltyTierFilter}
                onChange={(e) => setPenaltyTierFilter(e.target.value)}
                className="rounded-lg border px-2.5 py-1 text-xs font-semibold outline-none"
                style={inputStyle}
              >
                <option value="">All Tiers</option>
                <option value="free">Free Tier</option>
                <option value="daily">Daily Tier</option>
              </select>

              {/* Status Filter */}
              <select
                value={penaltyStatusFilter}
                onChange={(e) => setPenaltyStatusFilter(e.target.value)}
                className="rounded-lg border px-2.5 py-1 text-xs font-semibold outline-none"
                style={inputStyle}
              >
                <option value="">All Statuses</option>
                <option value="pending_daily">Pending Daily (Deferred)</option>
                <option value="collected">Collected (Debited)</option>
                <option value="waived">Waived</option>
              </select>

              {/* Rider ID Filter */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter by Rider ID..."
                  value={penaltyRiderFilter}
                  onChange={(e) => setPenaltyRiderFilter(e.target.value)}
                  className="rounded-lg border pl-7 pr-2.5 py-1 text-xs outline-none w-36"
                  style={inputStyle}
                />
                <Search size={12} className="absolute left-2 top-2 text-zinc-400" />
              </div>

              <button
                type="button"
                onClick={fetchPenalties}
                disabled={penaltiesLoading}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <RefreshCw size={12} className={penaltiesLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {/* Counter Reset Trigger */}
            <button
              type="button"
              onClick={() => setResetModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-500/20 transition-colors"
            >
              <RotateCcw size={13} />
              Reset Driver Counter
            </button>
          </div>

          {/* Penalties Table */}
          <div className="overflow-hidden rounded-2xl border" style={cardStyle}>
            <table className="w-full text-left text-xs">
              <thead style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>ID</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Driver</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Order ID</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Tier</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Event / Reason</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Miss #</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Penalty Amount</th>
                  <th className="px-4 py-3 font-semibold" style={{ color: 'var(--ink-muted)' }}>Status</th>
                  <th className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--ink-muted)' }}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {penaltiesLoading ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-emerald-600" />
                        Loading penalty ledger...
                      </div>
                    </td>
                  </tr>
                ) : penalties.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                      No penalties recorded matching the criteria.
                    </td>
                  </tr>
                ) : (
                  penalties.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-500/5 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold" style={{ color: 'var(--ink)' }}>#{p.id}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold" style={{ color: 'var(--ink)' }}>{p.rider_name || 'Driver'}</div>
                        <div className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>ID: #{p.rider_id}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-emerald-600">Order #{p.order_id}</td>
                      <td className="px-4 py-3">
                        <Badge tone={p.tier === 'free' ? 'info' : 'warning'}>
                          {p.tier}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 capitalize" style={{ color: 'var(--ink)' }}>
                        {p.event}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {p.miss_no ? `Miss #${p.miss_no}` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-rose-600">
                          {formatCurrency(p.amount)}
                        </span>
                        <span className="ml-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          ({p.pct}%)
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            p.status === 'collected'
                              ? 'danger'
                              : p.status === 'pending_daily'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {p.status === 'pending_daily' ? 'Pending Settlement' : p.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.status !== 'waived' ? (
                          <button
                            type="button"
                            onClick={() => setWaiveTarget(p)}
                            className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-600 hover:text-white transition-colors"
                          >
                            Waive
                          </button>
                        ) : (
                          <span className="text-[11px] text-zinc-400">Waived</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 3: DISPATCH & PENALTY SETTINGS */}
      {/* ============================================================ */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl">
          {!isSuperadmin && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>
                Dispatch configuration is global and can only be altered by a Superadmin. You are currently viewing in read-only mode.
              </span>
            </div>
          )}

          {/* Master Toggles */}
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              <Sliders size={16} className="text-emerald-600" />
              Master Automation Switches
            </h2>

            {/* Tiered Dispatch Enabled */}
            <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  Tiered Dispatch Cascade
                </div>
                <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  When enabled, Free orders cascade Free &rarr; Daily &rarr; Normal, and other orders cascade Daily &rarr; Normal.
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  disabled={!isSuperadmin}
                  checked={settings.tiered_dispatch_enabled}
                  onChange={(e) => setSettings((s) => ({ ...s, tiered_dispatch_enabled: e.target.checked }))}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-zinc-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:bg-zinc-700"></div>
              </label>
            </div>

            {/* Penalty Engine Enabled */}
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  Driver Penalty Engine
                </div>
                <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Deduct escalating penalties for skips, timeouts, and rejects during Free and Daily duty stages.
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  disabled={!isSuperadmin}
                  checked={settings.penalty_enabled}
                  onChange={(e) => setSettings((s) => ({ ...s, penalty_enabled: e.target.checked }))}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-zinc-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:bg-zinc-700"></div>
              </label>
            </div>
          </div>

          {/* Penalty Ladder Configuration */}
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              <ShieldAlert size={16} className="text-rose-600" />
              Escalating Penalty Ladder
            </h2>

            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Comma-separated percentage progression for consecutive skips/rejects (e.g. 5,10,20,50,100). Once the ladder ceiling is reached, subsequent misses receive the final percentage.
            </p>

            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                Ladder Values (% of order fare)
              </label>
              <input
                type="text"
                disabled={!isSuperadmin}
                value={settings.ladder}
                onChange={(e) => setSettings((s) => ({ ...s, ladder: e.target.value }))}
                className="mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
                placeholder="5,10,20,50,100"
              />
            </div>

            {/* Visual Ramp Preview */}
            <div className="mt-2 grid grid-cols-5 gap-2">
              {ladderArray.map((pct, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border p-2.5 text-center transition-all"
                  style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-muted)' }}>
                    {idx === ladderArray.length - 1 ? `Miss #${idx + 1}+` : `Miss #${idx + 1}`}
                  </div>
                  <div className="mt-1 text-base font-bold text-rose-600">
                    {pct}%
                  </div>
                </div>
              ))}
            </div>

            {/* Cancel Penalty Percentage */}
            <div className="pt-2">
              <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                Admin-Approved Cancel Penalty (% of order fare)
              </label>
              <p className="text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                Applied to a Free or Daily driver when the admin approves their cancel request before pickup.
              </p>
              <input
                type="number"
                min="0"
                max="100"
                disabled={!isSuperadmin}
                value={settings.cancel_penalty_pct}
                onChange={(e) => setSettings((s) => ({ ...s, cancel_penalty_pct: e.target.value }))}
                className="w-48 rounded-xl border px-3.5 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Save Button */}
          {isSuperadmin && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={settingsSaving || settingsLoading}
                className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {settingsSaving ? 'Saving...' : 'Save Dispatch Settings'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* ============================================================ */}
      {/* MODAL: APPROVE / REJECT CANCEL REQUEST */}
      {/* ============================================================ */}
      {activeModalAction && (
        <Modal
          title={
            activeModalAction.type === 'approve'
              ? 'Approve Driver Cancel Request?'
              : 'Reject Driver Cancel Request?'
          }
          onClose={() => setActiveModalAction(null)}
        >
          <div className="space-y-4 text-xs">
            {activeModalAction.type === 'approve' ? (
              <div className="space-y-2">
                <p style={{ color: 'var(--ink)' }}>
                  Are you sure you want to approve this cancel request for <strong>Order #{activeModalAction.request.order_id}</strong>?
                </p>
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 space-y-1 text-rose-700 dark:text-rose-400">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Automatic consequences:
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                    <li>Driver (ID #{activeModalAction.request.rider_id}) is unassigned immediately.</li>
                    <li>
                      Cancel penalty (<strong>{settings.cancel_penalty_pct}%</strong>) will be debited/deferred to the driver.
                    </li>
                    <li>Order re-enters dispatch cascade from the <strong>next eligible tier</strong>.</li>
                    <li>Customer app receives an unassigned event to show live re-dispatch.</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p style={{ color: 'var(--ink)' }}>
                  Reject cancel request for <strong>Order #{activeModalAction.request.order_id}</strong>?
                </p>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 space-y-1 text-amber-700 dark:text-amber-400">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Info size={14} /> Action outcome:
                  </div>
                  <p className="text-[11px]">
                    The order remains assigned to driver #{activeModalAction.request.rider_id}. A push notification will be sent instructing them that the cancel request was rejected and they must complete the delivery.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveModalAction(null)}
                className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelAction}
                disabled={actionSubmitting}
                className={`rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors ${
                  activeModalAction.type === 'approve'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-zinc-800 hover:bg-zinc-900 dark:bg-zinc-700 dark:hover:bg-zinc-600'
                }`}
              >
                {actionSubmitting ? 'Processing...' : activeModalAction.type === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================ */}
      {/* MODAL: WAIVE PENALTY CONFIRMATION */}
      {/* ============================================================ */}
      {waiveTarget && (
        <Modal
          title={`Waive Penalty #${waiveTarget.id}?`}
          onClose={() => setWaiveTarget(null)}
        >
          <div className="space-y-3 text-xs">
            <p style={{ color: 'var(--ink)' }}>
              Are you sure you want to waive penalty of <strong>{formatCurrency(waiveTarget.amount)}</strong> for Driver #{waiveTarget.rider_id}?
            </p>
            <p style={{ color: 'var(--ink-muted)' }}>
              If already deducted from wallet, it will be refunded. If pending for Daily settlement, it will be marked as waived.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setWaiveTarget(null)}
                className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleWaivePenalty}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
              >
                Confirm Waive
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ============================================================ */}
      {/* MODAL: RESET DRIVER TIER COUNTER */}
      {/* ============================================================ */}
      {resetModalOpen && (
        <Modal
          title="Reset Driver Penalty Counter"
          onClose={() => setResetModalOpen(false)}
        >
          <form onSubmit={handleResetCounter} className="space-y-4 text-xs">
            <div>
              <label className="font-semibold" style={{ color: 'var(--ink)' }}>
                Driver (Rider ID)
              </label>
              <input
                type="number"
                required
                placeholder="e.g. 104"
                value={resetForm.rider_id}
                onChange={(e) => setResetForm((f) => ({ ...f, rider_id: e.target.value }))}
                className="mt-1 w-full rounded-xl border px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              />
            </div>

            <div>
              <label className="font-semibold" style={{ color: 'var(--ink)' }}>
                Tier Counter to Reset
              </label>
              <select
                value={resetForm.tier}
                onChange={(e) => setResetForm((f) => ({ ...f, tier: e.target.value }))}
                className="mt-1 w-full rounded-xl border px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                style={inputStyle}
              >
                <option value="free">Free Booking Pool Tier</option>
                <option value="daily">Daily Duty Driver Tier</option>
              </select>
            </div>

            <p style={{ color: 'var(--ink-muted)' }}>
              Resetting will set the driver's consecutive miss count back to 0. Their next miss will start from the lowest ladder rung (e.g. 5%).
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetSubmitting}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 transition-colors"
              >
                {resetSubmitting ? 'Resetting...' : 'Reset Counter'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
