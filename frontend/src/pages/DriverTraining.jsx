import { useCallback, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import { formatDateTime } from '../utils/format'

export default function DriverTraining() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canReset = hasRole('superadmin', 'admin')

  const [status, setStatus] = useState('')
  const [resetTarget, setResetTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  const fetcher = useCallback(() => api.get('/training/progress', { params: { status: status || undefined } }).then((res) => res.data), [status])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const rows = data?.data ?? []

  async function handleReset() {
    if (!resetTarget) return
    setBusy(true)
    try {
      await api.post(`/training/progress/${resetTarget.rider_id}/reset`)
      toast.success(`Training reset for ${resetTarget.full_name || `Driver #${resetTarget.rider_id}`}.`)
      setResetTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reset training.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Driver Training
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Mandatory training-video completion per driver. Configure the video link under Platform Settings.
      </p>

      <div className="mt-4 flex gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <option value="">All drivers</option>
          <option value="pending">Pending / in progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Driver', 'Progress', 'Status', 'Last updated', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No drivers match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.rider_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{r.full_name || `Driver #${r.rider_id}`}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {r.fmobile}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {Math.round(r.watch_progress)}%
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={r.is_completed ? 'success' : 'warning'}>{r.is_completed ? 'Completed' : 'Pending'}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {r.updated_at ? formatDateTime(r.updated_at) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {canReset && (
                        <button
                          type="button"
                          onClick={() => setResetTarget(r)}
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-medium"
                          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                        >
                          <RotateCcw size={12} /> Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title="Reset training"
        footer={
          <>
            <button type="button" onClick={() => setResetTarget(null)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={handleReset} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
              {busy ? 'Resetting…' : 'Reset training'}
            </button>
          </>
        }
      >
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          This clears {resetTarget?.full_name || `Driver #${resetTarget?.rider_id}`}'s training progress. They'll be required to watch the training video again from the beginning before reaching the Home dashboard.
        </p>
      </Modal>
    </div>
  )
}
