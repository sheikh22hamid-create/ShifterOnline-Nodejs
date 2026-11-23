jest.mock("../porterLiveSettings", () => ({ getConfig: jest.fn(), isActiveForCity: jest.fn() }));
jest.mock("../../utils/logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const settings = require("../porterLiveSettings");
const svc = require("../porterQuoteService");

const P = { lat: 22.7196, lng: 75.8577 };
const D = { lat: 22.75, lng: 75.9 };
const okBody = (quotes = [{ porter_vehicle_id: 91, fare: 412.6 }]) => ({ ok: true, quotes, porter_distance_km: 6.2, quoted_at: "2026-11-22T10:00:00Z" });
const okFetch = (body = okBody()) => jest.fn().mockResolvedValue({ ok: true, json: async () => body });
const args = (over = {}) => ({ cityId: 7, category: "3 Wheeler", pickup: P, drop: D, stops: [], ...over });
// A distinct route per i (failed fetches are negative-cached per route, so repeats of one route make no fetch).
const route = (i) => args({ pickup: { lat: 22 + i / 100, lng: 75.5 } });

beforeEach(() => {
  svc._resetForTests();
  settings.getConfig.mockResolvedValue({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
  settings.isActiveForCity.mockImplementation(async (c) => c === 7);
});

describe("getPorterAnchor", () => {
  test("city not active -> null, no fetch", async () => {
    const f = okFetch();
    expect(await svc.getPorterAnchor(args({ cityId: 9 }), { fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  test("stops present -> null, no fetch", async () => {
    const f = okFetch();
    expect(await svc.getPorterAnchor(args({ stops: [{ lat: 1, lng: 2 }] }), { fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  test("returns anchor and posts the right body", async () => {
    const f = okFetch();
    const a = await svc.getPorterAnchor(args(), { fetchImpl: f });
    expect(a).toEqual({ fare: 412.6, porter_distance_km: 6.2, porter_vehicle_id: 91, quoted_at: "2026-11-22T10:00:00Z" });
    const [url, opts] = f.mock.calls[0];
    expect(url).toMatch(/\/api\/porter-quote$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ pickup: P, drop: D, stops: [] });
  });
  test("cache hit for coords differing in 5th decimal", async () => {
    const f = okFetch();
    await svc.getPorterAnchor(args(), { fetchImpl: f });
    await svc.getPorterAnchor(args({ pickup: { lat: P.lat + 0.00001, lng: P.lng } }), { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(svc.getStats().cacheHits).toBe(1);
  });
  test("cache expires after cacheMinutes", async () => {
    const f = okFetch();
    let t = 1000;
    const now = () => t;
    await svc.getPorterAnchor(args(), { fetchImpl: f, now });
    t += 11 * 60000;
    await svc.getPorterAnchor(args(), { fetchImpl: f, now });
    expect(f).toHaveBeenCalledTimes(2);
  });
  test("concurrent calls dedupe", async () => {
    const f = okFetch();
    const [a, b] = await Promise.all([svc.getPorterAnchor(args(), { fetchImpl: f }), svc.getPorterAnchor(args(), { fetchImpl: f })]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.fare).toBe(412.6);
  });
  test("missing vehicle -> null, other vehicle still served from cache, no failure", async () => {
    const f = okFetch();
    expect(await svc.getPorterAnchor(args({ category: "Tata Ace" }), { fetchImpl: f })).toBeNull();
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f })).fare).toBe(412.6);
    expect(f).toHaveBeenCalledTimes(1);
    expect(svc.getStats().failures).toBe(0);
  });
  test("reject / ok:false / timeout -> null and counted", async () => {
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    const bad = okFetch({ ok: false });
    const abort = jest.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "AbortError" }));
    expect(await svc.getPorterAnchor(route(1), { fetchImpl: rej })).toBeNull();
    expect(await svc.getPorterAnchor(route(2), { fetchImpl: bad })).toBeNull();
    expect(await svc.getPorterAnchor(route(3), { fetchImpl: abort })).toBeNull();
    expect(svc.getStats().failures).toBe(3);
    expect(svc.getStats().lastError).toBeTruthy();
  });
  test("breaker opens after 5 failures and resumes after 5 min", async () => {
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    let t = 1000;
    const now = () => t;
    for (let i = 0; i < 5; i++) await svc.getPorterAnchor(route(i), { fetchImpl: rej, now });
    expect(rej).toHaveBeenCalledTimes(5);
    expect(await svc.getPorterAnchor(route(9), { fetchImpl: rej, now })).toBeNull();
    expect(rej).toHaveBeenCalledTimes(5);
    t += 5 * 60000 + 1;
    const f = okFetch();
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
    expect(f).toHaveBeenCalledTimes(1);
  });
  test("success resets consecutive failures", async () => {
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 4; i++) await svc.getPorterAnchor(route(i), { fetchImpl: rej });
    await svc.getPorterAnchor(args({ pickup: { lat: 1, lng: 1 } }), { fetchImpl: okFetch() });
    for (let i = 10; i < 14; i++) await svc.getPorterAnchor(route(i), { fetchImpl: rej });
    expect(rej).toHaveBeenCalledTimes(8);
  });
  test("cache hit is served while the breaker is open", async () => {
    let t = 1000;
    const now = () => t;
    const f = okFetch();
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 5; i++) await svc.getPorterAnchor(route(i), { fetchImpl: rej, now });
    expect(svc.getStats().breakerOpenUntil).toBeGreaterThan(t);
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
    expect(f).toHaveBeenCalledTimes(1);
  });
  test("failed fetch is negative-cached: a second call within the TTL makes no fetch and returns null", async () => {
    let t = 1000;
    const now = () => t;
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    expect(await svc.getPorterAnchor(args(), { fetchImpl: rej, now })).toBeNull();
    t += 60000;
    const f = okFetch();
    expect(await svc.getPorterAnchor(args(), { fetchImpl: f, now })).toBeNull();
    expect(await svc.getPorterAnchor(args({ category: "Mini 3W" }), { fetchImpl: f, now })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(svc.getStats().failures).toBe(1);
  });
  test("negative entries expire after the TTL", async () => {
    let t = 1000;
    const now = () => t;
    await svc.getPorterAnchor(args(), { fetchImpl: jest.fn().mockRejectedValue(new Error("boom")), now });
    t += 10 * 60000 + 1;
    const f = okFetch();
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
    expect(f).toHaveBeenCalledTimes(1);
  });
  test("markRouteRejected: later calls for the same route+vehicle return null without fetch, other vehicles unaffected", async () => {
    let t = 1000;
    const now = () => t;
    const f = okFetch(okBody([{ porter_vehicle_id: 91, fare: 412.6 }, { porter_vehicle_id: 1139, fare: 300 }]));
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
    svc.markRouteRejected({ cityId: 7, pickup: P, drop: D, category: "3 Wheeler" }, { now });
    expect(await svc.getPorterAnchor(args(), { fetchImpl: f, now })).toBeNull();
    expect((await svc.getPorterAnchor(args({ category: "Mini 3W" }), { fetchImpl: f, now })).fare).toBe(300);
    expect(f).toHaveBeenCalledTimes(1);
    // a rejection with no cached quote also makes no fetch
    const g = okFetch();
    svc.markRouteRejected({ cityId: 7, pickup: { lat: 1, lng: 1 }, drop: D, category: "3 Wheeler" }, { now });
    expect(await svc.getPorterAnchor(args({ pickup: { lat: 1, lng: 1 } }), { fetchImpl: g, now })).toBeNull();
    expect(g).not.toHaveBeenCalled();
    // expires after the TTL
    t += 10 * 60000 + 1;
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
  });
  test("markRouteRejected ignores bad input without throwing", () => {
    expect(() => svc.markRouteRejected({})).not.toThrow();
    expect(() => svc.markRouteRejected({ cityId: 7, pickup: null, drop: D, category: "3 Wheeler" })).not.toThrow();
    expect(() => svc.markRouteRejected()).not.toThrow();
  });
  test("reads the config once per call (no isActiveForCity round trip)", async () => {
    settings.getConfig.mockClear();
    settings.isActiveForCity.mockClear();
    await svc.getPorterAnchor(args(), { fetchImpl: okFetch() });
    expect(settings.getConfig).toHaveBeenCalledTimes(1);
    expect(settings.isActiveForCity).not.toHaveBeenCalled();
  });
  test("normalises porter_distance_km and quoted_at (never undefined)", async () => {
    const f = okFetch({ ok: true, quotes: [{ porter_vehicle_id: 91, fare: 400 }] });
    expect(await svc.getPorterAnchor(args(), { fetchImpl: f })).toEqual({ fare: 400, porter_distance_km: null, porter_vehicle_id: 91, quoted_at: null });
    svc._resetForTests();
    const g = okFetch({ ok: true, quotes: [{ porter_vehicle_id: 91, fare: 400 }], porter_distance_km: "6.5", quoted_at: 12345 });
    expect(await svc.getPorterAnchor(args(), { fetchImpl: g })).toEqual({ fare: 400, porter_distance_km: 6.5, porter_vehicle_id: 91, quoted_at: null });
    svc._resetForTests();
    const h = okFetch({ ok: true, quotes: [{ porter_vehicle_id: 91, fare: 400 }], porter_distance_km: "abc", quoted_at: "2026-11-22T10:00:00Z" });
    expect(await svc.getPorterAnchor(args(), { fetchImpl: h })).toEqual({ fare: 400, porter_distance_km: null, porter_vehicle_id: 91, quoted_at: "2026-11-22T10:00:00Z" });
  });
  test.each([
    ["null", null],
    ["empty strings", { lat: "", lng: "" }],
    ["null coords", { lat: null, lng: null }],
    ["(0,0)", { lat: 0, lng: 0 }],
    ["lat > 90", { lat: 91, lng: 75 }],
    ["lng < -180", { lat: 22, lng: -181 }],
  ])("invalid point (%s) -> null, no fetch", async (_n, p) => {
    const f = okFetch();
    expect(await svc.getPorterAnchor(args({ pickup: p }), { fetchImpl: f })).toBeNull();
    expect(await svc.getPorterAnchor(args({ drop: p }), { fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  test("withinSanityRange", () => {
    expect(svc.withinSanityRange(300, 100)).toBe(false);
    expect(svc.withinSanityRange(300, 200)).toBe(true);
    expect(svc.withinSanityRange(0, 200)).toBe(false);
    expect(svc.withinSanityRange(100, 0)).toBe(false);
  });
  test("anchorFromOrder", () => {
    expect(svc.anchorFromOrder({ porter_quote: "{bad" })).toBeNull();
    expect(svc.anchorFromOrder({})).toBeNull();
    expect(svc.anchorFromOrder({ porter_quote: { fare: 0 } })).toBeNull();
    expect(svc.anchorFromOrder({ porter_quote: { fare: 300 } })).toEqual({ fare: 300 });
    expect(svc.anchorFromOrder({ porter_quote: '{"fare":300,"quoted_at":"x"}' })).toEqual({ fare: 300, quoted_at: "x" });
  });
  test("PORTER_PRICING_VEHICLE_ID", () => {
    expect(svc.PORTER_PRICING_VEHICLE_ID.mini_3w).toBe(1139);
    expect(svc.PORTER_PRICING_VEHICLE_ID.three_wheeler).toBe(91);
  });
});

describe("anchorForNewRoute", () => {
  const anchored = (over = {}) => ({
    id: 5, city_id: 7, category: "3 Wheeler", delivery_type: 4, distance: 10,
    porter_quote: { fare: 300, porter_distance_km: 9.8, porter_vehicle_id: 91, quoted_at: "2026-11-22T09:00:00Z" },
    ...over,
  });
  const route = (over = {}) => ({ pickup: P, drop: D, stops: [], newDistanceKm: 13, ...over });
  // rate card 200 at the old distance (10), 260 at the new one (13); a Porter-anchored price stays near it.
  const price = () => jest.fn(async (_pkg, d, _r, _e, _u, _s, _m, anchor) => ({ fare: anchor ? anchor.fare : d === 10 ? 200 : 260 }));

  test("order without an anchor -> null, no fetch", async () => {
    const f = okFetch();
    const p = price();
    expect(await svc.anchorForNewRoute(anchored({ porter_quote: null }), route(), { fetchImpl: f, priceForPackageId: p })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(p).not.toHaveBeenCalled();
  });

  test("live Porter quote for the new route wins", async () => {
    const f = okFetch(okBody([{ porter_vehicle_id: 91, fare: 280 }]));
    const a = await svc.anchorForNewRoute(anchored(), route(), { fetchImpl: f, priceForPackageId: price() });
    expect(a).toEqual({ fare: 280, porter_distance_km: 6.2, porter_vehicle_id: 91, quoted_at: "2026-11-22T10:00:00Z" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ pickup: P, drop: D, stops: [] });
  });

  test("Porter unavailable -> old fare scaled by the rate-card ratio (200 -> 260 = x1.3)", async () => {
    const f = jest.fn().mockRejectedValue(new Error("down"));
    const p = price();
    const a = await svc.anchorForNewRoute(anchored(), route(), { fetchImpl: f, priceForPackageId: p, now: () => Date.parse("2026-11-23T08:00:00Z") });
    expect(a).toEqual({ fare: 390, porter_distance_km: 9.8, porter_vehicle_id: 91, quoted_at: "2026-11-23T08:00:00.000Z", scaled: true });
    expect(p).toHaveBeenCalledWith(4, 10, 1, 0, null);
    expect(p).toHaveBeenCalledWith(4, 13, 1, 0, null);
  });

  test("stops present -> scaled path, no Porter call", async () => {
    const f = okFetch();
    const a = await svc.anchorForNewRoute(anchored(), route({ stops: [{ lat: 22.73, lng: 75.87 }] }), { fetchImpl: f, priceForPackageId: price() });
    expect(f).not.toHaveBeenCalled();
    expect(a.fare).toBe(390);
    expect(a.scaled).toBe(true);
  });

  test("city not enabled / no category -> scaled, no fetch", async () => {
    const f = okFetch();
    expect((await svc.anchorForNewRoute(anchored({ city_id: 9 }), route(), { fetchImpl: f, priceForPackageId: price() })).fare).toBe(390);
    expect((await svc.anchorForNewRoute(anchored({ category: null }), route(), { fetchImpl: f, priceForPackageId: price() })).fare).toBe(390);
    expect(f).not.toHaveBeenCalled();
  });

  // Fail closed: when the new route can't be anchored the order drops to the rate card, never keeps the old fare.
  test("old distance 0 / missing -> null", async () => {
    const f = jest.fn().mockRejectedValue(new Error("down"));
    expect(await svc.anchorForNewRoute(anchored({ distance: 0 }), route(), { fetchImpl: f, priceForPackageId: price() })).toBeNull();
    expect(await svc.anchorForNewRoute(anchored({ distance: null }), route(), { fetchImpl: f, priceForPackageId: price() })).toBeNull();
  });

  test("rate card <= 0 (old or new) -> null", async () => {
    const f = jest.fn().mockRejectedValue(new Error("down"));
    const zero = jest.fn(async () => ({ fare: 0 }));
    expect(await svc.anchorForNewRoute(anchored(), route(), { fetchImpl: f, priceForPackageId: zero })).toBeNull();
    const newNegative = jest.fn(async (_p, d) => ({ fare: d === 10 ? 200 : -5 }));
    expect(await svc.anchorForNewRoute(anchored(), route(), { fetchImpl: f, priceForPackageId: newNegative })).toBeNull();
  });

  test("a thrown pricing error -> null", async () => {
    const f = jest.fn().mockRejectedValue(new Error("down"));
    const boom = jest.fn(async () => { throw new Error("no package"); });
    expect(await svc.anchorForNewRoute(anchored(), route(), { fetchImpl: f, priceForPackageId: boom })).toBeNull();
  });

  test("live quote failing the sanity guard (>2x rate card) -> scaled instead", async () => {
    const f = okFetch(okBody([{ porter_vehicle_id: 91, fare: 900 }]));
    const a = await svc.anchorForNewRoute(anchored(), route(), { fetchImpl: f, priceForPackageId: price() });
    expect(a.fare).toBe(390);
    expect(a.scaled).toBe(true);
  });

  test("rounds the scaled fare to 2 decimals", async () => {
    const f = jest.fn().mockRejectedValue(new Error("down"));
    const p = jest.fn(async (_pkg, d) => ({ fare: d === 10 ? 300 : 100 }));
    const a = await svc.anchorForNewRoute(anchored({ porter_quote: { fare: 100 } }), route(), { fetchImpl: f, priceForPackageId: p });
    expect(a.fare).toBe(33.33);
  });
});
