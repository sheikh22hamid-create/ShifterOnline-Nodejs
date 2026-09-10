import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useSocket } from '../../context/SocketContext'
import { useToast } from '../../context/ToastContext'
import { playOrderChime } from '../../utils/sound'
import { formatCurrency } from '../../utils/format'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { socket } = useSocket()
  const toast = useToast()

  useEffect(() => {
    if (!socket) return

    function handleNewOrder(data) {
      playOrderChime()
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
    </div>
  )
}
