import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useApiQuery from '../../hooks/useApiQuery'
import { formatCurrency } from '../../utils/format'

export default function NextDaySequenceModal({ open, orders, onClose, onAssigned }) {
  const [selectedRiderId, setSelectedRiderId] = useState('')
  const [sequence, setSequence] = useState(null) // [{ order_id, pickup_distance_km }]
  const [reordered, setReordered] = useState(false)
  const [notifyNow, setNotifyNow] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // NextDaySequenceModal itself stays mounted across open/close cycles —
  // only its `open` prop toggles (Modal.jsx returns null internally when
  // closed, but that only hides Modal's own rendered output; it doesn't
  // unmount this parent component or its hooks). So without this, state
  // from a previous open/close cycle — e.g. a suggested sequence for a
  // different order selection — would leak into the next time the modal
  // is opened. Reset everything whenever it transitions to open so every
  // fresh open starts clean.
  useEffect(() => {
    if (open) {
      setSelectedRiderId('')
      setSequence(null)
      setNotifyNow(true)
      setError('')
      setReordered(false)
    }
  }, [open])

  const fetcher = useCallback(() => {
    if (!open) return Promise.resolve([])
    return api.get('/riders', { params: { status: 1 } }).then((res) => res.data.data)
  }, [open])
  const { data, loading } = useApiQuery(fetcher)
  const drivers = data ?? []

  const ordersById = new Map((orders || []).map((o) => [o.id, o]))

  async function handleSuggest() {
    if (!selectedRiderId) return
    setSuggesting(true)
    setError('')
    try {
      const res = await api.post('/orders/next-day/suggest-sequence', {
        rider_id: selectedRiderId,
        order_ids: (orders || []).map((o) => o.id),
      })
      setSequence(res.data.data)
      setReordered(false)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not suggest a sequence.')
    } finally {
      setSuggesting(false)
    }
  }

  function moveUp(index) {
    if (index === 0) return
    setReordered(true)
    setSequence((prev) => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index) {
    setReordered(true)
    setSequence((prev) => {
      if (index === prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  async function handleAssign() {
    if (!selectedRiderId || !sequence || sequence.length === 0) return
    setSubmitting(true)
    setError('')
    try {
      await api.post('/orders/next-day/assign-batch', {
        rider_id: selectedRiderId,
        notify_driver_now: notifyNow,
        sequence: sequence.map((s, i) => ({ order_id: s.order_id, position: i + 1 })),
      })
      onAssigned()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not assign this batch.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign ${orders?.length || 0} next-day order(s)`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!sequence || sequence.length === 0 || submitting}
            onClick={handleAssign}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Assigning…' : 'Assign All'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="next-day-driver">
        Driver
      </label>
      <div className="mb-3 flex gap-2">
        <select
          id="next-day-driver"
          value={selectedRiderId}
          onChange={(e) => { setSelectedRiderId(e.target.value); setSequence(null) }}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
        >
          <option value="">{loading ? 'Loading…' : 'Select driver'}</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name || `Driver #${d.id}`} — {d.fmobile}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedRiderId || suggesting}
          onClick={handleSuggest}
          className="whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
        >
          {suggesting ? 'Suggesting…' : 'Suggest Sequence'}
        </button>
      </div>

      {sequence && (
        <div className="mb-3 space-y-1.5">
          {sequence.map((s, i) => {
            const order = ordersById.get(s.order_id)
            return (
              <div key={s.order_id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <span className="font-mono-data font-semibold" style={{ color: 'var(--ink)' }}>#{i + 1}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--ink-muted)' }}>
                  Order #{s.order_id} — {order?.paddress || 'pickup'}{!reordered ? ` (${s.pickup_distance_km} km away)` : ''} — {formatCurrency(order?.total_dcharge)}
                </span>
                <button type="button" onClick={() => moveUp(i)} disabled={i === 0} className="disabled:opacity-30" style={{ color: 'var(--ink-faint)' }}>↑</button>
                <button type="button" onClick={() => moveDown(i)} disabled={i === sequence.length - 1} className="disabled:opacity-30" style={{ color: 'var(--ink-faint)' }}>↓</button>
              </div>
            )
          })}
        </div>
      )}

      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        <input type="checkbox" checked={notifyNow} onChange={(e) => setNotifyNow(e.target.checked)} />
        Notify the driver now (informational only — no accept/reject)
      </label>
    </Modal>
  )
}
