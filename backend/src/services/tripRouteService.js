const { haversineKm } = require("../utils/geoDistance");

// Per-trip GPS trail for the customer's completed-order route map.
// recordSamples is called from driverTripService.progressTrip with the
// location samples the driver app already sends; buildRoute turns the stored
// trail into what the app draws (polyline + start / pickup / OTP / drop).

const MIN_SPACING_M = 10; // thin the trail: ignore jitter closer than this
const MAX_ACCURACY_M = 100; // ignore fixes the phone itself says are poor
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // ignore samples older than this
const MAX_FUTURE_MS = 2 * 60 * 1000; // ...or stamped in the future
const MAX_BATCH = 120;
const GAP_MS = 10 * 60 * 1000; // a longer silence = offline gap, don't draw a solid line over it
const OTP_POINT_MIN_M = 50; // OTP point only matters if it differs from the pickup this much

const ACTIVE_PHASE = { 1: 0, 2: 1, 3: 1 }; // order_status -> phase (en route to pickup / waiting at pickup / delivering)

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Pure: which of `samples` to keep, oldest first. `last` is the previously
// stored point ({lat, lng}) so spacing is checked across batches too.
function selectSamples({ samples, last, phase, now = Date.now() }) {
  if (!Array.isArray(samples)) return [];
  const sorted = samples
    .map((s) => ({ ...s, lat: num(s?.lat), lng: num(s?.lng), timestamp: num(s?.timestamp) }))
    .filter((s) => s.lat !== null && s.lng !== null && s.timestamp !== null)
    .filter((s) => Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180 && !(s.lat === 0 && s.lng === 0))
    .filter((s) => !(Number.isFinite(Number(s.accuracy)) && Number(s.accuracy) > MAX_ACCURACY_M))
    .filter((s) => s.timestamp >= now - MAX_AGE_MS && s.timestamp <= now + MAX_FUTURE_MS)
    .sort((a, b) => a.timestamp - b.timestamp);

  const kept = [];
  let prev = last && num(last.lat) !== null ? { lat: Number(last.lat), lng: Number(last.lng) } : null;
  for (const s of sorted) {
    if (prev && haversineKm(prev.lat, prev.lng, s.lat, s.lng) * 1000 < MIN_SPACING_M) continue;
    kept.push({ ...s, phase });
    prev = s;
    if (kept.length >= MAX_BATCH) break;
  }
  return kept;
}

async function recordSamples(tx, { orderId, riderId, orderStatus, samples, now = Date.now() }) {
  const phase = ACTIVE_PHASE[orderStatus];
  if (phase === undefined || !Array.isArray(samples) || samples.length === 0) return 0;

  const last = await tx.driver_trip_location.findFirst({
    where: { order_id: orderId },
    orderBy: { recorded_at: "desc" },
    select: { lat: true, lng: true },
  });
  const kept = selectSamples({ samples, last, phase, now });
  if (kept.length === 0) return 0;

  await tx.driver_trip_location.createMany({
    data: kept.map((s) => ({
      order_id: orderId,
      rider_id: riderId,
      lat: s.lat,
      lng: s.lng,
      recorded_at: new Date(s.timestamp),
      phase: s.phase,
    })),
  });
  return kept.length;
}

