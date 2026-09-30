const prisma = require("../config/db");
const { getRoadDistanceKm, getMultiStopDistanceKm, haversineKm } = require("../utils/geoDistance");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");

/**
 * Real distance from the assigned driver's last FRESH GPS fix to a target
 * point (pickup or otherwise) — never order.radius_range (the customer's
 * search-radius setting) or the never-written order.pickup_distance_km.
 * Mirrors tripLifecycle.finalizeAcceptedOrder's own driverToPickupKm calc,
 * gated by the same staleness window dispatch/availability already use
 * (RIDER_LOCATION_FRESHNESS_MS), so a driver's last-known office location
 * can't get billed against a customer sitting at home. Falls back to 1
 * (== zero radius charge) when there's no driver yet, or their fix is
 * missing/stale — the same "unknown location" convention used everywhere
 * else in pricing.
 */
async function getDriverRealDistanceKm(rid, targetLat, targetLng) {
  if (!rid || rid <= 0) return 1;
  const rider = await prisma.tbl_rider.findUnique({
    where: { id: rid },
    select: { rlats: true, rlongs: true, rloc_updated_at: true },
  });
  const freshEnough = rider?.rloc_updated_at &&
    (Date.now() - new Date(rider.rloc_updated_at).getTime()) <= RIDER_LOCATION_FRESHNESS_MS;
  const driverLat = Number(rider?.rlats ?? NaN);
  const driverLng = Number(rider?.rlongs ?? NaN);
  const targetLatNum = Number(targetLat);
  const targetLngNum = Number(targetLng);
  if (!freshEnough || ![driverLat, driverLng, targetLatNum, targetLngNum].every(Number.isFinite)) {
    return 1;
  }
  return haversineKm(driverLat, driverLng, targetLatNum, targetLngNum);
}

/**
 * Road distance for a pickup -> [stops] -> drop route, given any combination
 * of updated pickup/stops/drop points. Shared by destination-change,
 * pickup-change, and add-stop so all three price a moved leg the same way.
 */
async function computeRouteDistanceKm({ plat, plong, stops = [], dlat, dlong }) {
  const p = { lat: Number(plat), lng: Number(plong) };
  const d = { lat: Number(dlat), lng: Number(dlong) };

  if (stops.length > 0) {
    const points = [p, ...stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })), d];
    const multiResult = await getMultiStopDistanceKm(points);
    return Math.max(0.1, Number(multiResult.distanceKm) || 0.1);
  }

  const roadResult = await getRoadDistanceKm(p.lat, p.lng, d.lat, d.lng);
  let distanceKm = Number(roadResult.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    distanceKm = haversineKm(p.lat, p.lng, d.lat, d.lng) * 1.3;
  }
  return Math.max(0.1, Math.round(distanceKm * 100) / 100);
}

module.exports = { getDriverRealDistanceKm, computeRouteDistanceKm };
