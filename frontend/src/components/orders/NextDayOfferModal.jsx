import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import { useToast } from '../../context/ToastContext'

const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const STATUS_COLOR = { offered: 'var(--brand)', accepted: 'var(--success)', rejected: 'var(--danger)', expired: 'var(--ink-faint)', cancelled: 'var(--ink-faint)' }

export default function NextDayOfferModal({ open, order, onClose, onChanged }) {
  const toast = useToast()
  // The toast context value is a fresh object on every provider render (each toast push re-renders it),
  // so depending on it directly would restart the polling effect and re-fire a failing load in a loop.
  const toastRef = useRef(toast)
  toastRef.current = toast
  const orderId = order?.id
  const [drivers, setDrivers] = useState([])
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const reqRef = useRef(0) // latest request id; responses from older requests / other orders are ignored
  const failedRef = useRef(false) // true while in a failure streak, so only the first failure toasts
  const timerRef = useRef(null)

  const load = useCallback(async (isFirst = false) => {
    if (!orderId) return
    const id = ++reqRef.current
    if (isFirst) setLoading(true) // only the first load after open shows "Loading…"; polls stay silent
    try {
      const [d, o] = await Promise.all([
        api.get(`/orders/next-day/${orderId}/daily-drivers`),
        api.get(`/orders/next-day/${orderId}/offers`),
      ])
      if (id !== reqRef.current) return
      setDrivers(d.data?.data ?? [])
      setOffers(o.data?.data ?? [])
      failedRef.current = false
    } catch (err) {
      if (id !== reqRef.current) return
      if (!failedRef.current) toastRef.current.error(errMsg(err, 'Could not load Daily Drivers'))
      failedRef.current = true
      const status = err?.response?.status
      // 4xx (order went live / was assigned / city mismatch): retrying will not help, stop polling
      if (status >= 400 && status < 500) clearInterval(timerRef.current)
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (!open) return undefined
    setDrivers([])
    setOffers([])
    failedRef.current = false
    load(true)
    const t = setInterval(() => load(), 5000) // follow the cascade while the modal is open
    timerRef.current = t
    return () => {
      clearInterval(t)
      reqRef.current += 1 // invalidate any in-flight request
    }
  }, [open, load])

  const openOffer = offers.find((o) => o.status === 'offered')

  async function offerTo(riderId) {
    setBusyId(riderId)
    try {
      await api.post(`/orders/next-day/${orderId}/offer`, { rider_id: riderId })
      toast.success('Offer sent. If the driver rejects or does not answer, the next Daily Driver is tried automatically.')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(errMsg(err, 'Could not send the offer'))
    } finally {
      setBusyId(null)
    }
  }

  const liveAt = order?.next_day_live_at ? new Date(order.next_day_live_at).toLocaleString() : '—'

  return (
    <Modal open={open} onClose={onClose} title={order ? `Offer order #${order.id} to a Daily Driver` : 'Offer'} width={560}>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 text-[13px]" style={{ color: 'var(--ink)' }}>
        <p style={{ color: 'var(--ink-muted)' }}>
          Goes live to Normal Drivers at <b>{liveAt}</b> if no Daily Driver has accepted. A Daily Driver earns 90% of the fare on this order.
        </p>

        {openOffer && (
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--brand-soft-border)', background: 'var(--brand-soft)' }}>
            Waiting for driver #{openOffer.rider_id} to answer…
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Available Daily Drivers (nearest first)</p>
          {loading && drivers.length === 0 && <p style={{ color: 'var(--ink-faint)' }}>Loading…</p>}
          {!loading && drivers.length === 0 && <p style={{ color: 'var(--ink-faint)' }}>No Daily Driver is available for this order.</p>}
          {drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-t py-2" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div>{d.full_name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || `Driver #${d.id}`} <span style={{ color: 'var(--ink-faint)' }}>#{d.id}</span></div>
                <div style={{ color: 'var(--ink-faint)' }}>{d.vehicle_no || '—'} · {d.fmobile || '—'}</div>
              </div>
              <button
                type="button"
                disabled={Boolean(openOffer) || busyId === d.id}
                onClick={() => offerTo(d.id)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                {busyId === d.id ? 'Sending…' : 'Offer'}
              </button>
            </div>
          ))}
        </div>

        {offers.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Offer history</p>
            {offers.map((o) => (
              <div key={o.id} className="flex items-center justify-between border-t py-1.5" style={{ borderColor: 'var(--border)' }}>
                <span>Driver #{o.rider_id} {o.offered_by_admin ? '(admin)' : '(auto)'}</span>
                <span style={{ color: STATUS_COLOR[o.status] || 'var(--ink-muted)' }}>{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
