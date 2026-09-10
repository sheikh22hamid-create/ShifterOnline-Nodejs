import { useCallback, useState } from 'react'
import { UserRound, Bike, MapPin, Receipt, Pencil, Ban, UserPlus, FileText, Phone, MessageSquare, Package, CheckCircle2, Circle, KeyRound, Clock, Calendar } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'
import useRealtimeSync from '../../hooks/useRealtimeSync'
import Drawer from '../common/Drawer'
import Badge from '../common/Badge'
import { orderStatusTone, orderStatusLabel } from '../../utils/orderStatus'
import { formatCurrency, formatDateTime } from '../../utils/format'
import AssignDriverModal from './AssignDriverModal'
import CancelOrderModal from './CancelOrderModal'
import InvoiceModal from './InvoiceModal'

const EDIT_FIELDS = [
  { key: 'paddress', label: 'Pickup address' },
  { key: 'pick_name', label: 'Pickup contact name' },
  { key: 'pmobile', label: 'Pickup contact mobile' },
  { key: 'daddress', label: 'Delivery address' },
  { key: 'drop_name', label: 'Drop contact name' },
  { key: 'dmobile', label: 'Drop contact mobile' },
  { key: 'description', label: 'Notes / Instructions' },
  { key: 'distance', label: 'Distance (km)' },
  { key: 'total_dcharge', label: 'Total fare (₹)' },
]

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px]" style={{ color: 'var(--ink)' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

function buildMilestones(order) {
  if (!order) return []
  return [
    { key: 'placed', label: 'Order Placed', reached: true, at: order.odate || order.created_at },
    { key: 'assigned', label: 'Driver Assigned', reached: Boolean(order.accept_time || order.rid), at: order.accept_time },
    { key: 'arrived', label: 'Arrived at Pickup', reached: order.order_status >= 2, at: order.wait_timer?.pickup_wait_start },
    { key: 'picked_up', label: 'OTP Verified & Picked Up', reached: Boolean(order.pickup_time) || order.order_status >= 3, at: order.pickup_time },
    { key: 'delivered', label: 'Delivered', reached: order.o_status === 'Completed' || order.order_status === 5, at: order.drop_time || order.ddate },
  ]
}

