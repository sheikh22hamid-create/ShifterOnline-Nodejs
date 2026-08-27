import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../context/SocketContext'
import { haversineMeters } from '../utils/geo'

/**
 * Subscribes to admin:live_driver_ping for one rider and tracks the raw
 * pings — nothing here touches the DOM or interpolates a per-frame
 * position. That work belongs to whatever imperatively drives the Leaflet
 * marker (MissionControlMap), so this hook doesn't trigger a React
 * re-render 60 times a second; it only updates state once per real ping.
 *
 * `latestPingRef` / `prevPingRef` are exposed as refs (not state) since
 * consumers read them inside their own animation loops or on their own
 * timer cadence (e.g. throttled OSRM refetches), not on every ping.
 * `pingVersion` is the cheap signal that a new ping arrived.
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
    // The focused rider changed — a real transition, not a mirror of
    // initial state, so resetting speed/ping-version here is legitimate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeedKmh(null)
    setPingVersion(0)
  }, [riderId])

  useEffect(() => {
    if (!socket || !riderId) return

    function onPing(payload) {
      if (payload.rider_id !== riderId || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return

      const now = performance.now()
      const next = {
        lat: payload.lat,
        lng: payload.lng,
        heading: Number.isFinite(payload.heading) ? payload.heading : prevPingRef.current?.heading ?? 0,
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
    return () => socket.off('admin:live_driver_ping', onPing)
  }, [socket, riderId])

  return { latestPingRef, speedKmh, pingVersion }
}
