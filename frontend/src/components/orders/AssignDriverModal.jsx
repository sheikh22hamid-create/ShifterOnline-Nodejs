import { useCallback, useState } from 'react'
import { Search, Bike } from 'lucide-react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useApiQuery from '../../hooks/useApiQuery'
import useDebouncedValue from '../../hooks/useDebouncedValue'

export default function AssignDriverModal({ open, order, onClose, onAssigned }) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [selectedId, setSelectedId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const fetcher = useCallback(() => {
    if (!open || !order) return Promise.resolve([])
    return api
      .get('/riders', { params: { status: 1, a_status: 1, search: debouncedSearch || undefined, city_id: order.city_id || undefined } })
      // The rider list endpoint has no vehicle-type filter — narrow to the
      // order's own category client-side.
      .then((res) => res.data.data.filter((d) => d.vehicle === order.category))
  }, [open, order, debouncedSearch])
  const { data, loading, error: loadError } = useApiQuery(fetcher)
  const drivers = data ?? []
  const error = submitError || (loadError ? 'Could not load eligible drivers.' : '')

  async function handleAssign() {
    if (!selectedId) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await api.post(`/orders/${order.id}/assign-rider`, { rider_id: selectedId })
      onAssigned()
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Could not assign this driver.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign driver — Order #${order?.id}`}
      width={440}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedId || submitting}
            onClick={handleAssign}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Assigning…' : 'Assign'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <Search size={14} style={{ color: 'var(--ink-faint)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or mobile"
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        {loading && (
          <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
            Loading eligible drivers…
          </p>
        )}
        {!loading && drivers.length === 0 && (
          <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
            No online, approved {order?.category} drivers found nearby.
          </p>
        )}
        {!loading &&
          drivers.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedId(d.id)}
              className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 transition-colors"
              style={{
                borderColor: 'var(--border)',
                background: selectedId === d.id ? 'var(--brand-soft)' : 'transparent',
              }}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                <Bike size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                  {d.full_name || `Driver #${d.id}`}
                </div>
                <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                  {d.fmobile} · {d.vehicle_no || 'no plate'}
                </div>
              </div>
              <div className="font-mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                ₹{d.wallet_balance}
              </div>
            </button>
          ))}
      </div>
    </Modal>
  )
}
