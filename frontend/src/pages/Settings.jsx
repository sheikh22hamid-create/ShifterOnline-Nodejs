import { useCallback, useState } from 'react'
import { Save, ExternalLink, PlayCircle, Plus, Trash2, AlertTriangle } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

function Label({ children, htmlFor }) {
  return (
    <label className="mb-1.5 block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor={htmlFor}>
      {children}
    </label>
  )
}

function Input(props) {
  return <input {...props} className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none" style={FIELD_STYLE} />
}

function Textarea(props) {
  return <textarea {...props} className="w-full rounded-lg border px-2.5 py-1.5 text-[12px] font-mono outline-none resize-y" style={FIELD_STYLE} />
}

function Section({ title, children }) {
  return (
    <section className="surface-card rounded-xl p-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </section>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const SETTING_FIELDS = [
  'currency', 'd_title', 'd_s_title', 'timezone', 'service_charge', 'rider_commission', 'admin_earning', 'driver_pay',
  'drive_cancellation', 'user_cancellation', 'reject_timer', 'refer_amount',
  // Legacy pre-migration pricing columns - not read by the current pricing
  // engine (Rate Cards / distance slabs handle live fares now), but they're
  // real columns on the `setting` table with no other way to view/edit them.
  'bkms', 'bprice', 'abprice', 'ukms', 'utprice', 'afprice', 'itemlimit', 'itemkg', 'mile_charge', 'kilo_limit', 'is_wether_bad',
]

// Keys already surfaced by a dedicated section above - excluded from the
// generic "Other Feature Flags" editor so they don't show twice.
const HANDLED_FLAG_KEYS = [
  'training_video_url',
  'training_video_title',
  'acko_session_cookie',
  'sarathi_state_id',
  'vehicle_detail_notes',
  'auto_verification',
  'auto_verification_charge',
  'auto_verification_charge_old',
  'auto_verification_msg',
  'manual_registration',
  'customer_care_number',
  'customer_care_email',
  'customer_care_hours',
  'driver_min_withdrawal_amount',
  'driver_max_due_limit',
  'model1_miss_limit',
  'model1_suspension_hours',
  'covered_body_charge',
  'half_body_charge',
  'pickup_otp_timeout_minutes',
  'pickup_relocate_ceiling_minutes',
  'pickup_small_move_threshold_m',
  'pickup_otp_mismatch_flag_m',
  'pickup_timeout_driver_compensation',
  'pickup_complete_auto_distance_m',
  'pickup_timer_auto_pause_distance_m',
  'pickup_eta_buffer_minutes',
  'pickup_eta_geofence_m',
  'pickup_eta_auto_cancel_enabled',
  'max_extra_stops',
  'customer_wallet_max_topup',
  'scheduled_confirm_popup_minutes',
  'max_blocked_drivers_per_user',
  'extra_stop_charge',
  'settlement_enabled',
  'settlement_reminder_minutes',
  'settlement_escalate_after_minutes',
  'settlement_driver_block_grace_minutes',
  'settlement_dispute_window_hours',
]

function PaymentGateways() {
  const fetcher = useCallback(() => api.get('/settings/payment-gateways').then((res) => res.data.data), [])
  const { data: gateways, loading } = useApiQuery(fetcher)

  return (
    <section className="surface-card rounded-xl p-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        Payment gateways
      </h3>
      {loading ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          Loading…
        </p>
      ) : gateways?.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No payment gateways configured yet.
        </p>
      ) : (
        <div className="space-y-2">
          {gateways?.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <span>{g.title}</span>
              <span style={{ color: g.status === 1 ? 'var(--success)' : 'var(--ink-faint)' }}>{g.status === 1 ? 'Active' : 'Inactive'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Model1SuspendedDrivers() {
  const toast = useToast()
  const fetcher = useCallback(() => api.get('/riders/model1-suspended').then((res) => res.data.data), [])
  const { data: drivers, loading, refetch } = useApiQuery(fetcher)
  const [unsuspendingId, setUnsuspendingId] = useState(null)

  async function handleUnsuspend(id) {
    setUnsuspendingId(id)
    try {
      await api.patch(`/riders/${id}/model1-unsuspend`)
      toast.success('Model 1 suspension removed.')
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove suspension.')
    } finally {
      setUnsuspendingId(null)
    }
  }

  return (
    <section className="surface-card rounded-xl p-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        Drivers suspended from Model 1
      </h3>
      {loading ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          Loading…
        </p>
      ) : drivers?.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No drivers are currently suspended from Model 1.
        </p>
      ) : (
        <div className="space-y-2">
          {drivers?.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="font-medium">{d.full_name || `Driver #${d.id}`}</div>
                <div className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                  {d.fmobile}{d.city_name ? ` · ${d.city_name}` : ''} · Suspended until {new Date(d.model1_suspended_until).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                disabled={unsuspendingId === d.id}
                onClick={() => handleUnsuspend(d.id)}
                className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                {unsuspendingId === d.id ? 'Removing…' : 'Remove suspension'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Only mounted once `data` exists, so form/flags can initialize straight
// from props via useState's lazy initializer — no effect needed to "sync"
// them, since there's nothing to sync on a component that doesn't outlive
// the data it was seeded with.
function SettingsForm({ data, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => Object.fromEntries(SETTING_FIELDS.map((k) => [k, data[k] ?? ''])))
  const [flags, setFlags] = useState(() => data.flags ?? {})
  const [paymentMethods, setPaymentMethods] = useState(() => ({
    payment_cod: data.payment_cod,
    payment_wallet: data.payment_wallet,
    payment_online: data.payment_online,
  }))
  const [saving, setSaving] = useState(false)
  const [newFlagKey, setNewFlagKey] = useState('')
  const [newFlagValue, setNewFlagValue] = useState('')
  const [deletingFlagKey, setDeletingFlagKey] = useState(null)

  function handleAddFlag(e) {
    if (e && e.preventDefault) e.preventDefault()
    const key = newFlagKey.trim().toLowerCase().replace(/\s+/g, '_')
    if (!key) return
    if (key in flags) {
      toast.error(`"${key}" already exists below.`)
      return
    }
    setFlags((f) => ({ ...f, [key]: newFlagValue }))
    setNewFlagKey('')
    setNewFlagValue('')
    toast.success(`Added "${key}" — click Save to persist it.`)
  }

  async function handleDeleteFlag(key) {
    // A key added locally but never saved yet doesn't exist in the DB -
    // just drop it from state instead of calling an API that would 404.
    if (!(key in (data.flags ?? {}))) {
      setFlags((f) => {
        const next = { ...f }
        delete next[key]
        return next
      })
      return
    }
    setDeletingFlagKey(key)
    try {
      await api.delete(`/settings/flags/${encodeURIComponent(key)}`)
      setFlags((f) => {
        const next = { ...f }
        delete next[key]
        return next
      })
      toast.success(`Deleted "${key}".`)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this setting.')
    } finally {
      setDeletingFlagKey(null)
    }
  }

  async function handleSave(e, overridePayload) {
    if (e && e.preventDefault) e.preventDefault()
    setSaving(true)
    try {
      const payload = overridePayload || { ...form, ...paymentMethods, flags }
      await api.put('/settings', payload)
      toast.success('Settings saved.')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        handleSave(e)
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Settings
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Platform configuration. Press <kbd className="rounded border px-1 py-0.5 font-mono text-[11px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}>Enter</kbd> in any field to save immediately.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <Section title="Branding">
          <div>
            <Label htmlFor="d_title">Platform name</Label>
            <Input id="d_title" value={form.d_title} onChange={(e) => setForm((f) => ({ ...f, d_title: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="d_s_title">Short name</Label>
            <Input id="d_s_title" value={form.d_s_title} onChange={(e) => setForm((f) => ({ ...f, d_s_title: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="currency">Currency symbol</Label>
            <Input id="currency" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
          </div>
        </Section>

        <Section title="Customer Care & Support">
          <div>
            <Label htmlFor="customer_care_number">Helpline / Support Phone Number</Label>
            <Input
              id="customer_care_number"
              placeholder="+91 9109114515"
              value={flags.customer_care_number ?? ''}
              onChange={(e) => setFlags((f) => ({ ...f, customer_care_number: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Displayed in Customer &amp; Driver apps. Tapping initiates a direct phone call.
            </p>
          </div>
          <div>
            <Label htmlFor="customer_care_email">Support Email (Optional)</Label>
            <Input
              id="customer_care_email"
              placeholder="support@shifteronline.com"
              value={flags.customer_care_email ?? ''}
              onChange={(e) => setFlags((f) => ({ ...f, customer_care_email: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="customer_care_hours">Operating Hours (Optional)</Label>
            <Input
              id="customer_care_hours"
              placeholder="24/7 Helpline"
              value={flags.customer_care_hours ?? ''}
              onChange={(e) => setFlags((f) => ({ ...f, customer_care_hours: e.target.value }))}
            />
          </div>
        </Section>

        <Section title="Commission & driver pay">
          <div>
            <Label htmlFor="service_charge">Service charge (%)</Label>
            <Input id="service_charge" type="number" value={form.service_charge} onChange={(e) => setForm((f) => ({ ...f, service_charge: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="rider_commission">Rider commission (%)</Label>
            <Input id="rider_commission" type="number" value={form.rider_commission} onChange={(e) => setForm((f) => ({ ...f, rider_commission: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="admin_earning">Admin earning</Label>
            <Input id="admin_earning" type="number" value={form.admin_earning} onChange={(e) => setForm((f) => ({ ...f, admin_earning: e.target.value }))} />
          </div>
        </Section>

        <Section title="Cancellation & timers">
          <div>
            <Label htmlFor="drive_cancellation">Driver cancellation fee</Label>
            <Input id="drive_cancellation" type="number" value={form.drive_cancellation} onChange={(e) => setForm((f) => ({ ...f, drive_cancellation: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="user_cancellation">Customer cancellation fee</Label>
            <Input id="user_cancellation" type="number" value={form.user_cancellation} onChange={(e) => setForm((f) => ({ ...f, user_cancellation: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="reject_timer">Dispatch reject timer (sec)</Label>
            <Input id="reject_timer" type="number" value={form.reject_timer} onChange={(e) => setForm((f) => ({ ...f, reject_timer: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="flag-pickup_otp_timeout_minutes">Pickup OTP timeout (min)</Label>
            <Input
              id="flag-pickup_otp_timeout_minutes"
              type="number"
              min="1"
              placeholder="e.g. 10"
              value={flags.pickup_otp_timeout_minutes ?? '7'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_otp_timeout_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              If the customer doesn't hand over the pickup OTP within this many minutes of the driver arriving, the ride auto-cancels from the customer's side.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_relocate_ceiling_minutes">Pickup relocation ceiling (min)</Label>
            <Input
              id="flag-pickup_relocate_ceiling_minutes"
              type="number"
              min="1"
              placeholder="e.g. 35"
              value={flags.pickup_relocate_ceiling_minutes ?? '35'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_relocate_ceiling_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              However many times a pickup change pauses/resumes the OTP timer, the order is force-resolved once this many minutes have passed since the driver's first arrival.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_small_move_threshold_m">Pickup small-move threshold (m)</Label>
            <Input
              id="flag-pickup_small_move_threshold_m"
              type="number"
              min="1"
              placeholder="e.g. 200"
              value={flags.pickup_small_move_threshold_m ?? '200'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_small_move_threshold_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              A pickup-location change within this distance keeps the OTP timer running as-is; beyond it, the timer pauses until the driver reaches the new point.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_otp_mismatch_flag_m">OTP-location mismatch flag distance (m)</Label>
            <Input
              id="flag-pickup_otp_mismatch_flag_m"
              type="number"
              min="1"
              placeholder="e.g. 500"
              value={flags.pickup_otp_mismatch_flag_m ?? '500'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_otp_mismatch_flag_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              If the driver verifies the OTP this far from the last confirmed pickup point, the trip re-prices against where the OTP was actually verified and is flagged for review.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_timeout_driver_compensation">Driver OTP-timeout compensation (₹)</Label>
            <Input
              id="flag-pickup_timeout_driver_compensation"
              type="number"
              min="0"
              placeholder="e.g. 0"
              value={flags.pickup_timeout_driver_compensation ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_timeout_driver_compensation: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Paid to the driver's wallet if an order auto-cancels because the customer never handed over the OTP. Set to 0 to pay nothing (today's behavior).
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_complete_auto_distance_m">Pickup-complete auto-trigger distance (m)</Label>
            <Input
              id="flag-pickup_complete_auto_distance_m"
              type="number"
              min="1"
              placeholder="e.g. 150"
              value={flags.pickup_complete_auto_distance_m ?? '150'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_complete_auto_distance_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              If the driver verifies the OTP but never taps "Pickup Complete", leaving the pickup point by this much automatically marks the pickup complete and starts the trip.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_timer_auto_pause_distance_m">Pickup OTP timer auto-pause distance (m)</Label>
            <Input
              id="flag-pickup_timer_auto_pause_distance_m"
              type="number"
              min="1"
              placeholder="e.g. 500"
              value={flags.pickup_timer_auto_pause_distance_m ?? '500'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_timer_auto_pause_distance_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              While waiting for the pickup OTP, if the driver moves this far from the pickup point the auto-cancel timer pauses by itself (they are heading to a new pickup spot). Drivers can also pause it manually from the OTP screen.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_eta_buffer_minutes">Pickup ETA buffer (min)</Label>
            <Input
              id="flag-pickup_eta_buffer_minutes"
              type="number"
              min="0"
              placeholder="e.g. 10"
              value={flags.pickup_eta_buffer_minutes ?? '10'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_eta_buffer_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              After a driver accepts, the customer sees Google's driver-to-pickup travel time plus this buffer (Google 20 min + 10 min buffer = 30 min ETA). That moment is also the driver's deadline to reach the pickup.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_eta_geofence_m">Pickup ETA geofence radius (m)</Label>
            <Input
              id="flag-pickup_eta_geofence_m"
              type="number"
              min="1"
              placeholder="e.g. 200"
              value={flags.pickup_eta_geofence_m ?? '200'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_eta_geofence_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              A driver who is inside this radius of the pickup when the ETA deadline passes is not auto-cancelled.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_eta_auto_cancel_enabled">Auto-cancel when driver misses the ETA</Label>
            <select
              id="flag-pickup_eta_auto_cancel_enabled"
              className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}
              value={flags.pickup_eta_auto_cancel_enabled ?? '1'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_eta_auto_cancel_enabled: e.target.value }))}
            >
              <option value="1">Enabled</option>
              <option value="0">Disabled</option>
            </select>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              When enabled, an order whose driver has not reached the pickup by the deadline is cancelled on the driver's side and the package's driver cancellation charge is applied.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-driver_min_withdrawal_amount">Driver minimum withdrawal amount (₹)</Label>
            <Input
              id="flag-driver_min_withdrawal_amount"
              type="number"
              min="0"
              placeholder="e.g. 500"
              value={flags.driver_min_withdrawal_amount ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, driver_min_withdrawal_amount: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              This amount always stays in the driver's ledger - they can only withdraw the balance above it (e.g. ₹20 balance with a ₹10 minimum lets them withdraw up to ₹10). Set to 0 to allow withdrawing the full balance.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-driver_max_due_limit">Driver maximum due limit (₹)</Label>
            <Input
              id="flag-driver_max_due_limit"
              type="number"
              min="0"
              placeholder="e.g. 100"
              value={flags.driver_max_due_limit ?? '100'}
              onChange={(e) => setFlags((f) => ({ ...f, driver_max_due_limit: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Maximum negative wallet balance allowed for a driver before they are blocked from receiving new ride offers (Default: 100).
            </p>
          </div>
        </Section>

        <Section title="Customer Safety">
          <div>
            <Label htmlFor="flag-max_blocked_drivers_per_user">Maximum drivers a customer can block</Label>
            <Input
              id="flag-max_blocked_drivers_per_user"
              type="number"
              min="0"
              placeholder="e.g. 3"
              value={flags.max_blocked_drivers_per_user ?? '3'}
              onChange={(e) => setFlags((f) => ({ ...f, max_blocked_drivers_per_user: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              A blocked driver is never offered that customer's orders. Set to 0 to turn blocking off (Default: 3).
            </p>
          </div>
        </Section>

        <Section title="Scheduled Rides">
          <div>
            <Label htmlFor="flag-scheduled_confirm_popup_minutes">Confirmation popup lead time (minutes)</Label>
            <Input
              id="flag-scheduled_confirm_popup_minutes"
              type="number"
              min="1"
              placeholder="e.g. 30"
              value={flags.scheduled_confirm_popup_minutes ?? '30'}
              onChange={(e) => setFlags((f) => ({ ...f, scheduled_confirm_popup_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              This many minutes before the scheduled time, the customer is asked "Do you still want to continue with this scheduled ride?" (Continue / Cancel). Cancelling also removes the booking from drivers who had pre-accepted it. The order always goes LIVE exactly at the selected time (Default: 30).
            </p>
          </div>
        </Section>

        <Section title="Customer Ledger (Wallet)">
          <div>
            <Label htmlFor="flag-customer_wallet_max_topup">Maximum amount per add-money (₹)</Label>
            <Input
              id="flag-customer_wallet_max_topup"
              type="number"
              min="1"
              placeholder="e.g. 50000"
              value={flags.customer_wallet_max_topup ?? '50000'}
              onChange={(e) => setFlags((f) => ({ ...f, customer_wallet_max_topup: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Highest amount a customer can add to their ledger in a single transaction (Default: 50000).
            </p>
          </div>
        </Section>

        <Section title="Trip Payment Settlement">
          <div className="col-span-2 sm:col-span-3">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[12px] text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={15} />
                <span>SECURITY GATE WARNING</span>
              </div>
              <p className="mt-1">
                Customer and driver settlement endpoints currently trust posted uid/rider_id. Real driver/customer authentication on <code>/api/rider/settlement/*</code> and <code>/api/order/settlement/*</code> <strong>MUST</strong> ship before enabling this switch in production.
              </p>
            </div>
          </div>
          <div>
            <Label htmlFor="flag-settlement_enabled">Master Switch (settlement_enabled)</Label>
            <select
              id="flag-settlement_enabled"
              className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              value={flags.settlement_enabled ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, settlement_enabled: e.target.value }))}
            >
              <option value="0">Disabled (0 - Legacy flow: completion assumes cash settled)</option>
              <option value="1">Enabled (1 - Active settlement flow with confirmation)</option>
            </select>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              When OFF, no settlements are created and completed rides behave byte-for-byte as before.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-settlement_reminder_minutes">Reminder Intervals (minutes)</Label>
            <Input
              id="flag-settlement_reminder_minutes"
              type="text"
              placeholder="10,30"
              value={flags.settlement_reminder_minutes ?? '10,30'}
              onChange={(e) => setFlags((f) => ({ ...f, settlement_reminder_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Comma-separated list of minutes after ride completion when push reminders are sent to customer and driver (Default: 10,30).
            </p>
          </div>
          <div>
            <Label htmlFor="flag-settlement_escalate_after_minutes">Escalate After (minutes)</Label>
            <Input
              id="flag-settlement_escalate_after_minutes"
              type="number"
              min="1"
              placeholder="60"
              value={flags.settlement_escalate_after_minutes ?? '60'}
              onChange={(e) => setFlags((f) => ({ ...f, settlement_escalate_after_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Pending settlements older than this threshold are flagged into the admin &quot;Unsettled&quot; queue (Default: 60).
            </p>
          </div>
          <div>
            <Label htmlFor="flag-settlement_driver_block_grace_minutes">Driver Block Grace (minutes)</Label>
            <Input
              id="flag-settlement_driver_block_grace_minutes"
              type="number"
              min="1"
              placeholder="10"
              value={flags.settlement_driver_block_grace_minutes ?? '10'}
              onChange={(e) => setFlags((f) => ({ ...f, settlement_driver_block_grace_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              A driver with a pending settlement older than this grace period stops receiving new order offers (Default: 10).
            </p>
          </div>
          <div>
            <Label htmlFor="flag-settlement_dispute_window_hours">Customer Dispute Window (hours)</Label>
            <Input
              id="flag-settlement_dispute_window_hours"
              type="number"
              min="1"
              placeholder="48"
              value={flags.settlement_dispute_window_hours ?? '48'}
              onChange={(e) => setFlags((f) => ({ ...f, settlement_dispute_window_hours: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Number of hours after driver confirmation during which the customer can report a problem / dispute (Default: 48).
            </p>
          </div>
        </Section>

        <Section title="Vehicle & Body Type Surcharges">
          <div className="space-y-4">
            <div>
              <Label htmlFor="flag-covered_body_charge">Covered Body Surcharge (₹)</Label>
              <Input
                id="flag-covered_body_charge"
                type="number"
                min="0"
                placeholder="e.g. 50"
                value={flags.covered_body_charge ?? '0'}
                onChange={(e) => setFlags((f) => ({ ...f, covered_body_charge: e.target.value }))}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Extra charge added to customer fare when customer books a Covered Body (closed container or tarpaulin) vehicle for commercial transport (E-loader, 3 Wheeler, Tata Ace, etc.).
              </p>
            </div>
            <div>
              <Label htmlFor="flag-half_body_charge">Half Body Surcharge (₹)</Label>
              <Input
                id="flag-half_body_charge"
                type="number"
                min="0"
                placeholder="e.g. 25"
                value={flags.half_body_charge ?? '0'}
                onChange={(e) => setFlags((f) => ({ ...f, half_body_charge: e.target.value }))}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Extra charge added to customer fare when customer books a Half Body (Half Dala) vehicle for commercial transport.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Multi-Stop / Extra Stops (Add Stop)">
          <div>
            <Label htmlFor="flag-max_extra_stops">Maximum Extra Stops</Label>
            <Input
              id="flag-max_extra_stops"
              type="number"
              min="0"
              placeholder="e.g. 5"
              value={flags.max_extra_stops ?? '2'}
              onChange={(e) => setFlags((f) => ({ ...f, max_extra_stops: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Maximum number of extra drop points a customer can add during booking in the app.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-extra_stop_charge">Extra Stop Charge (₹)</Label>
            <Input
              id="flag-extra_stop_charge"
              type="number"
              min="0"
              placeholder="e.g. 0"
              value={flags.extra_stop_charge ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, extra_stop_charge: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Fixed charge added to the customer fare for each extra stop added.
            </p>
          </div>
        </Section>

        <Section title="Model 1 reliability suspension">
          <div>
            <Label htmlFor="flag-model1_miss_limit">Max Model 1 rides a driver can ignore</Label>
            <Input
              id="flag-model1_miss_limit"
              type="number"
              min="1"
              placeholder="e.g. 5"
              value={flags.model1_miss_limit ?? '5'}
              onChange={(e) => setFlags((f) => ({ ...f, model1_miss_limit: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              After this many Model 1 offers in a row are rejected or timed out, the driver is suspended from Model 1 offers below.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-model1_suspension_hours">Suspension length (hours)</Label>
            <Input
              id="flag-model1_suspension_hours"
              type="number"
              min="1"
              placeholder="e.g. 24"
              value={flags.model1_suspension_hours ?? '24'}
              onChange={(e) => setFlags((f) => ({ ...f, model1_suspension_hours: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              How long a suspended driver stops receiving Model 1 offers before they're automatically eligible again.
            </p>
          </div>
        </Section>

        <Section title="Referral defaults">
          <div>
            <Label htmlFor="refer_amount">Referral reward</Label>
            <Input id="refer_amount" type="number" value={form.refer_amount} onChange={(e) => setForm((f) => ({ ...f, refer_amount: e.target.value }))} />
          </div>
        </Section>

        <section className="surface-card rounded-xl p-4">
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Legacy pricing fields
          </h3>
          <p className="mb-3 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
            Columns kept from the pre-migration pricing model. Live fares now come from Rate Cards & distance slabs — changing
            these has no effect on current pricing, but they're editable here since they're real DB values with no other UI.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="bkms">Bike base KM</Label>
              <Input id="bkms" type="number" value={form.bkms} onChange={(e) => setForm((f) => ({ ...f, bkms: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="bprice">Bike base price</Label>
              <Input id="bprice" type="number" value={form.bprice} onChange={(e) => setForm((f) => ({ ...f, bprice: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="abprice">Auto base price</Label>
              <Input id="abprice" type="number" value={form.abprice} onChange={(e) => setForm((f) => ({ ...f, abprice: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="ukms">User base KM</Label>
              <Input id="ukms" type="number" value={form.ukms} onChange={(e) => setForm((f) => ({ ...f, ukms: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="utprice">User trip price</Label>
              <Input id="utprice" type="number" value={form.utprice} onChange={(e) => setForm((f) => ({ ...f, utprice: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="afprice">Additional fare price</Label>
              <Input id="afprice" type="number" value={form.afprice} onChange={(e) => setForm((f) => ({ ...f, afprice: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="itemlimit">Item limit</Label>
              <Input id="itemlimit" type="number" value={form.itemlimit} onChange={(e) => setForm((f) => ({ ...f, itemlimit: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="itemkg">Item weight limit (kg)</Label>
              <Input id="itemkg" type="number" value={form.itemkg} onChange={(e) => setForm((f) => ({ ...f, itemkg: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="mile_charge">Per-mile charge</Label>
              <Input id="mile_charge" type="number" value={form.mile_charge} onChange={(e) => setForm((f) => ({ ...f, mile_charge: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="kilo_limit">KM limit</Label>
              <Input id="kilo_limit" type="number" value={form.kilo_limit} onChange={(e) => setForm((f) => ({ ...f, kilo_limit: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="is_wether_bad">Bad weather surcharge flag</Label>
              <select
                id="is_wether_bad"
                value={form.is_wether_bad || '0'}
                onChange={(e) => setForm((f) => ({ ...f, is_wether_bad: e.target.value }))}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
                style={FIELD_STYLE}
              >
                <option value="0">Off</option>
                <option value="1">On</option>
              </select>
            </div>
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Payment methods
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <Toggle label="Cash on delivery" checked={paymentMethods.payment_cod === 1} onChange={(v) => setPaymentMethods((p) => ({ ...p, payment_cod: v ? 1 : 0 }))} />
            <Toggle label="Wallet" checked={paymentMethods.payment_wallet === 1} onChange={(v) => setPaymentMethods((p) => ({ ...p, payment_wallet: v ? 1 : 0 }))} />
            <Toggle label="Online payment" checked={paymentMethods.payment_online === 1} onChange={(v) => setPaymentMethods((p) => ({ ...p, payment_online: v ? 1 : 0 }))} />
          </div>
        </section>

        {/* ── Driver Verification Payment ── */}
        <section className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Driver Verification Payment
              </h3>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                One-time eKYC verification fee charged to drivers during registration. Set to 0 to make it free.
              </p>
            </div>
            {Number(flags.auto_verification ?? 0) === 1 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                ● Auto KYC Enabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-faint)' }}>
                ○ Auto KYC Disabled
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {/* Toggle */}
              <Toggle
                label="Enable Automatic eKYC Verification"
                checked={Number(flags.auto_verification ?? 0) === 1}
                onChange={(v) => setFlags((f) => ({ ...f, auto_verification: v ? '1' : '0' }))}
              />

              {/* Charge */}
              <div>
                <Label htmlFor="flag-auto_verification_charge">Verification Charge (₹)</Label>
                <Input
                  id="flag-auto_verification_charge"
                  type="number"
                  min="0"
                  placeholder="e.g. 99  (set 0 for free)"
                  value={flags.auto_verification_charge ?? '0'}
                  onChange={(e) => setFlags((f) => ({ ...f, auto_verification_charge: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Amount driver pays via Razorpay. Set to <strong>0</strong> to skip payment screen entirely.
                </p>
              </div>

              {/* Old / strikethrough price */}
              <div>
                <Label htmlFor="flag-auto_verification_charge_old">Original Price — Strikethrough (₹)</Label>
                <Input
                  id="flag-auto_verification_charge_old"
                  type="number"
                  min="0"
                  placeholder="e.g. 199  (set 0 to hide)"
                  value={flags.auto_verification_charge_old ?? '0'}
                  onChange={(e) => setFlags((f) => ({ ...f, auto_verification_charge_old: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Shown with a strikethrough above the actual charge (like a discount display). Leave 0 to hide.
                </p>
              </div>

              {/* Message */}
              <div>
                <Label htmlFor="flag-auto_verification_msg">Payment Screen Message (optional)</Label>
                <Input
                  id="flag-auto_verification_msg"
                  placeholder="e.g. Limited time offer — get verified at just ₹99!"
                  value={flags.auto_verification_msg ?? ''}
                  onChange={(e) => setFlags((f) => ({ ...f, auto_verification_msg: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Optional promo text shown below the price on the driver's payment screen. Leave blank to hide.
                </p>
              </div>
            </div>

            {/* Live preview */}
            <div className="flex flex-col justify-center rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[11.5px] font-medium mb-3" style={{ color: 'var(--ink-muted)' }}>Live Preview — Driver Payment Screen</div>
              <div className="rounded-xl border p-4 space-y-2 text-center" style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}>
                <div className="text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>Complete Verification Payment</div>
                {Number(flags.auto_verification_charge_old ?? 0) > 0 && (
                  <div className="text-[13px] line-through" style={{ color: 'var(--ink-faint)' }}>₹{flags.auto_verification_charge_old}</div>
                )}
                <div className="text-[28px] font-bold" style={{ color: 'var(--success)' }}>
                  ₹{flags.auto_verification_charge ?? '0'}
                </div>
                {flags.auto_verification_msg?.trim() && (
                  <div className="text-[11px] italic" style={{ color: 'var(--brand)' }}>{flags.auto_verification_msg}</div>
                )}
                <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
                  {Number(flags.auto_verification_charge ?? 0) === 0 ? 'Proceed (Free)' : `Pay ₹${flags.auto_verification_charge} via Razorpay`}
                </div>
              </div>
              {Number(flags.auto_verification_charge ?? 0) === 0 && (
                <p className="mt-2 text-[11px] text-center" style={{ color: 'var(--success)' }}>✓ Payment screen will be skipped — driver goes directly to Home.</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              disabled={saving}
              onClick={(e) => handleSave(e, { flags })}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save Verification Settings'}
            </button>
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Driver Training Video (Mandatory Onboarding Gate)
              </h3>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                Configure the mandatory orientation video that drivers must watch in the Driver App before accessing the Home screen.
              </p>
            </div>
            {flags.training_video_url?.trim() ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                ● Gate Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-faint)' }}>
                ○ Gate Disabled (Optional)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="training_video_title">Video Title</Label>
                <Input
                  id="training_video_title"
                  placeholder="e.g. Shifter Partner Onboarding & Safety Training"
                  value={flags.training_video_title ?? ''}
                  onChange={(e) => setFlags((f) => ({ ...f, training_video_title: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="training_video_url">Direct Video URL (MP4 / WebM / CDN Stream)</Label>
                <Input
                  id="training_video_url"
                  placeholder="https://example.com/videos/driver_training.mp4"
                  value={flags.training_video_url ?? ''}
                  onChange={(e) => setFlags((f) => ({ ...f, training_video_url: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Leave blank to disable mandatory training and allow drivers to enter the app directly.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setFlags((f) => ({
                      ...f,
                      training_video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
                      training_video_title: 'Shifter Partner Training Video (Sample Demo)',
                    }))
                  }
                  className="rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--border)', color: 'var(--brand)' }}
                >
                  Load Sample Video Link
                </button>
                {flags.training_video_url && (
                  <button
                    type="button"
                    onClick={() =>
                      setFlags((f) => ({
                        ...f,
                        training_video_url: '',
                      }))
                    }
                    className="rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-white/5"
                    style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
                  >
                    Clear URL (Disable Gate)
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-center rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[11.5px] font-medium mb-2" style={{ color: 'var(--ink-muted)' }}>
                Live Video Preview
              </div>
              {flags.training_video_url?.trim() ? (
                <div className="overflow-hidden rounded-md border" style={{ borderColor: 'var(--border)', maxHeight: '200px' }}>
                  <video
                    key={flags.training_video_url}
                    src={flags.training_video_url}
                    controls
                    preload="metadata"
                    className="w-full h-auto max-h-[190px] object-contain bg-black"
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              ) : (
                <div className="flex h-32 flex-col items-center justify-center rounded border border-dashed p-4 text-center text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)' }}>
                  <span>No video URL configured.</span>
                  <span className="text-[11px] mt-0.5">Enter a valid direct video link above to preview.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                User App "How To Use" Tutorial Bar
              </h3>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                Configure the top tutorial button/banner shown on the customer mobile app home screen.
              </p>
            </div>
            {flags.how_to_use_enabled !== '0' && flags.how_to_use_enabled !== false ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                ● Active on App
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-faint)' }}>
                ○ Hidden
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="how_to_use_enabled">Tutorial Bar Status</Label>
                <select
                  id="how_to_use_enabled"
                  value={flags.how_to_use_enabled === '0' || flags.how_to_use_enabled === false ? '0' : '1'}
                  onChange={(e) => setFlags((f) => ({ ...f, how_to_use_enabled: e.target.value }))}
                  className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
                  style={FIELD_STYLE}
                >
                  <option value="1">Enabled (Visible on user app)</option>
                  <option value="0">Disabled (Hidden on user app)</option>
                </select>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Toggle whether the How To Use button appears at the top of the user app home page.
                </p>
              </div>

              <div>
                <Label htmlFor="how_to_use_title">Button Title</Label>
                <Input
                  id="how_to_use_title"
                  placeholder="How To Use"
                  value={flags.how_to_use_title ?? ''}
                  onChange={(e) => setFlags((f) => ({ ...f, how_to_use_title: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Default is "How To Use". You can customize it (e.g. "Watch App Tutorial", "How It Works").
                </p>
              </div>

              <div>
                <Label htmlFor="how_to_use_video_url">Video / Tutorial URL</Label>
                <Input
                  id="how_to_use_video_url"
                  placeholder="https://www.youtube.com/shorts/h7KMfS0IrI8"
                  value={flags.how_to_use_video_url ?? ''}
                  onChange={(e) => setFlags((f) => ({ ...f, how_to_use_video_url: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  YouTube Shorts, YouTube video, or any external link opened when the user clicks the button.
                </p>
              </div>

              <div>
                <Label htmlFor="how_to_use_max_orders">Auto-Hide After Completed Orders (Threshold)</Label>
                <Input
                  id="how_to_use_max_orders"
                  type="number"
                  min="0"
                  placeholder="5"
                  value={flags.how_to_use_max_orders ?? '5'}
                  onChange={(e) => setFlags((f) => ({ ...f, how_to_use_max_orders: e.target.value }))}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Automatically hides the How To Use button if the user has completed <strong>{flags.how_to_use_max_orders ?? '5'}</strong> or more orders. (Set 0 to never auto-hide).
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setFlags((f) => ({
                      ...f,
                      how_to_use_video_url: 'https://www.youtube.com/shorts/h7KMfS0IrI8',
                      how_to_use_title: 'How To Use',
                      how_to_use_enabled: '1',
                    }))
                  }
                  className="rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--border)', color: 'var(--brand)' }}
                >
                  Reset Default YouTube Shorts
                </button>
                {flags.how_to_use_video_url && (
                  <a
                    href={flags.how_to_use_video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-white/5"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  >
                    <ExternalLink size={12} /> Test Link in New Tab
                  </a>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-center rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="text-[11.5px] font-medium mb-3" style={{ color: 'var(--ink-muted)' }}>
                Live Preview — User App Home Screen Bar
              </div>
              {flags.how_to_use_enabled === '0' || flags.how_to_use_enabled === false ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)' }}>
                  Button is currently <strong>Hidden</strong>. It will not be shown on the user app home screen.
                </div>
              ) : (
                <div className="space-y-3">
                  <div
                    className="flex items-center justify-center gap-2.5 rounded-2xl py-3 px-4 shadow-lg cursor-pointer transition-transform hover:scale-[1.01]"
                    style={{
                      backgroundColor: '#FF0000',
                      boxShadow: '0 5px 15px rgba(255, 0, 0, 0.35)',
                    }}
                    onClick={() => {
                      if (flags.how_to_use_video_url) {
                        window.open(flags.how_to_use_video_url, '_blank')
                      }
                    }}
                  >
                    <PlayCircle size={26} color="#ffffff" />
                    <span className="text-[17px] font-bold text-white tracking-wide">
                      {flags.how_to_use_title?.trim() || 'How To Use'}
                    </span>
                  </div>
                  <p className="text-center text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                    Target: <code className="font-mono text-[10.5px]">{flags.how_to_use_video_url || 'https://www.youtube.com/shorts/h7KMfS0IrI8'}</code>
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <div className="mb-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              KYC Verification Session Cookies
            </h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              Used by the Driver App to call Acko (Vehicle RC lookup) and Sarathi Parivahan (Driving Licence lookup) directly from
              the device — deliberately not proxied through this server, so requests come from many driver IPs instead of one,
              which keeps this server from getting rate-limited or blacklisted as scraping traffic. When a lookup starts failing
              with an auth/session error, that provider's cookie below has likely expired — grab a fresh one from a real browser
              session and paste it here. Every app picks up the new value on its next verification attempt, no app release needed.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="flag-acko_session_cookie">Acko session cookie (Vehicle RC lookup)</Label>
              <Textarea
                id="flag-acko_session_cookie"
                rows={3}
                placeholder="trackerid=...; acko_visit=...; __cf_bm=..."
                value={flags.acko_session_cookie ?? ''}
                onChange={(e) => setFlags((f) => ({ ...f, acko_session_cookie: e.target.value }))}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Copy the full Cookie header value from a signed-in browser session on acko.com's vehicle-info lookup page.
              </p>
            </div>

            <div>
              <Label htmlFor="flag-sarathi_state_id">Sarathi Parivahan STATEID cookie (Driving Licence lookup)</Label>
              <Input
                id="flag-sarathi_state_id"
                placeholder="Base64-looking STATEID value"
                value={flags.sarathi_state_id ?? ''}
                onChange={(e) => setFlags((f) => ({ ...f, sarathi_state_id: e.target.value }))}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Rarely needs changing — Sarathi's actual session (JSESSIONID) is established fresh per verification attempt;
                this is a static state-selector value.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              These fields don't save on Enter (multi-line) — use the button.
            </span>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save Cookies'}
            </button>
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <div className="mb-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Vehicle Detail Notes
            </h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              One note per line. Shown as a numbered list on every vehicle category's Details screen in the customer app —
              this text is the same for every vehicle, only its dimensions/max load (set per category above) differ.
            </p>
          </div>
          <Textarea
            id="flag-vehicle_detail_notes"
            rows={5}
            placeholder={"Fare doesn't include labour charges for loading & unloading.\nThe amount shown to you right now is an estimate. The actual amount will be shown based on waiting time or location changes.\nParking charges to be paid by customer.\nFare doesn't include toll and permit charges."}
            value={flags.vehicle_detail_notes ?? ''}
            onChange={(e) => setFlags((f) => ({ ...f, vehicle_detail_notes: e.target.value }))}
          />
          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              Multi-line — use the button, Enter won't save this field.
            </span>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        </section>

        <section className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Other Feature Flags
              </h3>
              <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                Raw key-value config (app_settings table). Add any key the apps read that has no dedicated section above —
                e.g. <code className="font-mono text-[10.5px]">max_extra_stops</code>, <code className="font-mono text-[10.5px]">default_search_radius</code>.
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save Flags'}
            </button>
          </div>

          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <div className="min-w-[160px] flex-1">
              <Label htmlFor="new-flag-key">New setting key</Label>
              <Input
                id="new-flag-key"
                placeholder="e.g. default_search_radius"
                value={newFlagKey}
                onChange={(e) => setNewFlagKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddFlag(e)
                  }
                }}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <Label htmlFor="new-flag-value">Value</Label>
              <Input
                id="new-flag-value"
                placeholder="e.g. 2"
                value={newFlagValue}
                onChange={(e) => setNewFlagValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddFlag(e)
                  }
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleAddFlag}
              disabled={!newFlagKey.trim()}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Plus size={13} /> Add
            </button>
          </div>

          {Object.keys(flags).filter((k) => !HANDLED_FLAG_KEYS.includes(k)).length === 0 ? (
            <p className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
              No other settings yet — add one above.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(flags)
                .filter(([key]) => !HANDLED_FLAG_KEYS.includes(key))
                .map(([key, value]) => (
                  <div key={key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Label htmlFor={`flag-${key}`}>{key.replace(/_/g, ' ')}</Label>
                      <button
                        type="button"
                        disabled={deletingFlagKey === key}
                        onClick={() => handleDeleteFlag(key)}
                        aria-label={`Delete ${key}`}
                        style={{ color: 'var(--danger)' }}
                        className="disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <Input id={`flag-${key}`} value={value} onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              💡 Press <kbd className="rounded border px-1 py-0.5 font-mono text-[10.5px]" style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}>Enter</kbd> in any field to save immediately
            </span>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save Feature Flags'}
            </button>
          </div>
        </section>

        <PaymentGateways />

        <Model1SuspendedDrivers />

        {/* Bottom Save Action Bar */}
        <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-xl border p-3.5 shadow-lg backdrop-blur-md" style={{ borderColor: 'var(--border)', background: 'var(--bg-muted)' }}>
          <div className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            Unsaved changes? Press <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>Enter</kbd> or click save.
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold shadow-xs transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Save size={15} /> {saving ? 'Saving settings…' : 'Save All Changes'}
          </button>
        </div>
      </div>
    </form>
  )
}

export default function Settings() {
  const fetcher = useCallback(() => api.get('/settings').then((res) => res.data.data), [])
  const { data, loading, refetch } = useApiQuery(fetcher)

  if (loading || !data) {
    return (
      <div className="flex h-40 items-center justify-center" style={{ color: 'var(--ink-faint)' }}>
        Loading settings…
      </div>
    )
  }

  // No key needed — SettingsForm's lazy useState initializers only need to
  // run once, at the first mount that happens right here once data exists.
  return <SettingsForm data={data} onSaved={refetch} />
}
