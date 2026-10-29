jest.mock("../../config/db", () => ({
  service_zone: { findMany: jest.fn() },
  vehicle_no_entry_zone: { findMany: jest.fn() },
  pkg_category: { findFirst: jest.fn() },
  tbl_package: { findUnique: jest.fn() },
}));
jest.mock("../serviceAreaSettings", () => ({ isEnforced: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../serviceAreaSettings");
const service = require("../serviceAreaService");

const box = (lat0, lat1, lng0, lng1) => JSON.stringify([[lat0, lng0], [lat0, lng1], [lat1, lng1], [lat1, lng0]]);
const INDORE = { id: 1, city_id: 1, zone_kind: "coverage", status: 1, polygon_geojson: box(22.6, 22.8, 75.7, 75.95) };
const UJJAIN = { id: 2, city_id: 2, zone_kind: "coverage", status: 1, polygon_geojson: box(23.1, 23.25, 75.7, 75.85) };
const IN_INDORE = [22.7, 75.8];
const IN_UJJAIN = [23.18, 75.78];
const NOWHERE = [10.0, 70.0];
// Three-Wheeler is category 3, Two-Wheeler is 2
const noEntry = (o) => ({ id: 9, status: 1, center_lat: 0, center_lng: 0, radius_km: 1, ...o });

beforeEach(() => {
  jest.resetAllMocks();
  settings.isEnforced.mockResolvedValue(true);
  prisma.service_zone.findMany.mockResolvedValue([INDORE, UJJAIN]);
  prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([]);
  prisma.pkg_category.findFirst.mockResolvedValue(null);
});

describe("switch OFF", () => {
  it("allows everything and reads no zone", async () => {
    settings.isEnforced.mockResolvedValue(false);
    expect(await service.validateLocation({ lat: NOWHERE[0], lng: NOWHERE[1], kind: "pickup", category: 3 })).toEqual({ ok: true, enforced: false });
    expect(prisma.service_zone.findMany).not.toHaveBeenCalled();
  });
});

describe("coverage", () => {
  it("allows a point inside a coverage zone and reports its city", async () => {
    expect(await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup" })).toMatchObject({ ok: true, city_id: 1 });
  });

  it("blocks a point in no coverage zone with the exact message for pickup and for drop", async () => {
    expect(await service.validateLocation({ lat: NOWHERE[0], lng: NOWHERE[1], kind: "pickup" })).toMatchObject({ ok: false, code: "NO_SERVICE_ZONE", message: "No service zone available for this pickup location." });
    expect(await service.validateLocation({ lat: NOWHERE[0], lng: NOWHERE[1], kind: "drop" })).toMatchObject({ ok: false, code: "NO_SERVICE_ZONE", message: "No service zone available for this drop location." });
  });

  it("blocks everything when no coverage zone is configured at all (never assumes fully serviceable)", async () => {
    prisma.service_zone.findMany.mockResolvedValue([]);
    expect((await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup" })).code).toBe("NO_SERVICE_ZONE");
  });

  it("reads only active coverage zones, not duty zones", async () => {
    await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup" });
    expect(prisma.service_zone.findMany).toHaveBeenCalledWith({ where: { status: 1, zone_kind: "coverage" } });
  });

  it("treats a point on the coverage boundary as covered", async () => {
    expect((await service.validateLocation({ lat: 22.6, lng: 75.8, kind: "pickup" })).ok).toBe(true);
  });
});

describe("No Entry Zones", () => {
  const zone = noEntry({ city_id: 1, category_id: 3, kind: "pickup", polygon_geojson: box(22.69, 22.71, 75.79, 75.81) });

  it("blocks a pickup inside a Pickup No Entry Zone of the selected vehicle in that city", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([zone]);
    const out = await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup", category: 3 });
    expect(out).toMatchObject({ ok: false, code: "NO_ENTRY", message: "Pickup is not allowed in this area for the selected vehicle type." });
  });

  it("queries only the same kind, the same vehicle category and the covering city", async () => {
    await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup", category: 3 });
    expect(prisma.vehicle_no_entry_zone.findMany).toHaveBeenCalledWith({ where: { status: 1, kind: "pickup", category_id: 3, city_id: { in: [1] } } });
  });

  it("allows a point that is inside coverage but outside every No Entry polygon", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([zone]);
    expect((await service.validateLocation({ lat: 22.75, lng: 75.9, kind: "pickup", category: 3 })).ok).toBe(true);
  });

  it("treats a No Entry edge as blocked", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([zone]);
    expect((await service.validateLocation({ lat: 22.69, lng: 75.8, kind: "pickup", category: 3 })).code).toBe("NO_ENTRY");
  });

  it("uses the drop message for a Drop No Entry Zone", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([noEntry({ city_id: 2, category_id: 3, kind: "drop", polygon_geojson: box(23.17, 23.19, 75.77, 75.79) })]);
    const out = await service.validateLocation({ lat: IN_UJJAIN[0], lng: IN_UJJAIN[1], kind: "drop", category: 3 });
    expect(out.message).toBe("Drop location is a no-entry zone for the selected vehicle type. Please choose another location.");
  });

  it("checks coverage only when no vehicle category is given (no No Entry lookup)", async () => {
    expect((await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup" })).ok).toBe(true);
    expect(prisma.vehicle_no_entry_zone.findMany).not.toHaveBeenCalled();
  });

  it("resolves a category given by name", async () => {
    prisma.pkg_category.findFirst.mockResolvedValue({ id: 3 });
    await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup", category: "Three Wheeler" });
    expect(prisma.vehicle_no_entry_zone.findMany.mock.calls[0][0].where.category_id).toBe(3);
  });
});

describe("validateRoute (pickup and drop judged independently)", () => {
  it("Indore pickup fine, Ujjain drop in a drop No Entry Zone: only the drop is refused, with the drop message", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockImplementation(async ({ where }) =>
      where.kind === "drop" && where.city_id.in.includes(2)
        ? [noEntry({ city_id: 2, category_id: 3, kind: "drop", polygon_geojson: box(23.17, 23.19, 75.77, 75.79) })]
        : []);
    const out = await service.validateRoute({ pickup: { lat: IN_INDORE[0], lng: IN_INDORE[1] }, drop: { lat: IN_UJJAIN[0], lng: IN_UJJAIN[1] }, category: 3 });
    expect(out).toMatchObject({ ok: false, which: "drop", code: "NO_ENTRY" });
    expect(out.message).toMatch(/^Drop location is a no-entry zone/);
  });

  it("an Indore Pickup zone of another vehicle never blocks this vehicle, and a pickup zone never blocks a drop", async () => {
    // returned only if the query asked for exactly kind pickup, category 3, city 1
    prisma.vehicle_no_entry_zone.findMany.mockImplementation(async ({ where }) =>
      where.kind === "pickup" && where.category_id === 2 ? [noEntry({ city_id: 1, category_id: 2, kind: "pickup", polygon_geojson: box(22.6, 22.8, 75.7, 75.95) })] : []);
    const ok = await service.validateRoute({ pickup: { lat: IN_INDORE[0], lng: IN_INDORE[1] }, drop: { lat: IN_INDORE[0], lng: IN_INDORE[1] }, category: 3 });
    expect(ok.ok).toBe(true);
    const blocked = await service.validateRoute({ pickup: { lat: IN_INDORE[0], lng: IN_INDORE[1] }, drop: { lat: IN_INDORE[0], lng: IN_INDORE[1] }, category: 2 });
    expect(blocked).toMatchObject({ ok: false, which: "pickup" });
  });

  it("reports the pickup first when both fail, and passes when both are fine", async () => {
    const bad = await service.validateRoute({ pickup: { lat: NOWHERE[0], lng: NOWHERE[1] }, drop: { lat: NOWHERE[0], lng: NOWHERE[1] }, category: 3 });
    expect(bad).toMatchObject({ ok: false, which: "pickup", code: "NO_SERVICE_ZONE" });
    const good = await service.validateRoute({ pickup: { lat: IN_INDORE[0], lng: IN_INDORE[1] }, drop: { lat: IN_UJJAIN[0], lng: IN_UJJAIN[1] }, category: 3 });
    expect(good).toMatchObject({ ok: true });
  });
});

describe("fail closed", () => {
  it("a named vehicle that cannot be resolved is refused, not given a pass on its No Entry rules", async () => {
    prisma.pkg_category.findFirst.mockResolvedValue(null);
    const out = await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup", category: "Mystery Cart" });
    expect(out).toMatchObject({ ok: false, code: "UNKNOWN_VEHICLE" });
    expect(prisma.vehicle_no_entry_zone.findMany).not.toHaveBeenCalled();
  });

  it("a coverage zone that is not tied to a city does not count as coverage", async () => {
    prisma.service_zone.findMany.mockResolvedValue([{ ...INDORE, city_id: null }]);
    expect((await service.validateLocation({ lat: IN_INDORE[0], lng: IN_INDORE[1], kind: "pickup", category: 3 })).code).toBe("NO_SERVICE_ZONE");
  });
});

describe("validateBooking (categories come from the validated packages)", () => {
  const pickup = { lat: IN_INDORE[0], lng: IN_INDORE[1] };
  const drop = { lat: IN_UJJAIN[0], lng: IN_UJJAIN[1] };

  it("is a no-op while the switch is off", async () => {
    settings.isEnforced.mockResolvedValue(false);
    expect(await service.validateBooking({ pickup, drop, stops: [], categoryIds: [] })).toEqual({ ok: true, enforced: false });
  });

  it("refuses when no category can be resolved from the packages", async () => {
    expect(await service.validateBooking({ pickup, drop, stops: [], categoryIds: [null, 0] })).toMatchObject({ ok: false, code: "UNKNOWN_VEHICLE" });
  });

  it("checks every distinct category and every stop as a drop", async () => {
    prisma.vehicle_no_entry_zone.findMany.mockImplementation(async ({ where }) =>
      where.kind === "drop" && where.category_id === 4 ? [noEntry({ city_id: 1, category_id: 4, kind: "drop", polygon_geojson: box(22.69, 22.71, 75.79, 75.81) })] : []);
    const stops = [{ lat: 22.7, lng: 75.8 }];
    const out = await service.validateBooking({ pickup, drop, stops, categoryIds: [3, "4", 3] });
    expect(out).toMatchObject({ ok: false, which: "stop", code: "NO_ENTRY" });
    expect(await service.validateBooking({ pickup, drop, stops, categoryIds: [3] })).toMatchObject({ ok: true });
  });
});

describe("assertOrderChangeAllowed (existing order: new pickup, drop or stop)", () => {
  const order = { id: 7, delivery_type: 6, category: "Whatever the client typed" };

  it("does nothing while the switch is off", async () => {
    settings.isEnforced.mockResolvedValue(false);
    await expect(service.assertOrderChangeAllowed(order, { kind: "drop", lat: NOWHERE[0], lng: NOWHERE[1] })).resolves.toBeUndefined();
  });

  it("uses the package's category, not the stored name, and throws a code the controllers map to the exact message", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue({ cat_id: 3 });
    prisma.vehicle_no_entry_zone.findMany.mockResolvedValue([noEntry({ city_id: 1, category_id: 3, kind: "drop", polygon_geojson: box(22.69, 22.71, 75.79, 75.81) })]);
    await expect(service.assertOrderChangeAllowed(order, { kind: "drop", lat: 22.7, lng: 75.8 })).rejects.toThrow("SERVICE_AREA_drop_NO_ENTRY");
    expect(prisma.vehicle_no_entry_zone.findMany.mock.calls[0][0].where).toMatchObject({ category_id: 3, kind: "drop" });
    await expect(service.assertOrderChangeAllowed(order, { kind: "pickup", lat: NOWHERE[0], lng: NOWHERE[1] })).rejects.toThrow("SERVICE_AREA_pickup_NO_SERVICE_ZONE");
    await expect(service.assertOrderChangeAllowed(order, { kind: "drop", lat: 22.75, lng: 75.9 })).resolves.toBeUndefined();
  });

  it("refuses when the order's vehicle cannot be determined", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue(null);
    prisma.pkg_category.findFirst.mockResolvedValue(null);
    await expect(service.assertOrderChangeAllowed(order, { kind: "drop", lat: 22.7, lng: 75.8 })).rejects.toThrow("SERVICE_AREA_UNKNOWN_VEHICLE");
  });

  it("exposes the exact messages for the controller error maps", () => {
    expect(service.SERVICE_AREA_ERRORS.SERVICE_AREA_drop_NO_ENTRY).toEqual([400, "Drop location is a no-entry zone for the selected vehicle type. Please choose another location."]);
    expect(service.SERVICE_AREA_ERRORS.SERVICE_AREA_pickup_NO_SERVICE_ZONE).toEqual([400, "No service zone available for this pickup location."]);
  });
});
