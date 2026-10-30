const mockPrisma = {
  app_settings: { findFirst: jest.fn() },
  driver_go_to_home: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_rider_delivery_type: { findFirst: jest.fn(), updateMany: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
jest.mock("../../config/db", () => mockPrisma);
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const mockRoadRoute = jest.fn();
jest.mock("../favoriteRouteService", () => ({ roadRoute: (...a) => mockRoadRoute(...a) }));

const svc = require("../goToHomeService");
const rider = { id: 7, city_id: 1 };
const home = { rider_id: 7, active: false, home_lat: 22.7, home_lng: 75.9, home_address: "Home" };
const fixAt = () => ({ rlats: "22.80", rlongs: "75.80", rloc_updated_at: new Date() });
const route = { geometry: [{ lat: 22.8, lng: 75.8 }, { lat: 22.7, lng: 75.9 }], distance_km: 14 };

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.app_settings.findFirst.mockResolvedValue(null); // switch missing = ON
  mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  mockPrisma.tbl_rider_delivery_type.findFirst.mockResolvedValue({ status: 1 });
  mockPrisma.tbl_rider_delivery_type.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.driver_go_to_home.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.driver_go_to_home.update.mockResolvedValue({});
  mockPrisma.driver_go_to_home.upsert.mockResolvedValue({});
});

describe("enable", () => {
  test("saves the mode and switches Standard Tier ON only where it is not already ON", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(home);
    mockPrisma.tbl_rider.findUnique.mockResolvedValue(fixAt());
    mockRoadRoute.mockResolvedValue(route);
    await svc.enable(rider);
    const tier = mockPrisma.tbl_rider_delivery_type.updateMany.mock.calls[0][0];
    expect(tier.where).toEqual({ rider_id: 7, delivery_type: "6", status: { not: 1 } });
    expect(tier.data).toEqual({ status: 1 });
    const saved = mockPrisma.driver_go_to_home.update.mock.calls[0][0].data;
    expect(saved.active).toBe(true);
    expect(saved.next_refresh_at - saved.route_computed_at).toBe(2 * 60 * 60 * 1000);
  });

  test("no saved home: nothing is written", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(null);
    await expect(svc.enable(rider)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test("stale GPS: not activated, Standard Tier untouched", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(home);
    mockPrisma.tbl_rider.findUnique.mockResolvedValue({ ...fixAt(), rloc_updated_at: new Date(Date.now() - 10 * 60 * 1000) });
    await expect(svc.enable(rider)).rejects.toMatchObject({ statusCode: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.tbl_rider_delivery_type.updateMany).not.toHaveBeenCalled();
  });

  test("route failure: not activated, Standard Tier untouched", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(home);
    mockPrisma.tbl_rider.findUnique.mockResolvedValue(fixAt());
    mockRoadRoute.mockRejectedValue(Object.assign(new Error("down"), { statusCode: 503 }));
    await expect(svc.enable(rider)).rejects.toMatchObject({ statusCode: 503 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.tbl_rider_delivery_type.updateMany).not.toHaveBeenCalled();
  });

  test("already active: a repeat enable does nothing", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue({ ...home, active: true });
    await svc.enable(rider);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockRoadRoute).not.toHaveBeenCalled();
  });
});

describe("disable", () => {
  test("turns the mode off, keeps the home, never touches Standard Tier", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(home);
    await svc.disable(rider);
    const call = mockPrisma.driver_go_to_home.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ active: false, next_refresh_at: null, route_geometry: null });
    expect(call.data).not.toHaveProperty("home_lat");
    expect(mockPrisma.tbl_rider_delivery_type.updateMany).not.toHaveBeenCalled();
  });
});

describe("refresh", () => {
  const active = { ...home, active: true, route_geometry: route.geometry, route_computed_at: new Date() };

  test("success replaces the route and schedules the next refresh 2 h out; Standard Tier is never touched", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(active);
    mockPrisma.tbl_rider.findUnique.mockResolvedValue(fixAt());
    mockRoadRoute.mockResolvedValue(route);
    const r = await svc.refreshOne(7, { force: true, cityId: 1 });
    expect(r.ok).toBe(true);
    const d = mockPrisma.driver_go_to_home.updateMany.mock.calls[0][0].data;
    expect(d.last_refresh_status).toBe("ok");
    expect(d.next_refresh_at - d.route_computed_at).toBe(2 * 60 * 60 * 1000);
    expect(mockPrisma.tbl_rider_delivery_type.updateMany).not.toHaveBeenCalled();
  });

  test("no GPS: status recorded, retry soon, old route not overwritten", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(active);
    mockPrisma.tbl_rider.findUnique.mockResolvedValue({ ...fixAt(), rloc_updated_at: null });
    const r = await svc.refreshOne(7, { force: true, cityId: 1 });
    expect(r.status).toBe("no_location");
    const d = mockPrisma.driver_go_to_home.updateMany.mock.calls[0][0].data;
    expect(d.last_refresh_status).toBe("no_location");
    expect(d).not.toHaveProperty("route_geometry");
    expect(d.next_refresh_at.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  test("route API failure: status recorded, retry soon", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(active);
    mockPrisma.tbl_rider.findUnique.mockResolvedValue(fixAt());
    mockRoadRoute.mockRejectedValue(new Error("boom"));
    expect((await svc.refreshOne(7, { force: true, cityId: 1 })).status).toBe("route_failed");
  });

  test("a sweep claim lost to another instance does no work", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(active);
    mockPrisma.driver_go_to_home.updateMany.mockResolvedValue({ count: 0 });
    expect((await svc.refreshOne(7, { claimedNext: new Date() })).skipped).toBe(true);
    expect(mockRoadRoute).not.toHaveBeenCalled();
  });
});

describe("saveHome", () => {
  test("a changed home drops the old route before anything else", async () => {
    mockPrisma.driver_go_to_home.findUnique.mockResolvedValue(home);
    await svc.saveHome(rider, { lat: 22.9, lng: 75.7, address: "New" });
    const u = mockPrisma.driver_go_to_home.upsert.mock.calls[0][0].update;
    expect(u).toMatchObject({ home_lat: 22.9, home_lng: 75.7, route_geometry: null, route_computed_at: null });
  });
  test("rejects an invalid point", async () => {
    await expect(svc.saveHome(rider, { lat: 0, lng: 0 })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("prioritize", () => {
  const order = { id: 1, dlat: 22.75, dlong: 75.85 };
  const rows = [{ rider_id: 1 }, { rider_id: 7 }];
  test("puts a matching Go to Home driver first without dropping anyone", async () => {
    mockPrisma.driver_go_to_home.findMany.mockResolvedValue([{ ...home, rider_id: 7, active: true, route_geometry: route.geometry, route_computed_at: new Date() }]);
    mockPrisma.pkg_order_stops.findMany.mockResolvedValue([]);
    const out = await svc.prioritize(order, rows);
    expect(out.map((r) => r.rider_id)).toEqual([7, 1]);
    expect(out[0].go_to_home_match.matched).toBe(true);
  });
  test("a DB error returns the list unchanged", async () => {
    mockPrisma.driver_go_to_home.findMany.mockRejectedValue(new Error("x"));
    expect(await svc.prioritize(order, rows)).toBe(rows);
  });
});
