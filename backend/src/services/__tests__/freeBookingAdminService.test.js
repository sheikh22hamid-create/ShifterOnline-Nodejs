jest.mock("../../config/db", () => ({
  free_booking_setting: { findUnique: jest.fn(), upsert: jest.fn() },
  free_booking_pool: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  free_booking_order: { findMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findMany: jest.fn() },
  tbl_vehicle_details: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock("../freeBookingService", () => ({ poolRiderIds: jest.fn().mockResolvedValue([]), reapCancelled: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const freeBookingService = require("../freeBookingService");
const svc = require("../freeBookingAdminService");

beforeEach(() => jest.resetAllMocks());

describe("resolveCityId", () => {
  it("an admin is bound to their own city regardless of the request", () => {
    expect(svc.resolveCityId({ role: "admin", city_id: 3 }, { city_id: "9" }, { city_id: 9 })).toBe(3);
  });
  it("a superadmin chooses the city from query or body", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, { city_id: "4" }, {})).toBe(4);
    expect(svc.resolveCityId({ role: "superadmin" }, {}, { city_id: 5 })).toBe(5);
  });
  it("a superadmin with no city gets null", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, {}, {})).toBeNull();
  });
});

describe("saveSettings", () => {
  it("rejects enabling without both dates", async () => {
    await expect(svc.saveSettings({ cityId: 3, enabled: true, offerStart: null, offerEnd: null, adminId: 1 })).rejects.toThrow(/start and end/i);
  });
  it("rejects an end before the start", async () => {
    await expect(svc.saveSettings({ cityId: 3, enabled: true, offerStart: "2026-10-10T00:00:00Z", offerEnd: "2026-10-09T00:00:00Z", adminId: 1 })).rejects.toThrow(/after/i);
  });
  it("rejects a missing city", async () => {
    await expect(svc.saveSettings({ cityId: null, enabled: false, adminId: 1 })).rejects.toThrow(/city/i);
  });
  it("upserts a valid setting", async () => {
    prisma.free_booking_setting.upsert.mockResolvedValue({ city_id: 3 });
    await svc.saveSettings({ cityId: 3, enabled: true, offerStart: "2026-10-01T00:00:00Z", offerEnd: "2026-10-31T00:00:00Z", adminId: 1 });
    expect(prisma.free_booking_setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { city_id: 3 },
      create: expect.objectContaining({ city_id: 3, enabled: true, updated_by: 1 }),
    }));
  });
  it("allows turning OFF without dates", async () => {
    prisma.free_booking_setting.upsert.mockResolvedValue({});
    await expect(svc.saveSettings({ cityId: 3, enabled: false, adminId: 1 })).resolves.toBeDefined();
  });
});

describe("addToPool", () => {
  it("rejects a rider from another city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 4, a_status: 1, status: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/city/i);
  });
  it("rejects an unapproved rider", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 0, status: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/approved/i);
  });
  it("rejects bad or reversed dates", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 1, status: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "06-10-2026", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/date/i);
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-10", validTo: "2026-10-06", adminId: 1 })).rejects.toThrow(/date/i);
  });
  it("rejects a rider already in the pool for an overlapping period", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 1, status: 1 });
    prisma.free_booking_pool.findFirst.mockResolvedValue({ id: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/already/i);
  });
  it("creates the pool row with the rider's approved vehicle", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 1, status: 1 });
    prisma.free_booking_pool.findFirst.mockResolvedValue(null);
    prisma.tbl_vehicle_details.findMany.mockResolvedValue([{ id: 31, rider_id: 9 }]);
    prisma.free_booking_pool.create.mockResolvedValue({ id: 2 });
    await svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 });
    expect(prisma.free_booking_pool.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ city_id: 3, rider_id: 9, vehicle_details_id: 31, active: true, added_by: 1 }),
    });
  });
});

