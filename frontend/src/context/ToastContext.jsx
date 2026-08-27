import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

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
      setTimeout(() => dismiss(id), 3500)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ success: (m) => push(m, 'success'), error: (m) => push(m, 'error') }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]"
            style={{
              background: t.tone === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
              borderColor: t.tone === 'success' ? 'var(--success-soft-border)' : 'var(--danger-soft-border)',
              color: t.tone === 'success' ? 'var(--success)' : 'var(--danger)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {t.tone === 'success' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {t.message}
          </div>
        ))}
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
