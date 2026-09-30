import { useCallback, useState } from 'react'
import { Check, X, Clock } from 'lucide-react'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'

// Monthly drivers who tried to start duty before their contract shift start.
export default function EarlyStartRequests() {
  const toast = useToast()
  const fetcher = useCallback(() => api.get('/monthly-drivers/early-start-requests?status=pending').then((res) => res.data), [])
  const { data, refetch } = useApiQuery(fetcher)
  const requests = data?.data ?? []
  const [busyId, setBusyId] = useState(null)

  async function decide(id, decision) {
    setBusyId(id)
    try {
      await api.post(`/monthly-drivers/early-start-requests/${id}/decision`, { decision })
      toast.success(decision === 'approve' ? 'Early start approved.' : 'Early start declined.')
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update this request.')
    } finally {
      setBusyId(null)
    }
  }

  if (requests.length === 0) return null

  return (
    <section className="surface-card rounded-xl p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        <Clock size={14} /> Early duty start requests ({requests.length})
      </h3>
      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
            <div className="min-w-0 text-[13px]">
              <div className="font-medium" style={{ color: 'var(--ink)' }}>
                {r.rider_name} <span style={{ color: 'var(--ink-faint)' }}>{r.rider_mobile}</span>
              </div>
              <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Wants to start before the {r.shift_start_time ? String(r.shift_start_time).slice(0, 5) : 'shift start'} shift start
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => decide(r.id, 'approve')}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                <Check size={13} /> Approve
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => decide(r.id, 'reject')}
                className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
              >
                <X size={13} /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
