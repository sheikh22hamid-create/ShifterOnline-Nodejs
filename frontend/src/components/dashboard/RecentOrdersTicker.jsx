import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import api from '../../services/api'
import { useSocket } from '../../context/SocketContext'
import useApiQuery from '../../hooks/useApiQuery'
import Badge from '../common/Badge'
import { orderStatusTone, orderStatusLabel } from '../../utils/orderStatus'
import { formatCurrency, truncate } from '../../utils/format'

export default function RecentOrdersTicker() {
  const { socket } = useSocket()
  const navigate = useNavigate()

  const fetcher = useCallback(() => api.get('/orders', { params: { page: 1, limit: 8 } }).then((res) => res.data.data), [])
  const { data: orders, loading, refetch } = useApiQuery(fetcher)

  useEffect(() => {
    if (!socket) return
    socket.on('admin:new_order', refetch)
    socket.on('admin:order_status_update', refetch)
    return () => {
      socket.off('admin:new_order', refetch)
      socket.off('admin:order_status_update', refetch)
    }
  }, [socket, refetch])

  return (
    <div className="surface-card flex h-full flex-col overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'var(--success)' }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} />
          </span>
          Live Dispatch Ticker
        </h3>
        <button type="button" onClick={() => navigate('/orders')} className="text-[11.5px] font-medium" style={{ color: 'var(--brand)' }}>
          View all
        </button>
      </div>
      <div className="flex-1 divide-y overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
        {loading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-2.5">
              <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
            </div>
          ))}
        {!loading && orders?.length === 0 && (
          <p className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
            No orders yet.
          </p>
        )}
        {!loading &&
          orders?.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => navigate('/orders')}
              className="group flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono-data text-[12px]" style={{ color: 'var(--ink)' }}>
                    #{o.id}
                  </span>
                  <span className="truncate text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {o.customer_name || 'Unknown'}
                  </span>
                </div>
                <div className="truncate text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  {truncate(o.paddress, 18)} <span aria-hidden>&rarr;</span> {truncate(o.daddress, 18)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                  <span className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {formatCurrency(o.total_dcharge)}
                  </span>
                </div>
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  <ArrowUpRight size={13} strokeWidth={2.5} />
                </span>
              </div>
            </button>
          ))}
      </div>
    </div>
  )
}
