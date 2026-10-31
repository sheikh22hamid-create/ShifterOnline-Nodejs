process.env.PUBLIC_BASE_URL = "https://api.example.com";

jest.mock("../../config/db", () => ({
  pkg_order: { findFirst: jest.fn(), findUnique: jest.fn() },
  order_route_share: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tripRouteService", () => ({ buildRoute: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ haversineKm: (a, b, c, d) => Math.abs(c - a) + Math.abs(d - b) }));

const prisma = require("../../config/db");
const tripRoute = require("../tripRouteService");
const svc = require("../routeShareService");
const controller = require("../../controllers/routeShareController");
const { renderPage } = require("../../controllers/routePage");

const TOKEN = "A".repeat(43);
const completed = { id: 9, order_status: 5, o_status: "Completed", odate: new Date("2026-10-01"), ddate: new Date("2026-10-01") };

function mockRes() {
  const res = { headers: {} };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.send = jest.fn((b) => { res.body = b; return res; });
  res.set = jest.fn((h) => { Object.assign(res.headers, h); return res; });
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe("urlForOwner", () => {
  test("someone else's order is not found (ownership enforced in the query)", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);
    const out = await svc.urlForOwner({ orderId: 9, uid: 2 });
    expect(prisma.pkg_order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, uid: 2 } }));
    expect(out).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  test("an unfinished ride cannot be shared", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 9, order_status: 3, o_status: "Processing" });
    expect(await svc.urlForOwner({ orderId: 9, uid: 2 })).toMatchObject({ ok: false, code: "NOT_COMPLETED" });
    expect(prisma.order_route_share.create).not.toHaveBeenCalled();
  });

  test("completed ride gets one stable link, created once", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(completed);
    prisma.order_route_share.findUnique.mockResolvedValueOnce(null);
    prisma.order_route_share.create.mockImplementation(async ({ data }) => ({ ...data, id: 1 }));
    const first = await svc.urlForOwner({ orderId: 9, uid: 2 });
    expect(first.ok).toBe(true);
    expect(first.url).toMatch(/^https:\/\/api\.example\.com\/route\/[A-Za-z0-9_-]{43}$/);
    const saved = prisma.order_route_share.create.mock.calls[0][0].data;
    prisma.order_route_share.findUnique.mockResolvedValueOnce({ id: 1, token: saved.token });
    const second = await svc.urlForOwner({ orderId: 9, uid: 2 });
    expect(second.url).toBe(first.url);
    expect(prisma.order_route_share.create).toHaveBeenCalledTimes(1);
  });
});

describe("link expiry (30 days)", () => {
  const day = 24 * 60 * 60 * 1000;

  test("isExpired flips after 30 days", () => {
    expect(svc.isExpired({ created_at: new Date(Date.now() - 29 * day) })).toBe(false);
    expect(svc.isExpired({ created_at: new Date(Date.now() - 31 * day) })).toBe(true);
  });

  test("owner asking after expiry gets a rotated token and a fresh date", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(completed);
    prisma.order_route_share.findUnique.mockResolvedValue({ id: 1, order_id: 9, token: TOKEN, created_at: new Date(Date.now() - 40 * day) });
    prisma.order_route_share.update.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    const out = await svc.urlForOwner({ orderId: 9, uid: 2 });
    const data = prisma.order_route_share.update.mock.calls[0][0].data;
    expect(data.token).not.toBe(TOKEN);
    expect(Date.now() - data.created_at.getTime()).toBeLessThan(5000);
    expect(out.url).toContain(data.token);
  });

  test("an unexpired link is reused untouched", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(completed);
    prisma.order_route_share.findUnique.mockResolvedValue({ id: 1, order_id: 9, token: TOKEN, created_at: new Date(Date.now() - 5 * day) });
    const out = await svc.urlForOwner({ orderId: 9, uid: 2 });
    expect(prisma.order_route_share.update).not.toHaveBeenCalled();
    expect(out.url).toContain(TOKEN);
  });

  test("public API answers 410 expired for an old link and does not build the route", async () => {
    prisma.order_route_share.findUnique.mockResolvedValue({ id: 1, order_id: 9, created_at: new Date(Date.now() - 31 * day) });
    const res = mockRes();
    await controller.routeData({ params: { token: TOKEN } }, res);
    expect(res.statusCode).toBe(410);
    expect(res.body).toEqual({ state: "expired" });
    expect(tripRoute.buildRoute).not.toHaveBeenCalled();
  });
});

