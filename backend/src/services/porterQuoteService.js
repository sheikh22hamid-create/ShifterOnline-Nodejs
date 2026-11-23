const logger = require("../utils/logger");
const settings = require("./porterLiveSettings");
const { vehicleFamily, FAMILY_VEHICLE_ID } = require("./outsideDriverService");

// Porter anchor: asks the VPS bot for Porter's live quote on a route and returns the fare for one vehicle.
// Cache (one entry = all vehicles), in-flight dedupe, timeout and a circuit breaker keep it from slowing pricing down.
// Negative decisions are cached for the same TTL, so the estimate and the booking made right after it see the
// same basis: a failed fetch caches a "no quote" marker for the route (all vehicles), and a sanity-guard
// rejection (markRouteRejected) caches one for that route + vehicle.
const BASE_URL = () => (process.env.OUTSIDE_DRIVER_API_URL || "https://rider.shifteronline.com").replace(/\/+$/, "");
const apiKeyHeader = () => (process.env.OUTSIDE_DRIVER_API_KEY ? { "x-api-key": process.env.OUTSIDE_DRIVER_API_KEY } : {});

const PORTER_PRICING_VEHICLE_ID = Object.freeze({ ...FAMILY_VEHICLE_ID, mini_3w: 1139 });
const CACHE_MAX = 500;
const BREAKER_THRESHOLD = 5;
const BREAKER_MS = 5 * 60 * 1000;

const cache = new Map(); // key -> { at, quotes, ... } or { at, failed: true }
const rejected = new Map(); // `${key}#${vehicleId}` -> at
const inflight = new Map();
let stats, consecutiveFailures, breakerOpenUntil;

function _resetForTests() {
  cache.clear();
  rejected.clear();
  inflight.clear();
  stats = { lastSuccessAt: null, lastFailureAt: null, lastError: null, successes: 0, failures: 0, cacheHits: 0 };
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}
_resetForTests();

const getStats = () => ({ ...stats, breakerOpenUntil: breakerOpenUntil || null });

const pt = (p) => `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`;
const coord = (v) => (v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v));
// Rejects missing/empty coords, (0,0) (an unset GPS fix) and out-of-range lat/lng.
function validPoint(p) {
  if (!p || typeof p !== "object") return false;
  const lat = coord(p.lat), lng = coord(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}
const routeKey = (cityId, pickup, drop) => `${cityId}:${pt(pickup)}>${pt(drop)}`;
const fresh = (at, cfg, now) => now() - at < cfg.cacheMinutes * 60000;
const remember = (map, key, value) => {
  map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_MAX) map.delete(map.keys().next().value);
};

function recordFailure(err, now) {
  stats.failures++;
  stats.lastFailureAt = now();
  stats.lastError = err?.message || String(err);
  logger.warn(`porterQuoteService: quote failed (${stats.lastError})`);
  if (++consecutiveFailures >= BREAKER_THRESHOLD) breakerOpenUntil = now() + BREAKER_MS;
}

