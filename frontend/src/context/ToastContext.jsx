import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, Bell, AlertTriangle } from 'lucide-react'

const ToastContext = createContext(null)
let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message, tone = 'success') => {
      const id = nextId++
      setToasts((list) => [...list, { id, message, tone }])
      setTimeout(() => dismiss(id), 4500)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider
      value={{
        success: (m) => push(m, 'success'),
        error: (m) => push(m, 'error'),
        info: (m) => push(m, 'info'),
        warning: (m) => push(m, 'warning'),
      }}
    >
      {children}
      <div className="fixed top-5 right-5 z-[999999] flex flex-col gap-2.5 max-w-sm pointer-events-none">
        {toasts.map((t) => {
          let bg = 'var(--success-soft)'
          let border = 'var(--success-soft-border)'
          let color = 'var(--success)'
          let Icon = CheckCircle2

          if (t.tone === 'error' || t.tone === 'danger') {
            bg = 'var(--danger-soft)'
            border = 'var(--danger-soft-border)'
            color = 'var(--danger)'
            Icon = XCircle
          } else if (t.tone === 'info') {
            bg = 'var(--brand-soft)'
            border = 'var(--brand-soft-border, var(--brand-soft))'
            color = 'var(--brand)'
            Icon = Bell
          } else if (t.tone === 'warning') {
            bg = 'var(--warning-soft, #fef3c7)'
            border = 'var(--warning-soft-border, #fde68a)'
            color = 'var(--warning, #d97706)'
            Icon = AlertTriangle
          }

          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] font-medium shadow-xl transition-all animate-in fade-in slide-in-from-top-2 duration-200"
              style={{
                background: bg,
                borderColor: border,
                color: color,
                boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1))',
              }}
            >
              <Icon size={18} className="shrink-0" />
              <div className="flex-1 leading-snug">{t.message}</div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="opacity-70 hover:opacity-100 p-0.5"
                aria-label="Dismiss"
              >
                <XCircle size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Provider+hook co-location
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
