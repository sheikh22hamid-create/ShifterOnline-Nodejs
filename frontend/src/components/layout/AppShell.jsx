import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Bell, X } from 'lucide-react'
import { useSocket } from '../../context/SocketContext'
import { useToast } from '../../context/ToastContext'
import { playOrderChime } from '../../utils/sound'
import { formatCurrency } from '../../utils/format'
import OrderDetailDrawer from '../orders/OrderDetailDrawer'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [incomingOrder, setIncomingOrder] = useState(null)
  const [activeOrderDrawerId, setActiveOrderDrawerId] = useState(null)
  const { socket } = useSocket()
  const toast = useToast()

  useEffect(() => {
    if (!socket) return

    function handleNewOrder(data) {
      playOrderChime()
      setIncomingOrder(data)
      const orderId = data?.order_id || 'New'
      const fare = data?.total_dcharge ? formatCurrency(data.total_dcharge) : ''
      const cust = data?.customer_name ? `by ${data.customer_name}` : ''
      toast.info(`🔔 New Order #${orderId} booked ${cust} (${fare})`)
    }

    function handleDispatchAlert(data) {
      toast.warning(data?.message || `Order #${data?.order_id} needs manual driver assignment!`)
    }

    socket.on('admin:new_order', handleNewOrder)
    socket.on('admin:dispatch_alert', handleDispatchAlert)

    return () => {
      socket.off('admin:new_order', handleNewOrder)
      socket.off('admin:dispatch_alert', handleDispatchAlert)
    }
  }, [socket, toast])

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg)' }}>
      {/* Floating Interactive Order Alert Card */}
      {incomingOrder && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[999998] flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--brand)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl animate-bounce shrink-0" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <Bell size={18} />
          </div>
          <div className="text-left min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono-data text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                Order #{incomingOrder.order_id}
              </span>
              <span className="text-[10.5px] rounded-full px-2 py-0.5 font-bold uppercase tracking-wider" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                New Booking
              </span>
            </div>
            <div className="truncate text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              {incomingOrder.customer_name ? `Customer: ${incomingOrder.customer_name}` : 'New Customer Order'} · <strong style={{ color: 'var(--ink)' }}>{formatCurrency(incomingOrder.total_dcharge)}</strong>
            </div>
          </div>
          <div className="flex items-center gap-1.5 pl-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const id = incomingOrder.order_id
                setIncomingOrder(null)
                setActiveOrderDrawerId(id)
              }}
              className="rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              View Order
            </button>
            <button
              type="button"
              onClick={() => setIncomingOrder(null)}
              className="rounded-lg p-1.5 transition-all hover:bg-black/5"
              style={{ color: 'var(--ink-faint)' }}
              aria-label="Dismiss order popup"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      <Sidebar open={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />

      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>

      {activeOrderDrawerId && (
        <OrderDetailDrawer
          orderId={activeOrderDrawerId}
          onClose={() => setActiveOrderDrawerId(null)}
        />
      )}
    </div>
  )
}
