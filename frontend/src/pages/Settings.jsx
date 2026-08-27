import { useCallback, useState } from 'react'
import { Save } from 'lucide-react'
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

  async function handleSave() {
    setSaving(true)
    try {
      await api.put('/settings', { ...form, ...paymentMethods, flags })
      toast.success('Settings saved.')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Settings
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Platform configuration. API keys and auth secrets stay in environment variables, not here.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
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

        {Object.keys(flags).length > 0 && (
          <section className="surface-card rounded-xl p-4">
            <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Feature flags
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(flags).map(([key, value]) => (
                <div key={key}>
                  <Label htmlFor={`flag-${key}`}>{key.replace(/_/g, ' ')}</Label>
                  <Input id={`flag-${key}`} value={value} onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </section>
        )}

        <PaymentGateways />
      </div>
    </div>
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
