import { useCallback, useState } from 'react'
import { Plus, Pencil, Trash2, ImageOff } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import CategoryFormModal from '../components/master/CategoryFormModal'
import { resolveImageUrl } from '../utils/imageUrl'

function Thumb({ src }) {
  const url = resolveImageUrl(src)
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <ImageOff size={14} style={{ color: 'var(--ink-faint)' }} />}
    </div>
  )
}

export default function Categories() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/categories').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const categories = data?.data ?? []

  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await api.delete(`/categories/${deleteTarget.id}`)
      toast.success('Category deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      setDeleteError(err.response?.data?.message || 'Could not delete this category.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Package Categories
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Customer-app vehicle categories that rate cards attach to.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New category
          </button>
        )}
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['', 'Category', 'City', 'Sort', 'Status', canManage ? '' : undefined].filter((h) => h !== undefined).map((h, i) => (
                  <th key={h || i} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                categories.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5">
                      <Thumb src={c.cat_img} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {c.cat_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.city_id ? `#${c.city_id}` : 'All cities'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.sort_order ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={c.cat_status === 1 ? 'success' : 'neutral'}>{c.cat_status === 1 ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => setFormTarget(c)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(c)} style={{ color: 'var(--danger)' }} aria-label="Delete">
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

      {canManage && (
        <>
          <CategoryFormModal
            open={formTarget !== undefined}
            category={formTarget}
            onClose={() => setFormTarget(undefined)}
            onSaved={() => {
              toast.success(formTarget ? 'Category updated.' : 'Category created.')
              setFormTarget(undefined)
              refetch()
            }}
          />
          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete category"
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
            {deleteError && (
              <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
                {deleteError}
              </div>
            )}
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Delete <strong style={{ color: 'var(--ink)' }}>{deleteTarget?.cat_name}</strong>? Blocked if any rate cards still reference it.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}
