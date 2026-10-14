import { useCallback, useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'
import { formatDateTime } from '../utils/format'
import {
  REASON_MAX_LENGTH,
  buildProfileBody,
  buildReassignBody,
  buildSettingsBody,
  validateProfilePatch,
  validateReassign,
  validateSettings,
} from '../utils/guaranteeQueueForms'

const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const inputStyle = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }
const inputClass = 'rounded-lg border px-3 py-2 text-[13px]'
const STATE_TONE = { unassigned: 'warning', assigned: 'info', in_progress: 'brand', escalated: 'danger' }
const REASON = { none_in_city: 'No executive in this city', all_unavailable: 'All executives unavailable', all_at_capacity: 'All executives at capacity' }
const SETTING_FIELDS = [
  ['exec_default_capacity', 'Default capacity per executive (1-200)'],
  ['reminder_pct', 'Reminder at % of window (1-99)'],
  ['escalate_pct', 'Escalate at % of window (1-99, above the reminder)'],
  ['auto_reassign_idle_minutes', 'Auto-reassign if idle (minutes 1-1440, blank = off)'],
]

const settingsToForm = (d) => ({
  exec_queue_enabled: Boolean(d?.exec_queue_enabled),
  guarantee_recover_on_cancel: Boolean(d?.guarantee_recover_on_cancel),
  exec_default_capacity: d?.exec_default_capacity != null ? String(d.exec_default_capacity) : '',
  reminder_pct: d?.reminder_pct != null ? String(d.reminder_pct) : '',
  escalate_pct: d?.escalate_pct != null ? String(d.escalate_pct) : '',
  auto_reassign_idle_minutes: d?.auto_reassign_idle_minutes != null ? String(d.auto_reassign_idle_minutes) : '',
})

