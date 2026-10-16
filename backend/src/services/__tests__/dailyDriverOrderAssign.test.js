jest.mock("../../config/db", () => ({
  daily_driver_enrollment: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  booking_guarantee_case: { findFirst: jest.fn() },
}));

const prisma = require("../../config/db");
const { listAvailableDailyDrivers, isApplicable, tripDateFor } = require("../dailyDriverOrderAssign");

const order = (o = {}) => ({
  id: 10, booking_type: 3, schedule_date_time: "2026-10-18 09:00:00", category: "3 wheeler", city_id: 1, plat: "22.70", plong: "75.80", ...o,
});
const rider = (id, o = {}) => ({ id, full_name: `R${id}`, fmobile: "9", vehicle: "3 wheeler", rlats: null, rlongs: null, ...o });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.daily_driver_enrollment.findMany.mockResolvedValue([{ rider_id: 1 }, { rider_id: 2 }, { rider_id: 2 }]);
  prisma.tbl_rider.findMany.mockResolvedValue([rider(1), rider(2)]);
  prisma.pkg_order.findMany.mockResolvedValue([]);
  prisma.booking_guarantee_case.findFirst.mockResolvedValue(null);
});

describe("listAvailableDailyDrivers", () => {
  it("looks up enrollments for the trip day of a next-day / scheduled order", async () => {
    await listAvailableDailyDrivers(order({ booking_type: 2, schedule_date_time: "2026-11-02 14:30:00" }));
    expect(prisma.daily_driver_enrollment.findMany.mock.calls[0][0].where.enrollment_date.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(prisma.daily_driver_enrollment.findMany.mock.calls[0][0].where.status).toEqual({ in: ["enrolled", "active"] });
  });

  it("only asks for approved riders on the order's vehicle and city (each enrolled rider once)", async () => {
    await listAvailableDailyDrivers(order());
    const where = prisma.tbl_rider.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: { in: [1, 2] }, status: 1, vehicle: "3 wheeler", city_id: 1 });
  });

  it("drops a Daily Driver who is on an active trip", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ rid: 2 }]);
    const out = await listAvailableDailyDrivers(order());
    expect(out.map((r) => r.id)).toEqual([1]);
    expect(prisma.pkg_order.findMany.mock.calls[0][0].where.order_status).toEqual({ in: [1, 2, 3] });
  });

  it("returns nothing when nobody is enrolled, without querying riders", async () => {
    prisma.daily_driver_enrollment.findMany.mockResolvedValue([]);
    expect(await listAvailableDailyDrivers(order())).toEqual([]);
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
  });

  it("an unreadable schedule date yields an empty list instead of an error", async () => {
    expect(await listAvailableDailyDrivers(order({ schedule_date_time: null }))).toEqual([]);
  });

  it("an instant (guarantee) order uses today's enrollment date", () => {
    const d = tripDateFor(order({ booking_type: 1, schedule_date_time: null }));
    expect(d.toISOString().slice(0, 10)).toBe(new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10));
  });

  it("ranks the nearest-to-pickup rider first", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([rider(1, { rlats: "22.90", rlongs: "75.80" }), rider(2, { rlats: "22.71", rlongs: "75.80" })]);
    const out = await listAvailableDailyDrivers(order());
    expect(out.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("isApplicable", () => {
  it("scheduled and next-day orders always get the filter", async () => {
    expect(await isApplicable(order({ booking_type: 2 }))).toBe(true);
    expect(await isApplicable(order({ booking_type: 3 }))).toBe(true);
    expect(prisma.booking_guarantee_case.findFirst).not.toHaveBeenCalled();
  });

  it("an instant order only gets it while it has an open Booking Guarantee case", async () => {
    expect(await isApplicable(order({ booking_type: 1 }))).toBe(false);
    prisma.booking_guarantee_case.findFirst.mockResolvedValue({ id: 5 });
    expect(await isApplicable(order({ booking_type: 1 }))).toBe(true);
    expect(prisma.booking_guarantee_case.findFirst.mock.calls[1][0].where).toEqual({ order_id: 10, closed_at: null });
  });
});
