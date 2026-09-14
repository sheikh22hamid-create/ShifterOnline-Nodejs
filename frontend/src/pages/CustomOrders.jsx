import { useCallback, useState } from 'react'
import {
  ShoppingBag,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  User,
  MapPin,
  Tag,
  DollarSign,
  ArrowRight,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import Drawer from '../components/common/Drawer'
import Modal from '../components/common/Modal'
import { formatCurrency, formatDateTime, truncate } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

function customStatusTone(status) {
  switch (status) {
    case 'open':
      return 'warning'
    case 'accepted':
      return 'info'
    case 'completed':
      return 'success'
    case 'cancel':
      return 'danger'
    default:
      return 'neutral'
  }
}

function customStatusLabel(status) {
  switch (status) {
    case 'open':
      return 'Open (Bidding)'
    case 'accepted':
      return 'Accepted'
    case 'completed':
      return 'Completed'
    case 'cancel':
      return 'Cancelled'
    default:
      return status
  }
}

function BidsDrawer({ order, onClose, onConverted }) {
  const toast = useToast()
  const { hasRole } = useAuth()
  const canManage = hasRole('superadmin', 'admin')

  const bidsFetcher = useCallback(() => api.get(`/custom-orders/${order.id}/bids`).then((res) => res.data.data), [order.id])
  const { data: bids, loading, refetch } = useApiQuery(bidsFetcher)

  useRealtimeSync('admin:custom_order_update', refetch)

  const [selectedBid, setSelectedBid] = useState(null)
  const [agreedPrice, setAgreedPrice] = useState('')
  const [converting, setConverting] = useState(false)

  async function handleConvert() {
    if (!selectedBid) return
    const price = parseFloat(agreedPrice) || selectedBid.bid_amount
    setConverting(true)
    try {
      await api.post(`/custom-orders/${order.id}/convert`, {
        rider_id: selectedBid.rider_id,
        final_agreed_price: price,
      })
      toast.success('Bid accepted and driver assigned to custom order.')
      setSelectedBid(null)
      refetch()
      onConverted?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to convert order.')
    } finally {
      setConverting(false)
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={`Custom Order #${order.id}`}
        subtitle={order.created_at ? formatDateTime(order.created_at) : undefined}
      >
        <div className="space-y-5">
          {/* Order Details Summary */}
          <div className="surface-card rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge tone={customStatusTone(order.status)}>{customStatusLabel(order.status)}</Badge>
              <span className="font-mono-data text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                Base: {formatCurrency(order.base_price)}
              </span>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Item / Task Description
              </div>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ink)' }}>
                {order.description || 'No description provided.'}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              {order.pickup_address && (
                <div className="flex items-start gap-2 text-[12.5px]">
                  <MapPin size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--brand)' }} />
                  <div>
                    <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>Pickup: </span>
                    <span style={{ color: 'var(--ink)' }}>{order.pickup_address}</span>
                  </div>
                </div>
              )}
              {order.drop_address && (
                <div className="flex items-start gap-2 text-[12.5px]">
                  <MapPin size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                  <div>
                    <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>Drop: </span>
                    <span style={{ color: 'var(--ink)' }}>{order.drop_address}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Driver Bids Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Driver Quotations & Bids ({bids?.length ?? 0})
              </h3>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
                ))}
              </div>
            ) : !bids || bids.length === 0 ? (
              <div className="surface-card rounded-xl p-8 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                No drivers have placed a bid on this custom order yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {bids.map((b) => (
                  <div
                    key={b.id}
                    className="surface-card rounded-xl p-3.5 flex items-center justify-between gap-3 border transition-colors hover:border-brand"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div>
                      <div className="font-medium text-[13px]" style={{ color: 'var(--ink)' }}>
                        {b.rider_name || `Driver #${b.rider_id}`}
                      </div>
                      <div className="text-[11.5px] font-mono-data mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                        {b.rider_mobile || `ID: ${b.rider_id}`} • {formatDateTime(b.created_at)}
                      </div>
                      {b.status && (
                        <div className="mt-1">
                          <Badge tone={b.status === 'accepted' ? 'success' : b.status === 'rejected' ? 'danger' : 'neutral'}>
                            Bid: {b.status}
                          </Badge>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-[15px] font-semibold font-mono-data" style={{ color: 'var(--brand)' }}>
                          {formatCurrency(b.bid_amount)}
                        </div>
                      </div>

                      {order.status === 'open' && canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBid(b)
                            setAgreedPrice(String(b.bid_amount))
                          }}
                          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-opacity"
                          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                        >
                          Accept <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* Accept Bid Modal */}
      <Modal
        open={Boolean(selectedBid)}
        onClose={() => setSelectedBid(null)}
        title="Accept Driver Bid & Assign Order"
        footer={
          <>
            <button
              type="button"
              onClick={() => setSelectedBid(null)}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={converting}
              onClick={handleConvert}
              className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--success)' }}
            >
              {converting ? 'Accepting…' : 'Confirm & Accept Bid'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-[13px]">
          <p style={{ color: 'var(--ink-muted)' }}>
            Accept bid from <strong style={{ color: 'var(--ink)' }}>{selectedBid?.rider_name}</strong> for Custom Order #{order.id}?
          </p>

          <div>
            <label className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="agreed-price">
              Final Agreed Price (₹)
            </label>
            <input
              id="agreed-price"
              type="number"
              step="0.01"
              value={agreedPrice}
              onChange={(e) => setAgreedPrice(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
              style={FIELD_STYLE}
            />
          </div>

          <p className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
            This will accept this driver quotation, reject other pending bids, and lock the custom order price.
          </p>
        </div>
      </Modal>
    </>
  )
}

export default function CustomOrders() {
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)

  const fetcher = useCallback(
    () =>
      api
        .get('/custom-orders', {
          params: {
            status: status !== 'all' ? status : undefined,
          },
        })
        .then((res) => res.data.data),
    [status]
  )

  const { data: orders, loading, error, refetch } = useApiQuery(fetcher)

  useRealtimeSync(['admin:custom_order_update', 'admin:new_order', 'admin:order_status_update'], refetch)

  const filteredOrders = (orders || []).filter((o) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      String(o.id).includes(q) ||
      (o.description && o.description.toLowerCase().includes(q)) ||
      (o.pickup_address && o.pickup_address.toLowerCase().includes(q)) ||
      (o.drop_address && o.drop_address.toLowerCase().includes(q))
    )
  })

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Custom Orders (Buy Anything & Bidding)
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Manage custom errand orders, customer item requests, and driver bidding quotations.
          </p>
        </div>
      </div>

      {/* Filter Ribbon & Search */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: 'all', label: 'All Orders' },
            { value: 'open', label: 'Open (Bidding)' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancel', label: 'Cancelled' },
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
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

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            placeholder="Search description, address, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-lg border pl-8 pr-2.5 py-1.5 text-[12.5px] outline-none"
            style={FIELD_STYLE}
          />
        </div>
      </div>

      {/* Data Table */}
      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order ID', 'Item / Description', 'Base Price', 'Driver Bids', 'Status', 'Placed Date', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No custom orders match the current filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                filteredOrders.map((o) => (
                  <tr
                    key={o.id}
                    className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: '1px solid var(--border)' }}
                    onClick={() => setSelectedOrder(o)}
                  >
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>
                      #{o.id}
                    </td>
                    <td className="max-w-[280px] px-4 py-2.5">
                      <div className="truncate font-medium" style={{ color: 'var(--ink)' }} title={o.description}>
                        {truncate(o.description || 'Custom Order', 45)}
                      </div>
                      <div className="truncate text-[11.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                        {truncate(o.pickup_address || o.drop_address || '—', 35)}
                      </div>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(o.base_price)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={o.bid_count > 0 ? 'info' : 'neutral'}>
                        {o.bid_count} {o.bid_count === 1 ? 'Bid' : 'Bids'}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={customStatusTone(o.status)}>{customStatusLabel(o.status)}</Badge>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.created_at ? formatDateTime(o.created_at) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Eye size={15} style={{ color: 'var(--ink-faint)' }} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && (
        <BidsDrawer
          key={selectedOrder.id}
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onConverted={refetch}
        />
      )}
    </div>
  )
}
