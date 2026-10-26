jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const { haversineKm } = require("../../utils/geoDistance");
const pts = require("../outsideSearchPoints");

const ORIGIN = { lat: 22.7196, lng: 75.8577 };
const dist = (a, b) => haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;
let key;
beforeAll(() => { key = process.env.GOOGLE_MAPS_API_KEY; process.env.GOOGLE_MAPS_API_KEY = "test-key"; });
afterAll(() => { if (key === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = key; });

// Google "snaps" to the requested point and reports a road distance 1.3x the straight line.
const echoRoutes = () => jest.fn(async (_url, init) => {
  const b = JSON.parse(init.body);
  const from = { lat: b.origin.location.latLng.latitude, lng: b.origin.location.latLng.longitude };
  const to = { lat: b.destination.location.latLng.latitude, lng: b.destination.location.latLng.longitude };
  return { ok: true, json: async () => ({ routes: [{ distanceMeters: dist(from, to) * 1.3, legs: [{ endLocation: { latLng: { latitude: to.lat, longitude: to.lng } } }] }] }) };
});
const placeFn = async () => ({ title: "Scheme 54", subtitle: "Vijay Nagar, Indore, Madhya Pradesh" });

describe("outsideSearchPoints.generate", () => {
  it("puts the pickup 500 m - 1 km from the order and the drop about 2 km from that pickup", async () => {
    for (let i = 0; i < 25; i += 1) {
      const out = await pts.generate(ORIGIN, { fetchImpl: echoRoutes(), placeFn });
      expect(dist(ORIGIN, out.pickup)).toBeGreaterThanOrEqual(500 * 0.9);
      expect(dist(ORIGIN, out.pickup)).toBeLessThanOrEqual(1000 * 1.1);
      expect(dist(out.pickup, out.drop)).toBeGreaterThanOrEqual(1800 * 0.9);
      expect(dist(out.pickup, out.drop)).toBeLessThanOrEqual(2200 * 1.1);
      expect(out.pickup).toMatchObject({ title: "Scheme 54", subtitle: "Vijay Nagar, Indore, Madhya Pradesh" });
    }
  });

  it("varies per call", async () => {
    const a = await pts.generate(ORIGIN, { fetchImpl: echoRoutes(), placeFn });
    const b = await pts.generate(ORIGIN, { fetchImpl: echoRoutes(), placeFn });
    expect(a.pickup).not.toEqual(b.pickup);
  });

  it("returns null instead of an unverified point when Google cannot route", async () => {
    const down = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await pts.generate(ORIGIN, { fetchImpl: down, placeFn })).toBeNull();
    expect(down).toHaveBeenCalledTimes(pts.MAX_TRIES);
  });

  it("rejects a point Google snaps far away from the requested one", async () => {
    const far = jest.fn(async () => ({ ok: true, json: async () => ({ routes: [{ distanceMeters: 900, legs: [{ endLocation: { latLng: { latitude: 22.80, longitude: 75.95 } } }] }] }) }));
    expect(await pts.generate(ORIGIN, { fetchImpl: far, placeFn })).toBeNull();
  });

  it("rejects a point reachable only by a long detour", async () => {
    const detour = jest.fn(async (u, init) => {
      const j = await (await echoRoutes()(u, init)).json();
      j.routes[0].distanceMeters *= 5;
      return { ok: true, json: async () => j };
    });
    expect(await pts.generate(ORIGIN, { fetchImpl: detour, placeFn })).toBeNull();
  });

  it("returns null without a Google key", async () => {
    const saved = process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    const f = jest.fn();
    expect(await pts.generate(ORIGIN, { fetchImpl: f, placeFn })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    process.env.GOOGLE_MAPS_API_KEY = saved;
  });

  it("falls back to a generic title when no place is found nearby", async () => {
    const out = await pts.generate(ORIGIN, { fetchImpl: echoRoutes(), placeFn: async () => null });
    expect(out.pickup.title).toBe("Pickup Location");
  });
});
