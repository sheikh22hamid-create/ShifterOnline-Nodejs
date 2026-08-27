import { useEffect, useState } from 'react'
import { Eye, Code } from 'lucide-react'
import DOMPurify from 'dompurify'
import api from '../../services/api'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_FORM = { title: '', description: '', status: 1 }

export default function PageFormModal({ open, page, onClose, onSaved }) {
  const isEdit = Boolean(page)
  const [form, setForm] = useState(EMPTY_FORM)
  const [view, setView] = useState('edit')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which page it
    // targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    setView('edit')
    setForm(page ? { title: page.title, description: page.description, status: page.status } : EMPTY_FORM)
  }, [open, page])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) await api.put(`/pages/${page.id}`, form)
      else await api.post('/pages', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this page.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${page.title}` : 'New legal page'}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.title || !form.description}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create page'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="page-title">
        Title
      </label>
      <input id="page-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="e.g. Privacy Policy" />

      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="page-body">
          Content (HTML)
        </label>
        <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setView('edit')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{ background: view === 'edit' ? 'var(--brand-soft)' : 'transparent', color: view === 'edit' ? 'var(--brand)' : 'var(--ink-muted)' }}
          >
            <Code size={11} /> Edit
          </button>
          <button
            type="button"
            onClick={() => setView('preview')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{ background: view === 'preview' ? 'var(--brand-soft)' : 'transparent', color: view === 'preview' ? 'var(--brand)' : 'var(--ink-muted)' }}
          >
            <Eye size={11} /> Preview
          </button>
        </div>
      </div>

      {view === 'edit' ? (
        <textarea
          id="page-body"
          rows={10}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="font-mono-data mb-3 w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
          style={FIELD_STYLE}
        />
      ) : (
        <div
          className="prose-preview mb-3 max-h-64 overflow-y-auto rounded-lg border p-3 text-[13px]"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          // Sanitized even though it's the same superadmin previewing their
          // own just-typed content — cheap insurance, and this HTML is what
          // eventually reaches the customer app's webview too.
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(form.description || '<em>Nothing to preview yet</em>') }}
        />
      )}

      {isEdit && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="page-status">
            Status
          </label>
          <select id="page-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value={1}>Published</option>
            <option value={0}>Unpublished</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
