import { useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { question: '', type: 'Checkbox', status: 1 }

export default function QuestionFormModal({ open, question, onClose, onSaved }) {
  const isEdit = Boolean(question)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // Re-seeds the form when the target question changes while this modal
    // stays mounted — a real sync-to-props transition, not first-render echo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setForm(question ? { question: question.question, type: question.type, status: question.status } : EMPTY_FORM)
  }, [open, question])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/questions/${question.id}`, form)
      else await api.post('/questions', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this question.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Survey Question' : 'New Survey Question'}
      width={460}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.question}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create question'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="question-text">
        Question
      </label>
      <input
        id="question-text"
        value={form.question}
        onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={FIELD_STYLE}
      />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="question-type">
        Answer Type
      </label>
      <select
        id="question-type"
        value={form.type}
        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={FIELD_STYLE}
      >
        <option value="Checkbox">Checkbox (multi-select)</option>
        <option value="Radio">Radio (single-select)</option>
      </select>

      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        <input type="checkbox" checked={form.status === 1} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 1 : 0 }))} /> Published
      </label>
    </Modal>
  )
}
