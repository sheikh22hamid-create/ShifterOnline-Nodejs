import { useCallback, useState } from 'react'
import { Coins, Gift, Save, PhoneCall, Users, History } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import AdjustPointsModal from '../components/growth/AdjustPointsModal'
import GiveRewardPlanModal from '../components/growth/GiveRewardPlanModal'
import { formatDateTime } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const LIMIT = 20

const SOURCE_LABELS = {
  signup_bonus: { label: 'Signup Bonus', tone: 'success' },
  referral_reward: { label: 'Referral Reward', tone: 'success' },
  referral: { label: 'Referral Reward', tone: 'success' },
  admin_adjustment: { label: 'Admin Adjustment', tone: 'info' },
  ride_discount: { label: 'Ride Discount', tone: 'warning' },
  ride_discount_refund: { label: 'Discount Refund', tone: 'neutral' },
  due_clearance: { label: 'Due Clearance', tone: 'neutral' },
  points_expiry: { label: 'Points Expired', tone: 'danger' },
}
const SOURCE_FILTERS = [
  { value: 'all', label: 'All Sources' },
  { value: 'signup_bonus', label: 'Signup Bonus' },
  { value: 'referral_reward', label: 'Referral Reward' },
  { value: 'admin_adjustment', label: 'Admin Adjustment' },
  { value: 'ride_discount', label: 'Ride Discount' },
  { value: 'ride_discount_refund', label: 'Discount Refund' },
  { value: 'due_clearance', label: 'Due Clearance' },
  { value: 'points_expiry', label: 'Points Expired' },
]

// Points expiry: one duration per reward activity and recipient. An empty row means those points never expire.
const EXPIRY_ACTIVITIES = [
  { key: 'successful_referral', label: 'Successful Referral', hint: 'Referral reward once the referred person completes a ride' },
  { key: 'number_sharing', label: 'Number Sharing', hint: 'Reward for a shared number (lead) that joins' },
  { key: 'referral_sent', label: 'Referral Sent', hint: 'Sign-up bonus credited because a referral was used' },
]
const EXPIRY_TYPES = [
  { key: 'USER', label: 'Customer' },
  { key: 'DRIVER', label: 'Driver' },
]
const EXPIRY_UNITS = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
]

/** UI rows -> API body: every combination is sent, an empty value clears that row. */
function expiryPayload(config) {
  const out = {}
  for (const a of EXPIRY_ACTIVITIES) {
    out[a.key] = {}
    for (const t of EXPIRY_TYPES) {
      const row = config?.[a.key]?.[t.key]
      const raw = row?.value
      out[a.key][t.key] = raw === undefined || raw === null || raw === '' ? null : { value: Number(raw), unit: row.unit || 'months' }
    }
  }
  return out
}

function expiryDetail(r) {
  if (r.txn_type === 'expiry') return `Expired from credit #${r.origin_log_id}${r.expires_at ? ` · was due ${formatDateTime(r.expires_at)}` : ''}`
  if (!r.expires_at) return r.points > 0 && r.activity ? 'Never expires' : '—'
  return `Expires ${formatDateTime(r.expires_at)}${r.expiry_duration ? ` (${r.expiry_duration})` : ''}`
}

