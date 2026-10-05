const prisma = require("../config/db");
const logger = require("../utils/logger");
const { haversineKm } = require("../utils/geoDistance");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");

// Pickup ETA for an accepted order: Google's driver -> pickup travel time plus
// an admin-configurable buffer is what the customer is shown, and the same
// moment is the deadline. Once it passes with the driver still outside the
// pickup geofence, the customer may cancel for free (isPickupEtaExpired): no
// customer charge, no driver penalty, no driver payment. Nothing auto-cancels.
//
// pickup_eta_minutes / pickup_deadline_at are deliberately NOT modelled in
// prisma/schema.prisma (raw SQL only, like advance_payment): a modelled column
// that a hand-applied prod DB hasn't got yet would break EVERY pkg_order query
// with P2022 - here a missing column only makes the ETA best-effort.
// pickup_distance_km / pickup_duration_min (already modelled) hold Google's
// raw distance and minutes.

const DEFAULT_BUFFER_MIN = 10;
const DEFAULT_GEOFENCE_M = 200;
const GOOGLE_TIMEOUT_MS = 4000;
const FALLBACK_ROAD_FACTOR = 1.4; // straight-line -> road distance
const FALLBACK_SPEED_KMPH = 25; // urban two-wheeler/mini-truck average

function parseNonNegative(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Same convention as pickupOtpTimeout / pickupRelocateSettings: no caching, an
// admin change applies on the very next accept / sweep tick.
async function getPickupEtaSettings() {
  const keys = ["pickup_eta_buffer_minutes", "pickup_eta_geofence_m", "pickup_eta_auto_cancel_enabled"];
  const settings = { bufferMinutes: DEFAULT_BUFFER_MIN, geofenceM: DEFAULT_GEOFENCE_M, autoCancelEnabled: true };
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: keys } } });
    for (const row of rows) {
      if (row.setting_key === "pickup_eta_buffer_minutes") settings.bufferMinutes = parseNonNegative(row.setting_value, DEFAULT_BUFFER_MIN);
      if (row.setting_key === "pickup_eta_geofence_m") {
        const m = parseNonNegative(row.setting_value, DEFAULT_GEOFENCE_M);
        settings.geofenceM = m > 0 ? m : DEFAULT_GEOFENCE_M;
      }
      if (row.setting_key === "pickup_eta_auto_cancel_enabled") {
        settings.autoCancelEnabled = !["0", "false", "off", "no"].includes(String(row.setting_value ?? "").trim().toLowerCase());
      }
    }
  } catch (err) {
    logger.error("getPickupEtaSettings: failed to read admin settings, using defaults:", err);
  }
  return settings;
}

// Pure: Google's travel time (seconds) -> what the customer sees + the deadline.
function buildEtaPlan({ googleSeconds, bufferMinutes = DEFAULT_BUFFER_MIN, now = Date.now() }) {
  const googleMinutes = Math.max(1, Math.ceil(Number(googleSeconds) / 60));
  const customerMinutes = googleMinutes + Math.max(0, Math.round(Number(bufferMinutes) || 0));
  return { googleMinutes, customerMinutes, deadline: new Date(now + customerMinutes * 60000) };
}

// Google Routes API (same endpoint/key favoriteRouteService already uses).
// Returns { seconds, meters } or null on any failure so the caller can fall
// back to an estimate instead of blocking the accept.
async function fetchGoogleDrive(origin, destination, { fetchImpl = fetch, apiKey = process.env.GOOGLE_MAPS_API_KEY } = {}) {
  if (!apiKey) return null;
  try {
    const response = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    });
    if (!response.ok) {
      logger.warn(`pickupEtaService: Google Routes responded ${response.status}`);
      return null;
    }
    const data = await response.json();
    const route = data?.routes?.[0];
    const seconds = parseFloat(String(route?.duration ?? "").replace("s", ""));
    const meters = Number(route?.distanceMeters);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(meters)) return null;
    return { seconds, meters };
  } catch (err) {
    logger.warn(`pickupEtaService: Google Routes call failed (${err.message})`);
    return null;
  }
}

function estimateDrive(origin, destination) {
  const meters = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) * 1000 * FALLBACK_ROAD_FACTOR;
  return { seconds: (meters / 1000 / FALLBACK_SPEED_KMPH) * 3600, meters };
}

function toPoint(lat, lng) {
  const a = Number(lat ?? NaN);
  const b = Number(lng ?? NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

/**
 * Computes the driver's current location -> pickup ETA via Google, stores it
 * on the order and returns the customer-facing view. Best-effort: returns null
 * (and logs) when it can't, so an accept is never blocked by it.
 */
async function computeAndStorePickupEta(orderId, { fetchImpl } = {}) {
  try {
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { id: true, rid: true, plat: true, plong: true } });
    if (!order || !(Number(order.rid) > 0)) return null;
    const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(order.rid) }, select: { rlats: true, rlongs: true } });
    const origin = toPoint(rider?.rlats, rider?.rlongs);
    const destination = toPoint(order.plat, order.plong);
    if (!origin || !destination) return null;

    const [settings, google] = await Promise.all([getPickupEtaSettings(), fetchGoogleDrive(origin, destination, { fetchImpl })]);
    const drive = google || estimateDrive(origin, destination);
    const plan = buildEtaPlan({ googleSeconds: drive.seconds, bufferMinutes: settings.bufferMinutes });
    const distanceKm = Math.round((drive.meters / 1000) * 100) / 100;

    await prisma.pkg_order.update({ where: { id: orderId }, data: { pickup_distance_km: distanceKm, pickup_duration_min: plan.googleMinutes } });
    await prisma.$executeRaw`UPDATE pkg_order SET pickup_eta_minutes = ${plan.customerMinutes}, pickup_deadline_at = ${plan.deadline} WHERE id = ${orderId}`;

    return {
      pickup_distance_km: distanceKm,
      pickup_google_eta_minutes: plan.googleMinutes,
      pickup_eta_minutes: plan.customerMinutes,
      pickup_deadline_at: plan.deadline,
      pickup_eta_source: google ? "google" : "estimate",
    };
  } catch (err) {
    logger.error(`pickupEtaService.computeAndStorePickupEta failed for order ${orderId}:`, err);
    return null;
  }
}

