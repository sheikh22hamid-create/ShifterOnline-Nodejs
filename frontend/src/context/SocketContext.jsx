import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './AuthContext'

const SocketContext = createContext(null)

const PROD_SOCKET_URL = 'https://shifteronline-nodejs.onrender.com'

function resolveSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL
  }
  // In local browser dev, connect to backend port 5000 if running on Vite (5173)
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return window.location.port !== '5000' ? 'http://localhost:5000' : window.location.origin
  }
  return PROD_SOCKET_URL
}

export function SocketProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [lastActivity, setLastActivity] = useState(null)
  const socketRef = useRef(null)

  const joinAdminRoom = useCallback((sock) => {
    const targetSocket = sock || socketRef.current
    if (!targetSocket || !targetSocket.connected) return
    const token = localStorage.getItem('shifter_admin_token')
    if (token) {
      targetSocket.emit('admin:join', { token })
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      setSocket(null)
      setConnected(false)
      return
    }

    const socketUrl = resolveSocketUrl()
    const token = localStorage.getItem('shifter_admin_token')
    const nextSocket = io(socketUrl, {
      auth: { token },
      query: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 15000,
    })

    socketRef.current = nextSocket

    nextSocket.on('connect', () => {
      setConnected(true)
      joinAdminRoom(nextSocket)
      setLastActivity(Date.now())
    })

    nextSocket.on('admin:join:ack', (ack) => {
      setConnected(Boolean(ack?.Result))
      setLastActivity(Date.now())
    })

    nextSocket.on('disconnect', () => {
      setConnected(false)
    })

    nextSocket.on('connect_error', () => {
      setConnected(false)
    })

    // Track any incoming socket traffic as activity
    nextSocket.onAny(() => {
      setLastActivity(Date.now())
    })

    setSocket(nextSocket)

    return () => {
      if (nextSocket) {
        nextSocket.disconnect()
      }
      socketRef.current = null
    }
  }, [isAuthenticated, joinAdminRoom])

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.connect()
      joinAdminRoom(socketRef.current)
    }
  }, [joinAdminRoom])

  return (
    <SocketContext.Provider value={{ socket, connected, lastActivity, reconnect }}>
      {children}
    </SocketContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- standard Provider+hook co-location
export function useSocket() {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}

