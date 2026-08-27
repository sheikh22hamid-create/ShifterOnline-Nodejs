import { useCallback, useState } from 'react'
import { CalendarClock, UserPlus } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import AssignScheduledDriverModal from '../components/orders/AssignScheduledDriverModal'
import { orderStatusTone, orderStatusLabel } from '../utils/orderStatus'
import { formatCurrency, truncate } from '../utils/format'

export default function ScheduledOrders() {
  const toast = useToast()
  const [assignTarget, setAssignTarget] = useState(null)

  const fetcher = useCallback(() => api.get('/orders/scheduled').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const orders = data?.data ?? []

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Scheduled Orders
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Next-day / pre-scheduled bookings, pre-assignable to a driver ahead of pickup.
      </p>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order', 'Category', 'Pickup', 'Scheduled for', 'Fare', 'Status', 'Driver', ''].map((h) => (
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
                    <CalendarClock size={20} className="mx-auto mb-2" style={{ color: 'var(--ink-faint)' }} />
                    <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                      No scheduled bookings yet — no order-creation flow produces one at the moment (see backend note in
                      Phase 4).
                    </p>
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                orders.map((o) => (
                  <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      #{o.id}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.category}
                    </td>
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
                      {o.rid ? `Driver #${o.rid}` : 'Unassigned'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!o.rid && (
                        <button
                          type="button"
                          onClick={() => setAssignTarget(o)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold"
                          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                        >
                          <UserPlus size={12} /> Pre-assign
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <AssignScheduledDriverModal
        open={Boolean(assignTarget)}
        order={assignTarget}
        onClose={() => setAssignTarget(null)}
        onAssigned={() => {
          setAssignTarget(null)
          toast.success('Driver pre-assigned.')
          refetch()
        }}
      />
    </div>
  )
}