describe("updatePool and removeFromPool", () => {
  it("refuse a row from another city", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue({ id: 2, city_id: 4 });
    await expect(svc.updatePool(2, 3, { active: false })).rejects.toThrow(/not found/i);
    await expect(svc.removeFromPool(2, 3)).rejects.toThrow(/not found/i);
    expect(prisma.free_booking_pool.update).not.toHaveBeenCalled();
    expect(prisma.free_booking_pool.delete).not.toHaveBeenCalled();
  });
  it("update toggles active", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue({ id: 2, city_id: 3, valid_from: new Date("2026-10-06"), valid_to: new Date("2026-10-10") });
    prisma.free_booking_pool.update.mockResolvedValue({ id: 2 });
    await svc.updatePool(2, 3, { active: false });
    expect(prisma.free_booking_pool.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { active: false } });
  });
});

describe("updatePool overlap", () => {
  const row = { id: 2, city_id: 3, rider_id: 9, active: false, valid_from: new Date("2026-10-06"), valid_to: new Date("2026-10-10") };
  it("rejects reactivating a row that overlaps another active period", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue(row);
    prisma.free_booking_pool.findFirst.mockResolvedValue({ id: 5 });
    await expect(svc.updatePool(2, 3, { active: true })).rejects.toThrow(/already/i);
    expect(prisma.free_booking_pool.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ rider_id: 9, id: { not: 2 } }) });
    expect(prisma.free_booking_pool.update).not.toHaveBeenCalled();
  });
  it("rejects a date change that overlaps another active period", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue({ ...row, active: true });
    prisma.free_booking_pool.findFirst.mockResolvedValue({ id: 5 });
    await expect(svc.updatePool(2, 3, { valid_to: "2026-10-20" })).rejects.toThrow(/already/i);
  });
  it("allows a change with no overlap", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue(row);
    prisma.free_booking_pool.findFirst.mockResolvedValue(null);
    prisma.free_booking_pool.update.mockResolvedValue({ id: 2 });
    await svc.updatePool(2, 3, { active: true });
    expect(prisma.free_booking_pool.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { active: true } });
  });
});

describe("listOrders scope", () => {
  it("refuses a missing city unless unrestricted", async () => {
    await expect(svc.listOrders({ cityId: null })).rejects.toThrow(/not assigned/i);
    prisma.free_booking_order.findMany.mockResolvedValue([]);
    await expect(svc.listOrders({ cityId: null, unrestricted: true })).resolves.toEqual([]);
  });
});

describe("listOrders reaps cancelled rows first", () => {
  it("calls reapCancelled before listing", async () => {
    const order = [];
    freeBookingService.reapCancelled.mockImplementation(async () => { order.push("reap"); return 1; });
    prisma.free_booking_order.findMany.mockImplementation(async () => { order.push("list"); return [{ id: 1 }]; });
    await expect(svc.listOrders({ cityId: 3 })).resolves.toEqual([{ id: 1 }]);
    expect(order).toEqual(["reap", "list"]);
  });
  it("still lists when reapCancelled throws", async () => {
    freeBookingService.reapCancelled.mockRejectedValue(new Error("boom"));
    prisma.free_booking_order.findMany.mockResolvedValue([{ id: 2 }]);
    await expect(svc.listOrders({ cityId: 3 })).resolves.toEqual([{ id: 2 }]);
  });
});

describe("assertUserInCity", () => {
  it("lets a superadmin (null city) through and blocks an admin on another city's user", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    await expect(svc.assertUserInCity(7, null, true)).resolves.toBeUndefined();
    await expect(svc.assertUserInCity(7, 3)).rejects.toThrow(/city/i);
    await expect(svc.assertUserInCity(7, null)).rejects.toThrow(/not assigned/i);
  });
});

const status = (p) => p.catch((e) => e.statusCode);

