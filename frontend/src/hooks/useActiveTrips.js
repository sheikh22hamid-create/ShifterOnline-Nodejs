import { useCallback, useEffect, useState } from 'react'
import api from '../services/api'
import useRealtimeSync from './useRealtimeSync'

// "Active" = accepted but not yet delivered/cancelled. There's no single
// backend filter for that OR-of-statuses, so this fans out to the existing
// list endpoint once per status and merges — three small requests instead
// of a new backend endpoint.
const ACTIVE_STATUSES = ['processing', 'pickup', 'on_route']

export default function useActiveTrips() {
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
    fetchActive()
  }, [fetchActive])

  // Real-time refresh on order updates and status transitions
  useRealtimeSync(['admin:order_status_update', 'admin:new_order'], fetchActive)

  return { trips, loading, error, refetch: fetchActive }
}
