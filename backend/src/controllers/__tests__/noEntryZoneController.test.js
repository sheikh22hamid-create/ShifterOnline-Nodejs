jest.mock("../../config/db", () => ({
  vehicle_no_entry_zone: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pkg_category: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const controller = require("../noEntryZoneController");

const SQUARE = JSON.stringify([[22.7, 75.8], [22.7, 75.9], [22.8, 75.9], [22.8, 75.8]]);
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = (r) => r.json.mock.calls[0][0];

beforeEach(() => {
  jest.resetAllMocks();
  prisma.pkg_category.findUnique.mockResolvedValue({ id: 3 });
  prisma.vehicle_no_entry_zone.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  prisma.vehicle_no_entry_zone.update.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
});

describe("create", () => {
  const base = { name: "Old city", category_id: 3, kind: "pickup", polygon_geojson: SQUARE };

  it("saves the zone for a city admin's own city, ignoring any city in the body, with a centre taken from the polygon", async () => {
    const r = res();
    await controller.create({ scopedCityId: 5, body: { ...base, city_id: 9 } }, r);
    const data = prisma.vehicle_no_entry_zone.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ city_id: 5, category_id: 3, kind: "pickup", name: "Old city", status: 1 });
    expect(data.center_lat).toBeCloseTo(22.75);
    expect(data.center_lng).toBeCloseTo(75.85);
    expect(body(r).success).toBe(true);
  });

  it("a superadmin (no scoped city) must name the city", async () => {
    const r = res();
    await controller.create({ scopedCityId: null, body: base }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(body(r).message).toBe("Choose a city");
    const ok = res();
    await controller.create({ scopedCityId: null, body: { ...base, city_id: 2 } }, ok);
    expect(prisma.vehicle_no_entry_zone.create.mock.calls[0][0].data.city_id).toBe(2);
  });

  it.each([
    [{ kind: "stop" }, "Choose Pickup or Drop No Entry Zone"],
    [{ category_id: undefined }, "Choose a vehicle category"],
    [{ name: " " }, "Zone name is required"],
    [{ polygon_geojson: "[[1,1],[2,2]]" }, "Draw a valid area with at least 3 points"],
  ])("rejects %j with a plain message and saves nothing", async (patch, message) => {
    const r = res();
    await controller.create({ scopedCityId: 5, body: { ...base, ...patch } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(body(r).message).toBe(message);
    expect(prisma.vehicle_no_entry_zone.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown vehicle category", async () => {
    prisma.pkg_category.findUnique.mockResolvedValue(null);
    const r = res();
    await controller.create({ scopedCityId: 5, body: base }, r);
    expect(body(r).message).toBe("Unknown vehicle category");
  });
});

describe("list", () => {
  it("filters by the admin's city, vehicle category and kind", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([]);
    await controller.list({ scopedCityId: 5, query: { category_id: "3", kind: "drop" } }, res());
    expect(prisma.vehicle_no_entry_zone.findMany).toHaveBeenCalledWith({ where: { city_id: 5, category_id: 3, kind: "drop" }, orderBy: { id: "desc" } });
  });
  it("a superadmin sees every city unless filtering", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([]);
    await controller.list({ scopedCityId: null, query: {} }, res());
    expect(prisma.vehicle_no_entry_zone.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe("update and delete are city-locked", () => {
  const zone = { id: 1, city_id: 5, category_id: 3, kind: "pickup", name: "A", polygon_geojson: SQUARE, center_lat: 22.75, center_lng: 75.85, radius_km: 1 };

  it("another city's admin gets 403 and nothing changes", async () => {
    prisma.vehicle_no_entry_zone.findUnique.mockResolvedValue(zone);
    const u = res();
    await controller.update({ scopedCityId: 7, params: { id: "1" }, body: { name: "x" } }, u);
    expect(u.status).toHaveBeenCalledWith(403);
    const d = res();
    await controller.remove({ scopedCityId: 7, params: { id: "1" } }, d);
    expect(d.status).toHaveBeenCalledWith(403);
    expect(prisma.vehicle_no_entry_zone.update).not.toHaveBeenCalled();
    expect(prisma.vehicle_no_entry_zone.delete).not.toHaveBeenCalled();
  });

  it("the owning city's admin and a superadmin can edit and delete; the city cannot be moved", async () => {
    prisma.vehicle_no_entry_zone.findUnique.mockResolvedValue(zone);
    const u = res();
    await controller.update({ scopedCityId: 5, params: { id: "1" }, body: { name: "B", status: 0, city_id: 9 } }, u);
    expect(prisma.vehicle_no_entry_zone.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: "B", status: 0 } });
    const d = res();
    await controller.remove({ scopedCityId: null, params: { id: "1" } }, d);
    expect(prisma.vehicle_no_entry_zone.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("answers 404 for a missing zone", async () => {
    prisma.vehicle_no_entry_zone.findUnique.mockResolvedValue(null);
    const r = res();
    await controller.remove({ scopedCityId: 5, params: { id: "1" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});