// 0,0 is what legacy rows hold for "never recorded" - not a real place.
function point(lat, lng) {
  const a = num(lat);
  const b = num(lng);
  if (a === null || b === null || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

// One driver's stretch of the trail: the points, a dashed-gap flag after a long silence, and the distance driven.
function trailOf(rows) {
  const points = [];
  let distanceKm = 0;
  let prev = null;
  let prevAt = null;
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const at = new Date(r.recorded_at).getTime();
    const p = { lat, lng, phase: r.phase };
    if (prev) {
      distanceKm += haversineKm(prev.lat, prev.lng, lat, lng);
      if (at - prevAt > GAP_MS) p.gap = true;
    }
    points.push(p);
    prev = p;
    prevAt = at;
  }
  return { points, distanceKm };
}

/**
 * The stored trail split by driver, in the order the drivers took the booking. A booking several drivers accepted
 * (one cancelled, the next took over) has one assignment per driver, so their routes are never drawn as one line.
 */
function splitByDriver(rows) {
  const byRider = new Map();
  for (const r of rows) {
    const key = Number(r.rider_id);
    if (!byRider.has(key)) byRider.set(key, []);
    byRider.get(key).push(r);
  }
  return [...byRider.entries()].map(([riderId, list]) => {
    const { points, distanceKm } = trailOf(list);
    return {
      rider_id: riderId,
      points,
      has_trail: points.length >= 2,
      distance_km: Math.round(distanceKm * 100) / 100,
      started_at: list[0].recorded_at,
      ended_at: list[list.length - 1].recorded_at,
    };
  });
}

const isCancelled = (order) => String(order?.o_status || "").trim().toLowerCase() === "cancelled" || Number(order?.order_status) === 4;

// Returns null if the order doesn't exist. Ownership is checked by the caller.
// `withDrivers` (admin only) adds each driver's name to the per-driver assignments.
async function buildRoute(client, orderId, { withDrivers = false } = {}) {
  const order = await client.pkg_order.findUnique({ where: { id: orderId } });
  if (!order) return null;

  const [rows, stops, timer, pickupEvent] = await Promise.all([
    client.driver_trip_location.findMany({ where: { order_id: orderId }, orderBy: { recorded_at: "asc" } }),
    client.pkg_order_stops.findMany({ where: { order_id: orderId }, orderBy: [{ sequence: "asc" }, { id: "asc" }] }),
    client.pkg_order_wait_timer.findFirst({ where: { order_id: orderId } }),
    client.driver_trip_event.findUnique({ where: { order_id_milestone: { order_id: orderId, milestone: "pickup_updated" } } }),
  ]);

  const assignments = splitByDriver(rows);
  // The map shows the driver the booking ended with (the latest one); earlier drivers stay in `assignments`.
  const latest = assignments[assignments.length - 1] || { points: [], has_trail: false, distance_km: 0 };
  const points = latest.points;
  const cancelled = isCancelled(order);

  const currentPickup = point(order.plat, order.plong);
  const oldPickup = pickupEvent ? point(pickupEvent.payload?.old_lat, pickupEvent.payload?.old_lng) : null;
  const pickupChanged = Boolean(oldPickup);

  // OTP point = where the driver actually was when the OTP was entered; only
  // shown when it is meaningfully away from the (final) pickup pin.
  let otpPoint = point(timer?.otp_verify_lat, timer?.otp_verify_lng);
  if (otpPoint && currentPickup && haversineKm(currentPickup.lat, currentPickup.lng, otpPoint.lat, otpPoint.lng) * 1000 <= OTP_POINT_MIN_M) {
    otpPoint = null;
  }

  let names = new Map();
  if (withDrivers && assignments.length) {
    const riders = await client.tbl_rider.findMany({
      where: { id: { in: assignments.map((a) => a.rider_id) } },
      select: { id: true, full_name: true, first_name: true, last_name: true, vehicle_no: true },
    });
    names = new Map(riders.map((r) => [r.id, r]));
  }

  // One lonely fix can't draw a line; treat it as "no trail" so the app falls
  // back to the planned path instead of showing pins only.
  const hasTrail = latest.has_trail;
  return {
    has_trail: hasTrail,
    points,
    // Without a recorded trail the best figure is the planned trip distance. A cancelled order never shows a
    // planned/estimated figure or path: only what was actually recorded (0 when nothing was).
    distance_km: hasTrail ? latest.distance_km : (cancelled ? 0 : Number(order.distance) || 0),
    cancelled,
    order_status: order.order_status,
    o_status: order.o_status,
    assignments: assignments.map((a) => ({
      ...a,
      ...(withDrivers ? {
        driver_name: (names.get(a.rider_id)?.full_name || `${names.get(a.rider_id)?.first_name || ""} ${names.get(a.rider_id)?.last_name || ""}`).trim() || null,
        vehicle_no: names.get(a.rider_id)?.vehicle_no || null,
      } : {}),
    })),
    start: hasTrail ? { lat: points[0].lat, lng: points[0].lng } : null,
    // "pickup" = where the customer first asked for pickup; "final_pickup"
    // only when it was changed after booking.
    pickup: pickupChanged ? oldPickup : currentPickup,
    final_pickup: pickupChanged ? currentPickup : null,
    otp_point: otpPoint,
    stops: stops.map((s) => point(s.lat, s.lng)).filter(Boolean),
    drop: point(order.dlat, order.dlong),
  };
}

module.exports = { selectSamples, recordSamples, buildRoute };
