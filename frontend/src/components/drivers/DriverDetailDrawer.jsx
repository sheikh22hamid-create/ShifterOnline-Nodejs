import { useCallback, useState } from 'react'
import { ShieldBan, ShieldCheck, Trash2, UserMinus, Pencil } from 'lucide-react'
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
  const [demoteModalOpen, setDemoteModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [togglingModelId, setTogglingModelId] = useState(null)

  const fetcher = useCallback(() => api.get(`/riders/${riderId}`).then((res) => res.data.data), [riderId])
  const { data: rider, setData, loading, refetch } = useApiQuery(fetcher)

  function openEditModal() {
    setEditForm({
      full_name: rider.full_name || '',
      email: rider.email || '',
      fmobile: rider.fmobile || '',
      smobile: rider.smobile || '',
      dob: rider.dob || '',
      nationality: rider.nationality || '',
      full_address: rider.full_address || '',
      vehicle: rider.vehicle || '',
      vehicle_no: rider.vehicle_no || '',
      account_name: rider.account_name || '',
      account_number: rider.account_number || '',
      ifsc: rider.ifsc || '',
      upi_id: rider.upi_id || '',
      working_hours: rider.working_hours ?? '',
      plan_type: rider.plan_type || 'general',
      rc_owner_name: rider.personal_doc?.rc_owner_name || '',
      rc_owner_aadhar_number: rider.personal_doc?.rc_owner_aadhar_number || '',
    })
    setEditModalOpen(true)
  }

  async function handleSaveProfile() {
    setBusy(true)
    try {
      await api.patch(`/riders/${riderId}/profile`, editForm)
      toast.success('Driver profile updated.')
      setEditModalOpen(false)
      refetch()
      onChanged?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update profile.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDemote() {
    setBusy(true)
    try {
      await api.post('/monthly-drivers/demote', { rider_id: riderId })
      toast.success('Driver shifted back to Standard Freelance Driver.')
      setDemoteModalOpen(false)
      refetch()
      onChanged?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not revert driver status.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleModel(packageId, currentEnabled) {
    const newEnabled = !currentEnabled
    setTogglingModelId(packageId)

    // Optimistic update
    setData((prev) => {
      if (!prev || !prev.models) return prev
      return {
        ...prev,
        models: prev.models.map((m) =>
          m.package_id === packageId ? { ...m, enabled: newEnabled } : m
        ),
      }
    })

    try {
      const res = await api.put(`/riders/${riderId}/models/${packageId}/toggle`, {
        enabled: newEnabled,
      })
      toast.success(res.data?.message || `Model ${newEnabled ? 'enabled' : 'disabled'} successfully.`)
      onChanged?.()
    } catch (err) {
      // Revert on failure
      setData((prev) => {
        if (!prev || !prev.models) return prev
        return {
          ...prev,
          models: prev.models.map((m) =>
            m.package_id === packageId ? { ...m, enabled: currentEnabled } : m
          ),
        }
      })
      toast.error(err.response?.data?.message || 'Could not update model status.')
    } finally {
      setTogglingModelId(null)
    }
  }

  async function handleTogglePayment() {
    const nextValue = rider.payment_complete ? 0 : 1
    setBusy(true)
    try {
      await api.patch(`/riders/${riderId}/payment`, { payment_complete: nextValue })
      toast.success(nextValue ? 'Verification payment marked complete.' : 'Verification payment reset to pending.')
      refetch()
      onChanged?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update payment status.')
    } finally {
      setBusy(false)
    }
  }

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
              <Badge tone={rider.payment_complete ? 'success' : 'warning'}>
                Verification payment: {rider.payment_complete ? 'Paid' : 'Pending'}
              </Badge>
              {rider.monthly_plan === 1 ? (
                <Badge tone="info">💼 Monthly Dedicated</Badge>
              ) : (
                <Badge tone="neutral">⚡ Freelance Driver</Badge>
              )}
            </div>

            {canModerate && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openEditModal}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  <Pencil size={13} /> Edit Profile
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleTogglePayment}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
                  style={
                    rider.payment_complete
                      ? { borderColor: 'var(--border)', color: 'var(--ink-muted)' }
                      : { borderColor: 'var(--success-soft-border)', color: 'var(--success)', background: 'var(--success-soft)' }
                  }
                >
                  {rider.payment_complete ? 'Mark payment pending' : 'Mark payment complete'}
                </button>
                {rider.monthly_plan === 1 && (
                  <button
                    type="button"
                    onClick={() => setDemoteModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition"
                    style={{ borderColor: 'var(--danger-soft-border)', color: 'var(--danger)', background: 'var(--danger-soft)' }}
                  >
                    <UserMinus size={13} /> Shift to Normal Driver
                  </button>
                )}
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
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Vehicle Models / Delivery Tiers
                </h3>
                {rider.models && rider.models.length > 0 && (
                  <span className="text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                    {rider.models.filter((m) => m.enabled).length}/{rider.models.length} active
                  </span>
                )}
              </div>

              {!rider.models || rider.models.length === 0 ? (
                <div className="surface-card rounded-xl p-3.5 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                  No models configured for this vehicle category.
                </div>
              ) : (
                <div className="surface-card divide-y rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  {rider.models.map((model) => {
                    const isToggling = togglingModelId === model.package_id
                    return (
                      <div
                        key={model.package_id}
                        className="flex items-center justify-between p-3 transition-colors hover:bg-black/[0.02]"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="flex-1 pr-3 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                              {model.title}
                            </span>
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                              style={{
                                background: model.enabled ? 'var(--success-soft)' : 'var(--danger-soft)',
                                color: model.enabled ? 'var(--success)' : 'var(--danger)',
                                border: `1px solid ${model.enabled ? 'var(--success-soft-border)' : 'var(--danger-soft-border)'}`,
                              }}
                            >
                              {model.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {model.user_title && (
                              <span className="truncate">
                                <span style={{ color: 'var(--ink-faint)' }}>User:</span> {model.user_title}
                              </span>
                            )}
                            {model.driver_title && (
                              <span className="truncate">
                                <span style={{ color: 'var(--ink-faint)' }}>Driver:</span> {model.driver_title}
                              </span>
                            )}
                          </div>

                          <div className="mt-0.5 text-[11px] font-mono-data" style={{ color: 'var(--ink-faint)' }}>
                            Min ₹{model.min_charge} · ₹{model.per_km_charge}/km
                          </div>
                        </div>

                        {canModerate && (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={model.enabled}
                            disabled={isToggling || busy}
                            onClick={() => handleToggleModel(model.package_id, model.enabled)}
                            className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50"
                            style={{
                              backgroundColor: model.enabled ? 'var(--success)' : 'var(--border-strong)',
                            }}
                            title={`Click to ${model.enabled ? 'disable' : 'enable'} ${model.title}`}
                          >
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                model.enabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Training Video Status
                </h3>
                {rider.training?.is_completed ? (
                  <Badge tone="success">Completed (100%)</Badge>
                ) : rider.training?.watch_progress > 0 ? (
                  <Badge tone="warning">In Progress ({Math.round(rider.training.watch_progress)}%)</Badge>
                ) : (
                  <Badge tone="neutral">Not Started (0%)</Badge>
                )}
              </div>
              <div className="surface-card space-y-2 rounded-xl p-3.5 text-[12.5px]">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--ink-muted)' }}>Watch progress</span>
                  <span className="font-mono-data">{Math.round(rider.training?.watch_progress || 0)}%</span>
                </div>
                {rider.training?.completed_at && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--ink-muted)' }}>Completed at</span>
                    <span>{formatDateTime(rider.training.completed_at)}</span>
                  </div>
                )}
                {rider.training?.updated_at && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--ink-muted)' }}>Last synced</span>
                    <span>{formatDateTime(rider.training.updated_at)}</span>
                  </div>
                )}
                {canModerate && (rider.training?.watch_progress > 0 || rider.training?.is_completed) && (
                  <div className="pt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await api.post(`/training/progress/${riderId}/reset`)
                          toast.success('Training progress reset. Driver must rewatch the video.')
                          refetch()
                          onChanged?.()
                        } catch (err) {
                          toast.error(err.response?.data?.message || 'Could not reset training.')
                        } finally {
                          setBusy(false)
                        }
                      }}
                      className="w-full rounded-lg border py-1.5 text-center text-[12px] font-medium transition-colors hover:bg-white/5"
                      style={{ borderColor: 'var(--border)', color: 'var(--warning)' }}
                    >
                      Reset Training Progress
                    </button>
                  </div>
                )}
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
                {rider.personal_doc?.rc_owner_aadhar_number && (
                  <div className="border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      RC registered to a different owner
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--ink-muted)' }}>Owner name</span>
                      <span>{rider.personal_doc.rc_owner_name || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--ink-muted)' }}>Owner Aadhaar</span>
                      <span className="font-mono-data">{rider.personal_doc.rc_owner_aadhar_number}</span>
                    </div>
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

      <Modal
        open={demoteModalOpen}
        onClose={() => setDemoteModalOpen(false)}
        title="Shift to Standard Freelance Driver"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDemoteModalOpen(false)}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleDemote}
              className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--danger)' }}
            >
              {busy ? 'Shifting…' : 'Yes, Shift to Normal'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: 'var(--ink)' }}>
            Are you sure you want to revert <strong>{rider?.full_name || `Driver #${riderId}`}</strong> from Monthly Dedicated back to <strong>Standard Freelance Driver</strong>?
          </p>
          <div
            className="rounded-xl border p-3 text-[12px] space-y-1.5"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          >
            <div>• Monthly contract will be terminated immediately.</div>
            <div>• Any ongoing shift duty will be auto punched out.</div>
            <div>• Driver App will immediately restore standard freelance delivery modes and commission flow.</div>
          </div>
        </div>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit driver profile"
        footer={
          <>
            <button type="button" onClick={() => setEditModalOpen(false)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={handleSaveProfile} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editForm && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <EditSection title="Basic info">
              <EditField label="Full name" value={editForm.full_name} onChange={(v) => setEditForm((f) => ({ ...f, full_name: v }))} />
              <EditField label="Email" value={editForm.email} onChange={(v) => setEditForm((f) => ({ ...f, email: v }))} />
              <EditField label="Mobile" value={editForm.fmobile} onChange={(v) => setEditForm((f) => ({ ...f, fmobile: v }))} />
              <EditField label="Alternate mobile" value={editForm.smobile} onChange={(v) => setEditForm((f) => ({ ...f, smobile: v }))} />
              <EditField label="Date of birth" value={editForm.dob} onChange={(v) => setEditForm((f) => ({ ...f, dob: v }))} />
              <EditField label="Nationality" value={editForm.nationality} onChange={(v) => setEditForm((f) => ({ ...f, nationality: v }))} />
              <EditField label="Address" value={editForm.full_address} onChange={(v) => setEditForm((f) => ({ ...f, full_address: v }))} full />
            </EditSection>

            <EditSection title="Vehicle">
              <EditField label="Vehicle type" value={editForm.vehicle} onChange={(v) => setEditForm((f) => ({ ...f, vehicle: v }))} />
              <EditField label="Plate number" value={editForm.vehicle_no} onChange={(v) => setEditForm((f) => ({ ...f, vehicle_no: v }))} />
            </EditSection>

            <EditSection title="Bank & UPI">
              <EditField label="Account holder name" value={editForm.account_name} onChange={(v) => setEditForm((f) => ({ ...f, account_name: v }))} />
              <EditField label="Account number" value={editForm.account_number} onChange={(v) => setEditForm((f) => ({ ...f, account_number: v }))} />
              <EditField label="IFSC" value={editForm.ifsc} onChange={(v) => setEditForm((f) => ({ ...f, ifsc: v }))} />
              <EditField label="UPI ID" value={editForm.upi_id} onChange={(v) => setEditForm((f) => ({ ...f, upi_id: v }))} />
            </EditSection>

            <EditSection title="Plan">
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Plan type</div>
                <select
                  value={editForm.plan_type}
                  onChange={(e) => setEditForm((f) => ({ ...f, plan_type: e.target.value }))}
                  className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                >
                  <option value="general">General</option>
                  <option value="super">Super</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <EditField label="Working hours/day" type="number" value={editForm.working_hours} onChange={(v) => setEditForm((f) => ({ ...f, working_hours: v }))} />
            </EditSection>

            <EditSection title="RC owner correction (only if RC isn't self-owned)">
              <EditField label="Owner name" value={editForm.rc_owner_name} onChange={(v) => setEditForm((f) => ({ ...f, rc_owner_name: v }))} />
              <EditField label="Owner Aadhaar number" value={editForm.rc_owner_aadhar_number} onChange={(v) => setEditForm((f) => ({ ...f, rc_owner_aadhar_number: v }))} />
            </EditSection>
          </div>
        )}
      </Modal>
    </>
  )
}

function EditSection({ title, children }) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{title}</h4>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </section>
  )
}

function EditField({ label, value, onChange, type = 'text', full = false }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </div>
  )
}
