import { useCallback, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useApiQuery from '../../hooks/useApiQuery'

export default function AssignScheduledDriverModal({ open, order, onClose, onAssigned }) {
  const [selectedId, setSelectedId] = useState('')
  const [notifyNow, setNotifyNow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fetcher = useCallback(() => {
    if (!open || !order) return Promise.resolve([])
    return api
      .get('/riders', { params: { status: 1, city_id: order.city_id || undefined } })
      .then((res) => res.data.data.filter((d) => d.vehicle === order.category))
  }, [open, order])
  const { data, loading } = useApiQuery(fetcher)
  const drivers = data ?? []

  async function handleAssign() {
    if (!selectedId) return
    setSubmitting(true)
    setError('')
    try {
      await api.post(`/orders/scheduled/${order.id}/assign-driver`, { rider_id: selectedId, notify_driver_now: notifyNow })
      onAssigned()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not pre-assign this driver.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Pre-assign driver — Order #${order?.id}`}
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
            {submitting ? 'Assigning…' : 'Pre-assign'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="sched-driver">
        Driver
      </label>
      <select
        id="sched-driver"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      >
        <option value="">{loading ? 'Loading…' : `Select ${order?.category || ''} driver`}</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.full_name || `Driver #${d.id}`} — {d.fmobile}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        <input type="checkbox" checked={notifyNow} onChange={(e) => setNotifyNow(e.target.checked)} />
        Notify the driver immediately (there's no scheduler yet to wake them 30 min before pickup — see backend note)
      </label>
    </Modal>
  )
}
