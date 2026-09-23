import { useCallback, useState } from 'react'
import {
  ShieldBan,
  ShieldCheck,
  Trash2,
  UserMinus,
  Pencil,
  Copy,
  Check,
  Eye,
  ImageOff,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'
import Drawer from '../common/Drawer'
import Badge from '../common/Badge'
import Modal from '../common/Modal'
import DocumentImageViewer from '../kyc/DocumentImageViewer'
import { approvalTone, approvalLabel, onlineTone, onlineLabel, verificationTone } from '../../utils/driverStatus'
import { formatCurrency, formatDateTime } from '../../utils/format'
import { resolveImageUrl } from '../../utils/imageUrl'
import { splitVehiclePics } from '../../utils/kycDoc'

function Field({ label, value, copyable = false, rawCopyValue = null }) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  function handleCopy(e) {
    e.stopPropagation()
    const text = rawCopyValue ?? (typeof value === 'string' ? value : '')
    if (!text) return
    navigator.clipboard.writeText(String(text).trim())
    setCopied(true)
    toast.success(`${label} copied`)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        <span>{label}</span>
        {copyable && value && value !== '—' && (
          <button
            type="button"
            onClick={handleCopy}
            title={`Copy ${label}`}
            className="inline-flex items-center gap-0.5 hover:text-[var(--ink)] text-[10px] lowercase transition-colors"
            style={{ color: 'var(--ink-faint)' }}
          >
            {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
            <span>{copied ? 'copied' : 'copy'}</span>
          </button>
        )}
      </div>
      <div className="mt-0.5 text-[13px] break-words" style={{ color: 'var(--ink)' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

function DocThumbnail({ label, src, onPreview }) {
  const resolved = resolveImageUrl(src)
  const [imgError, setImgError] = useState(false)

  if (!src) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed p-2 text-center text-[11px]"
        style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)', minHeight: '68px' }}
      >
        <ImageOff size={15} className="mb-0.5 opacity-40" />
        <span className="truncate max-w-[120px]">{label}: Not uploaded</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onPreview(label, src)}
      className="group relative flex flex-col items-center overflow-hidden rounded-lg border text-left transition hover:border-[var(--brand)] focus:outline-none"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      title={`Click to view ${label}`}
    >
      <div className="relative h-20 w-full overflow-hidden bg-black/20">
        {!imgError ? (
          <img
            src={resolved}
            alt={label}
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-center p-2" style={{ color: 'var(--ink-faint)' }}>
            <ImageOff size={16} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1 rounded bg-black/75 px-2 py-0.5 text-[11px] font-medium text-white shadow">
            <Eye size={12} /> View Full
          </span>
        </div>
      </div>
      <div className="w-full px-2 py-1 text-[11px] font-medium truncate" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
    </button>
  )
}

function DocumentCard({ title, docNumber, status, photos = [], onPreview, note }) {
  const statusTone = status === 1 ? 'success' : status === 2 ? 'danger' : status === 0 ? 'warning' : 'neutral'
  const statusText = status === 1 ? 'Approved' : status === 2 ? 'Rejected' : status === 0 ? 'Pending' : 'Not submitted'

  return (
    <div className="surface-card rounded-xl border p-3.5 space-y-2.5" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
          {title}
        </div>
        <Badge tone={statusTone}>{statusText}</Badge>
      </div>

      <Field
        label={`${title} Number`}
        value={
          docNumber ? (
            <span className="font-mono-data font-semibold text-[13.5px] text-[var(--ink)] tracking-wide">
              {docNumber}
            </span>
          ) : (
            <span style={{ color: 'var(--ink-faint)' }}>Not provided</span>
          )
        }
        copyable={Boolean(docNumber)}
        rawCopyValue={docNumber}
      />

      {note && (
        <div
          className="text-[11.5px] rounded-lg p-2.5 border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink-muted)' }}
        >
          {note}
        </div>
      )}

      {photos.length > 0 && (
        <div className="pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            <span>Photos</span>
            <span>
              {photos.filter((p) => Boolean(p.src)).length}/{photos.length} uploaded
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p, idx) => (
              <DocThumbnail
                key={idx}
                label={p.label}
                src={p.src}
                onPreview={(lbl, src) => onPreview(title ? `${title} (${lbl})` : lbl, src)}
              />
            ))}
          </div>
        </div>
      )}
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
  const [previewDoc, setPreviewDoc] = useState(null)
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
      aadhar_id: rider.personal_doc?.aadhar_id || '',
      pan_id: rider.personal_doc?.pan_id || '',
      lic_id: rider.personal_doc?.lic_id || '',
      rc_number: rider.vehicle_details?.[0]?.reg_num || rider.personal_doc?.residence_id || rider.vehicle_no || '',
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
                Profile & Contact Details
              </h3>
              <div className="surface-card grid grid-cols-2 gap-3 rounded-xl p-3.5">
                <Field
                  label="Mobile"
                  value={<span className="font-mono-data">{rider.fmobile}</span>}
                  copyable
                  rawCopyValue={rider.fmobile}
                />
                <Field
                  label="Alternate mobile"
                  value={rider.smobile ? <span className="font-mono-data">{rider.smobile}</span> : '—'}
                  copyable={Boolean(rider.smobile)}
                  rawCopyValue={rider.smobile}
                />
                <Field label="Email" value={rider.email} copyable={Boolean(rider.email)} rawCopyValue={rider.email} />
                <Field
                  label="Date of birth (DOB)"
                  value={
                    rider.dob ? (
                      <span className="font-semibold" style={{ color: 'var(--brand)' }}>
                        {rider.dob}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
                <Field label="Nationality" value={rider.nationality || 'Indian'} />
                <Field label="Vehicle type" value={rider.vehicle} />
                <Field
                  label="Plate number"
                  value={<span className="font-mono-data font-semibold">{rider.vehicle_no}</span>}
                  copyable={Boolean(rider.vehicle_no)}
                  rawCopyValue={rider.vehicle_no}
                />
                <Field
                  label="City"
                  value={rider.city_name || (rider.city_id ? `City #${rider.city_id}` : '—')}
                />
                <Field label="Ledger balance" value={<span className="font-mono-data">{formatCurrency(rider.wallet_balance)}</span>} />
                <Field label="Joined" value={formatDateTime(rider.rdate)} />
                {rider.full_address && (
                  <div className="col-span-2 border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
                    <Field label="Full Address" value={rider.full_address} copyable rawCopyValue={rider.full_address} />
                  </div>
                )}
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

            {/* Comprehensive Identity & Government KYC Documents Section */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Identity & Verification Documents
                </h3>
                <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Click photo to zoom
                </span>
              </div>

              {/* Aadhaar Card */}
              <DocumentCard
                title="Aadhaar Card"
                docNumber={rider.personal_doc?.aadhar_id || rider.personal_doc?.address_id}
                status={rider.personal_doc?.aadhar_status ?? rider.personal_doc?.address_status}
                photos={[
                  { label: 'Front Photo', src: rider.personal_doc?.aadhar_front || rider.personal_doc?.address_front },
                  { label: 'Back Photo', src: rider.personal_doc?.aadhar_back || rider.personal_doc?.aadhaar_back || rider.personal_doc?.address_back },
                ]}
                onPreview={(title, src) => setPreviewDoc({ title, src })}
              />

              {/* PAN Card */}
              <DocumentCard
                title="PAN Card"
                docNumber={rider.personal_doc?.pan_id}
                status={rider.personal_doc?.pan_status}
                photos={[
                  { label: 'Front Photo', src: rider.personal_doc?.pan_front },
                  { label: 'Back Photo', src: rider.personal_doc?.pan_back },
                ]}
                onPreview={(title, src) => setPreviewDoc({ title, src })}
              />

              {/* Driving License (DL) */}
              <DocumentCard
                title="Driving License (DL)"
                docNumber={rider.personal_doc?.lic_id}
                status={rider.personal_doc?.lic_status}
                photos={[
                  { label: 'Front Photo', src: rider.personal_doc?.lic_front },
                  { label: 'Back Photo', src: rider.personal_doc?.lic_back },
                ]}
                onPreview={(title, src) => setPreviewDoc({ title, src })}
              />

              {/* Vehicle RC */}
              <DocumentCard
                title="Vehicle RC"
                docNumber={rider.vehicle_details?.[0]?.reg_num || rider.personal_doc?.residence_id || rider.vehicle_no}
                status={rider.vehicle_details?.[0]?.status ?? rider.personal_doc?.residence_status}
                note={
                  rider.personal_doc?.rc_owner_aadhar_number ? (
                    <div>
                      <span className="font-semibold text-[var(--ink)]">Third-party RC Owner:</span>{' '}
                      {rider.personal_doc.rc_owner_name || 'Owner'} ·{' '}
                      <span className="font-mono-data">Aadhaar: {rider.personal_doc.rc_owner_aadhar_number}</span>
                    </div>
                  ) : null
                }
                photos={[
                  ...splitVehiclePics(rider.vehicle_details?.[0]?.v_pic),
                  ...(rider.personal_doc?.residence_front ? [{ label: 'RC / Residence Front', src: rider.personal_doc.residence_front }] : []),
                  ...(rider.personal_doc?.residence_back ? [{ label: 'RC / Residence Back', src: rider.personal_doc.residence_back }] : []),
                ]}
                onPreview={(title, src) => setPreviewDoc({ title, src })}
              />

              {/* Bank & Payout Account */}
              <div className="surface-card rounded-xl border p-3.5 space-y-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                    Bank & Payout Account
                  </div>
                  <Badge tone={rider.bank_accounts?.[0]?.status === 1 ? 'success' : 'warning'}>
                    {rider.bank_accounts?.[0]?.status === 1 ? 'Approved' : 'Pending'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Account Holder"
                    value={rider.account_name || rider.bank_accounts?.[0]?.a_name}
                  />
                  <Field
                    label="Account Number"
                    value={
                      (rider.account_number || rider.bank_accounts?.[0]?.iban_num) ? (
                        <span className="font-mono-data font-semibold text-[var(--ink)]">
                          {rider.account_number || rider.bank_accounts?.[0]?.iban_num}
                        </span>
                      ) : null
                    }
                    copyable={Boolean(rider.account_number || rider.bank_accounts?.[0]?.iban_num)}
                    rawCopyValue={rider.account_number || rider.bank_accounts?.[0]?.iban_num}
                  />
                  <Field
                    label="IFSC Code"
                    value={
                      (rider.ifsc || rider.bank_accounts?.[0]?.ifsc_code) ? (
                        <span className="font-mono-data font-semibold text-[var(--ink)]">
                          {rider.ifsc || rider.bank_accounts?.[0]?.ifsc_code}
                        </span>
                      ) : null
                    }
                    copyable={Boolean(rider.ifsc || rider.bank_accounts?.[0]?.ifsc_code)}
                    rawCopyValue={rider.ifsc || rider.bank_accounts?.[0]?.ifsc_code}
                  />
                  <Field
                    label="UPI ID"
                    value={
                      rider.upi_id ? (
                        <span className="font-mono-data">{rider.upi_id}</span>
                      ) : null
                    }
                    copyable={Boolean(rider.upi_id)}
                    rawCopyValue={rider.upi_id}
                  />
                  {rider.bank_accounts?.[0]?.bank_name && (
                    <div className="col-span-2">
                      <Field
                        label="Bank & Branch"
                        value={`${rider.bank_accounts[0].bank_name}${rider.bank_accounts[0].branch_name ? ` · ${rider.bank_accounts[0].branch_name}` : ''}`}
                      />
                    </div>
                  )}
                </div>

                {rider.personal_doc?.upi_image && (
                  <div className="border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
                    <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      UPI QR / Passbook Image
                    </div>
                    <div className="w-1/2">
                      <DocThumbnail
                        label="UPI QR / Passbook"
                        src={rider.personal_doc.upi_image}
                        onPreview={(lbl, src) => setPreviewDoc({ title: 'Bank / UPI Document', src })}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery Kit */}
              {rider.kit && (
                <div className="surface-card rounded-xl border p-3.5 space-y-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                      Delivery Kit
                    </div>
                    <Badge tone={rider.kit.kit_status === 1 ? 'success' : 'warning'}>
                      {rider.kit.kit_status === 1 ? 'Approved' : 'Pending'}
                    </Badge>
                  </div>
                  {rider.kit.img && (
                    <div className="w-1/2 pt-1">
                      <DocThumbnail
                        label="Kit Photo"
                        src={rider.kit.img}
                        onPreview={(lbl, src) => setPreviewDoc({ title: 'Delivery Kit Photo', src })}
                      />
                    </div>
                  )}
                </div>
              )}
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
        width={560}
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
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <EditSection title="Basic info">
              <EditField label="Full name" value={editForm.full_name} onChange={(v) => setEditForm((f) => ({ ...f, full_name: v }))} />
              <EditField label="Email" value={editForm.email} onChange={(v) => setEditForm((f) => ({ ...f, email: v }))} />
              <EditField label="Mobile" value={editForm.fmobile} onChange={(v) => setEditForm((f) => ({ ...f, fmobile: v }))} />
              <EditField label="Alternate mobile" value={editForm.smobile} onChange={(v) => setEditForm((f) => ({ ...f, smobile: v }))} />
              <EditField label="Date of birth (DOB)" value={editForm.dob} onChange={(v) => setEditForm((f) => ({ ...f, dob: v }))} placeholder="e.g. 1995-08-15" />
              <EditField label="Nationality" value={editForm.nationality} onChange={(v) => setEditForm((f) => ({ ...f, nationality: v }))} />
              <EditField label="Address" value={editForm.full_address} onChange={(v) => setEditForm((f) => ({ ...f, full_address: v }))} full />
            </EditSection>

            <EditSection title="Identity & Government IDs">
              <EditField label="Aadhaar number" value={editForm.aadhar_id} onChange={(v) => setEditForm((f) => ({ ...f, aadhar_id: v }))} />
              <EditField label="PAN number" value={editForm.pan_id} onChange={(v) => setEditForm((f) => ({ ...f, pan_id: v }))} />
              <EditField label="Driving license (DL)" value={editForm.lic_id} onChange={(v) => setEditForm((f) => ({ ...f, lic_id: v }))} />
              <EditField label="Vehicle RC number" value={editForm.rc_number} onChange={(v) => setEditForm((f) => ({ ...f, rc_number: v }))} />
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

      {/* Interactive Document Image Viewer Modal */}
      <Modal
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.title || 'Document Preview'}
        width={720}
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              Use mouse wheel to zoom in/out, drag to pan the document.
            </span>
            <button
              type="button"
              onClick={() => setPreviewDoc(null)}
              className="rounded-lg border px-3.5 py-1.5 text-[13px] font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              Close
            </button>
          </div>
        }
      >
        {previewDoc && (
          <div className="h-[520px] w-full">
            <DocumentImageViewer src={previewDoc.src} label={previewDoc.title} />
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
