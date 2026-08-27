import { useCallback, useState } from 'react'
import { Plus, Pencil, Trash2, Crown, Star } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import PremiumPlanFormModal from '../components/marketing/PremiumPlanFormModal'
import { formatCurrency } from '../utils/format'

export default function PremiumPlans() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/marketing/premium-plans').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const plans = data?.data ?? []

  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/marketing/premium-plans/${deleteTarget.id}`)
      toast.success('Plan deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this plan.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Premium Plans
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Customer and driver subscription tiers.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New plan
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="surface-card mt-4 rounded-xl p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {!loading && !error && plans.length === 0 && (
        <div className="surface-card mt-4 rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No premium plans yet.
        </div>
      )}

      {!loading && !error && plans.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="surface-card relative flex flex-col rounded-xl p-4" style={{ borderColor: p.is_popular ? 'var(--brand)' : 'var(--border)' }}>
              {p.is_popular && (
                <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  <Star size={10} /> Popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  <Crown size={16} />
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {p.plan_name}
                  </div>
                  <Badge tone={p.plan_for === 'USER' ? 'info' : 'success'}>{p.plan_for === 'USER' ? 'Customer' : 'Driver'}</Badge>
                </div>
              </div>
              <div className="font-mono-data mt-3 text-[24px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(p.price)}
                <span className="ml-1 text-[12px] font-normal" style={{ color: 'var(--ink-faint)' }}>
                  / {p.validity_days}d
                </span>
              </div>
              {p.description && (
                <p className="mt-2 line-clamp-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                  {p.description}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between pt-3">
                <Badge tone={p.status ? 'success' : 'neutral'}>{p.status ? 'Active' : 'Inactive'}</Badge>
                {canManage && (
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setFormTarget(p)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(p)} style={{ color: 'var(--danger)' }} aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <PremiumPlanFormModal
            open={formTarget !== undefined}
            plan={formTarget}
            onClose={() => setFormTarget(undefined)}
            onSaved={() => {
              toast.success(formTarget ? 'Plan updated.' : 'Plan created.')
              setFormTarget(undefined)
              refetch()
            }}
          />
          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete plan"
            footer={
              <>
                <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
                  Cancel
                </button>
                <button type="button" disabled={deleting} onClick={handleDelete} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }
          >
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Delete <strong style={{ color: 'var(--ink)' }}>{deleteTarget?.plan_name}</strong>? This can't be undone.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}
