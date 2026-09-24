// In-process counters for the admin monitoring panel. Reset on process
// restart - this is a rough "since last deploy" view, not a durable log
// (favorite_route_audit already covers the durable trail).
const buckets = new Map();
function bucket(cityId) {
  const key = Number(cityId) || 0;
  if (!buckets.has(key)) buckets.set(key, { offers_matched: 0, offers_excluded_only_mode: 0, routing_errors: 0, match_duration_ms_total: 0, match_runs: 0, since: new Date() });
  return buckets.get(key);
}
function recordOffer(cityId, matched) {
  if (matched) bucket(cityId).offers_matched++;
}
function recordExcluded(cityId) {
  bucket(cityId).offers_excluded_only_mode++;
}
function recordRoutingError(cityId) {
  bucket(cityId).routing_errors++;
}
function recordMatchDuration(cityId, ms) {
  const b = bucket(cityId);
  b.match_duration_ms_total += ms;
  b.match_runs++;
}
function snapshot(cityId) {
  const keys = cityId ? [Number(cityId)] : [...buckets.keys()];
  return keys.map((key) => {
    const b = bucket(key);
    return {
      city_id: key || null,
      offers_matched: b.offers_matched,
      offers_excluded_only_mode: b.offers_excluded_only_mode,
      routing_errors: b.routing_errors,
      avg_match_duration_ms: b.match_runs ? Math.round(b.match_duration_ms_total / b.match_runs) : 0,
      match_runs: b.match_runs,
      since: b.since,
    };
  });
}
module.exports = { recordOffer, recordExcluded, recordRoutingError, recordMatchDuration, snapshot };
