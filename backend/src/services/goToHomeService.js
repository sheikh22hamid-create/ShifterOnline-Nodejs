const prisma = require("../config/db");
const logger = require("../utils/logger");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const rules = require("./goToHomeRules");

// Go to Home (spec 2026-10-30): a driver saves a home, switches the mode on, and drivers whose route to home passes
// within 5 km of an order's DROP are put first in that order's driver search. The route is rebuilt from the driver's
// live position every 2 hours by a server-side sweep. Standard Tier is switched ON once at enable time and never again.
// Best effort in dispatch: any failure here leaves normal driver selection untouched.

const SETTING_KEY = "go_to_home_enabled";
const TTL_MS = 5000;
let switchCache = null;

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const num = (v) => (v === null || v === undefined ? NaN : Number(v));

/** Global kill switch (app_settings). Missing = ON; an unreadable setting fails closed to normal dispatch. */
async function isEnabled() {
  if (switchCache && Date.now() - switchCache.at < TTL_MS) return switchCache.value;
  let value = false;
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: SETTING_KEY } });
    value = row ? !["0", "false", "off", "no"].includes(String(row.setting_value ?? "").trim().toLowerCase()) : true;
  } catch (err) {
    logger.error("goToHome: could not read the switch, treating as OFF:", err);
  }
  switchCache = { at: Date.now(), value };
  return value;
}

/** The rider's latest GPS fix if it is fresh, else null. */
async function freshLocation(riderId, now = new Date()) {
  const r = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { rlats: true, rlongs: true, rloc_updated_at: true } });
  if (!r || !r.rloc_updated_at || now - new Date(r.rloc_updated_at) > RIDER_LOCATION_FRESHNESS_MS) return null;
  const p = { lat: num(r.rlats), lng: num(r.rlongs) };
  return rules.validHome(p.lat, p.lng) ? p : null;
}

/** Road route current position -> home through the shared Google routing helper. */
async function buildRoute(from, home, cityId) {
  const { roadRoute } = require("./favoriteRouteService");
  const route = await roadRoute([from, home], cityId);
  if (route.distance_km > rules.MAX_ROUTE_KM) fail(`Home is too far from your current location (more than ${rules.MAX_ROUTE_KM} km by road) for Go to Home`, 422);
  return route;
}

async function standardTierOn(riderId) {
  const row = await prisma.tbl_rider_delivery_type.findFirst({ where: { rider_id: riderId, delivery_type: String(rules.STANDARD_TIER_PACKAGE_ID) } });
  return !row || row.status === 1; // a missing row means "never touched" = ON (dispatch treats it as eligible)
}

async function present(riderId, row) {
  const now = new Date();
  const valid = rules.isRouteValid(row, now);
  return {
    enabled_by_admin: await isEnabled(),
    has_home: Boolean(row && rules.validHome(row.home_lat, row.home_lng)),
    home: row && rules.validHome(row.home_lat, row.home_lng) ? { lat: num(row.home_lat), lng: num(row.home_lng), address: row.home_address || "" } : null,
    active: Boolean(row?.active),
    activated_at: row?.activated_at || null,
    next_refresh_at: row?.active ? row.next_refresh_at : null,
    route_valid: valid,
    route_computed_at: row?.route_computed_at || null,
    route_distance_km: valid ? row.route_distance_km : null,
    route: valid ? rules.thin(row.route_geometry) : [],
    current: row?.route_from_lat != null ? { lat: num(row.route_from_lat), lng: num(row.route_from_lng) } : null,
    corridor_km: rules.CORRIDOR_KM,
    last_refresh_status: row?.last_refresh_status || null,
    standard_tier_on: await standardTierOn(riderId),
  };
}

const getRow = (riderId) => prisma.driver_go_to_home.findUnique({ where: { rider_id: riderId } });

async function getState(rider) {
  return present(rider.id, await getRow(rider.id));
}

function cleanHome(body) {
  const lat = num(body?.lat);
  const lng = num(body?.lng);
  if (!rules.validHome(lat, lng)) fail("Choose a valid home location on the map");
  return { lat, lng, address: String(body?.address || "").trim().slice(0, 255) };
}

