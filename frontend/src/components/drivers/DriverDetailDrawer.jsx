import { useCallback, useState } from 'react'
import { ShieldBan, ShieldCheck, Trash2 } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'
import Drawer from '../common/Drawer'
import Badge from '../common/Badge'
import Modal from '../common/Modal'
import { approvalTone, approvalLabel, onlineTone, onlineLabel, verificationTone } from '../../utils/driverStatus'
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

export default function DriverDetailDrawer({ riderId, onClose, onChanged }) {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canModerate = hasRole('superadmin', 'admin')
  const canDelete = hasRole('superadmin')

  const [blockReason, setBlockReason] = useState('')
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const fetcher = useCallback(() => api.get(`/riders/${riderId}`).then((res) => res.data.data), [riderId])
  const { data: rider, loading, refetch } = useApiQuery(fetcher)

  async function handleUnblock() {
    setBusy(true)
    try {
      await api.patch(`/riders/${riderId}/status`, { status: 1 })
      toast.success('Driver reactivated.')
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
      await api.patch(`/riders/${riderId}/status`, { status: 0, reason: blockReason })
      toast.success('Driver blocked.')
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
      await api.delete(`/riders/${riderId}`)
      toast.success('Driver deleted.')
      setDeleteModalOpen(false)
      onChanged?.()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this driver.')
      setDeleteModalOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Drawer open onClose={onClose} title={loading ? 'Loading driver…' : rider?.full_name || `Driver #${riderId}`} subtitle={rider?.city_name}>
        {loading || !rider ? (
          <div className="flex h-40 items-center justify-center" style={{ color: 'var(--ink-faint)' }}>
            Loading…
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={approvalTone(rider.status)}>{approvalLabel(rider.status)}</Badge>
              <Badge tone={onlineTone(rider.a_status)}>{onlineLabel(rider.a_status)}</Badge>
              <Badge tone={verificationTone(rider.verification_status)}>KYC: {rider.verification_status}</Badge>
            </div>

            {canModerate && (
              <div className="flex flex-wrap gap-2">
                {rider.status === 1 ? (
                  <button
                    type="button"
                    onClick={() => setBlockModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{ borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
                  >
                    <ShieldBan size={13} /> Block driver
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleUnblock}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                    style={{ background: 'var(--success)', color: '#fff' }}
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
                <Field label="Mobile" value={<span className="font-mono-data">{rider.fmobile}</span>} />
                <Field label="Email" value={rider.email} />
                <Field label="Vehicle" value={rider.vehicle} />
                <Field label="Plate no." value={<span className="font-mono-data">{rider.vehicle_no}</span>} />
                <Field label="Wallet" value={<span className="font-mono-data">{formatCurrency(rider.wallet_balance)}</span>} />
                <Field label="Joined" value={formatDateTime(rider.rdate)} />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                KYC document status
              </h3>
              <div className="surface-card space-y-2 rounded-xl p-3.5 text-[12.5px]">
                {rider.personal_doc ? (
                  <>
                    <div className="flex justify-between"><span style={{ color: 'var(--ink-muted)' }}>Address proof</span><span>{['Pending', 'Approved', 'Rejected'][rider.personal_doc.address_status]}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--ink-muted)' }}>Residence proof</span><span>{['Pending', 'Approved', 'Rejected'][rider.personal_doc.residence_status]}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--ink-muted)' }}>License</span><span>{['Pending', 'Approved', 'Rejected'][rider.personal_doc.lic_status]}</span></div>
                  </>
                ) : (
                  <span style={{ color: 'var(--ink-faint)' }}>No personal documents on file yet.</span>
                )}
                {rider.vehicle_details?.length > 0 && (
                  <div className="flex justify-between border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                    <span style={{ color: 'var(--ink-muted)' }}>Vehicle/RC docs</span>
                    <span>{rider.vehicle_details.filter((v) => v.status === 1).length}/{rider.vehicle_details.length} approved</span>
                  </div>
                )}
                {rider.bank_accounts?.length > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--ink-muted)' }}>Bank account</span>
                    <span>{rider.bank_accounts[0].status === 1 ? 'Approved' : 'Pending'}</span>
                  </div>
                )}
                {rider.kit && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--ink-muted)' }}>Kit</span>
                    <span>{rider.kit.kit_status === 1 ? 'Approved' : 'Pending'}</span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                Approve or reject documents from the KYC Approval screen.
              </p>
            </section>

            {rider.emergency_contact && (
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Emergency contact
                </h3>
                <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                  <Field label="Name" value={rider.emergency_contact.name} />
                  <Field label="Relation" value={rider.emergency_contact.relation} />
                  <Field label="Mobile" value={<span className="font-mono-data">{rider.emergency_contact.mobile}</span>} />
                </div>
              </section>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        title="Block driver"
        footer={
          <>
            <button type="button" onClick={() => setBlockModalOpen(false)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={handleBlock} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
              {busy ? 'Blocking…' : 'Block driver'}
            </button>
          </>
        }
      >
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="block-reason">
          Reason
        </label>
        <textarea
          id="block-reason"
          rows={3}
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="e.g. Repeated order rejections"
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
        />
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete driver"
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
          This permanently removes the driver and their documents, bank details, and delivery-type enablements. This
          can't be undone. Drivers with a trip in progress can't be deleted.
        </p>
      </Modal>
    </>
  )
}
