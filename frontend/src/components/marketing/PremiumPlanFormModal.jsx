import { useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = {
  plan_name: '',
  plan_for: 'USER',
  plan_type: 'CUSTOMER_PREMIUM',
  price: '',
  validity_days: '30',
  description: '',
  is_popular: false,
  status: true,

  // Customer Benefits
  discount_enabled: false,
  discount_percent: '0',
  discount_max_cap: '0',
  no_advance_payment: false,
  priority_enabled: false,
  guarantee_driver: false,
  priority_support: false,
  special_offers: false,
  referral_enabled: false,
  referral_points_per_referral: '0',
  referral_point_value: '1',
  cancellation_enabled: false,
  free_cancellations: '5',
  cancellation_window_min: '5',
  wallet_bonus_enabled: false,
  wallet_bonus_amount: '0',

  // Driver Benefits
  commission_percent: '0',
  per_trip_charge: '0',
  initial_price: '0',
  subscription_price: '0',
  guaranteed_enabled: false,
  guaranteed_rides_per_month: '0',
  incentive_enabled: false,
  incentive_type: 'flat',
  incentive_value: '0',
  lifetime_enabled: false,
  activity_protection_enabled: false,
  activity_protection_3m: '0',
  activity_protection_6m: '0',
  activity_protection_12m: '0',
  activity_min_online_hours: '10',
  activity_require_model1: false,
  activity_require_zero_requests: false,
  activity_require_service_zone: false,
  activity_request_ends_day: true,
}

export default function PremiumPlanFormModal({ open, plan, onClose, onSaved }) {
  const isEdit = Boolean(plan)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(
      plan
        ? {
            ...EMPTY_FORM,
            ...plan,
            price: String(plan.price ?? ''),
            validity_days: String(plan.validity_days ?? 30),
            discount_percent: String(plan.discount_percent ?? 0),
            discount_max_cap: String(plan.discount_max_cap ?? 0),
            referral_points_per_referral: String(plan.referral_points_per_referral ?? 0),
            referral_point_value: String(plan.referral_point_value ?? 1),
            free_cancellations: String(plan.free_cancellations ?? 5),
            cancellation_window_min: String(plan.cancellation_window_min ?? 5),
            wallet_bonus_amount: String(plan.wallet_bonus_amount ?? 0),
            commission_percent: String(plan.commission_percent ?? 0),
            per_trip_charge: String(plan.per_trip_charge ?? 0),
            initial_price: String(plan.initial_price ?? 0),
            subscription_price: String(plan.subscription_price ?? 0),
            guaranteed_rides_per_month: String(plan.guaranteed_rides_per_month ?? 0),
            incentive_value: String(plan.incentive_value ?? 0),
            activity_protection_3m: String(plan.activity_protection_3m ?? 0),
            activity_protection_6m: String(plan.activity_protection_6m ?? 0),
            activity_protection_12m: String(plan.activity_protection_12m ?? 0),
            activity_min_online_hours: String(plan.activity_min_online_hours ?? 10),
            discount_enabled: Boolean(plan.discount_enabled),
            no_advance_payment: Boolean(plan.no_advance_payment),
            priority_enabled: Boolean(plan.priority_enabled),
            guarantee_driver: Boolean(plan.guarantee_driver),
            priority_support: Boolean(plan.priority_support),
            special_offers: Boolean(plan.special_offers),
            referral_enabled: Boolean(plan.referral_enabled),
            cancellation_enabled: Boolean(plan.cancellation_enabled),
            wallet_bonus_enabled: Boolean(plan.wallet_bonus_enabled),
            lifetime_enabled: Boolean(plan.lifetime_enabled),
            is_popular: Boolean(plan.is_popular),
            status: plan.status !== undefined ? Boolean(plan.status) : true,
          }
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
      width={680}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          >
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
        <div
          className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {/* Plan Basic Details */}
      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-name">
        Plan name
      </label>
      <input
        id="plan-name"
        value={form.plan_name}
        onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={FIELD_STYLE}
        placeholder={form.plan_for === 'USER' ? 'e.g. VIP Gold Customer Pass' : 'e.g. Shifter Pro Driver Plan'}
      />

      <div className="mb-3 grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-for">
            Audience
          </label>
          <select
            id="plan-for"
            value={form.plan_for}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                plan_for: e.target.value,
                plan_type: e.target.value === 'DRIVER' ? 'DRIVER_PREMIUM' : 'CUSTOMER_PREMIUM',
              }))
            }
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
          >
            <option value="USER">Customer</option>
            <option value="DRIVER">Driver</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-price">
            Price (₹)
          </label>
          <input
            id="plan-price"
            type="number"
            min="0"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
            placeholder="0"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="plan-validity">
            Validity (days)
          </label>
          <input
            id="plan-validity"
            type="number"
            min="1"
            disabled={form.lifetime_enabled}
            value={form.lifetime_enabled ? 'Lifetime' : form.validity_days}
            onChange={(e) => setForm((f) => ({ ...f, validity_days: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none disabled:opacity-50"
            style={FIELD_STYLE}
          />
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* CUSTOMER PLAN CONFIGURATION (when Audience = Customer)       */}
      {/* ───────────────────────────────────────────────────────────── */}
      {form.plan_for === 'USER' && (
        <div className="mb-3 space-y-3 rounded-lg border p-3.5" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
              Customer Plan Benefits & Rules
            </span>
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Configure discounts, payments & perks
            </span>
          </div>

          {/* 1. Fare Discount */}
          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={form.discount_enabled}
                onChange={(e) => setForm((f) => ({ ...f, discount_enabled: e.target.checked }))}
              />
              Per-Ride Fare Discount
            </label>
            {form.discount_enabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                    Discount Percentage (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.discount_percent}
                      onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
                      className="mt-1 w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                      style={FIELD_STYLE}
                      placeholder="e.g. 10"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                    Max Cap (₹, 0 for unlimited)
                    <input
                      type="number"
                      min="0"
                      value={form.discount_max_cap}
                      onChange={(e) => setForm((f) => ({ ...f, discount_max_cap: e.target.value }))}
                      className="mt-1 w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                      style={FIELD_STYLE}
                      placeholder="0"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 2. Advance Payment & Booking Privileges */}
          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <span className="block text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
              Payment & Booking Rules
            </span>
            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={form.no_advance_payment}
                  onChange={(e) => setForm((f) => ({ ...f, no_advance_payment: e.target.checked }))}
                />
                No Advance Payment (Pay after ride)
              </label>
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={form.priority_enabled}
                  onChange={(e) => setForm((f) => ({ ...f, priority_enabled: e.target.checked }))}
                />
                Priority Ride Matching
              </label>
              <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={form.guarantee_driver}
                  onChange={(e) => setForm((f) => ({ ...f, guarantee_driver: e.target.checked }))}
                />
                Guaranteed Driver Assignment
              </label>
            </div>
          </div>

          {/* 3. Refer & Earn Points */}
          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={form.referral_enabled}
                onChange={(e) => setForm((f) => ({ ...f, referral_enabled: e.target.checked }))}
              />
              Refer & Earn Points
            </label>
            {form.referral_enabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                    Points per verified referral
                    <input
                      type="number"
                      min="0"
                      value={form.referral_points_per_referral}
                      onChange={(e) => setForm((f) => ({ ...f, referral_points_per_referral: e.target.value }))}
                      className="mt-1 w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                      style={FIELD_STYLE}
                      placeholder="e.g. 100"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                    1 Point Redemption Value (₹)
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={form.referral_point_value}
                      onChange={(e) => setForm((f) => ({ ...f, referral_point_value: e.target.value }))}
                      className="mt-1 w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                      style={FIELD_STYLE}
                      placeholder="1"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 4. Cancellations & Instant Bonus */}
          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                  <input
                    type="checkbox"
                    checked={form.cancellation_enabled}
                    onChange={(e) => setForm((f) => ({ ...f, cancellation_enabled: e.target.checked }))}
                  />
                  Free Cancellations
                </label>
                {form.cancellation_enabled && (
                  <div className="mt-2 space-y-2">
                    <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                      Free cancellations/mo (-1 for unlim)
                      <input
                        type="number"
                        value={form.free_cancellations}
                        onChange={(e) => setForm((f) => ({ ...f, free_cancellations: e.target.value }))}
                        className="mt-1 w-full rounded-lg border px-2 py-1.5 text-[13px] outline-none"
                        style={FIELD_STYLE}
                      />
                    </label>
                    <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                      Cancellation window (mins)
                      <input
                        type="number"
                        min="1"
                        value={form.cancellation_window_min}
                        onChange={(e) => setForm((f) => ({ ...f, cancellation_window_min: e.target.value }))}
                        className="mt-1 w-full rounded-lg border px-2 py-1.5 text-[13px] outline-none"
                        style={FIELD_STYLE}
                      />
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                  Instant Wallet Bonus (₹)
                  <input
                    type="number"
                    min="0"
                    value={form.wallet_bonus_amount}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        wallet_bonus_amount: e.target.value,
                        wallet_bonus_enabled: Number(e.target.value) > 0,
                      }))
                    }
                    className="mt-2 w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none"
                    style={FIELD_STYLE}
                    placeholder="0"
                  />
                </label>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Bonus credited directly to customer wallet on plan purchase.
                </p>
              </div>
            </div>
          </div>

          {/* 5. Extra VIP Perks */}
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={form.priority_support}
                onChange={(e) => setForm((f) => ({ ...f, priority_support: e.target.checked }))}
              />
              24/7 Priority Support
            </label>
            <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={form.special_offers}
                onChange={(e) => setForm((f) => ({ ...f, special_offers: e.target.checked }))}
              />
              Exclusive Special Offers & Deals
            </label>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DRIVER PLAN CONFIGURATION (when Audience = Driver)           */}
      {/* ───────────────────────────────────────────────────────────── */}
      {form.plan_for === 'DRIVER' && (
        <div className="mb-3 space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
              Driver plan type
              <select
                value={form.plan_type}
                onChange={(e) => setForm((f) => ({ ...f, plan_type: e.target.value, guaranteed_enabled: e.target.value === 'DRIVER_SECOND' }))}
                className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                style={FIELD_STYLE}
              >
                <option value="DRIVER_PREMIUM">Driver premium</option>
                <option value="DRIVER_SECOND">Guaranteed rides</option>
              </select>
            </label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
              Commission (%)
              <input
                type="number"
                min="0"
                value={form.commission_percent}
                onChange={(e) => setForm((f) => ({ ...f, commission_percent: e.target.value }))}
                className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                style={FIELD_STYLE}
              />
            </label>
            <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
              Per-trip charge (₹)
              <input
                type="number"
                min="0"
                value={form.per_trip_charge}
                onChange={(e) => setForm((f) => ({ ...f, per_trip_charge: e.target.value }))}
                className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                style={FIELD_STYLE}
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              <input
                type="checkbox"
                checked={form.priority_enabled}
                onChange={(e) => setForm((f) => ({ ...f, priority_enabled: e.target.checked }))}
              />{' '}
              Priority ride assignment
            </label>
          </div>
          {form.plan_type === 'DRIVER_SECOND' && (
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                Initial price (₹)
                <input
                  type="number"
                  min="0"
                  value={form.initial_price}
                  onChange={(e) => setForm((f) => ({ ...f, initial_price: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                Renewal (₹)
                <input
                  type="number"
                  min="0"
                  value={form.subscription_price}
                  onChange={(e) => setForm((f) => ({ ...f, subscription_price: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                Guaranteed rides
                <input
                  type="number"
                  min="0"
                  value={form.guaranteed_rides_per_month}
                  onChange={(e) => setForm((f) => ({ ...f, guaranteed_rides_per_month: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                  style={FIELD_STYLE}
                />
              </label>
            </div>
          )}
          {form.plan_type === 'DRIVER_PREMIUM' && (
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-end gap-2 pb-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                <input
                  type="checkbox"
                  checked={form.incentive_enabled}
                  onChange={(e) => setForm((f) => ({ ...f, incentive_enabled: e.target.checked }))}
                />{' '}
                Per-trip incentive
              </label>
              <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                Incentive value
                <input
                  type="number"
                  min="0"
                  value={form.incentive_value}
                  onChange={(e) => setForm((f) => ({ ...f, incentive_value: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                  style={FIELD_STYLE}
                />
              </label>
              <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                Wallet bonus (₹)
                <input
                  type="number"
                  min="0"
                  value={form.wallet_bonus_amount}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      wallet_bonus_amount: e.target.value,
                      wallet_bonus_enabled: Number(e.target.value) > 0,
                    }))
                  }
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                  style={FIELD_STYLE}
                />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.lifetime_enabled}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    lifetime_enabled: e.target.checked,
                    validity_days: e.target.checked ? '36500' : '30',
                  }))
                }
              />{' '}
              One-time lifetime plan
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.activity_protection_enabled}
                onChange={(e) => setForm((f) => ({ ...f, activity_protection_enabled: e.target.checked }))}
              />{' '}
              Activity protection
            </label>
          </div>
          {form.activity_protection_enabled && (
            <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--brand-soft-border)', background: 'var(--brand-soft)' }}>
              <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                Activity protection configuration
              </p>
              <div className="grid grid-cols-4 gap-3">
                <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  After 3 months (₹/day)
                  <input
                    type="number"
                    min="0"
                    value={form.activity_protection_3m}
                    onChange={(e) => setForm((f) => ({ ...f, activity_protection_3m: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none"
                    style={FIELD_STYLE}
                  />
                </label>
                <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  After 6 months (₹/day)
                  <input
                    type="number"
                    min="0"
                    value={form.activity_protection_6m}
                    onChange={(e) => setForm((f) => ({ ...f, activity_protection_6m: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none"
                    style={FIELD_STYLE}
                  />
                </label>
                <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  After 12 months (₹/day)
                  <input
                    type="number"
                    min="0"
                    value={form.activity_protection_12m}
                    onChange={(e) => setForm((f) => ({ ...f, activity_protection_12m: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none"
                    style={FIELD_STYLE}
                  />
                </label>
                <label className="block text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  Minimum online hours
                  <input
                    type="number"
                    min="0"
                    value={form.activity_min_online_hours}
                    onChange={(e) => setForm((f) => ({ ...f, activity_min_online_hours: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-2 py-2 text-[13px] outline-none"
                    style={FIELD_STYLE}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.activity_require_model1}
                    onChange={(e) => setForm((f) => ({ ...f, activity_require_model1: e.target.checked }))}
                  />{' '}
                  Model 1 must stay ON
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.activity_require_zero_requests}
                    onChange={(e) => setForm((f) => ({ ...f, activity_require_zero_requests: e.target.checked }))}
                  />{' '}
                  Zero eligible requests
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.activity_request_ends_day}
                    onChange={(e) => setForm((f) => ({ ...f, activity_request_ends_day: e.target.checked }))}
                  />{' '}
                  Request ends protection for the day
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.activity_require_service_zone}
                    onChange={(e) => setForm((f) => ({ ...f, activity_require_service_zone: e.target.checked }))}
                  />{' '}
                  Must remain in service zone
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Description / Summary */}
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
        placeholder="Short description or summary of plan perks..."
      />

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          <input
            type="checkbox"
            checked={form.is_popular}
            onChange={(e) => setForm((f) => ({ ...f, is_popular: e.target.checked }))}
          />{' '}
          Mark as popular
        </label>
        {isEdit && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            <input
              type="checkbox"
              checked={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked }))}
            />{' '}
            Active
          </label>
        )}
      </div>
    </Modal>
  )
}
