import { useCallback, useState } from 'react'
import { Coins, Save } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Pagination from '../components/common/Pagination'
import AdjustPointsModal from '../components/growth/AdjustPointsModal'
import { formatDateTime } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const LIMIT = 20

export default function Referrals() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const isSuperadmin = hasRole('superadmin')
  const canAdjust = hasRole('superadmin', 'admin')

  const settingsFetcher = useCallback(() => api.get('/referrals/settings').then((res) => res.data.data), [])
  const { data: settings, refetch: refetchSettings } = useApiQuery(settingsFetcher)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const editable = form ?? settings

  const [page, setPage] = useState(1)
  const treeFetcher = useCallback(() => api.get('/referrals/users', { params: { page, limit: LIMIT } }).then((res) => res.data), [page])
  const { data: tree, loading, error, refetch: refetchTree } = useApiQuery(treeFetcher)
  const rows = tree?.data ?? []
  const total = tree?.total ?? 0

  const [adjustOpen, setAdjustOpen] = useState(false)

  async function handleSaveSettings() {
    setSaving(true)
    try {
      await api.put('/referrals/settings', {
        user_point: editable.user_points_per_referral,
        driver_point: editable.driver_points_per_referral,
        point_value: editable.point_value,
        referral_enabled: editable.referral_enabled,
        share_message: editable.share_message,
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
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Referral Network
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Reward settings, referral tree, and manual point adjustments.
      </p>

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
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          Referral tree
        </h3>
        {canAdjust && (
          <button
            type="button"
            onClick={() => setAdjustOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Coins size={13} /> Adjust points
          </button>
        )}
      </div>

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
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No referrals yet.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {r.referrer?.name || `#${r.referrer.id}`}
                      <div className="font-mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                        {r.referrer.type}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {r.referred?.name || `#${r.referred.id}`}
                      <div className="font-mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                        {r.referred.type}
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

      <AdjustPointsModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onDone={() => {
          setAdjustOpen(false)
          toast.success('Points adjusted.')
          refetchTree()
        }}
      />
    </div>
  )
}
