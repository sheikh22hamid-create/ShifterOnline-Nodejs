jest.mock("../../config/db", () => ({
  service_zone: { findMany: jest.fn() },
  tbl_city: { findUnique: jest.fn(), findFirst: jest.fn() },
}));
jest.mock("../geofenceService", () => ({ isInsideZone: jest.fn() }));
jest.mock("../serviceAreaSettings", () => ({ isEnforced: jest.fn() }));

const prisma = require("../../config/db");
const { isInsideZone } = require("../geofenceService");
const serviceAreaSettings = require("../serviceAreaSettings");
const { resolvePickupArea, resolvePickupCityId } = require("../pickupCityService");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.service_zone.findMany.mockResolvedValue([{ id: 3, name: "Zone A", city_id: 5 }, { id: 4, name: "Zone B", city_id: 2 }]);
  prisma.tbl_city.findUnique.mockResolvedValue({ id: 5, title: "Bhopal" });
  prisma.tbl_city.findFirst.mockResolvedValue({ id: 1, title: "Indore" });
  serviceAreaSettings.isEnforced.mockResolvedValue(false);
});

describe("resolvePickupCityId", () => {
  it("returns the city of the first active zone containing the pickup", async () => {
    isInsideZone.mockImplementation((lat, lng, zone) => zone.id === 3);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBe(5);
    expect(prisma.service_zone.findMany).toHaveBeenCalledWith({ where: { status: 1 } });
  });

  it("falls back to the first active city when no zone matches", async () => {
    isInsideZone.mockReturnValue(false);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBe(1);
  });

  it("returns null when a matched zone has no city", async () => {
    prisma.service_zone.findMany.mockResolvedValue([{ id: 3, city_id: null }]);
    isInsideZone.mockReturnValue(true);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBeNull();
  });

  it("returns null when nothing matches and there is no active city", async () => {
    isInsideZone.mockReturnValue(false);
    prisma.tbl_city.findFirst.mockResolvedValue(null);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBeNull();
  });

  it("returns null for invalid coordinates without querying", async () => {
    await expect(resolvePickupCityId("x", undefined)).resolves.toBeNull();
    expect(prisma.service_zone.findMany).not.toHaveBeenCalled();
  });
});

describe("resolvePickupArea", () => {
  it("returns the zone, city id and city name", async () => {
    isInsideZone.mockImplementation((lat, lng, zone) => zone.id === 3);
    await expect(resolvePickupArea(23.2, 77.4)).resolves.toEqual({
      serviceable: true, cityId: 5, cityName: "Bhopal", zoneId: 3, zoneName: "Zone A",
    });
  });

  it("uses the first active city's main zone when no zone matches", async () => {
    isInsideZone.mockReturnValue(false);
    await expect(resolvePickupArea(23.2, 77.4)).resolves.toEqual({
      serviceable: true, cityId: 1, cityName: "Indore", zoneId: 1, zoneName: "Indore Main Zone",
    });
  });

  it("is not serviceable when nothing matches and there is no active city", async () => {
    isInsideZone.mockReturnValue(false);
    prisma.tbl_city.findFirst.mockResolvedValue(null);
    await expect(resolvePickupArea(23.2, 77.4)).resolves.toMatchObject({ serviceable: false, cityId: 0 });
  });
});

describe("coverage zones and the city lookup (spec 2026-10-29)", () => {
  const duty = { id: 3, name: "Duty", city_id: 5, zone_kind: "duty" };
  const coverage = { id: 8, name: "Coverage", city_id: 2, zone_kind: "coverage" };

  it("with the service-area check off, coverage zones are ignored: the original duty-zone lookup, unchanged", async () => {
    prisma.service_zone.findMany.mockResolvedValue([coverage, duty]);
    isInsideZone.mockReturnValue(true);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBe(5);
    const seen = isInsideZone.mock.calls.map((c) => c[2].id);
    expect(seen).toEqual([3]);
  });

  it("with the check on, coverage zones come first and name the pickup's city", async () => {
    serviceAreaSettings.isEnforced.mockResolvedValue(true);
    prisma.service_zone.findMany.mockResolvedValue([duty, coverage]);
    isInsideZone.mockReturnValue(true);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBe(2);
  });

  it("a zone without a kind is a duty zone", async () => {
    prisma.service_zone.findMany.mockResolvedValue([{ id: 3, city_id: 5 }]);
    isInsideZone.mockReturnValue(true);
    await expect(resolvePickupCityId(23.2, 77.4)).resolves.toBe(5);
  });
});
