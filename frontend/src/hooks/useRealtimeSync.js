import { useEffect, useRef } from 'react'
import { useSocket } from '../context/SocketContext'

/**
 * Hook to automatically synchronize and refetch page data whenever:
 * 1. Specific Socket.io events are received in real-time.
 * 2. Socket reconnects after a network interruption.
 * 3. The admin switches back to the tab/window (visibilitychange).
 * 4. Safety background fallback heartbeat interval (optional, default 30s).
 *
 * @param {string|string[]} events - Single event name or array of event names to listen on
 * @param {Function} refetch - The fetch/refetch callback to run
 * @param {Object} [options]
 * @param {boolean} [options.syncOnFocus=true] - Refetch when user returns to tab
 * @param {number} [options.fallbackInterval=30000] - Interval in ms for background sync (0 to disable)
 */
export default function useRealtimeSync(events, refetch, options = {}) {
  const { syncOnFocus = true, fallbackInterval = 30000 } = options
  const { socket, connected } = useSocket()
  const refetchRef = useRef(refetch)
  const prevConnectedRef = useRef(connected)

  useEffect(() => {
    refetchRef.current = refetch
  }, [refetch])

  // Real-time socket event listeners
  useEffect(() => {
    if (!socket) return

    const eventList = Array.isArray(events) ? events : [events]
    const handler = () => {
      if (typeof refetchRef.current === 'function') {
        refetchRef.current()
      }
    }

    eventList.forEach((evt) => {
      socket.on(evt, handler)
    })

    return () => {
      eventList.forEach((evt) => {
        socket.off(evt, handler)
      })
    }
  }, [socket, events])

  // Trigger refetch when connection is restored
  useEffect(() => {
    if (!prevConnectedRef.current && connected) {
      if (typeof refetchRef.current === 'function') {
        refetchRef.current()
      }
    }
    prevConnectedRef.current = connected
  }, [connected])

  // Window focus / tab visibility sync
  useEffect(() => {
    if (!syncOnFocus || typeof window === 'undefined') return

    let lastSync = Date.now()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync > 3000) {
        lastSync = Date.now()
        if (typeof refetchRef.current === 'function') {
          refetchRef.current()
        }
      }
    }

    window.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      window.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [syncOnFocus])

  // Background fallback interval
  useEffect(() => {
    if (!fallbackInterval || fallbackInterval <= 0) return

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && typeof refetchRef.current === 'function') {
        refetchRef.current()
      }
    }, fallbackInterval)

    return () => clearInterval(timer)
  }, [fallbackInterval])
}
