import { useCallback, useEffect, useRef, useState } from 'react'
import { UserPlus, Ban, XCircle, ShieldCheck, RefreshCw, Users, ChevronDown } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'

const STATUS_BADGE = {
  active: { tone: 'warning', label: '🧪 Trial Active' },
  exhausted: { tone: 'danger', label: '⛔ Trial Exhausted' },
  blocked: { tone: 'danger', label: '✕ Blocked' },
  upgraded: { tone: 'success', label: '✓ Upgraded' },
}

export default function TrialDrivers() {
  const toast = useToast()
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ full_name: '', fmobile: '', vehicle: 'Bike', trial_orders_allowed: '5' })
  const [busy, setBusy] = useState(false)
  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false)
  const vehicleFieldRef = useRef(null)

  useEffect(() => {
    if (!vehicleMenuOpen) return
    function onOutsideClick(e) {
      if (vehicleFieldRef.current && !vehicleFieldRef.current.contains(e.target)) setVehicleMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [vehicleMenuOpen])

  const fetcher = useCallback(() => api.get('/trial-drivers').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const drivers = data?.data ?? []

  const vehiclesFetcher = useCallback(() => api.get('/vehicles').then((res) => res.data.data), [])
  const { data: vehicles } = useApiQuery(vehiclesFetcher)

  async function handleAdd() {
    setBusy(true)
    try {
      await api.post('/trial-drivers', {
        full_name: form.full_name,
        fmobile: form.fmobile,
        vehicle: form.vehicle,
        trial_orders_allowed: Number(form.trial_orders_allowed),
      })
      toast.success(`${form.full_name} added to trial`)
      setAddOpen(false)
      setForm({ full_name: '', fmobile: '', vehicle: 'Bike', trial_orders_allowed: '5' })
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add trial driver.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAction(driver, action, label) {
    setBusy(true)
    try {
      await api.post(`/trial-drivers/${driver.id}/${action}`)
      toast.success(`${driver.full_name || driver.fmobile} ${label}`)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${action} driver.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Trial Drivers
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Drivers taking a limited number of real orders before completing full KYC.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium hover:bg-[var(--bg-hover)]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white"
            style={{ background: 'var(--brand)' }}
          >
            <UserPlus size={13} />
            Add Trial Driver
          </button>
        </div>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Driver', 'Mobile', 'Vehicle', 'Status', 'Orders Used', 'Actions'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && !error && drivers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    <Users size={28} className="mx-auto mb-2 opacity-40" />
                    No trial drivers yet.
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>{error}</td>
                </tr>
              )}
              {drivers.map((d) => {
                const badge = STATUS_BADGE[d.trial_status] || { tone: 'neutral', label: d.trial_status }
                return (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>{d.full_name || `#${d.id}`}</td>
                    <td className="px-4 py-3 font-mono text-[12px]">{d.fmobile}</td>
                    <td className="px-4 py-3">{d.vehicle}</td>
                    <td className="px-4 py-3"><Badge tone={badge.tone}>{badge.label}</Badge></td>
                    <td className="px-4 py-3">{d.trial_orders_completed} / {d.trial_orders_allowed ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy || d.trial_status === 'blocked'}
                          onClick={() => handleAction(d, 'block', 'blocked')}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium disabled:opacity-40"
                          style={{ borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
                        >
                          <Ban size={12} /> Block
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleAction(d, 'remove', 'removed from trial')}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium disabled:opacity-40"
                          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                        >
                          <XCircle size={12} /> Remove
                        </button>
                        <button
                          type="button"
                          disabled={busy || d.trial_status === 'upgraded'}
                          onClick={() => handleAction(d, 'upgrade', 'upgraded to verified')}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40"
                          style={{ background: 'var(--success)' }}
                        >
                          <ShieldCheck size={12} /> Upgrade
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && (
        <Modal open={addOpen} title="Add Trial Driver" onClose={() => !busy && setAddOpen(false)}>
          <div className="space-y-3 text-[13px]">
            <div>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Full Name</label>
              <input
                className="w-full rounded-lg border px-3 py-1.5 text-[13px]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Mobile Number</label>
              <input
                className="w-full rounded-lg border px-3 py-1.5 text-[13px]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                value={form.fmobile}
                onChange={(e) => setForm((f) => ({ ...f, fmobile: e.target.value }))}
              />
            </div>
            <div className="relative" ref={vehicleFieldRef}>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Vehicle</label>
              {/* Native <select> popups render their <option> rows with the
                  browser/OS's own styling in Chromium - the page's CSS
                  variables on background/color aren't reliably applied,
                  producing unreadable text regardless of theme or
                  extensions. A fully custom list sidesteps that. */}
              <button
                type="button"
                onClick={() => setVehicleMenuOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-[13px]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: form.vehicle ? 'var(--ink)' : 'var(--ink-faint)' }}
              >
                <span>{form.vehicle || 'Select vehicle'}</span>
                <ChevronDown size={14} style={{ color: 'var(--ink-faint)' }} />
              </button>
              {vehicleMenuOpen && (
                <div
                  className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}
                >
                  {vehicles?.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, vehicle: v.title }))
                        setVehicleMenuOpen(false)
                      }}
                      className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--ink)', background: form.vehicle === v.title ? 'var(--bg)' : 'transparent' }}
                    >
                      {v.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Number of Trial Orders</label>
              <input
                type="number"
                min="1"
                className="w-full rounded-lg border px-3 py-1.5 text-[13px]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                value={form.trial_orders_allowed}
                onChange={(e) => setForm((f) => ({ ...f, trial_orders_allowed: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setAddOpen(false)} className="rounded-lg border px-3 py-1.5 text-[12.5px] font-medium" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                Cancel
              </button>
              <button type="button" disabled={busy || !form.full_name || !form.fmobile} onClick={handleAdd} className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                {busy ? 'Adding...' : 'Add to Trial'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
