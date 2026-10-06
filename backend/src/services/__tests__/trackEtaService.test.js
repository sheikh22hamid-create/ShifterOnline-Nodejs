jest.mock("../../config/db", () => ({}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
const svc = require("../trackEtaService");

const FROM = { lat: 22.7, lng: 75.8 };
const TO = { lat: 22.75, lng: 75.85 };
const googleOk = (seconds = 600, meters = 4200) =>
  jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: `${seconds}s`, distanceMeters: meters }] }) });

beforeEach(() => {
  svc._reset();
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});
afterAll(() => delete process.env.GOOGLE_MAPS_API_KEY);

describe("getEta", () => {
  it("returns minutes and distance from Google", async () => {
    const eta = await svc.getEta(1, FROM, TO, { now: 1000, fetchImpl: googleOk() });
    expect(eta).toMatchObject({ minutes: 10, distance_km: 4.2 });
    expect(new Date(eta.updated_at).getTime()).toBe(1000);
  });
  it("reuses the cache for 60 s", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, { lat: 22.9, lng: 75.9 }, TO, { now: 59000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("between 60 s and 120 s reuses only if the driver moved less than 150 m", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, { lat: 22.701, lng: 75.8 }, TO, { now: 90000, fetchImpl: f }); // ~111 m
    expect(f).toHaveBeenCalledTimes(1);
    await svc.getEta(1, { lat: 22.702, lng: 75.8 }, TO, { now: 91000, fetchImpl: f }); // ~222 m from the cached point
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("recomputes after 120 s even if the driver did not move", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, FROM, TO, { now: 121000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("makes one Google call for concurrent requests", async () => {
    const f = googleOk();
    const [a, b] = await Promise.all([svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f }), svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f })]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
  it("falls back to a straight-line estimate when Google fails", async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const eta = await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    expect(eta.minutes).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(eta.distance_km)).toBe(true);
  });
  it("falls back without calling Google when there is no API key", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const f = jest.fn();
    const eta = await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(eta.minutes).toBeGreaterThanOrEqual(1);
  });
});

describe("destination awareness and eviction", () => {
  const MOVED = { lat: 22.76, lng: 75.85 }; // ~1.1 km from TO
  const NEAR = { lat: 22.75001, lng: 75.85 }; // ~1 m from TO
  const routeOk = (coords) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ polyline: { geoJsonLinestring: { coordinates: coords } } }] }) });
  it("recomputes the route when the drop moved more than 50 m", async () => {
    const f = routeOk([[75.8, 22.7], [75.85, 22.76]]);
    await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getRoute(1, FROM, MOVED, { now: 1000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("recomputes the route when the pickup moved more than 50 m", async () => {
    const f = routeOk([[75.8, 22.7], [75.85, 22.75]]);
    await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getRoute(1, { lat: 22.71, lng: 75.8 }, TO, { now: 1000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("reuses the route when the drop moved less than 50 m", async () => {
    const f = routeOk([[75.8, 22.7], [75.85, 22.75]]);
    await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getRoute(1, FROM, NEAR, { now: 1000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("recomputes the ETA when the drop moved, even inside the 60 s window", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, FROM, NEAR, { now: 1000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    await svc.getEta(1, FROM, MOVED, { now: 2000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("sweeps entries older than their TTL on the next write", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f });
    expect(svc._sizes()).toEqual({ eta: 1, route: 1 });
    await svc.getEta(2, FROM, TO, { now: 11 * 60 * 1000, fetchImpl: f });
    await svc.getRoute(2, FROM, TO, { now: 31 * 60 * 1000, fetchImpl: f });
    expect(svc._sizes()).toEqual({ eta: 1, route: 1 });
  });
});

describe("getRoute", () => {
  const routeOk = (coords) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ polyline: { geoJsonLinestring: { coordinates: coords } } }] }) });
  it("returns [lat,lng] pairs (GeoJSON is lng,lat)", async () => {
    const r = await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: routeOk([[75.8, 22.7], [75.85, 22.75]]) });
    expect(r).toEqual([[22.7, 75.8], [22.75, 75.85]]);
  });
  it("caches the route for the order", async () => {
    const f = routeOk([[75.8, 22.7], [75.85, 22.75]]);
    await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getRoute(1, FROM, TO, { now: 60000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("falls back to a straight line when Google fails and retries after 2 minutes", async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f })).toEqual([[22.7, 75.8], [22.75, 75.85]]);
    await svc.getRoute(1, FROM, TO, { now: 60000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    await svc.getRoute(1, FROM, TO, { now: 130000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("simplify", () => {
  it("keeps short lines and thins long ones to at most 150 points, keeping both ends", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => [i, i]);
    const out = svc.simplify(pts);
    expect(out.length).toBeLessThanOrEqual(150);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([999, 999]);
    expect(svc.simplify([[1, 1], [2, 2]])).toHaveLength(2);
  });
});
