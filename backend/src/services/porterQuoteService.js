const logger = require("../utils/logger");
const settings = require("./porterLiveSettings");
const { vehicleFamily, FAMILY_VEHICLE_ID } = require("./outsideDriverService");

// Porter anchor: asks the VPS bot for Porter's live quote on a route and returns the fare for one vehicle.
// Cache (one entry = all vehicles), in-flight dedupe, timeout and a circuit breaker keep it from slowing pricing down.
const BASE_URL = () => (process.env.OUTSIDE_DRIVER_API_URL || "https://rider.shifteronline.com").replace(/\/+$/, "");
const apiKeyHeader = () => (process.env.OUTSIDE_DRIVER_API_KEY ? { "x-api-key": process.env.OUTSIDE_DRIVER_API_KEY } : {});

const PORTER_PRICING_VEHICLE_ID = Object.freeze({ ...FAMILY_VEHICLE_ID, mini_3w: 1139 });
const CACHE_MAX = 500;
const BREAKER_THRESHOLD = 5;
const BREAKER_MS = 5 * 60 * 1000;

const cache = new Map();
const inflight = new Map();
let stats, consecutiveFailures, breakerOpenUntil;

function _resetForTests() {
  cache.clear();
  inflight.clear();
  stats = { lastSuccessAt: null, lastFailureAt: null, lastError: null, successes: 0, failures: 0, cacheHits: 0 };
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}
_resetForTests();

const getStats = () => ({ ...stats, breakerOpenUntil: breakerOpenUntil || null });

const pt = (p) => `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`;
const validPoint = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

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

async function getPorterAnchor({ cityId, category, pickup, drop, stops = [] } = {}, { fetchImpl = fetch, now = Date.now } = {}) {
  try {
    if (Array.isArray(stops) && stops.length > 0) return null;
    if (!validPoint(pickup) || !validPoint(drop)) return null;
    if (!(await settings.isActiveForCity(cityId))) return null;
    const vehicleId = PORTER_PRICING_VEHICLE_ID[vehicleFamily(category)];
    if (!vehicleId) return null;
    if (breakerOpenUntil) {
      if (now() < breakerOpenUntil) return null;
      breakerOpenUntil = 0;
      consecutiveFailures = 0;
    }
    const cfg = await settings.getConfig();
    const key = `${cityId}:${pt(pickup)}>${pt(drop)}`;

    let entry = cache.get(key);
    if (entry && now() - entry.at < cfg.cacheMinutes * 60000) {
      stats.cacheHits++;
    } else {
      cache.delete(key);
      let p = inflight.get(key);
      if (!p) {
        p = fetchQuotes({ pickup, drop }, cfg.timeoutMs, fetchImpl, now).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      const res = await p;
      if (!res) return null;
      entry = { at: now(), ...res };
      if (!cache.has(key)) {
        cache.set(key, entry);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      }
    }

    const q = entry.quotes.find((x) => Number(x.porter_vehicle_id) === vehicleId);
    const fare = Number(q?.fare);
    if (!q || !Number.isFinite(fare) || fare <= 0) return null;
    return { fare, porter_distance_km: entry.porter_distance_km, porter_vehicle_id: vehicleId, quoted_at: entry.quoted_at };
  } catch (err) {
    logger.warn(`porterQuoteService.getPorterAnchor: ${err.message}`);
    return null;
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

module.exports = { getPorterAnchor, withinSanityRange, anchorFromOrder, getStats, _resetForTests, PORTER_PRICING_VEHICLE_ID };
