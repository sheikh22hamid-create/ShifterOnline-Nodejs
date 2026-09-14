import { useCallback, useEffect, useState } from 'react'
import api from '../services/api'
import useRealtimeSync from './useRealtimeSync'

const FALLBACK_STATUSES = ['pending', 'processing', 'pickup', 'on_route']

export default function useActiveTrips() {
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchActive = useCallback(async () => {
    try {
      const res = await api.get('/fleet/active-trips')
      if (res?.data?.success && Array.isArray(res.data.data)) {
        setTrips(res.data.data)
        setError('')
        return
      }
    } catch (err) {
      // Fallback to fanout if active-trips endpoint fails
    }

    try {
      const responses = await Promise.all(
        FALLBACK_STATUSES.map((status) => api.get('/orders', { params: { status, limit: 50 } }))
      )
      const merged = responses.flatMap((res) => res.data?.data || [])
      const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values())
      unique.sort((a, b) => b.id - a.id)
      setTrips(unique)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load active trips.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActive()
  }, [fetchActive])

  // Real-time refresh on order updates, new orders, dispatch alerts and driver transitions
  useRealtimeSync(
    ['admin:order_status_update', 'admin:new_order', 'admin:driver_status_update', 'admin:dispatch_alert'],
    fetchActive,
    { fallbackInterval: 6000 }
  )

  return { trips, loading, error, refetch: fetchActive }
}
