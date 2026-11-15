jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  tbl_city: { findMany: jest.fn(), findUnique: jest.fn() },
  service_zone: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../../services/globalIndiaSettings");
const controller = require("../globalIndiaController");

const cities = [{ id: 1, title: "Indore", status: 1 }, { id: 2, title: "Ujjain", status: 1 }, { id: 99, title: "Global India", status: 1 }, { id: 5, title: "Old", status: 0 }];
const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

function setup({ stored = {} } = {}) {
  jest.clearAllMocks();
  settings.invalidate();
  const rows = Object.entries(stored).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
  prisma.app_settings.findMany.mockImplementation(() => Promise.resolve(rows));
  prisma.app_settings.findFirst.mockResolvedValue(null);
  prisma.app_settings.create.mockImplementation(({ data }) => { rows.push(data); return Promise.resolve(data); });
  prisma.tbl_city.findMany.mockResolvedValue(cities);
  prisma.tbl_city.findUnique.mockImplementation(({ where }) => Promise.resolve(cities.find((c) => c.id === where.id) || null));
  prisma.service_zone.findMany.mockResolvedValue([
    { id: 1, city_id: 1, status: 1, name: "Indore", center_lat: 22.7196, center_lng: 75.8577, radius_km: 25, updated_at: new Date("2026-11-10T00:00:00Z") },
    { id: 2, city_id: 2, status: 1, name: "Ujjain", center_lat: 23.1765, center_lng: 75.7885, radius_km: 15, updated_at: new Date("2026-11-12T00:00:00Z") },
  ]);
}

describe("status", () => {
  it("reports the switch, the Global India city (found by title), every city's geofences and the boundary", async () => {
    setup();
    const r = res();
    await controller.status({}, r);
    const data = r.json.mock.calls[0][0].data;
    expect(data).toMatchObject({ enabled: false, ready: true, global_city: { id: 99, source: "title" } });
    expect(data.coverage_text).toMatch(/not covered by any active City Admin geofence/);
    expect(data.boundary.polygons).toBeGreaterThan(10);
    expect(data.cities.find((c) => c.id === 1)).toMatchObject({ geofences: 1, is_global: false, active: true });
    expect(data.cities.find((c) => c.id === 99)).toMatchObject({ geofences: 0, is_global: true });
    expect(data.cities.find((c) => c.id === 5)).toMatchObject({ active: false });
  });
});

describe("update", () => {
  it("refuses to turn the fallback on while no Global India city exists", async () => {
    setup();
    prisma.tbl_city.findMany.mockResolvedValue(cities.filter((c) => c.id !== 99));
    const r = res();
    await controller.update({ body: { enabled: true } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.app_settings.create).not.toHaveBeenCalled();
  });

  it("turns it on when a Global India city exists", async () => {
    setup();
    const r = res();
    await controller.update({ body: { enabled: true } }, r);
    expect(prisma.app_settings.create).toHaveBeenCalledWith({ data: { setting_key: "global_india_fallback_enabled", setting_value: "1" } });
  });

  it("refuses an unknown or inactive city as Global India, and saves a good one", async () => {
    setup();
    let r = res();
    await controller.update({ body: { city_id: 404 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    r = res();
    await controller.update({ body: { city_id: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    r = res();
    await controller.update({ body: { city_id: 2 } }, r);
    expect(prisma.app_settings.create).toHaveBeenCalledWith({ data: { setting_key: "global_india_city_id", setting_value: "2" } });
  });
});

describe("check", () => {
  it("says who serves a pickup, even while the switch is off", async () => {
    setup();
    const cases = [
      [{ lat: 22.7196, lng: 75.8577 }, { result: "city", city_id: 1, city_name: "Indore" }],
      [{ lat: 22.95, lng: 75.82 }, { result: "global", city_id: 99, city_name: "Global India" }],
      [{ lat: 6.9271, lng: 79.8612 }, { result: "outside_india", city_id: null }],
    ];
    for (const [body, expected] of cases) {
      const r = res();
      await controller.check({ body }, r);
      expect(r.json.mock.calls[0][0].data).toMatchObject({ switch_enabled: false, ...expected });
    }
  });

  it("rejects a bad coordinate", async () => {
    setup();
    const r = res();
    await controller.check({ body: { lat: "abc", lng: 75 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});
