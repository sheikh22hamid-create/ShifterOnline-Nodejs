import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import GuaranteeCountdown from './GuaranteeCountdown'
import { formatCurrency } from '../../utils/format'

/** The "assign a driver within mm:ss" line; reads "window expired" once the deadline passes. */
function AssignLine({ alert }) {
  const target = new Date(alert.deadline_at).getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (Number.isFinite(target) && target <= now) {
    return <>Order #{alert.order_id} · window expired — order is being cancelled</>
  }
  return (
    <>
      Order #{alert.order_id} · assign a driver within <GuaranteeCountdown deadline={alert.deadline_at} />
      {Number(alert.amount) > 0 && <> · customer is owed {formatCurrency(alert.amount)} if none is assigned</>}
    </>
  )
}

/**
 * Persistent, high-priority banners for Booking Guarantee alerts (the plain toast scrolls away; this stays
 * until the admin dismisses it or the order is assigned/cancelled). `alerts` = [{ order_id, amount, deadline_at, message }].
 */
export default function GuaranteeBanner({ alerts, onOpen, onDismiss }) {
  if (!alerts.length) return null
  return (
    <div className="fixed left-1/2 top-16 z-[999997] flex w-[min(560px,92vw)] -translate-x-1/2 flex-col gap-2">
      {alerts.map((a) => (
        <div
          key={a.order_id}
          role="alert"
          className="flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl"
          style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)', color: 'var(--ink)' }}
        >
          <AlertTriangle size={20} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--danger)' }}>
              {a.message}
            </div>
            <div className="mt-0.5 text-[13px]">
              <AssignLine alert={a} />
            </div>
            <button
              type="button"
              onClick={() => onOpen(a.order_id)}
              className="mt-2 rounded-lg px-3 py-1 text-[12.5px] font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              Open order &amp; assign
            </button>
          </div>
          <button type="button" onClick={() => onDismiss(a.order_id)} aria-label="Dismiss" style={{ color: 'var(--ink-faint)' }}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
