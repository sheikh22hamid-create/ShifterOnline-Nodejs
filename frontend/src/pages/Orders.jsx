import { useCallback, useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import api from '../services/api'
import { useSocket } from '../context/SocketContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import OrderDetailDrawer from '../components/orders/OrderDetailDrawer'
import { ORDER_STATUS_FILTERS, orderStatusTone, orderStatusLabel } from '../utils/orderStatus'
import { formatCurrency, formatDateTime, truncate } from '../utils/format'

const LIMIT = 20

export default function Orders() {
  const { socket } = useSocket()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)

  const fetcher = useCallback(
    () => api.get('/orders', { params: { status: status || undefined, page, limit: LIMIT } }).then((res) => res.data),
    [status, page]
  )
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const orders = data?.data ?? []
  const total = data?.total ?? 0

  // Real-time refresh off the Phase 5 admin socket events — no polling.
  useEffect(() => {
    if (!socket) return
    socket.on('admin:new_order', refetch)
    socket.on('admin:order_status_update', refetch)
    return () => {
      socket.off('admin:new_order', refetch)
      socket.off('admin:order_status_update', refetch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket])

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Orders
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Live dispatch queue and trip history.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {ORDER_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setStatus(f.value)
              setPage(1)
            }}
            className="rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors"
            style={{
              borderColor: status === f.value ? 'var(--brand)' : 'var(--border)',
              background: status === f.value ? 'var(--brand-soft)' : 'transparent',
              color: status === f.value ? 'var(--brand)' : 'var(--ink-muted)',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order', 'Customer', 'Driver', 'Status', 'Fare', 'Pickup', 'Placed', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
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
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No orders match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                orders.map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: '1px solid var(--border)' }}
                    onClick={() => setSelectedId(o.id)}
                  >
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      #{o.id}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{o.customer_name || '—'}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {o.customer_mobile}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: o.rid ? 'var(--ink)' : 'var(--ink-faint)' }}>
                      {o.rider_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(o.total_dcharge)}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2.5" style={{ color: 'var(--ink-muted)' }} title={o.paddress}>
                      {truncate(o.paddress, 32)}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(o.odate)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Eye size={15} style={{ color: 'var(--ink-faint)' }} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      </div>

      {selectedId && <OrderDetailDrawer key={selectedId} orderId={selectedId} onClose={() => setSelectedId(null)} onChanged={refetch} />}
    </div>
  )
}
