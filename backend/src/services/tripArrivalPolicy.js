const { haversineKm } = require('../utils/geoDistance');

const POLICY = Object.freeze({ radiusM: 100, accuracyM: 35, maxSpeedMps: 2.5, dwellMs: 25000, gapMs: 20000, maxAgeMs: 20 * 60000 });

// Pure reducer: duplicate, stale, inaccurate and drive-by fixes cannot mark arrival.
function observeArrival(previous, sample, target, now = Date.now()) {
  const timestamp = Number(sample.timestamp);
  const priorTime = previous.last_sample_at ? new Date(previous.last_sample_at).getTime() : 0;
  if (!Number.isFinite(timestamp) || timestamp <= priorTime || timestamp > now + 5000 || now - timestamp > POLICY.maxAgeMs) {
    return { ...previous, arrived: false };
  }
  const next = { ...previous, last_sample_at: new Date(timestamp), arrived: false };
  const numeric = [sample.lat, sample.lng, sample.accuracy, sample.speed, target.lat, target.lng];
  const valid = numeric.every(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)))
    && Math.abs(Number(sample.lat)) <= 90 && Math.abs(Number(sample.lng)) <= 180
    && Math.abs(Number(target.lat)) <= 90 && Math.abs(Number(target.lng)) <= 180
    && !(Number(target.lat) === 0 && Number(target.lng) === 0)
    && Number(sample.accuracy) > 0 && Number(sample.accuracy) <= POLICY.accuracyM
    && Number(sample.speed) >= 0 && Number(sample.speed) <= POLICY.maxSpeedMps
    && sample.mock !== true
    && haversineKm(Number(sample.lat), Number(sample.lng), Number(target.lat), Number(target.lng)) * 1000
      + Number(sample.accuracy) <= POLICY.radiusM;
  if (!valid) return { ...next, candidate_key: null, candidate_since: null, candidate_count: 0 };
  const continuous = previous.candidate_key === target.key && previous.candidate_since && timestamp - priorTime <= POLICY.gapMs;
  next.candidate_key = target.key;
  next.candidate_since = continuous ? previous.candidate_since : new Date(timestamp);
  next.candidate_count = continuous ? previous.candidate_count + 1 : 1;
  next.arrived = next.candidate_count >= 3 && timestamp - new Date(next.candidate_since).getTime() >= POLICY.dwellMs;
  return next;
}

module.exports = { POLICY, observeArrival };
