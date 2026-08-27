import { useState } from 'react'
import { Phone, MessageSquare, Package, UserRound, Bike, CheckCircle2, Circle, ChevronUp, ChevronDown } from 'lucide-react'
import Badge from '../common/Badge'
import { formatDistanceKm, formatEta, formatDateTime } from '../../utils/format'

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </div>
      <div className="mt-0.5 truncate text-[13px]" title={typeof value === 'string' ? value : undefined} style={{ color: 'var(--ink)' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

// "Arrived at Pickup" has no dedicated timestamp column in the schema — it's
// inferred from order_status reaching 2, with pkg_order_wait_timer's
// pickup_wait_start shown alongside it when that row happens to exist.
function buildMilestones(trip) {
  return [
    { key: 'assigned', label: 'Assigned', reached: Boolean(trip.accept_time), at: trip.accept_time },
    { key: 'arrived', label: 'Arrived at Pickup', reached: trip.order_status >= 2, at: trip.wait_timer?.pickup_wait_start },
    { key: 'picked_up', label: 'OTP Verified & Picked Up', reached: Boolean(trip.pickup_time), at: trip.pickup_time },
    { key: 'delivered', label: 'Delivered', reached: trip.o_status === 'Completed', at: trip.drop_time || trip.ddate },
  ]
}

// A dedicated top-to-bottom right panel (not just a top-anchored card) so it
// can never overlap the bottom-docked carousel — the carousel is sized to
// leave this exact width clear instead of the two guessing at each other's
// height.
const HUD_POSITION_CLASSES = 'absolute right-4 top-4 bottom-4 z-[1000] w-[min(92vw,360px)] overflow-y-auto rounded-2xl p-4 flex flex-col space-y-3'

export default function MissionHUD({ trip, phase, speedKmh, liveMetrics, loading }) {
  const [collapsed, setCollapsed] = useState(false)

  if (loading || !trip) {
    return (
      <div className={`mission-hud ${HUD_POSITION_CLASSES} text-[13px]`} style={{ color: 'var(--ink-faint)' }}>
        {loading ? 'Loading trip…' : 'Select a trip below to see live details.'}
      </div>
    )
  }

  const milestones = buildMilestones(trip)
  const phaseLabel = phase === 1 ? 'En Route to Pickup' : phase === 2 ? 'On Route to Drop' : '—'
  const phaseTone = phase === 1 ? 'warning' : phase === 2 ? 'success' : 'neutral'

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="mission-hud absolute right-4 top-4 z-[1000] flex max-w-[min(92vw,360px)] items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium"
        style={{ color: 'var(--ink)' }}
      >
        <span className="font-mono-data shrink-0">Order #{trip.id}</span>
        <span style={{ color: 'var(--ink-faint)' }}>·</span>
        <span className="shrink-0">{phaseLabel}</span>
        <span style={{ color: 'var(--ink-faint)' }}>·</span>
        <span className="truncate">ETA {formatEta(liveMetrics?.etaSeconds)}</span>
        <ChevronDown size={14} className="shrink-0" style={{ color: 'var(--ink-faint)' }} />
      </button>
    )
  }

  return (
    <div className={`mission-hud ${HUD_POSITION_CLASSES}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
          Order #{trip.id}
        </span>
        <div className="flex items-center gap-1.5">
          <Badge tone={phaseTone}>{phaseLabel}</Badge>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse Mission HUD"
            className="rounded-md p-1"
            style={{ color: 'var(--ink-faint)' }}
          >
            <ChevronUp size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        <span>
          ETA: <strong style={{ color: 'var(--ink)' }}>{formatEta(liveMetrics?.etaSeconds)}</strong>
        </span>
        <span>{formatDistanceKm(liveMetrics?.remainingMeters)} remaining</span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <section className="min-w-0 space-y-2">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            <Bike size={12} /> Driver
          </h4>
          <Field label="Name" value={trip.rider?.name} />
          <Field label="Vehicle" value={trip.rider?.vehicle_no && <span className="font-mono-data">{trip.rider.vehicle_no}</span>} />
          <Field label="Speed" value={speedKmh != null && <span className="font-mono-data">{Math.round(speedKmh)} km/h</span>} />
          {trip.rider?.mobile && (
            <div className="flex gap-2 pt-1">
              <a
                href={`tel:${trip.rider.mobile}`}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
              >
                <Phone size={12} /> Call
              </a>
              <a
                href={`sms:${trip.rider.mobile}`}
                className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
              >
                <MessageSquare size={12} /> Message
              </a>
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-2">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            <UserRound size={12} /> Sender / Recipient
          </h4>
          <Field label="Sender" value={trip.customer?.name} />
          <Field label="Recipient" value={trip.drop_name} />
          <Field label="Recipient phone" value={trip.dmobile && <span className="font-mono-data">{trip.dmobile}</span>} />
        </section>
      </div>

      <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          <Package size={12} /> Package
        </h4>
        <div className="flex items-center justify-between text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          <span>{trip.category || '—'}</span>
          <span className="font-mono-data">{trip.package_weight ? `${trip.package_weight} kg` : '—'}</span>
        </div>
      </div>

      <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          Milestones
        </h4>
        <ol className="space-y-1.5">
          {milestones.map((m) => (
            <li key={m.key} className="flex items-center gap-2 text-[12px]" style={{ color: m.reached ? 'var(--ink)' : 'var(--ink-faint)' }}>
              {m.reached ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> : <Circle size={14} />}
              <span className="flex-1">{m.label}</span>
              {m.at && (
                <span className="font-mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  {formatDateTime(m.at)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
