jest.mock("../porterLiveSettings", () => ({ getConfig: jest.fn(), isActiveForCity: jest.fn() }));
jest.mock("../../utils/logger", () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const settings = require("../porterLiveSettings");
const svc = require("../porterQuoteService");

const P = { lat: 22.7196, lng: 75.8577 };
const D = { lat: 22.75, lng: 75.9 };
const okBody = (quotes = [{ porter_vehicle_id: 91, fare: 412.6 }]) => ({ ok: true, quotes, porter_distance_km: 6.2, quoted_at: "2026-11-22T10:00:00Z" });
const okFetch = (body = okBody()) => jest.fn().mockResolvedValue({ ok: true, json: async () => body });
const args = (over = {}) => ({ cityId: 7, category: "3 Wheeler", pickup: P, drop: D, stops: [], ...over });

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
    expect(await svc.getPorterAnchor(args(), { fetchImpl: rej })).toBeNull();
    expect(await svc.getPorterAnchor(args(), { fetchImpl: bad })).toBeNull();
    expect(await svc.getPorterAnchor(args(), { fetchImpl: abort })).toBeNull();
    expect(svc.getStats().failures).toBe(3);
    expect(svc.getStats().lastError).toBeTruthy();
  });
  test("breaker opens after 5 failures and resumes after 5 min", async () => {
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    let t = 1000;
    const now = () => t;
    for (let i = 0; i < 5; i++) await svc.getPorterAnchor(args(), { fetchImpl: rej, now });
    expect(rej).toHaveBeenCalledTimes(5);
    expect(await svc.getPorterAnchor(args(), { fetchImpl: rej, now })).toBeNull();
    expect(rej).toHaveBeenCalledTimes(5);
    t += 5 * 60000 + 1;
    const f = okFetch();
    expect((await svc.getPorterAnchor(args(), { fetchImpl: f, now })).fare).toBe(412.6);
    expect(f).toHaveBeenCalledTimes(1);
  });
  test("success resets consecutive failures", async () => {
    const rej = jest.fn().mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 4; i++) await svc.getPorterAnchor(args(), { fetchImpl: rej });
    await svc.getPorterAnchor(args({ pickup: { lat: 1, lng: 1 } }), { fetchImpl: okFetch() });
    for (let i = 0; i < 4; i++) await svc.getPorterAnchor(args(), { fetchImpl: rej });
    expect(rej).toHaveBeenCalledTimes(8);
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
