import { useCallback, useState } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import FaqFormModal from '../components/cms/FaqFormModal'

export default function Faqs() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/faqs').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const faqs = data?.data ?? []

  const [openId, setOpenId] = useState(null)
  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/faqs/${deleteTarget.id}`)
      toast.success('FAQ deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this FAQ.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            FAQs
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            In-app help & support questions.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New FAQ
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="surface-card mt-4 rounded-xl p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {!loading && !error && faqs.length === 0 && (
        <div className="surface-card mt-4 rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No FAQs yet.
        </div>
      )}

      {!loading && !error && faqs.length > 0 && (
        <div className="surface-card mt-4 divide-y overflow-hidden rounded-xl" style={{ borderColor: 'var(--border)' }}>
          {faqs.map((f) => (
            <div key={f.id} style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setOpenId(openId === f.id ? null : f.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                  {f.question}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={f.status === 1 ? 'success' : 'neutral'}>{f.status === 1 ? 'Active' : 'Inactive'}</Badge>
                  <ChevronDown size={14} className="transition-transform" style={{ color: 'var(--ink-faint)', transform: openId === f.id ? 'rotate(180deg)' : 'none' }} />
                </div>
              </button>
              {openId === f.id && (
                <div className="px-4 pb-3.5">
                  <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {f.answer}
                  </p>
                  {canManage && (
                    <div className="mt-2 flex gap-3">
                      <button type="button" onClick={() => setFormTarget(f)} className="text-[12px] font-medium" style={{ color: 'var(--brand)' }}>
                        Edit
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(f)} className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <FaqFormModal
            open={formTarget !== undefined}
            faq={formTarget}
            onClose={() => setFormTarget(undefined)}
            onSaved={() => {
              toast.success(formTarget ? 'FAQ updated.' : 'FAQ created.')
              setFormTarget(undefined)
              refetch()
            }}
          />
          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete FAQ"
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
              Delete this FAQ? This can't be undone.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}