/** Driver already arrived once / pickup being re-planned: nothing left to enforce. */
async function clearPickupDeadline(orderId, client = prisma) {
  try {
    await client.$executeRaw`UPDATE pkg_order SET pickup_deadline_at = NULL WHERE id = ${orderId}`;
  } catch (err) {
    logger.error(`pickupEtaService.clearPickupDeadline failed for order ${orderId}:`, err);
  }
}

/**
 * Customer moved the pickup after accept. Driver still on the way: re-plan the
 * ETA/deadline from where they are now to the new pickup. Driver already
 * arrived at the old pin once: the ETA obligation is spent (the OTP-wait and
 * relocation-ceiling sweeps bound the rest), so just drop the deadline.
 */
async function refreshAfterPickupChange(orderId) {
  try {
    const arrived = await prisma.pkg_order_wait_timer.findFirst({
      where: { order_id: orderId, first_arrival_at: { not: null } },
      select: { id: true },
    });
    if (arrived) {
      await clearPickupDeadline(orderId);
      return null;
    }
    return await computeAndStorePickupEta(orderId);
  } catch (err) {
    logger.error(`pickupEtaService.refreshAfterPickupChange failed for order ${orderId}:`, err);
    return null;
  }
}

/** Raw read of the two unmodelled columns; null when missing/unavailable. */
async function getPickupEtaRow(orderId, client = prisma) {
  try {
    const [row] = await client.$queryRaw`SELECT pickup_eta_minutes, pickup_deadline_at FROM pkg_order WHERE id = ${orderId} LIMIT 1`;
    return row || null;
  } catch (err) {
    return null;
  }
}

/**
 * True when the accepted driver has missed the pickup ETA: still heading to
 * pickup (order_status 1), deadline passed, no recorded arrival, and not
 * inside the pickup geofence by a fresh GPS fix (a stale fix can't vouch).
 */
async function isPickupEtaExpired(order, etaRow, rider, now = Date.now()) {
  const deadlineMs = etaRow?.pickup_deadline_at ? new Date(etaRow.pickup_deadline_at).getTime() : 0;
  if (Number(order?.order_status) !== 1 || !deadlineMs || now < deadlineMs) return false;

  const arrived = await prisma.pkg_order_wait_timer.findFirst({
    where: { order_id: Number(order.id), first_arrival_at: { not: null } },
    select: { id: true },
  }).catch(() => null);
  if (arrived) return false;

  const fresh = rider?.rloc_updated_at && now - new Date(rider.rloc_updated_at).getTime() <= RIDER_LOCATION_FRESHNESS_MS;
  if (fresh) {
    const { geofenceM } = await getPickupEtaSettings();
    const distanceM = haversineKm(Number(order.plat), Number(order.plong), Number(rider.rlats), Number(rider.rlongs)) * 1000;
    if (Number.isFinite(distanceM) && distanceM <= geofenceM) return false;
  }
  return true;
}

// What the customer / driver / admin apps get on an order payload.
// `etaExpired` (from isPickupEtaExpired) tells the customer app to offer a free cancel.
function buildEtaView(order, etaRow, now = Date.now(), etaExpired = false) {
  const deadlineMs = etaRow?.pickup_deadline_at ? new Date(etaRow.pickup_deadline_at).getTime() : 0;
  const active = Number(order?.order_status) === 1 && deadlineMs > 0;
  return {
    pickup_distance_km: order?.pickup_distance_km != null ? String(Number(order.pickup_distance_km) || 0) : "0",
    pickup_google_eta_minutes: Number(order?.pickup_duration_min) || 0,
    pickup_eta_minutes: Number(etaRow?.pickup_eta_minutes) || 0,
    pickup_deadline_at: deadlineMs ? new Date(deadlineMs).toISOString() : null,
    pickup_eta_remaining_seconds: active ? Math.max(0, Math.round((deadlineMs - now) / 1000)) : 0,
    pickup_eta_expired: Boolean(etaExpired),
  };
}

module.exports = {
  getPickupEtaSettings,
  buildEtaPlan,
  fetchGoogleDrive,
  estimateDrive,
  computeAndStorePickupEta,
  clearPickupDeadline,
  refreshAfterPickupChange,
  getPickupEtaRow,
  isPickupEtaExpired,
  buildEtaView,
  DEFAULT_BUFFER_MIN,
  DEFAULT_GEOFENCE_M,
};
