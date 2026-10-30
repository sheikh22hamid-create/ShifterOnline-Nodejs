const rules = require("../goToHomeRules");

const now = new Date("2026-10-30T12:00:00Z");
const route = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }];
const row = (over = {}) => ({ rider_id: 1, active: true, home_lat: 0, home_lng: 2, route_geometry: route, route_computed_at: new Date(now - 60 * 60 * 1000), ...over });

test("drop inside the 5 km corridor matches", () => {
  expect(rules.evaluate(row(), [{ lat: 0.02, lng: 1 }], now).matched).toBe(true); // ~2.2 km off the line
});
test("drop outside the corridor does not match, even with the pickup on the route", () => {
  expect(rules.evaluate(row(), [{ lat: 0.1, lng: 1 }], now).reason).toBe("drop_outside_corridor"); // ~11 km off
});
test("every stop must be inside the corridor", () => {
  expect(rules.evaluate(row(), [{ lat: 0, lng: 1 }, { lat: 0.5, lng: 1 }], now).matched).toBe(false);
});
test("the corridor applies on both sides of the route", () => {
  expect(rules.evaluate(row(), [{ lat: -0.03, lng: 1 }], now).matched).toBe(true);
});
test("inactive mode never matches", () => {
  expect(rules.evaluate(row({ active: false }), [{ lat: 0, lng: 1 }], now).reason).toBe("inactive");
});
test("a route older than 2 h + grace gets no priority", () => {
  expect(rules.evaluate(row({ route_computed_at: new Date(now - 2.5 * 60 * 60 * 1000) }), [{ lat: 0, lng: 1 }], now).reason).toBe("route_stale");
});
test("a route just inside the grace window is still trusted", () => {
  expect(rules.isRouteValid(row({ route_computed_at: new Date(now - (2 * 60 + 10) * 60 * 1000) }), now)).toBe(true);
});
test("a cleared route (invalidated) is not valid", () => {
  expect(rules.isRouteValid(row({ route_geometry: null }), now)).toBe(false);
});
test("missing home location never matches", () => {
  expect(rules.evaluate(row({ home_lat: null, home_lng: null }), [{ lat: 0, lng: 1 }], now).reason).toBe("no_home");
});
test("malformed drop is rejected, not guessed", () => {
  expect(rules.evaluate(row(), [{ lat: NaN, lng: 1 }], now).reason).toBe("invalid_drop");
});
test("prioritize puts matched drivers first and keeps the rest in their order", () => {
  const rows = [{ rider_id: 1 }, { rider_id: 2 }, { rider_id: 3 }, { rider_id: 4 }];
  const m = new Map([[3, { matched: true }], [4, { matched: false }]]);
  expect(rules.prioritize(rows, m).map((r) => r.rider_id)).toEqual([3, 1, 2, 4]);
});
test("prioritize with no matches leaves the order unchanged", () => {
  const rows = [{ rider_id: 5 }, { rider_id: 6 }];
  expect(rules.prioritize(rows, new Map()).map((r) => r.rider_id)).toEqual([5, 6]);
});
test("thin keeps both ends and caps the size", () => {
  const g = Array.from({ length: 1000 }, (_, i) => ({ lat: i, lng: 0 }));
  const t = rules.thin(g, 100);
  expect(t.length).toBe(100);
  expect(t[0]).toEqual(g[0]);
  expect(t[99]).toEqual(g[999]);
});
