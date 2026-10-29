import { useCallback, useMemo, useState } from 'react'
import { Sunrise, Users } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import NextDaySequenceModal from '../components/orders/NextDaySequenceModal'
import NextDayOfferModal from '../components/orders/NextDayOfferModal'
import NextDaySettingsCard from '../components/orders/NextDaySettingsCard'
import { orderStatusTone, orderStatusLabel } from '../utils/orderStatus'
import { formatCurrency, truncate } from '../utils/format'

const isLowFare = (o) => o.next_day_stage === 'low_fare'
const LOW_FARE_TONE = { 'Waiting to open': 'neutral', Open: 'info', Accepted: 'success', Expired: 'danger', Cancelled: 'danger' }
const istTime = (v) => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const lowFareWindow = (o) => `${istTime(o.next_day_live_at)} - ${istTime(o.next_day_live_until)}`

export default function NextDayOrders() {
  const toast = useToast()
  const [selectedIds, setSelectedIds] = useState([])
  const [assigning, setAssigning] = useState(false)
  const [offerOrder, setOfferOrder] = useState(null)

  const fetcher = useCallback(() => api.get('/orders/next-day').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  // Memoized on `data`, not recomputed fresh on every render — `data?.data
  // ?? []` would otherwise return a new array reference every render (even
  // while `data` is still null, pre-fetch), which is wasteful for a value
  // multiple derived lists below are filtered from.
  const orders = useMemo(() => data?.data ?? [], [data])
  // Low Fare orders are taken by drivers from their own section, so there is nothing to assign or offer by hand.
  const unassigned = orders.filter((o) => !o.rid && !isLowFare(o))
  // Filtering against the current `unassigned` on every render (rather than
  // pruning `selectedIds` itself in an effect) means a selection that drops
  // out of `unassigned` — assigned/cancelled elsewhere, seen via the
  // realtime refetch below — simply stops appearing here on its own; the
  // banner and the batch posted to the assign modal read `selectedOrders`,
  // never the raw (possibly stale) `selectedIds`.
  const selectedOrders = unassigned.filter((o) => selectedIds.includes(o.id))

  useRealtimeSync(['admin:new_order', 'admin:order_status_update'], refetch)

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Next Day Orders
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Next-day bookings are priced at Model 1. Old-style orders are offered to a Daily Driver by hand. Low Fare orders (marked below) are priced at Model 1 minus the discount and accepted by drivers themselves during the customer's pickup window; they expire if nobody takes them.
      </p>

      <NextDaySettingsCard />

      {selectedOrders.length > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: 'var(--brand-soft)' }}>
          <span className="text-[13px]" style={{ color: 'var(--brand)' }}>{selectedOrders.length} order(s) selected</span>
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Users size={13} /> Assign to Driver
          </button>
        </div>
      )}

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['', 'Order', 'Category', 'Pickup', 'For date', 'Fare', 'Status', 'Live at / window', 'Driver', 'Driver discount', ''].map((h) => (
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
                    <td colSpan={11} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && orders.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center">
                    <Sunrise size={20} className="mx-auto mb-2" style={{ color: 'var(--ink-faint)' }} />
                    <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>No next-day bookings yet.</p>
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                orders.map((o) => (
                  <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5">
                      {!o.rid && !isLowFare(o) && (
                        <input type="checkbox" checked={selectedIds.includes(o.id)} onChange={() => toggleSelect(o.id)} />
                      )}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>#{o.id}</td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>{o.category}</td>
                    <td className="max-w-[220px] truncate px-4 py-2.5" style={{ color: 'var(--ink-muted)' }} title={o.paddress}>
                      {truncate(o.paddress, 32)}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.schedule_date_time || '—'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(o.total_dcharge)}
                      {isLowFare(o) && o.next_day_model1_fare != null && (
                        <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          Model 1 {formatCurrency(o.next_day_model1_fare)} - {Number(o.next_day_discount_percent)}% ({formatCurrency(o.next_day_discount_amount)})
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {isLowFare(o) ? (
                        <Badge tone={LOW_FARE_TONE[o.low_fare_status] || 'neutral'}>Low Fare: {o.low_fare_status}</Badge>
                      ) : (
                        <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                      )}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {isLowFare(o)
                        ? lowFareWindow(o)
                        : o.next_day_stage === 'live' ? 'Live' : o.next_day_live_at ? new Date(o.next_day_live_at).toLocaleString() : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: o.rid ? 'var(--success)' : 'var(--ink-faint)' }}>
                      {o.rid
                        ? `${o.low_fare_driver_name ? `${o.low_fare_driver_name} · ` : ''}Driver #${o.rid}${o.next_day_sequence ? ` (stop ${o.next_day_sequence})` : ''}`
                        : isLowFare(o) ? 'Open to drivers' : 'Unassigned'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {!isLowFare(o) && o.next_day_discount_amount != null ? formatCurrency(o.next_day_discount_amount) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {!o.rid && o.next_day_stage === 'arranging' && (
                        <button type="button" onClick={() => setOfferOrder(o)} className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                          Offer to Daily Driver
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <NextDaySequenceModal
        open={assigning}
        orders={selectedOrders}
        onClose={() => setAssigning(false)}
        onAssigned={() => {
          setAssigning(false)
          setSelectedIds([])
          toast.success('Next-day orders assigned.')
          refetch()
        }}
      />

      <NextDayOfferModal open={Boolean(offerOrder)} order={offerOrder} onClose={() => setOfferOrder(null)} onChanged={refetch} />
    </div>
  )
}
