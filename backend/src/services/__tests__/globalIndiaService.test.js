jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
  service_zone: { findMany: jest.fn(), findFirst: jest.fn() },
  tbl_city: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../globalIndiaSettings");
const globalIndia = require("../globalIndiaService");
const { resolvePickupArea, resolvePickupCityId } = require("../pickupCityService");

const INDORE = { lat: 22.7196, lng: 75.8577 };
const UJJAIN = { lat: 23.1765, lng: 75.7885 };
const BETWEEN = { lat: 22.95, lng: 75.82 };
const COLOMBO = { lat: 6.9271, lng: 79.8612 };

const cities = [
  { id: 1, title: "Indore", status: 1 }, { id: 2, title: "Ujjain", status: 1 }, { id: 99, title: "Global India", status: 1 },
];
const zone = (id, city_id, c, radius_km, extra = {}) => ({ id, city_id, name: `Zone ${id}`, center_lat: c.lat, center_lng: c.lng, radius_km, polygon_geojson: null, status: 1, zone_kind: "coverage", ...extra });

function setup({ enabled = true, cityIdSetting = null, zones, cityRows = cities } = {}) {
  jest.clearAllMocks();
  settings.invalidate();
  prisma.app_settings.findMany.mockResolvedValue([
    { setting_key: "global_india_fallback_enabled", setting_value: enabled ? "1" : "0" },
    ...(cityIdSetting ? [{ setting_key: "global_india_city_id", setting_value: String(cityIdSetting) }] : []),
  ]);
  prisma.tbl_city.findMany.mockResolvedValue(cityRows);
  prisma.tbl_city.findUnique.mockImplementation(({ where }) => Promise.resolve(cityRows.find((c) => c.id === where.id) || null));
  prisma.tbl_city.findFirst.mockResolvedValue(cityRows[0]);
  prisma.service_zone.findMany.mockResolvedValue(zones ?? [zone(1, 1, INDORE, 25), zone(2, 2, UJJAIN, 15)]);
}

describe("switch and Global India city", () => {
  it("OFF (default): nothing changes, resolve returns null", async () => {
    setup({ enabled: false });
    expect(await globalIndia.resolve(BETWEEN.lat, BETWEEN.lng)).toBeNull();
  });

  it("an unreadable switch fails closed to OFF", async () => {
    setup();
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect(await globalIndia.resolve(BETWEEN.lat, BETWEEN.lng)).toBeNull();
  });

  it("the Global India city comes from the setting when set, else from a city titled 'global'", async () => {
    setup({ cityIdSetting: 2 });
    expect((await settings.getConfig({ fresh: true })).globalCity).toMatchObject({ id: 2, source: "setting" });
    setup();
    expect((await settings.getConfig({ fresh: true })).globalCity).toMatchObject({ id: 99, source: "title" });
  });

  it("a configured city that is inactive or missing is not silently replaced by a guess", async () => {
    setup({ cityIdSetting: 2, cityRows: [{ id: 2, title: "Ujjain", status: 0 }, { id: 99, title: "Global India", status: 1 }] });
    expect((await settings.getConfig({ fresh: true })).globalCity).toBeNull();
  });
});

describe("resolvePickupArea / resolvePickupCityId with the fallback ON", () => {
  it("A: pickup inside Indore's geofence -> Indore", async () => {
    setup();
    expect(await resolvePickupArea(INDORE.lat, INDORE.lng)).toMatchObject({ serviceable: true, cityId: 1, cityName: "Indore" });
    expect(await resolvePickupCityId(INDORE.lat, INDORE.lng)).toBe(1);
  });

  it("B: pickup inside Ujjain's geofence -> Ujjain", async () => {
    setup();
    expect(await resolvePickupCityId(UJJAIN.lat, UJJAIN.lng)).toBe(2);
  });

  it("C: between the two, outside both, inside India -> Global India", async () => {
    setup();
    expect(await resolvePickupArea(BETWEEN.lat, BETWEEN.lng)).toMatchObject({ serviceable: true, cityId: 99, cityName: "Global India", zoneName: "Global India" });
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(99);
  });

  it("outside India -> not serviceable, no Global India", async () => {
    setup();
    expect(await resolvePickupArea(COLOMBO.lat, COLOMBO.lng)).toMatchObject({ serviceable: false, cityId: 0 });
    expect(await resolvePickupCityId(COLOMBO.lat, COLOMBO.lng)).toBeNull();
  });

  it("a global-area pickup switches to Indore as soon as Indore's geofence is updated to include it (next lookup)", async () => {
    setup();
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(99);
    prisma.service_zone.findMany.mockResolvedValue([zone(1, 1, INDORE, 60), zone(2, 2, UJJAIN, 15)]); // admin grew Indore
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(1);
  });

  it("... and goes back to Global India when the geofence is reduced or removed", async () => {
    setup({ zones: [zone(1, 1, INDORE, 60), zone(2, 2, UJJAIN, 15)] });
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(1);
    prisma.service_zone.findMany.mockResolvedValue([zone(1, 1, INDORE, 25), zone(2, 2, UJJAIN, 15)]);
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(99);
    prisma.service_zone.findMany.mockResolvedValue([zone(2, 2, UJJAIN, 15)]); // Indore's geofence deleted
    expect(await resolvePickupCityId(INDORE.lat, INDORE.lng)).toBe(99);
  });

  it("an area moves from one city to another (Indore -> Ujjain)", async () => {
    setup({ zones: [zone(1, 1, INDORE, 60), zone(2, 2, UJJAIN, 15)] });
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(1);
    prisma.service_zone.findMany.mockResolvedValue([zone(1, 1, INDORE, 25), zone(2, 2, UJJAIN, 60)]);
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(2);
  });

  it("a deactivated city's geofence no longer covers anything (its area falls back to Global India)", async () => {
    setup({ cityRows: [{ id: 1, title: "Indore", status: 0 }, cities[1], cities[2]] });
    expect(await resolvePickupCityId(INDORE.lat, INDORE.lng)).toBe(99);
  });

  it("with the fallback OFF the original resolution runs unchanged (first matching zone, else the first active city)", async () => {
    setup({ enabled: false, zones: [zone(1, 2, UJJAIN, 15, { zone_kind: "duty" })] });
    expect(await resolvePickupCityId(UJJAIN.lat, UJJAIN.lng)).toBe(2);
    expect(await resolvePickupCityId(COLOMBO.lat, COLOMBO.lng)).toBe(1); // legacy: first active city
  });

  it("inside India with no Global India city set up keeps the original resolution rather than guessing", async () => {
    setup({ cityRows: [cities[0], cities[1]] }); // no city titled 'global', nothing configured
    expect(await resolvePickupCityId(BETWEEN.lat, BETWEEN.lng)).toBe(1); // legacy first active city
  });
});
