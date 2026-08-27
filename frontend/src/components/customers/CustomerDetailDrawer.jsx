import { useCallback, useState } from 'react'
import { ShieldBan, ShieldCheck, Wallet, Trash2, MapPin, Heart } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'
import Drawer from '../common/Drawer'
import Badge from '../common/Badge'
import Modal from '../common/Modal'
import WalletAdjustModal from './WalletAdjustModal'
import { orderStatusTone, orderStatusLabel } from '../../utils/orderStatus'
import { formatCurrency, formatDateTime } from '../../utils/format'

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

export default function CustomerDetailDrawer({ customerId, onClose, onChanged }) {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canModerate = hasRole('superadmin', 'admin')
  const canDelete = hasRole('superadmin')

  const fetcher = useCallback(() => api.get(`/customers/${customerId}`).then((res) => res.data.data), [customerId])
  const { data: customer, loading, refetch } = useApiQuery(fetcher)

  const [walletOpen, setWalletOpen] = useState(false)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleUnblock() {
    setBusy(true)
    try {
      await api.patch(`/customers/${customerId}/status`, { status: 1 })
      toast.success('Customer reactivated.')
      refetch()
      onChanged?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update status.')
    } finally {
      setBusy(false)
    }
  }

  async function handleBlock() {
    setBusy(true)
    try {
      await api.patch(`/customers/${customerId}/status`, { status: 0, reason: blockReason })
      toast.success('Customer blocked.')
      setBlockModalOpen(false)
      setBlockReason('')
      refetch()
      onChanged?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update status.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await api.delete(`/customers/${customerId}`)
      toast.success('Customer deleted.')
      setDeleteModalOpen(false)
      onChanged?.()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this customer.')
      setDeleteModalOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Drawer open onClose={onClose} title={loading ? 'Loading customer…' : customer?.name || `Customer #${customerId}`} subtitle={customer?.city_name}>
        {loading || !customer ? (
          <div className="flex h-40 items-center justify-center" style={{ color: 'var(--ink-faint)' }}>
            Loading…
          </div>
        ) : (
          <div className="space-y-5">
            <Badge tone={customer.status === 1 ? 'success' : 'danger'}>{customer.status === 1 ? 'Active' : 'Blocked'}</Badge>

            {canModerate && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setWalletOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                >
                  <Wallet size={13} /> Adjust wallet
                </button>
                {customer.status === 1 ? (
                  <button
                    type="button"
                    onClick={() => setBlockModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{ borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
                  >
                    <ShieldBan size={13} /> Block
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleUnblock}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{ borderColor: 'var(--success-soft-border)', color: 'var(--success)' }}
                  >
                    <ShieldCheck size={13} /> Reactivate
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleteModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            )}

            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Profile
              </h3>
              <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                <Field label="Mobile" value={<span className="font-mono-data">{customer.mobile}</span>} />
                <Field label="Email" value={customer.email} />
                <Field label="Wallet" value={<span className="font-mono-data">{formatCurrency(customer.wallet)}</span>} />
                <Field label="Plan" value={customer.plan_type} />
                <Field label="Referral points" value={customer.referral_points} />
                <Field label="Registered" value={formatDateTime(customer.registered_at)} />
              </div>
            </section>

            {customer.addresses?.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  <MapPin size={13} /> Saved addresses
                </h3>
                <div className="surface-card space-y-2 rounded-xl p-3.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                  {customer.addresses.map((a) => (
                    <div key={a.id}>
                      {a.type ? `${a.type}: ` : ''}
                      {a.address}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {customer.favorite_drivers?.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  <Heart size={13} /> Favorite drivers
                </h3>
                <div className="surface-card space-y-1.5 rounded-xl p-3.5 text-[12.5px]">
                  {customer.favorite_drivers.map((f) => (
                    <div key={f.rider_id} className="flex justify-between">
                      <span style={{ color: 'var(--ink)' }}>{f.rider_name || `Driver #${f.rider_id}`}</span>
                      <span className="font-mono-data" style={{ color: 'var(--ink-faint)' }}>
                        {f.rider_mobile}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Recent orders
              </h3>
              {customer.recent_orders?.length > 0 ? (
                <div className="surface-card divide-y rounded-xl" style={{ borderColor: 'var(--border)' }}>
                  {customer.recent_orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between px-3.5 py-2.5 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                      <span className="font-mono-data" style={{ color: 'var(--ink)' }}>
                        #{o.id}
                      </span>
                      <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                      <span className="font-mono-data" style={{ color: 'var(--ink-muted)' }}>
                        {formatCurrency(o.total_dcharge)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                  No orders yet.
                </p>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <WalletAdjustModal
        open={walletOpen}
        customer={customer}
        onClose={() => setWalletOpen(false)}
        onDone={() => {
          setWalletOpen(false)
          toast.success('Wallet adjusted.')
          refetch()
          onChanged?.()
        }}
      />

      <Modal
        open={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        title="Block customer"
        footer={
          <>
            <button type="button" onClick={() => setBlockModalOpen(false)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={handleBlock} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
              {busy ? 'Blocking…' : 'Block customer'}
            </button>
          </>
        }
      >
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cust-block-reason">
          Reason
        </label>
        <textarea
          id="cust-block-reason"
          rows={3}
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="e.g. Repeated fraudulent bookings"
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
        />
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete customer"
        footer={
          <>
            <button type="button" onClick={() => setDeleteModalOpen(false)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={handleDelete} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          This permanently removes the customer, their devices, and their favorites. This can't be undone. Customers with an order in progress can't be deleted.
        </p>
      </Modal>
    </>
  )
}
