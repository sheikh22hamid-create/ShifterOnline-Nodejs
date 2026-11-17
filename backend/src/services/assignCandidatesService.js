// Drivers the admin "Assign driver" popup offers for an order. Same idea as dispatch (which offers an order to
// drivers near the pickup, whatever city they are registered in): the order's own city's drivers, plus drivers of
// other cities who are near the pickup right now.
const prisma = require("../config/db");
const { haversineKm } = require("../utils/geoDistance");
const { SEARCH_RADIUS_KM, RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const whatsappTrialSettings = require("./whatsappTrialSettings");

// An offline Trial Driver has no live location; their last known one counts if it is under a day old.
const TRIAL_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const num = (v) => (v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v));

/** Straight-line km from the order's pickup to the rider's last location, or null when either is unknown. */
function distanceFromPickup(order, rider) {
  const plat = num(order.plat), plng = num(order.plong), rlat = num(rider.rlats), rlng = num(rider.rlongs);
  if (![plat, plng, rlat, rlng].every(Number.isFinite)) return null;
  return haversineKm(plat, plng, rlat, rlng);
}

/** Within the order's search radius, with a location no older than maxAgeMs. */
function isNearPickup(order, rider, maxAgeMs = TRIAL_LOCATION_MAX_AGE_MS) {
  const km = distanceFromPickup(order, rider);
  if (km === null || !rider.rloc_updated_at) return false;
  if (Date.now() - new Date(rider.rloc_updated_at).getTime() > maxAgeMs) return false;
  return km <= (Number(order.radius_range) || SEARCH_RADIUS_KM);
}

/**
 * May an executive scoped to the order's city assign this driver registered elsewhere? Only the same vehicle as the
 * order, near the pickup, with a live location (the dispatch freshness) - the 24 h window applies only to an active
 * Trial Driver taking the order over WhatsApp (offline, so no live location). Mirrors what the popup lists.
 */
function mayAssignOtherCity(order, rider, channel = "app") {
  if (rider.vehicle !== order.category) return false;
  const offlineTrial = channel === "whatsapp" && rider.trial_status === "active";
  return isNearPickup(order, rider, offlineTrial ? TRIAL_LOCATION_MAX_AGE_MS : RIDER_LOCATION_FRESHNESS_MS);
}

const riderName = (r) => r.full_name || [r.fname, r.lname].filter(Boolean).join(" ") || null;

/**
 * source 'all'   -> online drivers (same as before) of the order's city, plus other-city online drivers near the pickup
 *                   with a fresh location (the same freshness dispatch uses).
 * source 'trial' -> active Trial Drivers, online or offline (an offline one can take the order over WhatsApp), of the
 *                   order's city, plus other-city ones whose last location (under 24 h) is near the pickup.
 * Every active Trial Driver row carries its WhatsApp eligibility, so the popup needs no per-rider call (city-scoped).
 */
async function listCandidates(order, { source = "all", search } = {}) {
  const trial = source === "trial";
  const where = { status: 1, vehicle: order.category, ...(trial ? { trial_status: "active" } : { a_status: 1 }) };
  const maxAge = trial ? TRIAL_LOCATION_MAX_AGE_MS : RIDER_LOCATION_FRESHNESS_MS;
  const now = Date.now();
  // Other cities' drivers are read only when their location is recent enough to count (distance checked below).
  const and = [{ OR: [{ city_id: order.city_id }, { rloc_updated_at: { gte: new Date(now - maxAge) } }] }];
  const q = String(search || "").trim();
  if (q) and.push({ OR: [{ full_name: { contains: q } }, { fmobile: { contains: q } }, { vehicle_no: { contains: q } }] });
  where.AND = and;

  const riders = await prisma.tbl_rider.findMany({ where, orderBy: { id: "desc" }, take: 500 });

  const rows = [];
  for (const r of riders) {
    const sameCity = Number(r.city_id) === Number(order.city_id);
    if (!sameCity && !isNearPickup(order, r, maxAge)) continue;
    const km = distanceFromPickup(order, r);
    const fresh = r.rloc_updated_at && now - new Date(r.rloc_updated_at).getTime() <= RIDER_LOCATION_FRESHNESS_MS;
    rows.push({
      id: r.id,
      full_name: riderName(r),
      fmobile: r.fmobile,
      vehicle: r.vehicle,
      vehicle_no: r.vehicle_no,
      city_id: r.city_id,
      // Another city's driver: only what is needed to pick and call them (no wallet).
      wallet_balance: sameCity ? r.wallet_balance : null,
      trial_status: r.trial_status,
      online: r.a_status === 1,
      location_fresh: Boolean(fresh),
      distance_km: km === null ? null : Math.round(km * 10) / 10,
      other_city: !sameCity,
    });
  }
  rows.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));

  // Every Trial Driver row carries its WhatsApp eligibility (on either tab).
  for (const row of rows) {
    if (row.trial_status === "active") {
      const e = await whatsappTrialSettings.eligibility(row.id);
      row.whatsapp = { eligible: e.eligible, reason: e.reason, whatsapp_orders_done: e.whatsapp_orders_done };
    }
  }
  return rows;
}

module.exports = { listCandidates, isNearPickup, mayAssignOtherCity, distanceFromPickup, TRIAL_LOCATION_MAX_AGE_MS };