describe("numeric id validation (400, never a Prisma 500)", () => {
  it.each(["abc", "", null, undefined, "1.5", "-2", "0", NaN])("pool id %p is rejected before any query", async (id) => {
    expect(await status(svc.updatePool(id, 3, { active: false }))).toBe(400);
    expect(await status(svc.removeFromPool(id, 3))).toBe(400);
    expect(prisma.free_booking_pool.findUnique).not.toHaveBeenCalled();
  });
  it.each(["abc", "", null, undefined, "x9"])("addToPool rider_id %p is rejected", async (riderId) => {
    expect(await status(svc.addToPool({ cityId: 3, riderId, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 }))).toBe(400);
    expect(prisma.tbl_rider.findUnique).not.toHaveBeenCalled();
  });
  it("findOrderInCity rejects a non-numeric id", async () => {
    expect(await status(svc.findOrderInCity("abc", 3))).toBe(400);
  });
  it("a numeric string id still works", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue({ id: 2, city_id: 3, valid_from: new Date("2026-10-06"), valid_to: new Date("2026-10-10") });
    prisma.free_booking_pool.update.mockResolvedValue({ id: 2 });
    await svc.updatePool("2", 3, { active: false });
    expect(prisma.free_booking_pool.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { active: false } });
  });
});

describe("saveSettings strict parsing", () => {
  const okDates = { offerStart: "2026-10-01T00:00:00Z", offerEnd: "2026-10-31T00:00:00Z" };
  beforeEach(() => prisma.free_booking_setting.upsert.mockResolvedValue({}));
  it.each([[true, true], ["true", true], [1, true], ["1", true], [false, false], ["false", false], [0, false], ["0", false], [undefined, false], [null, false]])(
    "enabled %p => %p", async (input, expected) => {
      await svc.saveSettings({ cityId: 3, enabled: input, ...okDates, adminId: 1 });
      expect(prisma.free_booking_setting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ enabled: expected }) }));
    }
  );
  it.each(["yes", "maybe", 2, {}, "TRUE "])("enabled %p is a 400", async (input) => {
    expect(await status(svc.saveSettings({ cityId: 3, enabled: input, ...okDates, adminId: 1 }))).toBe(400);
    expect(prisma.free_booking_setting.upsert).not.toHaveBeenCalled();
  });
  it("an unparseable date is a 400 even when the offer is OFF", async () => {
    expect(await status(svc.saveSettings({ cityId: 3, enabled: false, offerStart: "not-a-date", offerEnd: null, adminId: 1 }))).toBe(400);
    expect(await status(svc.saveSettings({ cityId: 3, enabled: "false", offerStart: null, offerEnd: "garbage", adminId: 1 }))).toBe(400);
    expect(prisma.free_booking_setting.upsert).not.toHaveBeenCalled();
  });
  it("valid dates are still stored when the offer is OFF", async () => {
    await svc.saveSettings({ cityId: 3, enabled: false, ...okDates, adminId: 1 });
    expect(prisma.free_booking_setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ enabled: false, offer_start: new Date(okDates.offerStart), offer_end: new Date(okDates.offerEnd) }),
    }));
  });
});

describe("assertUserInCity missing / invalid users", () => {
  it("404s a missing customer for a superadmin and for a city admin", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue(null);
    expect(await status(svc.assertUserInCity(7, null, true))).toBe(404);
    expect(await status(svc.assertUserInCity(7, 3))).toBe(404);
    await expect(svc.assertUserInCity(7, 3)).rejects.toThrow("Customer not found");
  });
  it("keeps the city rules for existing users: 400 for another city, 403 for an unassigned admin", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    expect(await status(svc.assertUserInCity(7, 3))).toBe(400);
    expect(await status(svc.assertUserInCity(7, null))).toBe(403);
    await expect(svc.assertUserInCity(7, 4)).resolves.toBeUndefined();
  });
  it("400s a non-numeric user id", async () => {
    expect(await status(svc.assertUserInCity("abc", 3))).toBe(400);
    expect(await status(svc.assertUserInCity("abc", null, true))).toBe(400);
    expect(prisma.tbl_user.findUnique).not.toHaveBeenCalled();
  });
});

describe("resolveCityId empty-string fallback", () => {
  it("a superadmin's empty query city_id falls back to the body", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, { city_id: "" }, { city_id: 5 })).toBe(5);
  });
  it("a non-finite query city_id also falls back to the body", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, { city_id: "abc" }, { city_id: "6" })).toBe(6);
  });
  it("is null when both are empty", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, { city_id: "" }, { city_id: "" })).toBeNull();
  });
});
