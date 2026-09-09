import { useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = {
  plan_name: '', plan_for: 'USER', plan_type: 'CUSTOMER_PREMIUM', price: '', validity_days: '30', description: '',
  commission_percent: '0', per_trip_charge: '0', initial_price: '0', subscription_price: '0', guaranteed_enabled: false,
  guaranteed_rides_per_month: '0', priority_enabled: false, incentive_enabled: false, incentive_type: 'flat', incentive_value: '0',
  wallet_bonus_enabled: false, wallet_bonus_amount: '0', lifetime_enabled: false, activity_protection_enabled: false,
  activity_protection_3m: '0', activity_protection_6m: '0', activity_protection_12m: '0', activity_min_online_hours: '10',
  activity_require_model1: false, activity_require_zero_requests: false, activity_require_service_zone: false, activity_request_ends_day: true,
  is_popular: false, status: true,
}

export default function PremiumPlanFormModal({ open, plan, onClose, onSaved }) {
  const isEdit = Boolean(plan)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which plan it
    // targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(
      plan
        ? { ...EMPTY_FORM, ...plan, price: String(plan.price), validity_days: String(plan.validity_days), commission_percent: String(plan.commission_percent ?? 0), per_trip_charge: String(plan.per_trip_charge ?? 0), initial_price: String(plan.initial_price ?? 0), subscription_price: String(plan.subscription_price ?? 0), guaranteed_rides_per_month: String(plan.guaranteed_rides_per_month ?? 0), activity_protection_3m: String(plan.activity_protection_3m ?? 0), activity_protection_6m: String(plan.activity_protection_6m ?? 0), activity_protection_12m: String(plan.activity_protection_12m ?? 0), activity_min_online_hours: String(plan.activity_min_online_hours ?? 10) }
        : EMPTY_FORM
    )
  }, [open, plan])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/marketing/premium-plans/${plan.id}`, form)
      else await api.post('/marketing/premium-plans', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this plan.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${plan.plan_name}` : 'New premium plan'}
      width={620}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.plan_name || !form.price}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create plan'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-name">
        Plan name
      </label>
      <input id="plan-name" value={form.plan_name} onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. Shifter Pro Driver Plan" />

      <div className="mb-3 grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-for">
            Audience
          </label>
          <select id="plan-for" value={form.plan_for} onChange={(e) => setForm((f) => ({ ...f, plan_for: e.target.value, plan_type: e.target.value === 'DRIVER' ? 'DRIVER_PREMIUM' : 'CUSTOMER_PREMIUM' }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value="USER">Customer</option>
            <option value="DRIVER">Driver</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-price">
            Price (₹)
          </label>
          <input id="plan-price" type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-validity">
            Validity (days)
          </label>
          <input id="plan-validity" type="number" disabled={form.lifetime_enabled} value={form.lifetime_enabled ? 'Lifetime' : form.validity_days} onChange={(e) => setForm((f) => ({ ...f, validity_days: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none disabled:opacity-50" style={FIELD_STYLE} />
        </div>
      </div>

      {form.plan_for === 'DRIVER' && (
        <div className="mb-3 space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Driver plan type
              <select value={form.plan_type} onChange={(e) => setForm((f) => ({ ...f, plan_type: e.target.value, guaranteed_enabled: e.target.value === 'DRIVER_SECOND' }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
                <option value="DRIVER_PREMIUM">Driver premium</option>
                <option value="DRIVER_SECOND">Guaranteed rides</option>
              </select>
            </label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Commission (%)
              <input type="number" min="0" value={form.commission_percent} onChange={(e) => setForm((f) => ({ ...f, commission_percent: e.target.value }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
            </label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Per-trip charge (₹)
              <input type="number" min="0" value={form.per_trip_charge} onChange={(e) => setForm((f) => ({ ...f, per_trip_charge: e.target.value }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}><input type="checkbox" checked={form.priority_enabled} onChange={(e) => setForm((f) => ({ ...f, priority_enabled: e.target.checked }))} /> Priority ride assignment</label>
          </div>
          {form.plan_type === 'DRIVER_SECOND' && <div className="grid grid-cols-3 gap-3">
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Initial price (₹)<input type="number" min="0" value={form.initial_price} onChange={(e) => setForm((f) => ({ ...f, initial_price: e.target.value }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Renewal (₹)<input type="number" min="0" value={form.subscription_price} onChange={(e) => setForm((f) => ({ ...f, subscription_price: e.target.value }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Guaranteed rides<input type="number" min="0" value={form.guaranteed_rides_per_month} onChange={(e) => setForm((f) => ({ ...f, guaranteed_rides_per_month: e.target.value }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
          </div>}
          {form.plan_type === 'DRIVER_PREMIUM' && <div className="grid grid-cols-3 gap-3">
            <label className="flex items-end gap-2 pb-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}><input type="checkbox" checked={form.incentive_enabled} onChange={(e) => setForm((f) => ({ ...f, incentive_enabled: e.target.checked }))} /> Per-trip incentive</label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Incentive value<input type="number" min="0" value={form.incentive_value} onChange={(e) => setForm((f) => ({ ...f, incentive_value: e.target.value }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Wallet bonus (₹)<input type="number" min="0" value={form.wallet_bonus_amount} onChange={(e) => setForm((f) => ({ ...f, wallet_bonus_amount: e.target.value, wallet_bonus_enabled: Number(e.target.value) > 0 }))} className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
          </div>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.lifetime_enabled} onChange={(e) => setForm((f) => ({ ...f, lifetime_enabled: e.target.checked, validity_days: e.target.checked ? '36500' : '30' }))} /> One-time lifetime plan</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.activity_protection_enabled} onChange={(e) => setForm((f) => ({ ...f, activity_protection_enabled: e.target.checked }))} /> Activity protection</label>
          </div>
          {form.activity_protection_enabled && <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--brand-soft-border)', background: 'var(--brand-soft)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Activity protection configuration</p>
            <div className="grid grid-cols-4 gap-3">
              <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>After 3 months (₹/day)<input type="number" min="0" value={form.activity_protection_3m} onChange={(e) => setForm((f) => ({ ...f, activity_protection_3m: e.target.value }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
              <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>After 6 months (₹/day)<input type="number" min="0" value={form.activity_protection_6m} onChange={(e) => setForm((f) => ({ ...f, activity_protection_6m: e.target.value }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
              <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>After 12 months (₹/day)<input type="number" min="0" value={form.activity_protection_12m} onChange={(e) => setForm((f) => ({ ...f, activity_protection_12m: e.target.value }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
              <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>Minimum online hours<input type="number" min="0" value={form.activity_min_online_hours} onChange={(e) => setForm((f) => ({ ...f, activity_min_online_hours: e.target.value }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none" style={FIELD_STYLE} /></label>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.activity_require_model1} onChange={(e) => setForm((f) => ({ ...f, activity_require_model1: e.target.checked }))} /> Model 1 must stay ON</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.activity_require_zero_requests} onChange={(e) => setForm((f) => ({ ...f, activity_require_zero_requests: e.target.checked }))} /> Zero eligible requests</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.activity_request_ends_day} onChange={(e) => setForm((f) => ({ ...f, activity_request_ends_day: e.target.checked }))} /> Request ends protection for the day</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.activity_require_service_zone} onChange={(e) => setForm((f) => ({ ...f, activity_require_service_zone: e.target.checked }))} /> Must remain in service zone</label>
            </div>
          </div>}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-desc">
        Benefits / description
      </label>
      <textarea
        id="plan-desc"
        rows={3}
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={FIELD_STYLE}
      />

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={form.is_popular} onChange={(e) => setForm((f) => ({ ...f, is_popular: e.target.checked }))} /> Mark as popular
        </label>
        {isEdit && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            <input type="checkbox" checked={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked }))} /> Active
          </label>
        )}
      </div>
    </Modal>
  )
}
