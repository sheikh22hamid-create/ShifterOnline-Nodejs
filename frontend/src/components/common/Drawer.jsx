import { X } from 'lucide-react'

export default function Drawer({ open, onClose, title, subtitle, children, width = 480 }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative flex h-full flex-col border-l"
        style={{ width: 'min(100%, ' + width + 'px)', background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
      >
        <div className="flex shrink-0 items-start justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ color: 'var(--ink-faint)' }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
