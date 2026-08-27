import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import useApiQuery from '../../hooks/useApiQuery'

export default function QuestionOptionsPanel({ questionId, onOptionCountChange }) {
  const toast = useToast()
  const fetcher = useCallback(() => api.get(`/questions/${questionId}/options`).then((res) => res.data), [questionId])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const options = data?.data ?? []

  const [newOption, setNewOption] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  async function handleAdd() {
    if (!newOption.trim()) return
    setAdding(true)
    try {
      await api.post(`/questions/${questionId}/options`, { title: newOption.trim() })
      setNewOption('')
      refetch()
      onOptionCountChange?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add this option.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(optionId) {
    setRemovingId(optionId)
    try {
      await api.delete(`/questions/${questionId}/options/${optionId}`)
      refetch()
      onOptionCountChange?.()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove this option.')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="mt-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
        Answer choices
      </p>

      {loading && <p className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Loading…</p>}
      {!loading && error && <p className="text-[12.5px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      {!loading && !error && options.length === 0 && (
        <p className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>No answer choices yet — add at least one below.</p>
      )}

      {!loading && !error && options.length > 0 && (
        <ul className="mb-2 space-y-1">
          {options.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              <span>{o.title}</span>
              <button
                type="button"
                disabled={removingId === o.id}
                onClick={() => handleRemove(o.id)}
                aria-label={`Remove option ${o.title}`}
                style={{ color: 'var(--ink-faint)' }}
                className="disabled:opacity-50"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add an answer choice…"
          className="flex-1 rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
        />
        <button
          type="button"
          disabled={adding || !newOption.trim()}
          onClick={handleAdd}
          className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}