export default function Referrals() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const isSuperadmin = hasRole('superadmin')
  const canAdjust = hasRole('superadmin', 'admin')

  const settingsFetcher = useCallback(() => api.get('/referrals/settings').then((res) => res.data.data), [])
  const { data: settings, error: settingsError, refetch: refetchSettings } = useApiQuery(settingsFetcher)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const editable = form ?? settings

  const [activeTab, setActiveTab] = useState('tree') // 'tree' | 'history'

  const [page, setPage] = useState(1)
  const treeFetcher = useCallback(() => api.get('/referrals/users', { params: { page, limit: LIMIT } }).then((res) => res.data), [page])
  const { data: tree, loading, error, refetch: refetchTree } = useApiQuery(treeFetcher)
  const rows = tree?.data ?? []
  const total = tree?.total ?? 0

  const [historyPage, setHistoryPage] = useState(1)
  const [sourceFilter, setSourceFilter] = useState('all')
  const historyFetcher = useCallback(
    () => api.get('/referrals/point-log', { params: { page: historyPage, limit: LIMIT, source: sourceFilter } }).then((res) => res.data),
    [historyPage, sourceFilter]
  )
  const { data: history, loading: historyLoading, error: historyError, refetch: refetchHistory } = useApiQuery(historyFetcher)
  const historyRows = history?.data ?? []
  const historyTotal = history?.total ?? 0

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [rewardOpen, setRewardOpen] = useState(false)

  async function handleSaveSettings() {
    setSaving(true)
    try {
      await api.put('/referrals/settings', {
        user_point: editable.user_points_per_referral,
        driver_point: editable.driver_points_per_referral,
        lead_referral_points: editable.lead_referral_points,
        lead_verification_window_days: editable.lead_verification_window_days,
        signup_bonus_points: editable.signup_bonus_points,
        point_value: editable.point_value,
        referral_enabled: editable.referral_enabled,
        share_message: editable.share_message,
        ride_discount_percent: editable.ride_discount_percent,
        plan_purchase_enabled: editable.plan_purchase_enabled,
        plan_points_max_percent: editable.plan_points_max_percent,
        points_expiry: expiryPayload(editable.points_expiry),
      })
      toast.success('Referral settings saved.')
      setForm(null)
      refetchSettings()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Referral Network
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Reward settings, referral tree, and manual point adjustments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link
            to="/driver-leads"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
          >
            <PhoneCall size={13} /> Driver Leads Queue
          </Link>
          <Link
            to="/user-leads"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: '#2563EB', color: '#2563EB' }}
          >
            <Users size={13} /> User Leads Queue
          </Link>
        </div>
      </div>

      {!editable && settingsError && (
        <div className="surface-card mt-4 rounded-xl p-4 text-[13px]" style={{ color: 'var(--danger)' }}>
          Could not load reward settings: {settingsError}
        </div>
      )}

      {editable && (
        <div className="surface-card mt-4 rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Reward settings
            </h3>
            {isSuperadmin && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveSettings}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                <Save size={13} /> {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Customer points
              </label>
              <input
                type="number"
                disabled={!isSuperadmin}
                value={editable.user_points_per_referral}
                onChange={(e) => setForm({ ...editable, user_points_per_referral: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Driver points
              </label>
              <input
                type="number"
                disabled={!isSuperadmin}
                value={editable.driver_points_per_referral}
                onChange={(e) => setForm({ ...editable, driver_points_per_referral: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Lead points (Driver)
              </label>
              <input
                type="number"
                disabled={!isSuperadmin}
                value={editable.lead_referral_points ?? 100}
                onChange={(e) => setForm({ ...editable, lead_referral_points: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Lead validity (Days)
              </label>
              <input
                type="number"
                disabled={!isSuperadmin}
                value={editable.lead_verification_window_days ?? 45}
                onChange={(e) => setForm({ ...editable, lead_verification_window_days: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Sign-up bonus (points)
              </label>
              <input
                type="number"
                min="0"
                disabled={!isSuperadmin}
                value={editable.signup_bonus_points ?? 0}
                onChange={(e) => setForm({ ...editable, signup_bonus_points: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
              <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                Points credited immediately to a new user/driver who signs up using a referral code or matched lead.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                ₹ per point
              </label>
              <input
                type="number"
                disabled={!isSuperadmin}
                value={editable.point_value}
                onChange={(e) => setForm({ ...editable, point_value: e.target.value })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Program enabled
              </label>
              <select
                disabled={!isSuperadmin}
                value={editable.referral_enabled ? '1' : '0'}
                onChange={(e) => setForm({ ...editable, referral_enabled: e.target.value === '1' })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              >
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Ride discount from points (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                disabled={!isSuperadmin}
                value={editable.ride_discount_percent ?? 0}
                onChange={(e) => setForm({ ...editable, ride_discount_percent: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
              <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                Max % of a ride's fare (or advance payment) customers can cover using referral points.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Points for plan purchase
              </label>
              <select
                disabled={!isSuperadmin}
                value={editable.plan_purchase_enabled === false ? '0' : '1'}
                onChange={(e) => setForm({ ...editable, plan_purchase_enabled: e.target.value === '1' })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              >
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
              <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                Customers and drivers can pay for premium plans with referral points.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                Plan price payable with points (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                disabled={!isSuperadmin}
                value={editable.plan_points_max_percent ?? 100}
                onChange={(e) => setForm({ ...editable, plan_points_max_percent: Number(e.target.value) })}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                style={FIELD_STYLE}
              />
              <p className="mt-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                100 = a plan can be bought entirely with points.
              </p>
            </div>
          </div>
        </div>
      )}

      {editable && (
        <div className="surface-card mt-4 rounded-xl p-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Points expiry
          </h3>
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
            How long points from each activity stay valid, counted from the day they are credited. Applies to new credits only; points already
            credited keep their date. Leave a row empty and those points never expire. Save with the Save button above.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Reward activity</th>
                  {EXPIRY_TYPES.map((t) => (
                    <th key={t.key} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{t.label} expiry</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EXPIRY_ACTIVITIES.map((a) => (
                  <tr key={a.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-2 py-2" style={{ color: 'var(--ink)' }}>
                      <div className="font-medium">{a.label}</div>
                      <div className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>{a.hint}</div>
                    </td>
                    {EXPIRY_TYPES.map((t) => {
                      const row = editable.points_expiry?.[a.key]?.[t.key] || {}
                      const setRow = (patch) =>
                        setForm({
                          ...editable,
                          points_expiry: {
                            ...(editable.points_expiry || {}),
                            [a.key]: { ...(editable.points_expiry?.[a.key] || {}), [t.key]: { unit: 'months', ...row, ...patch } },
                          },
                        })
                      return (
                        <td key={t.key} className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              placeholder="No expiry"
                              disabled={!isSuperadmin}
                              value={row.value ?? ''}
                              onChange={(e) => setRow({ value: e.target.value })}
                              className="w-24 rounded-lg border px-2.5 py-1.5 text-[13px] outline-none disabled:opacity-60"
                              style={FIELD_STYLE}
                            />
                            <select
                              disabled={!isSuperadmin}
                              value={row.unit || 'months'}
                              onChange={(e) => setRow({ unit: e.target.value })}
                              className="rounded-lg border px-2 py-1.5 text-[13px] outline-none disabled:opacity-60"
                              style={FIELD_STYLE}
                            >
                              {EXPIRY_UNITS.map((u) => (
                                <option key={u.value} value={u.value}>{u.label}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(editable.points_expiry_unset?.length ?? 0) > 0 && (
            <p className="mt-2 text-[11.5px]" style={{ color: 'var(--warning, #b45309)' }}>
              No expiry is set for {editable.points_expiry_unset.length} of 6 rows, so those points never expire.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5 border-b sm:border-b-0" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('tree')}
            className="flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{
              color: activeTab === 'tree' ? 'var(--brand)' : 'var(--ink-muted)',
              borderBottom: activeTab === 'tree' ? '2px solid var(--brand)' : '2px solid transparent',
            }}
          >
            <Users size={13} /> Referral Tree
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className="flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{
              color: activeTab === 'history' ? 'var(--brand)' : 'var(--ink-muted)',
              borderBottom: activeTab === 'history' ? '2px solid var(--brand)' : '2px solid transparent',
            }}
          >
            <History size={13} /> Points History
          </button>
        </div>
        {canAdjust && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRewardOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
            >
              <Gift size={13} /> Give reward plan
            </button>
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Coins size={13} /> Adjust points
            </button>
          </div>
        )}
      </div>

      {activeTab === 'tree' && (
        <div className="surface-card mt-2 overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Referrer', 'Referred', 'Code', 'Status', 'Points', 'Date'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td colSpan={7} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                      </td>
                    </tr>
                  ))}
                {!loading && error && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                      {error}
                    </td>
                  </tr>
                )}
                {!loading && !error && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                      No referrals yet.
                    </td>
                  </tr>
                )}
                {!loading &&
                  !error &&
                  rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                        <div className="font-medium text-[13px]">
                          {r.referrer?.name || `ID #${r.referrer?.id}`}
                        </div>
                        <div className="font-mono-data text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                          {r.referrer?.mobile && (
                            <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>
                              {r.referrer.mobile}
                            </span>
                          )}
                          {r.referrer?.mobile && <span>·</span>}
                          <span>{r.referrer?.type}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                        <div className="font-medium text-[13px]">
                          {r.referred?.name || `ID #${r.referred?.id}`}
                        </div>
                        <div className="font-mono-data text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                          {r.referred?.mobile && (
                            <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>
                              {r.referred.mobile}
                            </span>
                          )}
                          {r.referred?.mobile && <span>·</span>}
                          <span>{r.referred?.type}</span>
                        </div>
                      </td>
                      <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                        {r.referral_code}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 capitalize" style={{ color: 'var(--ink-muted)' }}>
                        {r.status}
                      </td>
                      <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                        {r.points_awarded}
                      </td>
                      <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-faint)' }}>
                        {formatDateTime(r.registered_at)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
        </div>
      )}

      {activeTab === 'history' && (
        <div className="mt-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setSourceFilter(f.value)
                  setHistoryPage(1)
                }}
                className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: sourceFilter === f.value ? 'var(--brand)' : 'var(--border)',
                  background: sourceFilter === f.value ? 'var(--brand-soft)' : 'transparent',
                  color: sourceFilter === f.value ? 'var(--brand)' : 'var(--ink-muted)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="surface-card overflow-hidden rounded-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    {['Recipient', 'Source', 'Points', 'Balance After', 'Expiry', 'Note', 'Date'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historyLoading &&
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td colSpan={7} className="px-4 py-3">
                          <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                        </td>
                      </tr>
                    ))}
                  {!historyLoading && historyError && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                        {historyError}
                      </td>
                    </tr>
                  )}
                  {!historyLoading && !historyError && historyRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                        No point transactions yet.
                      </td>
                    </tr>
                  )}
                  {!historyLoading &&
                    !historyError &&
                    historyRows.map((r) => {
                      const sourceInfo = SOURCE_LABELS[r.source] || { label: r.source, tone: 'neutral' }
                      return (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                            <div className="font-medium text-[13px]">{r.user?.name || `ID #${r.user?.id}`}</div>
                            <div className="font-mono-data text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                              {r.user?.mobile && (
                                <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>
                                  {r.user.mobile}
                                </span>
                              )}
                              {r.user?.mobile && <span>·</span>}
                              <span>{r.user?.type}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            <Badge tone={sourceInfo.tone}>{sourceInfo.label}</Badge>
                          </td>
                          <td
                            className="font-mono-data whitespace-nowrap px-4 py-2.5"
                            style={{ color: r.points >= 0 ? 'var(--success)' : 'var(--danger)' }}
                          >
                            {r.points >= 0 ? `+${r.points}` : r.points}
                          </td>
                          <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                            {r.balance_after}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                            <div>{expiryDetail(r)}</div>
                            {r.remaining_points !== null && r.remaining_points !== undefined && (
                              <div style={{ color: 'var(--ink-faint)' }}>
                                Remaining {r.remaining_points} · Redeemed {r.redeemed_points} · Expired {r.expired_points}
                              </div>
                            )}
                          </td>
                          <td className="max-w-[220px] truncate px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }} title={r.note || ''}>
                            {r.note || '—'}
                          </td>
                          <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-faint)' }}>
                            {formatDateTime(r.created_at)}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
            <Pagination page={historyPage} limit={LIMIT} total={historyTotal} onPageChange={setHistoryPage} />
          </div>
        </div>
      )}

      <AdjustPointsModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onDone={() => {
          setAdjustOpen(false)
          toast.success('Points adjusted.')
          refetchTree()
          refetchHistory()
        }}
      />

      <GiveRewardPlanModal
        open={rewardOpen}
        onClose={() => setRewardOpen(false)}
        onDone={() => {
          setRewardOpen(false)
          toast.success('Reward plan given.')
        }}
      />
    </div>
  )
}
