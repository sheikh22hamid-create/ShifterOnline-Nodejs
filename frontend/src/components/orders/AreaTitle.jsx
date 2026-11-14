// Bold "Main Area" title shown above an order's pickup/drop address.
// Renders as plain text (React escapes it) and nothing at all when empty.
export default function AreaTitle({ title, className = '' }) {
  const text = typeof title === 'string' ? title.trim() : ''
  if (!text) return null
  return (
    <div className={`truncate text-[11.5px] font-semibold ${className}`} style={{ color: 'var(--ink)' }}>
      {text}
    </div>
  )
}
