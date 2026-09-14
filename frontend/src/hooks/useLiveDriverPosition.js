import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import { haversineMeters } from '../utils/geo'

/**
 * Subscribes to admin:live_driver_ping & driver:location_stream for one rider and tracks raw pings.
 */
export default function useLiveDriverPosition(riderId) {
  const { socket } = useSocket()
  const [speedKmh, setSpeedKmh] = useState(null)
  const [pingVersion, setPingVersion] = useState(0)
  const latestPingRef = useRef(null) // { lat, lng, heading, t }
  const prevPingRef = useRef(null)

  useEffect(() => {
    latestPingRef.current = null
    prevPingRef.current = null
    setSpeedKmh(null)
    setPingVersion(0)
  }, [riderId])

  useEffect(() => {
    if (!socket || !riderId) return

    function onPing(payload) {
      if (!payload) return
      const pRiderId = Number(payload.rider_id)
      const targetRiderId = Number(riderId)
      const lat = Number(payload.lat)
      const lng = Number(payload.lng)

      if (pRiderId !== targetRiderId || !Number.isFinite(lat) || !Number.isFinite(lng)) return

      const now = performance.now()
      const heading = Number.isFinite(Number(payload.heading)) ? Number(payload.heading) : prevPingRef.current?.heading ?? 0
      const next = {
        lat,
        lng,
        heading,
        t: now,
      }

      const prev = prevPingRef.current
      if (prev) {
        const seconds = (now - prev.t) / 1000
        if (seconds > 0.5) {
          const meters = haversineMeters([prev.lat, prev.lng], [next.lat, next.lng])
          setSpeedKmh((meters / seconds) * 3.6)
        }
      }

      prevPingRef.current = next
      latestPingRef.current = next
      setPingVersion((v) => v + 1)
    }

    socket.on('admin:live_driver_ping', onPing)
    socket.on('driver:location_stream', onPing)

    return () => {
      socket.off('admin:live_driver_ping', onPing)
      socket.off('driver:location_stream', onPing)
    }
  }, [socket, riderId])

  return { latestPingRef, speedKmh, pingVersion }
}