/** Save or change the home. A changed home invalidates the old route; while the mode is on a new one is built now. */
async function saveHome(rider, body) {
  const home = cleanHome(body);
  const existing = await getRow(rider.id);
  const changed = !existing || num(existing.home_lat) !== home.lat || num(existing.home_lng) !== home.lng;
  const base = { home_lat: home.lat, home_lng: home.lng, home_address: home.address };
  if (!changed) {
    await prisma.driver_go_to_home.update({ where: { rider_id: rider.id }, data: { home_address: home.address } });
    return getState(rider);
  }
  // Drop the old route first: even if the rebuild below fails, nothing keeps matching on the old home.
  await prisma.driver_go_to_home.upsert({
    where: { rider_id: rider.id },
    create: { rider_id: rider.id, ...base },
    update: { ...base, route_geometry: null, route_distance_km: null, route_computed_at: null, route_from_lat: null, route_from_lng: null },
  });
  if (existing?.active) await refreshOne(rider.id, { force: true, cityId: rider.city_id });
  return getState(rider);
}

/**
 * Turn the mode on. Needs a saved home, a fresh GPS fix and a working route; otherwise nothing is written (so a
 * failed activation never leaves Standard Tier switched on). The route is built first, then one transaction saves the
 * mode and, only if Standard Tier is OFF, switches it ON. Already active = no-op.
 */
