import { useCallback, useState } from 'react'
import { UserRound, Bike, MapPin, Receipt, Pencil, Ban, UserPlus } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'
import Drawer from '../common/Drawer'
import Badge from '../common/Badge'
import { orderStatusTone, orderStatusLabel } from '../../utils/orderStatus'
import { formatCurrency, formatDateTime } from '../../utils/format'
import AssignDriverModal from './AssignDriverModal'
import CancelOrderModal from './CancelOrderModal'

const EDIT_FIELDS = [
  { key: 'paddress', label: 'Pickup address' },
  { key: 'pmobile', label: 'Pickup mobile' },
  { key: 'daddress', label: 'Delivery address' },
  { key: 'dmobile', label: 'Delivery mobile' },
  { key: 'description', label: 'Notes' },
  { key: 'distance', label: 'Distance (km)' },
  { key: 'total_dcharge', label: 'Total fare (₹)' },
]

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px]" style={{ color: 'var(--ink)' }}>
        {value ?? '—'}
      </div>
    </div>
  )
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

  const fetcher = useCallback(() => api.get(`/orders/${orderId}`).then((res) => res.data.data), [orderId])
  const { data: order, loading, refetch } = useApiQuery(fetcher)

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
  const isUnassigned = order && order.rid === 0 && order.o_status === 'Pending'

  return (
    <>
      <Drawer open onClose={onClose} title={loading ? 'Loading order…' : `Order #${order?.id}`} subtitle={order ? formatDateTime(order.odate) : undefined}>
        {loading || !order ? (
          <div className="flex h-40 items-center justify-center" style={{ color: 'var(--ink-faint)' }}>
            Loading…
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <Badge tone={orderStatusTone(order.o_status)}>{orderStatusLabel(order.o_status)}</Badge>
              <span className="font-mono-data text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(order.total_dcharge)}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
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
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <UserRound size={13} /> Customer
                  </h3>
                  <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                    <Field label="Name" value={order.customer?.name} />
                    <Field label="Mobile" value={<span className="font-mono-data">{order.customer?.mobile}</span>} />
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <Bike size={13} /> Driver
                  </h3>
                  <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                    {order.rider ? (
                      <>
                        <Field label="Name" value={order.rider.name} />
                        <Field label="Mobile" value={<span className="font-mono-data">{order.rider.mobile}</span>} />
                        <Field label="Vehicle no." value={<span className="font-mono-data">{order.rider.vehicle_no}</span>} />
                      </>
                    ) : (
                      <span className="col-span-2 text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                        Not assigned yet
                      </span>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <MapPin size={13} /> Route
                  </h3>
                  <div className="surface-card space-y-3 rounded-xl p-3.5">
                    <Field label="Pickup" value={order.paddress} />
                    <Field label="Delivery" value={order.daddress} />
                    <Field label="Distance" value={`${order.distance} km`} />
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    <Receipt size={13} /> Fare breakdown
                  </h3>
                  <div className="surface-card space-y-2 rounded-xl p-3.5">
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: 'var(--ink-muted)' }}>Base charge</span>
                      <span className="font-mono-data">{formatCurrency(order.d_charge)}</span>
                    </div>
                    <div className="flex justify-between text-[12.5px]">
                      <span style={{ color: 'var(--ink-muted)' }}>Commission</span>
                      <span className="font-mono-data">{formatCurrency(order.commission_amount)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)' }}>
                      <span>Total</span>
                      <span className="font-mono-data">{formatCurrency(order.total_dcharge)}</span>
                    </div>
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
    </>
  )
}
