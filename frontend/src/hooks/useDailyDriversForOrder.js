import { useCallback } from 'react'
import api from '../services/api'
import useApiQuery from './useApiQuery'

/**
 * Available Daily Drivers for an order, for the "Daily Drivers" filter on the manual-assign pickers.
 * `applicable` is false for orders the filter is not meant for (anything but scheduled, next-day or a
 * Booking Guarantee order) and also if the list could not be loaded, so the picker then just behaves as before.
 */
export default function useDailyDriversForOrder(orderId, enabled = true) {
  const fetcher = useCallback(
    () => api.get(`/orders/${orderId}/daily-drivers`).then((res) => res.data?.data ?? { applicable: false, drivers: [] }),
    [orderId],
  )
  const { data, loading } = useApiQuery(fetcher, { enabled: Boolean(enabled && orderId) })
  return {
    applicable: Boolean(data?.applicable),
    drivers: data?.drivers ?? [],
    loading,
  }
}
