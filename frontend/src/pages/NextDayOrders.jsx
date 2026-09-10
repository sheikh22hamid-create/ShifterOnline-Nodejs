import { useCallback, useState } from 'react'
import { Sunrise, Users } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import NextDaySequenceModal from '../components/orders/NextDaySequenceModal'
import { orderStatusTone, orderStatusLabel } from '../utils/orderStatus'
import { formatCurrency, truncate } from '../utils/format'

export default function NextDayOrders() {
  const toast = useToast()
  const [selectedIds, setSelectedIds] = useState([])
  const [assigning, setAssigning] = useState(false)

  const fetcher = useCallback(() => api.get('/orders/next-day').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const orders = data?.data ?? []
  const unassigned = orders.filter((o) => !o.rid)
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
        Next-day bookings, priced at Model 1 with no fixed pickup time (10 AM–8 PM) — never auto-dispatched, assign manually to a driver.
      </p>

      {selectedIds.length > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: 'var(--brand-soft)' }}>
          <span className="text-[13px]" style={{ color: 'var(--brand)' }}>{selectedIds.length} order(s) selected</span>
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
                {['', 'Order', 'Category', 'Pickup', 'For date', 'Fare', 'Status', 'Driver'].map((h) => (
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
                    <td colSpan={8} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
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
                      {!o.rid && (
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
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: o.rid ? 'var(--success)' : 'var(--ink-faint)' }}>
                      {o.rid ? `Driver #${o.rid}${o.next_day_sequence ? ` (stop ${o.next_day_sequence})` : ''}` : 'Unassigned'}
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
    </div>
  )
}