async function fetchQuotes({ pickup, drop }, timeoutMs, fetchImpl, now) {
  try {
    const resp = await fetchImpl(`${BASE_URL()}/api/porter-quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiKeyHeader() },
      body: JSON.stringify({ pickup, drop, stops: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new Error(`bot HTTP ${resp.status}`);
    const body = await resp.json();
    if (!body || body.ok !== true || !Array.isArray(body.quotes)) throw new Error("bot returned ok:false");
    consecutiveFailures = 0;
    stats.successes++;
    stats.lastSuccessAt = now();
    return { quotes: body.quotes, porter_distance_km: body.porter_distance_km, quoted_at: body.quoted_at };
  } catch (err) {
    recordFailure(err, now);
    return null;
  }
}

const activeFor = (cfg, cityId) => {
  const id = Number(cityId);
  return cityId !== null && cityId !== undefined && Number.isInteger(id) && cfg.enabled === true && cfg.cityIds.includes(id);
};

async function getPorterAnchor({ cityId, category, pickup, drop, stops = [] } = {}, { fetchImpl = fetch, now = Date.now } = {}) {
  try {
    if (Array.isArray(stops) && stops.length > 0) return null;
    if (!validPoint(pickup) || !validPoint(drop)) return null;
    const cfg = await settings.getConfig();
    if (!activeFor(cfg, cityId)) return null;
    const vehicleId = PORTER_PRICING_VEHICLE_ID[vehicleFamily(category)];
    if (!vehicleId) return null;
    const key = routeKey(cityId, pickup, drop);

    // Cache (positive or negative) before the breaker: a known answer is served even while Porter is down.
    const rejectedAt = rejected.get(`${key}#${vehicleId}`);
    if (rejectedAt !== undefined) {
      if (fresh(rejectedAt, cfg, now)) return null;
      rejected.delete(`${key}#${vehicleId}`);
    }
    let entry = cache.get(key);
    if (entry && fresh(entry.at, cfg, now)) {
      stats.cacheHits++;
      if (entry.failed) return null;
    } else {
      cache.delete(key);
      if (breakerOpenUntil) {
        if (now() < breakerOpenUntil) return null;
        breakerOpenUntil = 0;
        consecutiveFailures = 0;
      }
      let p = inflight.get(key);
      if (!p) {
        p = fetchQuotes({ pickup, drop }, cfg.timeoutMs, fetchImpl, now)
          .then((res) => {
            remember(cache, key, res ? { at: now(), ...res } : { at: now(), failed: true });
            return res;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const res = await p;
      if (!res) return null;
      entry = cache.get(key) || { at: now(), ...res };
    }

    const q = entry.quotes.find((x) => Number(x.porter_vehicle_id) === vehicleId);
    const fare = Number(q?.fare);
    if (!q || !Number.isFinite(fare) || fare <= 0) return null;
    // Porter's web quote sits above its in-app price; cut it by this vehicle's configured percent so the
    // stored anchor (and therefore Model 3) lands near what the Porter app shows. 0 / unset -> no change.
    const adjustPct = Number(cfg.appAdjustPct?.[vehicleId]);
    const adjustedFare = Number.isFinite(adjustPct) && adjustPct > 0 ? Math.round(fare * (1 - adjustPct / 100) * 100) / 100 : fare;
    if (!(adjustedFare > 0)) return null;
    const km = entry.porter_distance_km === null || entry.porter_distance_km === undefined || entry.porter_distance_km === "" ? NaN : Number(entry.porter_distance_km);
    return {
      fare: adjustedFare,
      porter_distance_km: Number.isFinite(km) ? km : null,
      porter_vehicle_id: vehicleId,
      quoted_at: typeof entry.quoted_at === "string" ? entry.quoted_at : null,
    };
  } catch (err) {
    logger.warn(`porterQuoteService.getPorterAnchor: ${err.message}`);
    return null;
  }
}

/**
 * The sanity guard (pricingEngine) rejected this route's anchor for this vehicle: answer "no quote" for it
 * until the cache TTL passes, so a booking right after a rejected estimate is priced the same way (rate card).
 * Never throws; bad input is ignored. Not a breaker failure.
 */
function markRouteRejected({ cityId, pickup, drop, category } = {}, { now = Date.now } = {}) {
  try {
    if (cityId === null || cityId === undefined || !validPoint(pickup) || !validPoint(drop)) return;
    const vehicleId = PORTER_PRICING_VEHICLE_ID[vehicleFamily(category)];
    if (!vehicleId) return;
    remember(rejected, `${routeKey(cityId, pickup, drop)}#${vehicleId}`, now());
  } catch (err) {
    logger.warn(`porterQuoteService.markRouteRejected: ${err.message}`);
  }
}

// Porter-derived fare must stay within 0.5x-2x of the rate-card fare of the same package.
function withinSanityRange(porterBasedFare, rateCardFare) {
  const a = Number(porterBasedFare), b = Number(rateCardFare);
  if (!(a > 0) || !(b > 0)) return false;
  const r = a / b;
  return r >= 0.5 && r <= 2;
}

function anchorFromOrder(order) {
  try {
    let q = order?.porter_quote;
    if (typeof q === "string") q = JSON.parse(q);
    const fare = Number(q?.fare);
    if (!q || typeof q !== "object" || !Number.isFinite(fare) || fare <= 0) return null;
    const out = { fare };
    if (q.porter_distance_km !== undefined && q.porter_distance_km !== null) out.porter_distance_km = Number(q.porter_distance_km);
    if (q.quoted_at !== undefined) out.quoted_at = q.quoted_at;
    if (q.porter_vehicle_id !== undefined) out.porter_vehicle_id = q.porter_vehicle_id;
    return out;
  } catch {
    return null;
  }
}

/**
 * New anchor for an order whose route changed (drop/pickup change, stop added, early drop, OTP-point move),
 * so it stays on the Porter level instead of falling back to the rate card.
 * - no anchor on the order -> null (order stays rate card)
 * - live Porter quote for the new route (city + category known, no stops, passes the sanity guard) -> that quote
 * - else the old anchor scaled by the rate card: old.fare x rateCard(new km) / rateCard(old km), scaled:true
 * - nothing to scale by (old distance 0, rate card <= 0, error) -> null: fail closed, the order drops its anchor
 *   and is priced on the rate card at the new distance (never billed at the old route's Porter fare)
 * pricingEngine is required lazily (it requires this module lazily too); tests pass deps.priceForPackageId.
 */
async function anchorForNewRoute(order, { pickup, drop, stops = [], newDistanceKm } = {}, deps = {}) {
  const old = anchorFromOrder(order);
  if (!old) return null;
  const { fetchImpl = fetch, now = Date.now } = deps;
  try {
    const price = deps.priceForPackageId || require("./pricingEngine").priceForPackageId;
    const packageId = Number(order.delivery_type) || 1;
    const newKm = Number(newDistanceKm);
    const oldKm = Number(order.distance);
    const rateCard = async (d) => Number((await price(packageId, d, 1, 0, null))?.fare);

    const category = order.category || null;
    if (category && Number.isFinite(newKm) && newKm > 0) {
      const live = await getPorterAnchor({ cityId: order.city_id, category, pickup, drop, stops }, { fetchImpl, now });
      if (live) {
        const [withLive, plain] = await Promise.all([
          price(packageId, newKm, 1, 0, null, null, null, live).then((r) => Number(r?.fare)),
          rateCard(newKm),
        ]);
        if (withinSanityRange(withLive, plain)) return live;
      }
    }

    if (!(oldKm > 0) || !Number.isFinite(newKm) || newKm <= 0) return null;
    const [oldCard, newCard] = await Promise.all([rateCard(oldKm), rateCard(newKm)]);
    if (!(oldCard > 0) || !(newCard > 0)) return null;
    const fare = Math.round(((old.fare * newCard) / oldCard) * 100) / 100;
    return { ...old, fare, quoted_at: new Date(now()).toISOString(), scaled: true };
  } catch (err) {
    logger.warn(`porterQuoteService.anchorForNewRoute: ${err.message}`);
    return null;
  }
}

module.exports = { getPorterAnchor, markRouteRejected, withinSanityRange, anchorFromOrder, anchorForNewRoute, getStats, _resetForTests, PORTER_PRICING_VEHICLE_ID };
