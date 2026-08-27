import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({ page, limit, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
      <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
        Page <span className="font-mono-data">{page}</span> of <span className="font-mono-data">{totalPages}</span> ·{' '}
        <span className="font-mono-data">{total}</span> total
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] disabled:opacity-40"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        >
          <ChevronLeft size={13} /> Prev
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] disabled:opacity-40"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}
