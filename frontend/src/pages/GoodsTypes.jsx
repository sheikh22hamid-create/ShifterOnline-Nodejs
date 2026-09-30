import { useCallback, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import GoodsTypeFormModal from '../components/cms/GoodsTypeFormModal'

export default function GoodsTypes() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/goods-types').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const goodsTypes = data?.data ?? []

  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await api.delete(`/goods-types/${deleteTarget.id}`)
      // The backend says when it deactivated (type used by old orders) instead of deleting.
      toast.success(res.data?.message || 'Goods type deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this goods type.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Goods Types
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Options customers can pick as the goods being carried when booking.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New goods type
          </button>
        )}
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Name', 'Sort', 'Status', canManage ? '' : undefined].filter((h) => h !== undefined).map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={4} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && goodsTypes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No goods types yet. Customers will only see the "Other" option until you add some.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                goodsTypes.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {t.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {t.sort_order}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={t.status ? 'success' : 'neutral'}>{t.status ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => setFormTarget(t)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(t)} style={{ color: 'var(--danger)' }} aria-label="Delete">
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
      </div>

      <GoodsTypeFormModal
        open={formTarget !== undefined}
        item={formTarget}
        onClose={() => setFormTarget(undefined)}
        onSaved={() => {
          toast.success(formTarget ? 'Goods type updated.' : 'Goods type created.')
          setFormTarget(undefined)
          refetch()
        }}
      />
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete goods type"
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
          Delete <strong style={{ color: 'var(--ink)' }}>{deleteTarget?.name}</strong>? If existing orders use it, it is deactivated instead and those orders keep their goods type.
        </p>
      </Modal>
    </div>
  )
}
