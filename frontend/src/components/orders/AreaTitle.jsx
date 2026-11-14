import { extractAreaFromAddress } from '../../utils/addressUtils'

// Bold "Main Area" title shown above an order's pickup/drop address.
// If title is missing/empty, safely falls back to extracting locality from address.
// Renders as plain text (React escapes it) and nothing at all when empty.
export default function AreaTitle({ title, address, className = '' }) {
  const text = (typeof title === 'string' && title.trim()) || extractAreaFromAddress(address) || ''
  if (!text) return null
  return (
    <div className={`truncate text-[11.5px] font-semibold ${className}`} style={{ color: 'var(--ink)' }}>
      {text}
    </div>
  )
}
