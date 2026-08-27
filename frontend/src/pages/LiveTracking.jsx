import { useCallback, useEffect, useState } from 'react'
import api from '../services/api'
import { useSocket } from '../context/SocketContext'
import useApiQuery from '../hooks/useApiQuery'
import useActiveTrips from '../hooks/useActiveTrips'
import useOsrmRoute from '../hooks/useOsrmRoute'
import useLiveDriverPosition from '../hooks/useLiveDriverPosition'
import { getTripPhase } from '../utils/tripPhase'
import MissionControlMap from '../components/tracking/MissionControlMap'
import MissionHUD from '../components/tracking/MissionHUD'
import ActiveTripsCarousel from '../components/tracking/ActiveTripsCarousel'

// How often the "moving" leg's OSRM route is recalculated. Not tied to the
// GPS ping rate — that would hammer the public OSRM instance for no visual
// benefit, since the marker itself is animated every frame regardless (see
// MissionControlMap), and the polyline is shrunk client-side between fetches.
const ROUTING_REFRESH_MS = 20000

function toPoint(latStr, lngStr) {
  const lat = Number(latStr)
  const lng = Number(lngStr)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

export default function LiveTracking() {
  const { socket } = useSocket()
  const { trips, loading: tripsLoading } = useActiveTrips()
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [liveMetrics, setLiveMetrics] = useState(null)

  useEffect(() => {
    // Auto-focusing the first active trip once the list arrives — same
    // external-data-arrived case as useApiQuery's own setData.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedOrderId && trips.length > 0) setSelectedOrderId(trips[0].id)
  }, [trips, selectedOrderId])

  const tripFetcher = useCallback(
    () => (selectedOrderId ? api.get(`/orders/${selectedOrderId}`).then((res) => res.data.data) : Promise.resolve(null)),
    [selectedOrderId]
  )
  const { data: trip, loading: tripLoading, refetch: refetchTrip } = useApiQuery(tripFetcher)

  // Phase transitions (e.g. Pickup -> On_Route) arrive on this event —
  // refetch the focused trip immediately instead of waiting on anything else.
  useEffect(() => {
    if (!socket || !selectedOrderId) return
    function onUpdate(payload) {
      if (payload?.order_id === selectedOrderId) refetchTrip()
    }
    socket.on('admin:order_status_update', onUpdate)
    return () => socket.off('admin:order_status_update', onUpdate)
  }, [socket, selectedOrderId, refetchTrip])

  useEffect(() => {
    // Clearing stale metrics from whichever trip was previously focused —
    // a real transition, not a mirror of initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveMetrics(null)
  }, [selectedOrderId])

  const phase = getTripPhase(trip)
  const pickupPoint = trip ? toPoint(trip.plat, trip.plong) : null
  const dropoffPoint = trip ? toPoint(trip.dlat, trip.dlong) : null
  const driverSnapshot = trip?.rider ? toPoint(trip.rider.rlats, trip.rider.rlongs) : null
  const riderId = trip?.rid || null
  // The rider's own free-text vehicle description isn't part of the order
  // detail response — the order's rate-card title (e.g. "Bike", "Mini
  // Truck") is, and is arguably the more correct signal anyway: it's the
  // vehicle class the trip was actually booked for.
  const vehicleText = trip?.package?.title || ''

  const { latestPingRef, speedKmh, pingVersion } = useLiveDriverPosition(riderId)

  const [routingOrigin, setRoutingOrigin] = useState(null)
  useEffect(() => {
    function sample() {
      setRoutingOrigin(latestPingRef.current ? { lat: latestPingRef.current.lat, lng: latestPingRef.current.lng } : driverSnapshot)
    }
    sample()
    const id = setInterval(sample, ROUTING_REFRESH_MS)
    return () => clearInterval(id)
    // Resample immediately (and restart the heartbeat) whenever the focused
    // driver or the active phase changes; driverSnapshot/latestPingRef are
    // read fresh inside `sample` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId, phase])

  const { route: leg1Route } = useOsrmRoute(phase === 1 ? routingOrigin : null, phase === 1 ? pickupPoint : null)
  const { route: leg2Route } = useOsrmRoute(phase === 1 ? pickupPoint : null, phase === 1 ? dropoffPoint : null)
  const { route: activeLegRoute } = useOsrmRoute(phase === 2 ? routingOrigin : null, phase === 2 ? dropoffPoint : null)

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Live Mission Control
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Real-time multi-leg route tracking for every trip currently in progress.
        </p>
      </div>

      <div className="surface-card relative min-h-[640px] flex-1 overflow-hidden rounded-xl">
        <MissionControlMap
          trip={trip}
          phase={phase}
          pickupPoint={pickupPoint}
          dropoffPoint={dropoffPoint}
          driverSnapshot={driverSnapshot}
          vehicleText={vehicleText}
          leg1Route={leg1Route}
          leg2Route={leg2Route}
          activeLegRoute={activeLegRoute}
          latestPingRef={latestPingRef}
          pingVersion={pingVersion}
          onLiveMetricsChange={setLiveMetrics}
        />
        <MissionHUD trip={trip} phase={phase} speedKmh={speedKmh} liveMetrics={liveMetrics} loading={tripLoading && Boolean(selectedOrderId)} />
        <ActiveTripsCarousel trips={trips} selectedOrderId={selectedOrderId} onSelect={setSelectedOrderId} loading={tripsLoading} />
      </div>
    </div>
  )
}