async function enable(rider) {
  if (!(await isEnabled())) fail("Go to Home is not available right now", 409);
  const existing = await getRow(rider.id);
  if (existing?.active) return getState(rider);
  if (!existing || !rules.validHome(existing.home_lat, existing.home_lng)) fail("Save your home location first", 409);
  const now = new Date();
  const from = await freshLocation(rider.id, now);
  if (!from) fail("We could not get your current location. Turn on GPS, open the app and retry.", 409);
  const home = { lat: num(existing.home_lat), lng: num(existing.home_lng) };
  const route = await buildRoute(from, home, rider.city_id); // throws a 4xx/5xx with a retryable message

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tbl_rider WHERE id = ${rider.id} FOR UPDATE`;
    await tx.driver_go_to_home.update({
      where: { rider_id: rider.id },
      data: {
        active: true, activated_at: now, route_geometry: route.geometry, route_distance_km: route.distance_km,
        route_from_lat: from.lat, route_from_lng: from.lng, route_computed_at: now,
        next_refresh_at: new Date(now.getTime() + rules.REFRESH_MS), last_refresh_status: "ok", last_refresh_at: now,
      },
    });
    // Only OFF -> ON; an already-ON (or never-touched) Standard Tier gets no write at all.
    await tx.tbl_rider_delivery_type.updateMany({
      where: { rider_id: rider.id, delivery_type: String(rules.STANDARD_TIER_PACKAGE_ID), status: { not: 1 } },
      data: { status: 1 },
    });
  });
  hint.value = true;
  return getState(rider);
}

/** Turn the mode off: priority and refreshes stop at once. Home stays saved; Standard Tier is left exactly as it is. */
async function disable(rider) {
  await prisma.driver_go_to_home.updateMany({
    where: { rider_id: rider.id },
    data: { active: false, next_refresh_at: null, route_geometry: null, route_distance_km: null, route_computed_at: null, route_from_lat: null, route_from_lng: null },
  });
  return getState(rider);
}

/**
 * Rebuild one active driver's route from their live position. On any failure the old route is kept only until it
 * ages out (isRouteValid); the status is recorded and the next try is RETRY_MS away, never an hourly hammering.
 * `claimedNext` makes the claim safe across several server instances.
 */
async function refreshOne(riderId, { force = false, cityId = null, claimedNext = null } = {}) {
  const now = new Date();
  const row = await getRow(riderId);
  if (!row || !row.active) return { skipped: true };
  if (!force && claimedNext) {
    const claimed = await prisma.driver_go_to_home.updateMany({
      where: { rider_id: riderId, active: true, next_refresh_at: claimedNext },
      data: { next_refresh_at: new Date(now.getTime() + rules.RETRY_MS) },
    });
    if (claimed.count === 0) return { skipped: true }; // another instance has it
  }
  const record = (data) => prisma.driver_go_to_home.updateMany({ where: { rider_id: riderId, active: true }, data: { last_refresh_at: now, ...data } });
  try {
    const from = await freshLocation(riderId, now);
    if (!from) { await record({ last_refresh_status: "no_location", next_refresh_at: new Date(now.getTime() + rules.RETRY_MS) }); return { ok: false, status: "no_location" }; }
    const rider = cityId == null ? await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { city_id: true } }) : { city_id: cityId };
    const route = await buildRoute(from, { lat: num(row.home_lat), lng: num(row.home_lng) }, rider?.city_id);
    await record({
      route_geometry: route.geometry, route_distance_km: route.distance_km, route_from_lat: from.lat, route_from_lng: from.lng,
      route_computed_at: now, next_refresh_at: new Date(now.getTime() + rules.REFRESH_MS), last_refresh_status: "ok",
    });
    return { ok: true, status: "ok" };
  } catch (err) {
    logger.warn(`goToHome: route refresh failed for rider ${riderId}: ${err.message}`);
    await record({ last_refresh_status: "route_failed", next_refresh_at: new Date(now.getTime() + rules.RETRY_MS) }).catch(() => {});
    return { ok: false, status: "route_failed" };
  }
}

/** Sweep: refresh every active driver whose time has come. Called from server.js on an interval. */
async function refreshDue(limit = 50) {
  await refreshActiveHint();
  if (!(await isEnabled())) return 0;
  const due = await prisma.driver_go_to_home.findMany({
    where: { active: true, next_refresh_at: { lte: new Date() } },
    orderBy: { next_refresh_at: "asc" }, take: limit, select: { rider_id: true, next_refresh_at: true },
  });
  for (const d of due) await refreshOne(d.rider_id, { claimedNext: d.next_refresh_at });
  return due.length;
}

// Dispatch must not pay two extra queries (and an await) on every search just to learn that nobody uses the mode, so
// it reads a synchronous hint that is refreshed in the background (at most every HINT_TTL_MS) and by the 1-minute sweep.
const HINT_TTL_MS = 5000;
const hint = { at: 0, value: false, loading: false };

async function refreshActiveHint() {
  hint.loading = true;
  try {
    hint.value = (await isEnabled()) && Boolean(await prisma.driver_go_to_home.findFirst({ where: { active: true }, select: { rider_id: true } }));
  } catch (err) {
    hint.value = false; // table missing (migration not applied) or DB blip: normal dispatch
    logger.warn(`goToHome: active check failed (migration not applied?): ${err.message}`);
  } finally {
    hint.at = Date.now();
    hint.loading = false;
  }
  return hint.value;
}

/** Sync: true when at least one driver may have the mode on, so dispatch must read every candidate (no SQL LIMIT). */
function hasActiveDrivers() {
  if (!hint.loading && Date.now() - hint.at > HINT_TTL_MS) refreshActiveHint();
  return hint.value;
}

/**
 * Put qualifying Go to Home drivers first in the candidate list. Never removes a driver and never adds one, so
 * normal eligibility is untouched. Any error returns the list as it came in.
 */
async function prioritize(order, rows) {
  try {
    if (!rows.length || !(await isEnabled())) return rows;
    const homes = await prisma.driver_go_to_home.findMany({ where: { active: true, rider_id: { in: rows.map((r) => Number(r.rider_id)) } } });
    if (!homes.length) return rows;
    const stops = await prisma.pkg_order_stops.findMany({ where: { order_id: order.id }, orderBy: [{ sequence: "asc" }, { id: "asc" }] });
    const drops = [...stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) })), { lat: Number(order.dlat), lng: Number(order.dlong) }];
    const now = new Date();
    const match = new Map(homes.map((h) => [h.rider_id, rules.evaluate(h, drops, now)]));
    return rules.prioritize(rows, match).map((r) => (match.get(Number(r.rider_id))?.matched ? { ...r, go_to_home_match: match.get(Number(r.rider_id)) } : r));
  } catch (err) {
    logger.error(`goToHome: prioritize failed for order ${order?.id}, using normal order:`, err);
    return rows;
  }
}

module.exports = { isEnabled, refreshActiveHint, getState, saveHome, enable, disable, refreshOne, refreshDue, hasActiveDrivers, prioritize };
