import { useCallback, useState } from 'react'
import { Save, ExternalLink, PlayCircle } from 'lucide-react'
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

const SETTING_FIELDS = ['currency', 'd_title', 'd_s_title', 'timezone', 'service_charge', 'rider_commission', 'admin_earning', 'driver_pay', 'drive_cancellation', 'user_cancellation', 'reject_timer', 'refer_amount', 'refer_join_amount']

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
        </Section>

        <Section title="Referral defaults">
          <div>
            <Label htmlFor="refer_amount">Referral reward</Label>
            <Input id="refer_amount" type="number" value={form.refer_amount} onChange={(e) => setForm((f) => ({ ...f, refer_amount: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="refer_join_amount">Sign-up bonus</Label>
            <Input id="refer_join_amount" type="number" value={form.refer_join_amount} onChange={(e) => setForm((f) => ({ ...f, refer_join_amount: e.target.value }))} />
          </div>
        </Section>

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

        {Object.keys(flags).filter((k) => !['training_video_url', 'training_video_title', 'acko_session_cookie', 'sarathi_state_id', 'vehicle_detail_notes', 'auto_verification', 'auto_verification_charge', 'auto_verification_charge_old', 'auto_verification_msg', 'manual_registration'].includes(k)).length > 0 && (
          <section className="surface-card rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Other Feature Flags
              </h3>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                <Save size={13} /> {saving ? 'Saving…' : 'Save Flags'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(flags)
                .filter(([key]) => !['training_video_url', 'training_video_title', 'acko_session_cookie', 'sarathi_state_id', 'vehicle_detail_notes', 'auto_verification', 'auto_verification_charge', 'auto_verification_charge_old', 'auto_verification_msg', 'manual_registration'].includes(key))
                .map(([key, value]) => (
                  <div key={key}>
                    <Label htmlFor={`flag-${key}`}>{key.replace(/_/g, ' ')}</Label>
                    <Input id={`flag-${key}`} value={value} onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
            </div>
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
        )}

        <PaymentGateways />

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