export default function OrderDetailDrawer({ orderId, onClose, onChanged }) {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin', 'admin')

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)

  const fetcher = useCallback(() => api.get(`/orders/${orderId}`).then((res) => res.data.data), [orderId])
  const { data: order, loading, refetch } = useApiQuery(fetcher)

  // Real-time live update of order details while drawer is open
  useRealtimeSync(['admin:order_status_update', 'admin:driver_status_update'], refetch)

  function startEdit() {
    setForm(Object.fromEntries(EDIT_FIELDS.map(({ key }) => [key, order[key] ?? ''])))
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    try {
      await api.put(`/orders/${orderId}`, form)
      toast.success('Order updated.')
      setEditing(false)
      refetch()
      onChanged?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  const isTerminal = order && ['Completed', 'Cancelled'].includes(order.o_status)
  const isUnassigned = order && (!order.rid || order.rid === 0) && order.o_status === 'Pending'
  const milestones = buildMilestones(order)

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={loading ? 'Loading order…' : `Order #${order?.id}`}
        subtitle={order ? formatDateTime(order.odate) : undefined}
      >
        {loading || !order ? (
          <div className="flex h-40 items-center justify-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
            Loading order details…
          </div>
        ) : (
          <div className="space-y-5">
            {/* Top Status & Price Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={orderStatusTone(order.o_status)}>{orderStatusLabel(order.o_status)}</Badge>
                {order.booking_type === 2 ? (
                  <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                    <Calendar size={11} /> Scheduled: {order.schedule_date_time || 'Later'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-muted)' }}>
                    <Clock size={11} /> Instant Booking
                  </span>
                )}
              </div>
              <span className="font-mono-data text-[16px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(order.total_dcharge)}
              </span>
            </div>

            {/* OTP Alert Box */}
            {order.otp && (
              <div className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: 'var(--brand-soft)', background: 'var(--brand-soft)' }}>
                <div className="flex items-center gap-2">
                  <KeyRound size={16} style={{ color: 'var(--brand)' }} />
                  <div>
                    <div className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--brand)' }}>
                      Delivery Verification OTP
                    </div>
                    <div className="font-mono-data text-[15px] font-bold tracking-wider" style={{ color: 'var(--brand)' }}>
                      {order.otp}
                    </div>
                  </div>
                </div>
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>Share with driver at pickup</span>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInvoiceOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--brand)' }}
              >
                <FileText size={13} /> Invoice / Receipt
              </button>

              {isUnassigned && (
                <button
                  type="button"
                  onClick={() => setAssignOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                >
                  <UserPlus size={13} /> Assign driver
                </button>
              )}
              {canManage && !isTerminal && !editing && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                >
                  <Pencil size={13} /> Edit
                </button>
              )}
              {canManage && !isTerminal && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                  style={{ borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
                >
                  <Ban size={13} /> Cancel order
                </button>
              )}
            </div>

            {editing ? (
              <div className="surface-card space-y-3 rounded-xl p-4">
                {EDIT_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-1 block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor={key}>
                      {label}
                    </label>
                    {key === 'description' ? (
                      <textarea
                        id={key}
                        rows={2}
                        value={form[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                      />
                    ) : (
                      <input
                        id={key}
                        value={form[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                      />
                    )}
                  </div>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setEditing(false)} className="rounded-lg border px-3 py-1.5 text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
                    Discard
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={saveEdit}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
                    style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Customer & Sender Section */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <UserRound size={13} /> Sender & Customer Info
                  </h3>
                  <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                    <Field label="Sender Contact" value={order.pick_name || order.customer?.name} />
                    <Field label="Sender Mobile" value={order.pmobile || (order.customer?.mobile && <span className="font-mono-data">{order.customer.mobile}</span>)} />
                    {order.customer?.email && <Field label="Account Email" value={order.customer.email} />}
                    {order.pick_type && <Field label="Pickup Location Type" value={order.pick_type} />}
                  </div>
                </section>

                {/* Recipient Section */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <UserRound size={13} /> Recipient Info
                  </h3>
                  <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                    <Field label="Recipient Name" value={order.drop_name} />
                    <Field label="Recipient Phone" value={order.dmobile && <span className="font-mono-data">{order.dmobile}</span>} />
                    {order.drop_type && <Field label="Drop Location Type" value={order.drop_type} />}
                    {order.description && <div className="col-span-2"><Field label="Delivery Notes" value={order.description} /></div>}
                  </div>
                </section>

                {/* Driver Section */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <Bike size={13} /> Assigned Driver
                  </h3>
                  <div className="surface-card rounded-xl p-3.5">
                    {order.rider ? (
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Driver Name" value={order.rider.name} />
                        <Field label="Vehicle No." value={<span className="font-mono-data">{order.rider.vehicle_no || '—'}</span>} />
                        <Field label="Mobile" value={<span className="font-mono-data">{order.rider.mobile}</span>} />
                        <div className="flex items-end gap-2 pt-1">
                          {order.rider.mobile && (
                            <>
                              <a
                                href={`tel:${order.rider.mobile}`}
                                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-medium"
                                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                              >
                                <Phone size={12} /> Call
                              </a>
                              <a
                                href={`sms:${order.rider.mobile}`}
                                className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium"
                                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                              >
                                <MessageSquare size={12} /> Msg
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-[13px]">
                        <span style={{ color: 'var(--ink-faint)' }}>Not assigned yet</span>
                        {canManage && !isTerminal && (
                          <button
                            type="button"
                            onClick={() => setAssignOpen(true)}
                            className="rounded-lg border px-2.5 py-1 text-[12px] font-medium"
                            style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
                          >
                            Assign Now
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                {/* Package & Category Details */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <Package size={13} /> Package & Vehicle Type
                  </h3>
                  <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                    <Field label="Vehicle Type" value={order.package?.title || order.category || 'Standard'} />
                    <Field label="Package Weight" value={order.package_weight ? `${order.package_weight} kg` : '—'} />
                    {order.package_cost > 0 && <Field label="Declared Value" value={formatCurrency(order.package_cost)} />}
                    {order.photos && (
                      <div className="col-span-2">
                        <div className="text-[10.5px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--ink-faint)' }}>
                          Attached Photo
                        </div>
                        <img src={order.photos} alt="Package" className="h-20 w-auto rounded-lg object-cover border" style={{ borderColor: 'var(--border)' }} />
                      </div>
                    )}
                  </div>
                </section>

                {/* Route Section */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <MapPin size={13} /> Route & Distance
                  </h3>
                  <div className="surface-card space-y-2.5 rounded-xl p-3.5">
                    <Field label="Pickup Location" value={order.paddress} />
                    <Field label="Delivery Location" value={order.daddress} />
                    <div className="grid grid-cols-2 gap-3 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                      <Field label="Road Distance" value={`${order.distance} km`} />
                      {order.extra_mile_charge > 0 && <Field label="Extra Mile Charge" value={formatCurrency(order.extra_mile_charge)} />}
                    </div>
                  </div>
                </section>

                {/* Financial Breakdown */}
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <Receipt size={13} /> Payment & Fare Breakdown
                  </h3>
                  <div className="surface-card space-y-2 rounded-xl p-3.5">
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: 'var(--ink-muted)' }}>Payment Method</span>
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>{order.payment_method || 'Cash / Pre-paid'}</span>
                    </div>
                    {order.trans_id && (
                      <div className="flex justify-between text-[12.5px]">
                        <span style={{ color: 'var(--ink-muted)' }}>Transaction ID</span>
                        <span className="font-mono-data text-[11.5px]">{order.trans_id}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: 'var(--ink-muted)' }}>Delivery Fare</span>
                      <span className="font-mono-data">{formatCurrency(order.d_charge)}</span>
                    </div>
                    {order.cou_amt > 0 && (
                      <div className="flex justify-between text-[12.5px]" style={{ color: 'var(--success)' }}>
                        <span>Coupon Discount</span>
                        <span className="font-mono-data">-{formatCurrency(order.cou_amt)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: 'var(--ink-muted)' }}>Platform Commission</span>
                      <span className="font-mono-data">{formatCurrency(order.commission_amount)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 text-[13px] font-bold" style={{ borderColor: 'var(--border)' }}>
                      <span>Total Amount</span>
                      <span className="font-mono-data">{formatCurrency(order.total_dcharge)}</span>
                    </div>
                  </div>
                </section>

                {/* Live Milestones */}
                <section>
                  <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    Order Timeline & Milestones
                  </h3>
                  <div className="surface-card rounded-xl p-3.5">
                    <ol className="space-y-2">
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
                </section>
              </>
            )}
          </div>
        )}
      </Drawer>

      <AssignDriverModal
        open={assignOpen}
        order={order}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => {
          setAssignOpen(false)
          toast.success('Driver assigned.')
          refetch()
          onChanged?.()
        }}
      />
      <CancelOrderModal
        open={cancelOpen}
        order={order}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false)
          toast.success('Order cancelled.')
          refetch()
          onChanged?.()
        }}
      />
      <InvoiceModal
        open={invoiceOpen}
        orderId={orderId}
        onClose={() => setInvoiceOpen(false)}
      />
    </>
  )
}
