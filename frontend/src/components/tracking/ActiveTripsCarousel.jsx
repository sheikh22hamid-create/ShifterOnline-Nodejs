import { Bike, MapPin } from 'lucide-react'
import Badge from '../common/Badge'
import { orderStatusTone, orderStatusLabel } from '../../utils/orderStatus'
import { truncate } from '../../utils/format'

export default function ActiveTripsCarousel({ trips, selectedOrderId, onSelect, loading }) {
  return (
    <div className="mission-hud absolute bottom-4 left-4 right-[385px] z-[1000] rounded-2xl p-3 max-md:bottom-4 max-md:right-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          {loading ? 'Loading active trips…' : `${trips.length} Trip${trips.length === 1 ? '' : 's'} In Transit`}
        </h3>
      </div>
      {trips.length === 0 && !loading ? (
        <p className="px-1 pb-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
          No trips are currently in progress.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {trips.map((trip) => {
            const selected = trip.id === selectedOrderId
            return (
              <button
                key={trip.id}
                type="button"
                onClick={() => onSelect(trip.id)}
                className="w-[220px] shrink-0 rounded-xl border p-2.5 text-left transition-colors"
                style={{
                  borderColor: selected ? 'var(--brand)' : 'var(--border)',
                  background: selected ? 'var(--brand-soft)' : 'var(--surface)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono-data text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                    #{trip.id}
                  </span>
                  <Badge tone={orderStatusTone(trip.o_status)}>{orderStatusLabel(trip.o_status)}</Badge>
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                  <Bike size={11} /> {trip.rider_name}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  <MapPin size={11} /> {truncate(trip.daddress, 30)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
