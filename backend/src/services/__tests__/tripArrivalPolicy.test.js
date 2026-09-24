const { observeArrival } = require('../tripArrivalPolicy');
const NOW = Date.parse('2026-09-24T10:00:00Z');
const target = { key: 'arrived', lat: 28.6, lng: 77.2 };
function fix(offset, overrides = {}) { return { lat: 28.6, lng: 77.2, accuracy: 10, speed: 0, timestamp: NOW + offset, ...overrides }; }
function feed(samples, t = target) { return samples.reduce((state, sample) => observeArrival(state, sample, t, NOW + 60000), {}); }

test('requires sustained proximity, not a single fix or a drive-by', () => {
  expect(feed([fix(0)]).arrived).toBe(false);
  expect(feed([fix(0), fix(10000), fix(20000)]).arrived).toBe(false);
  expect(feed([fix(0), fix(10000), fix(20000), fix(30000)]).arrived).toBe(true);
  expect(feed([fix(0), fix(10000, { speed: 8 }), fix(20000), fix(30000)]).arrived).toBe(false);
});
test.each([{ accuracy: 100 }, { speed: -1 }, { accuracy: null }, { mock: true }, { lat: 0 }, { lng: 999 }])('rejects unreliable fix %p', bad => {
  expect(feed([fix(0), fix(10000), fix(20000), fix(30000, bad)]).arrived).toBe(false);
});
test('uncertainty radius must fit inside the geofence', () => {
  expect(feed([0, 10000, 20000, 30000].map(t => fix(t, { lat: 28.6008, accuracy: 30 }))).arrived).toBe(false);
});
test('long gaps, duplicates and a new target cannot complete old dwell', () => {
  expect(feed([fix(0), fix(10000), fix(40000)]).arrived).toBe(false);
  expect(feed([fix(0), fix(0), fix(0)]).candidate_count).toBe(1);
  const state = feed([fix(0), fix(10000), fix(20000)]);
  expect(observeArrival(state, fix(30000), { ...target, key: 'arrived_drop' }, NOW + 60000).arrived).toBe(false);
});
test('bounded offline replay is accepted, stale/future fixes are ignored', () => {
  expect(observeArrival({}, fix(-21 * 60000), target, NOW).candidate_count).toBeUndefined();
  expect(observeArrival({}, fix(6000), target, NOW).candidate_count).toBeUndefined();
  expect(feed([fix(-60000), fix(-50000), fix(-40000), fix(-30000)]).arrived).toBe(true);
});