describe("buildPublicRoute", () => {
  const link = { id: 1, order_id: 9 };
  const route = {
    has_trail: true, distance_km: 12.34, cancelled: false,
    points: [
      { lat: 0.5, lng: 1.5, phase: 0 }, { lat: 0.8, lng: 1.8, phase: 0 },
      { lat: 1, lng: 2, phase: 1 }, { lat: 1.1, lng: 2.1, phase: 1, gap: true },
    ],
    start: { lat: 1, lng: 2 }, pickup: { lat: 1, lng: 2 }, final_pickup: null, otp_point: { lat: 5, lng: 5 },
    stops: [{ lat: 3, lng: 3 }], drop: { lat: 4, lng: 4 },
    assignments: [{ rider_id: 77, points: [] }], order_status: 5, o_status: "Completed",
  };

  test("ready: only the pickup->drop trail (gaps kept), never the driver's own trip or start point", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(completed);
    tripRoute.buildRoute.mockResolvedValue(route);
    const out = await svc.buildPublicRoute(link);
    expect(out.state).toBe("ready");
    expect(out.points).toEqual([{ lat: 1, lng: 2, phase: 1 }, { lat: 1.1, lng: 2.1, phase: 1, gap: true }]);
    expect(out.start).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("0.5");
    expect(out.distance_km).toBeCloseTo(0.2, 2); // delivery leg only, not the 12.34 km total
    expect(out.stops).toHaveLength(1);
    expect(out.drop).toEqual({ lat: 4, lng: 4 });
    expect(out.booking_id).toBe("SO0000000009");
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/rider|assignments|otp|uid|mobile|address/i);
  });

  test("a trail with no pickup->drop part is treated as no trail", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(completed);
    tripRoute.buildRoute.mockResolvedValue({ ...route, points: route.points.filter((p) => p.phase === 0) });
    expect((await svc.buildPublicRoute(link)).state).toBe("no_trail");
  });

  test("no trail recorded: pins only, state no_trail, no path", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(completed);
    tripRoute.buildRoute.mockResolvedValue({ ...route, has_trail: false, points: [] });
    const out = await svc.buildPublicRoute(link);
    expect(out.state).toBe("no_trail");
    expect(out.points).toBeUndefined();
    expect(out.pickup).toBeTruthy();
  });

  test("a ride that is not completed is unavailable", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...completed, order_status: 3, o_status: "Processing" });
    expect(await svc.buildPublicRoute(link)).toEqual({ state: "unavailable" });
    expect(tripRoute.buildRoute).not.toHaveBeenCalled();
  });
});

describe("public endpoints", () => {
  test("bad token shape -> 404 without touching the DB", async () => {
    const res = mockRes();
    await controller.routeData({ params: { token: "short" } }, res);
    expect(res.statusCode).toBe(404);
    expect(prisma.order_route_share.findUnique).not.toHaveBeenCalled();
  });

  test("unknown token -> 404", async () => {
    prisma.order_route_share.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await controller.routeData({ params: { token: TOKEN } }, res);
    expect(res.statusCode).toBe(404);
  });

  test("valid token -> JSON route, not cacheable", async () => {
    prisma.order_route_share.findUnique.mockResolvedValue({ id: 1, order_id: 9, created_at: new Date() });
    prisma.order_route_share.update.mockResolvedValue({});
    prisma.pkg_order.findUnique.mockResolvedValue(completed);
    tripRoute.buildRoute.mockResolvedValue({ has_trail: false, points: [], pickup: { lat: 1, lng: 2 }, stops: [], drop: { lat: 3, lng: 4 } });
    const res = mockRes();
    await controller.routeData({ params: { token: TOKEN } }, res);
    expect(res.body.state).toBe("no_trail");
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  test("link endpoint: validation and missing-table failure are clean messages", async () => {
    let res = mockRes();
    await controller.customerRouteLink({ body: {} }, res);
    expect(res.body.Result).toBe("false");
    prisma.pkg_order.findFirst.mockResolvedValue(completed);
    prisma.order_route_share.findUnique.mockRejectedValue(new Error("P2021 no table"));
    res = mockRes();
    await controller.customerRouteLink({ body: { uid: 2, order_id: 9 } }, res);
    expect(res.body).toMatchObject({ ResponseCode: "500", Result: "false" });
  });
});

describe("page", () => {
  test("renders with config and its script is valid JavaScript", () => {
    const html = renderPage({ tileUrl: "https://t/{z}/{x}/{y}.png?key=abc", attribution: "<b>x</b>" });
    expect(html).toContain("/api/route/");
    expect(html).not.toContain("__CONFIG__");
    expect(html).not.toContain("<b>x</b>"); // "<" escaped inside the JSON config
    const scripts = [...html.matchAll(/<script(?![^>]*src=)(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBe(1);
    expect(() => new Function(scripts[0])).not.toThrow();
  });
});
