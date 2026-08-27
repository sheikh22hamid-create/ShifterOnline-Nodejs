import { useCallback, useState } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import QuestionFormModal from '../components/settings/QuestionFormModal'
import QuestionOptionsPanel from '../components/settings/QuestionOptionsPanel'

export default function DynamicQuestions() {
  const toast = useToast()

  const fetcher = useCallback(() => api.get('/questions').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const questions = data?.data ?? []

  const [openId, setOpenId] = useState(null)
  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/questions/${deleteTarget.id}`)
      toast.success('Question deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this question.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Dynamic Questions
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Post-trip survey questions shown to customers, and their answer choices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormTarget(null)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          <Plus size={14} /> New Question
        </button>
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
      {!loading && !error && questions.length === 0 && (
        <div className="surface-card mt-4 rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No survey questions yet.
        </div>
      )}

      {!loading && !error && questions.length > 0 && (
        <div className="surface-card mt-4 divide-y overflow-hidden rounded-xl" style={{ borderColor: 'var(--border)' }}>
          {questions.map((q) => (
            <div key={q.id} style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setOpenId(openId === q.id ? null : q.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                  {q.question}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="info">{q.type}</Badge>
                  <Badge tone="neutral">{q.option_count} option{q.option_count === 1 ? '' : 's'}</Badge>
                  <Badge tone={q.status === 1 ? 'success' : 'neutral'}>{q.status === 1 ? 'Published' : 'Unpublished'}</Badge>
                  <ChevronDown size={14} className="transition-transform" style={{ color: 'var(--ink-faint)', transform: openId === q.id ? 'rotate(180deg)' : 'none' }} />
                </div>
              </button>
              {openId === q.id && (
                <div className="px-4 pb-3.5">
                  <QuestionOptionsPanel questionId={q.id} onOptionCountChange={refetch} />
                  <div className="mt-2 flex gap-3">
                    <button type="button" onClick={() => setFormTarget(q)} className="text-[12px] font-medium" style={{ color: 'var(--brand)' }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(q)} className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <QuestionFormModal
        open={formTarget !== undefined}
        question={formTarget}
        onClose={() => setFormTarget(undefined)}
        onSaved={() => {
          toast.success(formTarget ? 'Question updated.' : 'Question created.')
          setFormTarget(undefined)
          refetch()
        }}
      />
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Question"
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
          Delete this question and all its answer choices? This can't be undone.
        </p>
      </Modal>
    </div>
  )
}