function Kpi({ label, value, tone }) {
  return (
    <div className="rounded-2xl border p-3" style={{ background: 'var(--surface)', borderColor: tone === 'danger' && value > 0 ? 'var(--danger)' : 'var(--border)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{label}</div>
      <div className="text-[22px] font-bold" style={{ color: 'var(--ink)' }}>{value ?? '–'}</div>
    </div>
  )
}

function ConfirmBox({ children, busy, onConfirm, onCancel, confirmLabel }) {
  return (
    <div className="grid gap-2 rounded-xl border p-3 text-[13px]" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)', color: 'var(--ink)' }}>
      <div>{children}</div>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>{confirmLabel}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Cancel</button>
      </div>
    </div>
  )
}

export default function GuaranteeWorkload() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const [cityId, setCityId] = useState('')
  const [cities, setCities] = useState([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [reassigning, setReassigning] = useState(null) // { order_id }
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [confirmUnavailable, setConfirmUnavailable] = useState(null) // workload row
  // Loaded settings always carry the city they belong to: { city, settings, form }.
  const [loadedSettings, setLoadedSettings] = useState(null)
  const [settingsError, setSettingsError] = useState('')
  const [confirmEnable, setConfirmEnable] = useState(false)

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities')
      .then((res) => setCities(res.data?.data || res.data || []))
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load cities')))
  }, [isSuper])

  const fetcher = useCallback(async () => {
    const p = { params: isSuper && cityId ? { city_id: cityId } : {} }
    const [report, workload, queue] = await Promise.all([
      api.get('/booking-guarantee/exec/report', p),
      api.get('/booking-guarantee/exec/workload', p),
      api.get('/booking-guarantee/exec/queue', p),
    ])
    return { city: String(isSuper ? cityId : ''), report: report.data?.data, workload: workload.data?.data ?? [], queue: queue.data?.data ?? [] }
  }, [isSuper, cityId])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(['admin:dispatch_alert', 'admin:order_status_update'], refetch, { fallbackInterval: 15000 })

  const settingsCity = isSuper ? cityId : String(user?.city_id ?? '')
  const settingsCityRef = useRef(settingsCity)
  useEffect(() => { settingsCityRef.current = settingsCity }, [settingsCity])
  const loadSettings = useCallback(async (city, signal) => {
    try {
      const res = await api.get('/booking-guarantee/exec/settings', { params: isSuper ? { city_id: city } : {} })
      if (signal?.cancelled) return
      setLoadedSettings({ city, settings: res.data?.data, form: settingsToForm(res.data?.data) })
    } catch (err) {
      if (signal?.cancelled) return
      const msg = errMsg(err, 'Could not load settings')
      setSettingsError(msg)
      toastRef.current.error(msg)
    }
  }, [isSuper])
  useEffect(() => {
    // Never keep another city's values on screen while this city loads (or fails to load).
    setLoadedSettings(null)
    setSettingsError('')
    setConfirmEnable(false)
    if (!settingsCity) return undefined
    const signal = { cancelled: false }
    loadSettings(settingsCity, signal)
    return () => { signal.cancelled = true }
  }, [settingsCity, loadSettings])

  useEffect(() => { setReassigning(null); setConfirmUnavailable(null) }, [cityId])

  // One request at a time; refetch after every success; show the server's message on failure.
  const run = async (fn, okMsg) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
      toastRef.current.success(okMsg)
      await refetch()
      return true
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Action failed'))
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const saveProfile = (row, patch) => {
    const problem = validateProfilePatch(patch)
    if (problem) { toastRef.current.error(problem); return Promise.resolve(false) }
    return run(() => api.put(`/booking-guarantee/exec/profiles/${row.admin_id}`, buildProfileBody(patch)), 'Executive updated')
  }
  const toggleAvailability = (x) => {
    if (x.available) { setConfirmUnavailable(x); return }
    saveProfile(x, { available: true })
  }
  const confirmMarkUnavailable = async () => {
    const x = confirmUnavailable
    if (!x) return
    await saveProfile(x, { available: false })
    setConfirmUnavailable(null)
  }

  const submitReassign = async () => {
    const problem = validateReassign({ target: effectiveTarget, reason })
    if (problem) { toastRef.current.error(problem); return }
    const ok = await run(
      () => api.post(`/booking-guarantee/exec/cases/${reassigning.order_id}/reassign`, buildReassignBody({ target: effectiveTarget, reason })),
      'Case reassigned',
    )
    if (ok) { setReassigning(null); setTarget(''); setReason('') }
  }

  const doSaveSettings = async () => {
    // Capture the city and values at click time; a later city switch must not change what is sent.
    const savingCity = settingsCity
    if (!loadedSettings || loadedSettings.city !== savingCity) return
    const body = buildSettingsBody(loadedSettings.form, isSuper ? savingCity : undefined)
    const ok = await run(async () => {
      const res = await api.put('/booking-guarantee/exec/settings', body)
      if (settingsCityRef.current !== savingCity) return // switched city meanwhile: drop this response
      setLoadedSettings({ city: savingCity, settings: res.data?.data, form: settingsToForm(res.data?.data) })
    }, 'Settings saved')
    if (ok && settingsCityRef.current === savingCity) setConfirmEnable(false)
  }
  const saveSettings = () => {
    if (isSuper && !settingsCity) { toastRef.current.error('Select a city first'); return }
    if (!form || loadedSettings.city !== settingsCity) return
    const problem = validateSettings(form)
    if (problem) { toastRef.current.error(problem); return }
    if (form.exec_queue_enabled && !loadedSettings.settings?.exec_queue_enabled) { setConfirmEnable(true); return }
    doSaveSettings()
  }

  // Hide rows fetched for a previously selected city until the new city's data arrives.
  const view = data && data.city === String(isSuper ? cityId : '') ? data : null
  const r = view?.report
  const exec = view?.workload ?? []
  const queue = view?.queue ?? []
  const form = loadedSettings && loadedSettings.city === settingsCity ? loadedSettings.form : null
  const setField = (k) => (e) => {
    const city = settingsCity
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setConfirmEnable(false)
    setLoadedSettings((cur) => (cur && cur.city === city ? { ...cur, form: { ...cur.form, [k]: value } } : cur))
  }
  const targetOptions = exec.filter((x) => x.available && x.active_account)
  // A selected executive that dropped out of the option list after a refetch falls back to automatic.
  const effectiveTarget = targetOptions.some((x) => String(x.admin_id) === String(target)) ? target : ''
  const canSaveSettings = !busy && Boolean(form) && (!isSuper || Boolean(settingsCity))

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Users size={20} style={{ color: 'var(--brand)' }} />
        <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>Guarantee Queue &amp; Workload</h1>
        {isSuper && (
          <select aria-label="City" value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass} style={{ ...inputStyle, width: 220 }}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title || c.name || `City ${c.id}`}</option>)}
          </select>
        )}
      </div>

      {loading && !view && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}
      {error && <div className="text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Cases (24 h)" value={r.total} />
            <Kpi label="Unassigned now" value={r.unassigned_now} tone="danger" />
            <Kpi label="Resolved" value={r.resolved} />
            <Kpi label="Expired" value={r.expired} tone="danger" />
            <Kpi label="Auto-assigned" value={r.auto_assigned} />
            <Kpi label="Reassigned" value={r.reassigned_cases} />
            <Kpi label="Avg first action (s)" value={r.avg_seconds_to_first_action} />
            <Kpi label="Cancelled" value={r.cancelled} />
          </div>
          <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            Expired cases by cause: no executive was ever assigned <b>{r.failure_breakdown?.expired_no_owner ?? 0}</b> · executive never acted <b>{r.failure_breakdown?.expired_owner_no_action ?? 0}</b> · executive acted but no driver was found <b>{r.failure_breakdown?.expired_owner_acted ?? 0}</b>. An expiry alone is not a performance finding.
          </div>
        </>
      )}

      <section className="grid gap-2">
        <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Cases in the queue</div>
        {queue.length === 0 && !loading && view && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>No cases in the executive queue.</div>}
        {queue.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-[13px]" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
            <span className="font-mono-data font-bold">#{c.order_id}</span>
            <Badge tone={c.status === 'open' ? (STATE_TONE[c.queue_state] ?? 'neutral') : 'neutral'}>{c.status === 'open' ? c.queue_state : c.status}</Badge>
            <span style={{ color: 'var(--ink-muted)' }}>{c.owner_admin_id ? `Owner: ${c.owner_name || c.owner_username || c.owner_admin_id}` : (REASON[c.unassigned_reason] ?? 'Unassigned')}</span>
            {c.status === 'open' && <span className="ml-auto">Left <GuaranteeCountdown deadline={c.deadline_at} /></span>}
            <span style={{ color: 'var(--ink-faint)' }}>{c.first_action_at ? `first action ${formatDateTime(c.first_action_at)}` : 'no action yet'}</span>
            {c.status === 'open' && (
              <button type="button" disabled={busy} onClick={() => { setReassigning({ order_id: c.order_id }); setTarget(''); setReason('') }} className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Reassign</button>
            )}
          </div>
        ))}
        {reassigning && (
          <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
            <div className="text-[13px]" style={{ color: 'var(--ink)' }}>Reassign order #{reassigning.order_id}. The customer's deadline does not change and the executive's capacity limit applies.</div>
            <select aria-label="Target executive" value={effectiveTarget} onChange={(e) => setTarget(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">Automatic (best available executive)</option>
              {targetOptions.map((x) => <option key={x.admin_id} value={x.admin_id}>{x.name} ({x.active}/{x.effective_capacity})</option>)}
            </select>
            <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX_LENGTH} placeholder="Reason (required)" className={inputClass} style={inputStyle} />
            <div className="flex gap-2">
              <button type="button" disabled={busy || !reason.trim()} onClick={submitReassign} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Confirm reassign</button>
              <button type="button" disabled={busy} onClick={() => setReassigning(null)} className="rounded-lg border px-3 py-2 text-[13px] disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Executives</div>
        {exec.map((x) => (
          <div key={x.admin_id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-[13px]" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
            <span className="font-semibold">{x.name}</span>
            {!x.active_account && <Badge tone="danger">Inactive account</Badge>}
            <Badge tone={x.available ? 'success' : 'neutral'}>{x.available ? 'Available' : 'Unavailable'}</Badge>
            <span>Load {x.active}/{x.effective_capacity}</span>
            <span style={{ color: 'var(--ink-faint)' }}>escalated {x.escalated} · resolved {x.resolved} · of {x.owned_total} owned · moved away {x.reassigned_away}</span>
            <span className="ml-auto flex items-center gap-2">
              <input
                key={`${x.admin_id}-${x.capacity ?? ''}`}
                aria-label={`Capacity for ${x.name}`}
                type="number" min="1" max="200" step="1" disabled={busy}
                defaultValue={x.capacity ?? ''} placeholder={`cap ${x.effective_capacity}`}
                className={`${inputClass} w-24`} style={inputStyle}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (e.target.validity?.badInput) {
                    toastRef.current.error('Capacity must be a whole number from 1 to 200')
                    e.target.value = x.capacity ?? ''
                    return
                  }
                  if (String(x.capacity ?? '') === v) return
                  saveProfile(x, { capacity: v }).then((ok) => { if (!ok) e.target.value = x.capacity ?? '' })
                }}
              />
              <button type="button" disabled={busy} onClick={() => toggleAvailability(x)} className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>
                {x.available ? 'Mark unavailable' : 'Mark available'}
              </button>
            </span>
            {confirmUnavailable?.admin_id === x.admin_id && (
              <div className="w-full">
                <ConfirmBox busy={busy} confirmLabel="Mark unavailable" onConfirm={confirmMarkUnavailable} onCancel={() => setConfirmUnavailable(null)}>
                  Mark <b>{x.name}</b> unavailable? Their active cases ({x.active}) will be handed over to other executives right away.
                </ConfirmBox>
              </div>
            )}
          </div>
        ))}
        {exec.length === 0 && !loading && view && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>No executives in scope.</div>}
      </section>

      <section className="grid gap-2 rounded-2xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Executive queue settings (this city)</div>
        {isSuper && !settingsCity && <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Select a city above to view and change its queue settings.</div>}
        {settingsError && !form && <div className="text-[12px]" style={{ color: 'var(--danger)' }}>{settingsError}</div>}
        {form && (
          <>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" disabled={busy} checked={form.exec_queue_enabled} onChange={setField('exec_queue_enabled')} />
              Executive queue active (OFF keeps today's behaviour: any admin may assign)
            </label>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" disabled={busy} checked={form.guarantee_recover_on_cancel} onChange={setField('guarantee_recover_on_cancel')} />
              Recover orders when an assigned driver cancels before pickup (OFF keeps today's behaviour: the cancel is final)
            </label>
            {SETTING_FIELDS.map(([k, label]) => (
              <label key={k} className="grid gap-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{label}
                <input type="number" min="1" step="1" disabled={busy} value={form[k]} onChange={setField(k)} className={inputClass} style={inputStyle} />
              </label>
            ))}
            {confirmEnable && (
              <ConfirmBox busy={busy} confirmLabel="Enable and save" onConfirm={doSaveSettings} onCancel={() => setConfirmEnable(false)}>
                Turning the executive queue on changes who may assign guarantee cases in this city: only the executive who owns a case (and managers) will be able to act on it.
              </ConfirmBox>
            )}
            <button type="button" disabled={!canSaveSettings} onClick={saveSettings} className="w-fit rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Save settings</button>
          </>
        )}
      </section>
    </div>
  )
}
