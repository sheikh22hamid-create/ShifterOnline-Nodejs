import { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './AuthContext'

const SocketContext = createContext(null)

export function SocketProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      // A real transition (e.g. logout while connected), not just mirroring
      // initial state — the socket this effect owns needs tearing down and
      // its connection status reflected, which an effect is exactly for
      // (this *is* syncing React state with an external system, per the
      // rule's own guidance — the heuristic just can't see that here).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSocket(null)
      setConnected(false)
      return
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin
    const nextSocket = io(socketUrl, { transports: ['websocket'] })
    nextSocket.on('connect', () => {
      const token = localStorage.getItem('shifter_admin_token')
      nextSocket.emit('admin:join', { token })
    })
    nextSocket.on('admin:join:ack', (ack) => setConnected(Boolean(ack?.Result)))
    nextSocket.on('disconnect', () => setConnected(false))
    setSocket(nextSocket)

    return () => {
      nextSocket.close()
    }
  }, [isAuthenticated])

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Provider+hook co-location
export function useSocket() {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}
