import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Milestone, IndianRupee, Gift, Users, Sparkles, Eye, Search, Phone } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

function MilestoneFormModal({ open, milestone, onClose, onSaved }) {
  const [ridesRequired, setRidesRequired] = useState('')
  const [planId, setPlanId] = useState('')
  const [status, setStatus] = useState(true)
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRidesRequired(milestone ? String(milestone.rides_required) : '')
    setPlanId(milestone ? String(milestone.plan_id) : '')
    setStatus(milestone ? Boolean(milestone.status) : true)
    setError('')
  }, [open, milestone])

  useEffect(() => {
    if (!open) return
    setPlansLoading(true)
    api
      .get('/marketing/premium-plans', { params: { plan_for: 'USER', status: 'true' } })
      .then((res) => setPlans(res.data?.data || []))
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false))
  }, [open])

  async function handleSubmit() {
    setError('')
    const rides = Number(ridesRequired)
    if (!rides || rides <= 0) {
      setError('Enter a valid number of rides.')
      return
    }
    if (!planId) {
      setError('Please select a plan.')
      return
    }
    setSaving(true)
    try {
      if (milestone) {
        await api.put(`/ride-milestones/${milestone.id}`, { rides_required: rides, plan_id: planId, status })
      } else {
        await api.post('/ride-milestones', { rides_required: rides, plan_id: planId })
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this milestone.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={milestone ? 'Edit ride count milestone' : 'New ride count milestone'}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="rides-required">
          Rides required (lifetime completed rides)
        </label>
        <input
          id="rides-required"
          type="number"
          min="1"
          value={ridesRequired}
          onChange={(e) => setRidesRequired(e.target.value)}
          placeholder="e.g. 10"
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
        />
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="milestone-plan">
          Plan to reward
        </label>
        <select
          id="milestone-plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          <option value="">{plansLoading ? 'Loading plans…' : 'Select a plan'}</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.plan_name}
            </option>
          ))}
        </select>
      </div>

      {milestone && (
        <div className="flex items-center gap-2 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', width: 'fit-content' }}>
          {[
            { key: true, label: 'Active' },
            { key: false, label: 'Inactive' },
          ].map((opt) => (
            <button
              key={String(opt.key)}
              type="button"
              onClick={() => setStatus(opt.key)}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-all"
              style={{
                background: status === opt.key ? 'var(--brand)' : 'transparent',
                color: status === opt.key ? 'var(--brand-ink)' : 'var(--ink-muted)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

function AmountRewardFormModal({ open, reward, onClose, onSaved }) {
  const [minAmount, setMinAmount] = useState('')
  const [planId, setPlanId] = useState('')
  const [maxCustomers, setMaxCustomers] = useState('')
  const [status, setStatus] = useState(true)
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setMinAmount(reward ? String(reward.min_amount) : '')
    setPlanId(reward ? String(reward.plan_id) : '')
    setMaxCustomers(reward && reward.max_customers ? String(reward.max_customers) : '')
    setStatus(reward ? Boolean(reward.status) : true)
    setError('')
  }, [open, reward])

  useEffect(() => {
    if (!open) return
    setPlansLoading(true)
    api
      .get('/marketing/premium-plans', { params: { plan_for: 'USER', status: 'true' } })
      .then((res) => setPlans(res.data?.data || []))
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false))
  }, [open])

  async function handleSubmit() {
    setError('')
    const amount = Number(minAmount)
    if (!amount || amount <= 0) {
      setError('Please enter a valid minimum ride amount (₹).')
      return
    }
    if (!planId) {
      setError('Please select a reward plan.')
      return
    }

    const payload = {
      min_amount: amount,
      plan_id: planId,
      max_customers: maxCustomers.trim() ? Number(maxCustomers.trim()) : null,
      status,
    }

    setSaving(true)
    try {
      if (reward) {
        await api.put(`/ride-amount-rewards/${reward.id}`, payload)
      } else {
        await api.post('/ride-amount-rewards', payload)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this ride amount reward offer.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reward ? 'Edit ride amount reward offer' : 'New ride amount reward offer'}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {saving ? 'Saving…' : 'Save Offer'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="reward-min-amount">
          Total Ride Spend Required (₹)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-2.5 text-[13px] font-medium text-gray-400">₹</span>
          <input
            id="reward-min-amount"
            type="number"
            min="1"
            step="1"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="e.g. 500"
            className="w-full rounded-lg border py-2 pl-7 pr-3 text-[13px] outline-none"
            style={FIELD_STYLE}
          />
        </div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          Customer will get the reward plan once their total completed ride spend reaches this amount (single ride of ₹{minAmount || '500'} or multiple smaller rides combined).
        </p>
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="amount-reward-plan">
          Plan to reward
        </label>
        <select
          id="amount-reward-plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          <option value="">{plansLoading ? 'Loading plans…' : 'Select a plan'}</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.plan_name} ({plan.lifetime_enabled ? 'Lifetime' : `${plan.validity_days || 30} days`})
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="reward-max-customers">
          Max Customers Limit (Quota)
        </label>
        <input
          id="reward-max-customers"
          type="number"
          min="1"
          value={maxCustomers}
          onChange={(e) => setMaxCustomers(e.target.value)}
          placeholder="Leave empty for unlimited customers"
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
        />
        <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          Admin can increase or reduce this limit anytime. Once reached, this offer automatically expires.
        </p>
      </div>

      {reward && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>Offer Status</span>
          <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
            {[
              { key: true, label: 'Active' },
              { key: false, label: 'Inactive' },
            ].map((opt) => (
              <button
                key={String(opt.key)}
                type="button"
                onClick={() => setStatus(opt.key)}
                className="rounded-md px-3 py-1 text-[12px] font-semibold transition-all"
                style={{
                  background: status === opt.key ? 'var(--brand)' : 'transparent',
                  color: status === opt.key ? 'var(--brand-ink)' : 'var(--ink-muted)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

function ClaimedUsersModal({ open, target, type = 'amount', onClose }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open || !target) return
    setLoading(true)
    setError('')
    setSearch('')
    const url = type === 'amount'
      ? `/ride-amount-rewards/${target.id}/claims`
      : `/ride-milestones/${target.id}/claims`

    api
      .get(url)
      .then((res) => setClaims(res.data?.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load claimed customers.'))
      .finally(() => setLoading(false))
  }, [open, target, type])

  const filtered = claims.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    const name = c.user?.name?.toLowerCase() || ''
    const phone = String(c.user?.mobile || '')
    const orderId = String(c.order_id || '')
    return name.includes(q) || phone.includes(q) || orderId.includes(q)
  })

  const title = target
    ? type === 'amount'
      ? `Claimed Customers (₹${Number(target.min_amount).toLocaleString('en-IN')}+ Ride Offer)`
      : `Claimed Customers (${target.rides_required} Rides Milestone)`
    : 'Claimed Customers'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={720}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border px-4 py-1.5 text-[13px] font-semibold"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
        >
          Close
        </button>
      }
    >
      {/* Subheader info banner */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" style={{ background: 'var(--bg-subtle, var(--bg))', borderColor: 'var(--border)' }}>
        <div>
          <span className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>Reward Plan: </span>
          <span className="font-semibold text-[13px]" style={{ color: 'var(--brand)' }}>{target?.plan?.plan_name || `Plan #${target?.plan_id}`}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          <Users size={14} />
          <span>Total Claims: <strong>{claims.length}</strong> {target?.max_customers ? `/ ${target.max_customers} quota` : ''}</span>
        </div>
      </div>

      {/* Search Input */}
      {claims.length > 0 && (
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, phone, or order ID..."
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-[13px] outline-none"
            style={FIELD_STYLE}
          />
        </div>
      )}

      {loading && (
        <div className="space-y-2 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--border)' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border p-4 text-center text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderColor: 'var(--danger-soft-border)' }}>
          {error}
        </div>
      )}

      {!loading && !error && claims.length === 0 && (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
          <Gift size={28} className="mx-auto mb-2 text-gray-400" />
          <div className="text-[14px] font-semibold text-gray-700">No Customers Claimed Yet</div>
          <div className="mt-1 text-[12px] text-gray-500">
            When a customer completes a ride qualifying for this offer, their details will appear here automatically.
          </div>
        </div>
      )}

      {!loading && !error && claims.length > 0 && filtered.length === 0 && (
        <div className="py-6 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          No claimed customers matching "{search}".
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-subtle, var(--bg))' }}>
                <th className="px-3 py-2.5 font-semibold" style={{ color: 'var(--ink-faint)' }}>Customer</th>
                <th className="px-3 py-2.5 font-semibold" style={{ color: 'var(--ink-faint)' }}>Triggering Ride</th>
                <th className="px-3 py-2.5 font-semibold" style={{ color: 'var(--ink-faint)' }}>Status</th>
                <th className="px-3 py-2.5 font-semibold" style={{ color: 'var(--ink-faint)' }}>Claimed At</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const dateStr = c.applied_at
                  ? new Date(c.applied_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })
                  : '—'
                return (
                  <tr key={c.id} className="border-b last:border-b-0 hover:bg-gray-50/50" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                        {c.user?.name || `Customer #${c.user_id}`}
                      </div>
                      <div className="flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                        <Phone size={11} />
                        <span>{c.user?.mobile || 'No phone'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {c.order_id ? (
                        <div>
                          <span className="font-mono-data font-semibold text-[12px]" style={{ color: 'var(--brand)' }}>
                            #{c.order_id}
                          </span>
                          {c.order?.order_total != null && (
                            <span className="ml-1.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                              (Fare: ₹{c.order.order_total})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--ink-faint)' }}>—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {c.status === 'applied' ? (
                        <Badge tone="success">Plan Activated 🎉</Badge>
                      ) : (
                        <Badge tone="neutral">Skipped (Active Plan)</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {dateStr}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export default function RideMilestones() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin') || hasRole('admin')

  const [activeTab, setActiveTab] = useState('amount') // 'amount' | 'count'

  // Ride count milestones
  const fetcherCount = useCallback(() => api.get('/ride-milestones').then((res) => res.data), [])
  const { data: countData, loading: countLoading, error: countError, refetch: refetchCount } = useApiQuery(fetcherCount)
  const milestones = countData?.data ?? []

  // Ride amount rewards
  const fetcherAmount = useCallback(() => api.get('/ride-amount-rewards').then((res) => res.data), [])
  const { data: amountData, loading: amountLoading, error: amountError, refetch: refetchAmount } = useApiQuery(fetcherAmount)
  const amountRewards = amountData?.data ?? []

  const [formTargetCount, setFormTargetCount] = useState(undefined)
  const [deleteTargetCount, setDeleteTargetCount] = useState(null)
  const [deletingCount, setDeletingCount] = useState(false)

  const [formTargetAmount, setFormTargetAmount] = useState(undefined)
  const [deleteTargetAmount, setDeleteTargetAmount] = useState(null)
  const [deletingAmount, setDeletingAmount] = useState(false)

  const [viewClaimedTarget, setViewClaimedTarget] = useState(null)
  const [viewClaimedType, setViewClaimedType] = useState('amount')

  async function handleDeleteCount() {
    setDeletingCount(true)
    try {
      await api.delete(`/ride-milestones/${deleteTargetCount.id}`)
      toast.success('Milestone deleted.')
      setDeleteTargetCount(null)
      refetchCount()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this milestone.')
    } finally {
      setDeletingCount(false)
    }
  }

  async function handleDeleteAmount() {
    setDeletingAmount(true)
    try {
      await api.delete(`/ride-amount-rewards/${deleteTargetAmount.id}`)
      toast.success('Amount reward rule deleted.')
      setDeleteTargetAmount(null)
      refetchAmount()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this rule.')
    } finally {
      setDeletingAmount(false)
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Ride Milestones & Reward Offers
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Reward customers automatically with premium plans based on ride amount or ride count milestones.
          </p>
        </div>
        {canManage && (
          <div>
            {activeTab === 'amount' ? (
              <button
                type="button"
                onClick={() => setFormTargetAmount(null)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold shadow-sm"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                <Plus size={14} /> New Amount Reward Offer
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setFormTargetCount(null)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold shadow-sm"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                <Plus size={14} /> New Ride Milestone
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex items-center gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setActiveTab('amount')}
          className="flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-all"
          style={{
            borderColor: activeTab === 'amount' ? 'var(--brand)' : 'transparent',
            color: activeTab === 'amount' ? 'var(--brand)' : 'var(--ink-muted)',
          }}
        >
          <Gift size={15} />
          <span>By Ride Amount (₹)</span>
          {amountRewards.length > 0 && (
            <span className="rounded-full px-1.5 py-0.2 text-[10.5px] font-semibold" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              {amountRewards.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('count')}
          className="flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-all"
          style={{
            borderColor: activeTab === 'count' ? 'var(--brand)' : 'transparent',
            color: activeTab === 'count' ? 'var(--brand)' : 'var(--ink-muted)',
          }}
        >
          <Milestone size={15} />
          <span>By Ride Count (Nth Ride)</span>
          {milestones.length > 0 && (
            <span className="rounded-full px-1.5 py-0.2 text-[10.5px] font-semibold" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              {milestones.length}
            </span>
          )}
        </button>
      </div>

      {/* ================= TAB 1: RIDE AMOUNT REWARDS ================= */}
      {activeTab === 'amount' && (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between rounded-xl border p-3" style={{ background: 'var(--bg-subtle, var(--bg))', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              <Sparkles size={16} className="text-amber-500" />
              <span>
                Customers whose total completed ride spending reaches the threshold amount (single ride or multiple smaller rides combined) will instantly receive the chosen plan for free. You can adjust the amount threshold and max customer limit anytime.
              </span>
            </div>
          </div>

          {amountLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
              ))}
            </div>
          )}

          {!amountLoading && amountError && (
            <div className="surface-card rounded-xl p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
              {amountError}
            </div>
          )}

          {!amountLoading && !amountError && amountRewards.length === 0 && (
            <div className="surface-card rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              No ride amount reward offers set up yet. Click <strong>"New Amount Reward Offer"</strong> to create one.
            </div>
          )}

          {!amountLoading && !amountError && amountRewards.length > 0 && (
            <div className="surface-card overflow-hidden rounded-xl">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Total Spend Required
                    </th>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Reward Plan
                    </th>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Quota & Claimed
                    </th>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Status
                    </th>
                    {canManage && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {amountRewards.map((r) => {
                    const isExhausted = r.max_customers && r.claimed_count >= r.max_customers
                    return (
                      <tr key={r.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                              <IndianRupee size={14} />
                            </div>
                            <span className="font-mono-data font-bold text-[14px]" style={{ color: 'var(--ink)' }}>
                              ₹{Number(r.min_amount).toLocaleString('en-IN')}+
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                            {r.plan?.plan_name || `Plan #${r.plan_id}`}
                          </div>
                          {r.plan && (
                            <div className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                              {r.plan.lifetime_enabled ? 'Lifetime' : `${r.plan.validity_days || 30} days validity`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => {
                              setViewClaimedTarget(r)
                              setViewClaimedType('amount')
                            }}
                            className="group flex items-center gap-2 rounded-lg py-0.5 text-left transition-colors hover:opacity-80"
                            title="Click to view claimed customers"
                          >
                            <Users size={14} style={{ color: 'var(--brand)' }} />
                            <span className="text-[12.5px] font-semibold underline decoration-dashed underline-offset-4" style={{ color: 'var(--ink)' }}>
                              {r.claimed_count} {r.max_customers ? `/ ${r.max_customers} claimed` : 'claimed (Unlimited)'}
                            </span>
                            <Eye size={13} className="opacity-60 transition-opacity group-hover:opacity-100" style={{ color: 'var(--brand)' }} />
                          </button>
                          {r.max_customers && (
                            <div className="mt-1 w-32">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${Math.min(100, Math.round((r.claimed_count / r.max_customers) * 100))}%`,
                                    background: isExhausted ? 'var(--danger)' : 'var(--brand)',
                                  }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-500">
                                {isExhausted ? 'Quota full' : `${Math.max(0, r.max_customers - r.claimed_count)} spots left`}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isExhausted ? (
                            <Badge tone="danger">Quota Full</Badge>
                          ) : (
                            <Badge tone={r.status ? 'success' : 'neutral'}>{r.status ? 'Active' : 'Inactive'}</Badge>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setViewClaimedTarget(r)
                                  setViewClaimedType('amount')
                                }}
                                className="rounded p-1 transition-colors hover:bg-gray-100"
                                style={{ color: 'var(--brand)' }}
                                aria-label="View claimed customers"
                                title="View customers who received this reward"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setFormTargetAmount(r)}
                                className="rounded p-1 transition-colors hover:bg-gray-100"
                                style={{ color: 'var(--ink-muted)' }}
                                aria-label="Edit offer"
                                title="Edit offer amount or quota"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTargetAmount(r)}
                                className="rounded p-1 transition-colors hover:bg-red-50"
                                style={{ color: 'var(--danger)' }}
                                aria-label="Delete offer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: RIDE COUNT MILESTONES ================= */}
      {activeTab === 'count' && (
        <div className="mt-4">
          {countLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
              ))}
            </div>
          )}
          {!countLoading && countError && (
            <div className="surface-card rounded-xl p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
              {countError}
            </div>
          )}
          {!countLoading && !countError && milestones.length === 0 && (
            <div className="surface-card rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
              No ride count milestones set up yet.
            </div>
          )}

          {!countLoading && !countError && milestones.length > 0 && (
            <div className="surface-card overflow-hidden rounded-xl">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Rides required
                    </th>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Reward plan
                    </th>
                    <th className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                      Status
                    </th>
                    {canManage && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m) => (
                    <tr key={m.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                            <Milestone size={13} />
                          </div>
                          <span className="font-mono-data font-semibold" style={{ color: 'var(--ink)' }}>
                            {m.rides_required} rides
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                        {m.plan?.plan_name || `Plan #${m.plan_id}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={m.status ? 'success' : 'neutral'}>{m.status ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setViewClaimedTarget(m)
                                setViewClaimedType('count')
                              }}
                              style={{ color: 'var(--brand)' }}
                              aria-label="View claimed customers"
                              title="View customers who reached this milestone"
                            >
                              <Eye size={14} />
                            </button>
                            <button type="button" onClick={() => setFormTargetCount(m)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                              <Pencil size={14} />
                            </button>
                            <button type="button" onClick={() => setDeleteTargetCount(m)} style={{ color: 'var(--danger)' }} aria-label="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {canManage && (
        <>
          <MilestoneFormModal
            open={formTargetCount !== undefined}
            milestone={formTargetCount}
            onClose={() => setFormTargetCount(undefined)}
            onSaved={() => {
              toast.success(formTargetCount ? 'Milestone updated.' : 'Milestone created.')
              setFormTargetCount(undefined)
              refetchCount()
            }}
          />
          <Modal
            open={Boolean(deleteTargetCount)}
            onClose={() => setDeleteTargetCount(null)}
            title="Delete milestone"
            footer={
              <>
                <button type="button" onClick={() => setDeleteTargetCount(null)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
                  Cancel
                </button>
                <button type="button" disabled={deletingCount} onClick={handleDeleteCount} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
                  {deletingCount ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }
          >
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Delete the <strong style={{ color: 'var(--ink)' }}>{deleteTargetCount?.rides_required} rides</strong> milestone? This can't be undone.
            </p>
          </Modal>

          <AmountRewardFormModal
            open={formTargetAmount !== undefined}
            reward={formTargetAmount}
            onClose={() => setFormTargetAmount(undefined)}
            onSaved={() => {
              toast.success(formTargetAmount ? 'Amount reward offer updated.' : 'Amount reward offer created.')
              setFormTargetAmount(undefined)
              refetchAmount()
            }}
          />
          <ClaimedUsersModal
            open={Boolean(viewClaimedTarget)}
            target={viewClaimedTarget}
            type={viewClaimedType}
            onClose={() => setViewClaimedTarget(null)}
          />

          <Modal
            open={Boolean(deleteTargetAmount)}
            onClose={() => setDeleteTargetAmount(null)}
            title="Delete ride amount reward offer"
            footer={
              <>
                <button type="button" onClick={() => setDeleteTargetAmount(null)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
                  Cancel
                </button>
                <button type="button" disabled={deletingAmount} onClick={handleDeleteAmount} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
                  {deletingAmount ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }
          >
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Delete the <strong style={{ color: 'var(--ink)' }}>₹{deleteTargetAmount?.min_amount}+</strong> reward offer? This cannot be undone.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}
