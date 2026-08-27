import { useCallback, useEffect, useState } from 'react'
import api from '../services/api'
import { useSocket } from '../context/SocketContext'

// "Active" = accepted but not yet delivered/cancelled. There's no single
// backend filter for that OR-of-statuses, so this fans out to the existing
// list endpoint once per status and merges — three small requests instead
// of a new backend endpoint.
const ACTIVE_STATUSES = ['processing', 'pickup', 'on_route']

export default function useActiveTrips() {
  const { socket } = useSocket()
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchActive = useCallback(async () => {
    try {
      const responses = await Promise.all(ACTIVE_STATUSES.map((status) => api.get('/orders', { params: { status, limit: 100 } })))
      const merged = responses.flatMap((res) => res.data.data)
      merged.sort((a, b) => b.id - a.id)
      setTrips(merged)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load active trips.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // This effect's whole purpose is kicking off the async fetch against
    // the API — same async-boundary case as useApiQuery's own effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActive()
  }, [fetchActive])

  // Real-time refresh instead of polling — both events already broadcast
  // to the admin room today (adminSocket.js) whenever a trip's status
  // changes or a new one enters the accepted/pickup/on_route set.
  useEffect(() => {
    if (!socket) return
    function onChange() {
      fetchActive()
    }
    socket.on('admin:order_status_update', onChange)
    socket.on('admin:new_order', onChange)
    return () => {
      socket.off('admin:order_status_update', onChange)
      socket.off('admin:new_order', onChange)
    }
  }, [socket, fetchActive])

  return { trips, loading, error, refetch: fetchActive }
}
