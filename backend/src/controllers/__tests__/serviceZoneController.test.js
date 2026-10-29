jest.mock("../../config/db", () => ({
  service_zone: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const controller = require("../serviceZoneController");

const SQUARE = JSON.stringify([[22.7, 75.8], [22.7, 75.9], [22.8, 75.9], [22.8, 75.8]]);
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = (r) => r.json.mock.calls[0][0];
const valid = { name: "Indore pickup", center_lat: 22.75, center_lng: 75.85, radius_km: 5, polygon_geojson: SQUARE };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.service_zone.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  prisma.service_zone.update.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
});

describe("createZone", () => {
  it("a zone created without a type is the original duty zone", async () => {
    await controller.createZone({ scopedCityId: null, body: { ...valid, city_id: 2 } }, res());
    expect(prisma.service_zone.create.mock.calls[0][0].data).toMatchObject({ zone_kind: "duty", city_id: 2 });
  });

  it("a city admin's coverage zone is always in their own city, whatever city the request names", async () => {
    await controller.createZone({ scopedCityId: 5, body: { ...valid, zone_kind: "coverage", city_id: 9 } }, res());
    expect(prisma.service_zone.create.mock.calls[0][0].data).toMatchObject({ zone_kind: "coverage", city_id: 5 });
  });

  it("a superadmin must name the city for a coverage zone, and the area must be usable", async () => {
    const noCity = res();
    await controller.createZone({ scopedCityId: null, body: { ...valid, zone_kind: "coverage" } }, noCity);
    expect(noCity.status).toHaveBeenCalledWith(400);
    expect(body(noCity).message).toBe("Choose the city this pickup area belongs to");
    const badShape = res();
    await controller.createZone({ scopedCityId: null, body: { ...valid, zone_kind: "coverage", city_id: 2, polygon_geojson: "[[1,1],[2,2]]" } }, badShape);
    expect(badShape.status).toHaveBeenCalledWith(400);
    expect(prisma.service_zone.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown zone type", async () => {
    const r = res();
    await controller.createZone({ scopedCityId: 5, body: { ...valid, zone_kind: "other" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});

describe("listZones", () => {
  it("narrows a city admin to their own city's zones plus city-less ones, and honours ?kind", async () => {
    prisma.service_zone.findMany.mockResolvedValue([]);
    await controller.listZones({ scopedCityId: 5, query: { kind: "duty" } }, res());
    expect(prisma.service_zone.findMany).toHaveBeenCalledWith({ where: { zone_kind: "duty", OR: [{ city_id: 5 }, { city_id: null }] }, orderBy: { id: "desc" } });
  });
  it("a superadmin sees every zone", async () => {
    prisma.service_zone.findMany.mockResolvedValue([]);
    await controller.listZones({ scopedCityId: null, query: {} }, res());
    expect(prisma.service_zone.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe("update and delete are city-locked", () => {
  const zone = { id: 1, city_id: 5, zone_kind: "coverage", name: "A", polygon_geojson: SQUARE, center_lat: 22.75, center_lng: 75.85, radius_km: 5 };

  it("another city's admin gets 403 on edit and delete", async () => {
    prisma.service_zone.findUnique.mockResolvedValue(zone);
    const u = res();
    await controller.updateZone({ scopedCityId: 7, params: { id: "1" }, body: { name: "x" } }, u);
    const d = res();
    await controller.deleteZone({ scopedCityId: 7, user: { role: "admin" }, params: { id: "1" } }, d);
    expect(u.status).toHaveBeenCalledWith(403);
    expect(d.status).toHaveBeenCalledWith(403);
    expect(prisma.service_zone.update).not.toHaveBeenCalled();
    expect(prisma.service_zone.delete).not.toHaveBeenCalled();
  });

  it("the owning city's admin edits a coverage zone but cannot move it to another city", async () => {
    prisma.service_zone.findUnique.mockResolvedValue(zone);
    await controller.updateZone({ scopedCityId: 5, params: { id: "1" }, body: { name: "B", city_id: 9 } }, res());
    expect(prisma.service_zone.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: "B" } });
  });

  it("an edit that would leave a coverage zone without a usable area is refused", async () => {
    prisma.service_zone.findUnique.mockResolvedValue(zone);
    const r = res();
    await controller.updateZone({ scopedCityId: 5, params: { id: "1" }, body: { polygon_geojson: "[[1,1]]" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.service_zone.update).not.toHaveBeenCalled();
  });

  it("a city admin can delete a coverage zone of their city but not a duty zone; a superadmin can delete either", async () => {
    prisma.service_zone.findUnique.mockResolvedValue(zone);
    await controller.deleteZone({ scopedCityId: 5, user: { role: "admin" }, params: { id: "1" } }, res());
    expect(prisma.service_zone.delete).toHaveBeenCalledTimes(1);

    prisma.service_zone.findUnique.mockResolvedValue({ ...zone, zone_kind: "duty" });
    const denied = res();
    await controller.deleteZone({ scopedCityId: 5, user: { role: "admin" }, params: { id: "1" } }, denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(prisma.service_zone.delete).toHaveBeenCalledTimes(1);

    await controller.deleteZone({ scopedCityId: null, user: { role: "superadmin" }, params: { id: "1" } }, res());
    expect(prisma.service_zone.delete).toHaveBeenCalledTimes(2);
  });
});
