import { useCallback, useState } from 'react'
import { Plus, Pencil, Trash2, FileText } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import PageFormModal from '../components/cms/PageFormModal'

export default function LegalPages() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/pages').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const pages = data?.data ?? []

  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/pages/${deleteTarget.id}`)
      toast.success('Page deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this page.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Legal Pages
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Privacy, terms, about, refund — static content for the app.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New page
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="surface-card mt-4 rounded-xl p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {!loading && !error && pages.length === 0 && (
        <div className="surface-card mt-4 rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No pages yet.
        </div>
      )}

      {!loading && !error && pages.length > 0 && (
        <div className="mt-4 space-y-2">
          {pages.map((p) => (
            <div key={p.id} className="surface-card flex items-center justify-between rounded-xl p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                  <FileText size={16} />
                </div>
                <div>
                  <div className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                    {p.title}
                  </div>
                  <Badge tone={p.status === 1 ? 'success' : 'neutral'}>{p.status === 1 ? 'Published' : 'Unpublished'}</Badge>
                </div>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFormTarget(p)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => setDeleteTarget(p)} style={{ color: 'var(--danger)' }} aria-label="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <PageFormModal
            open={formTarget !== undefined}
            page={formTarget}
            onClose={() => setFormTarget(undefined)}
            onSaved={() => {
              toast.success(formTarget ? 'Page updated.' : 'Page created.')
              setFormTarget(undefined)
              refetch()
            }}
          />
          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete page"
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
              Delete <strong style={{ color: 'var(--ink)' }}>{deleteTarget?.title}</strong>? This can't be undone.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}
