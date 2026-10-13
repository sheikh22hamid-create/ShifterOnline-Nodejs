jest.mock("../../config/db", () => ({
  daily_driver_enrollment: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
}));
jest.mock("../../services/dailyDriverPlanService", () => ({}));
jest.mock("../../services/forceAssignService", () => ({}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const ctrl = require("../adminDailyDriverController");

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const plan = { duty_start_time: "10:00:00", duty_end_time: "20:00:00" };
const enrollment = (id, riderId, date = "2026-10-13") => ({
  id, rider_id: riderId, enrollment_date: new Date(`${date}T00:00:00.000Z`), plan, duty_log: null,
});
const order = (rid, ddate, amount) => ({ rid, ddate: new Date(ddate), next_day_discount_amount: amount });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_rider.findMany.mockResolvedValue([{ id: 1, full_name: "A" }, { id: 2, full_name: "B" }]);
});

describe("listEnrollments: next-day discount to deduct", () => {
  it("sums each enrollment's recorded next-day discounts inside its own duty window", async () => {
    prisma.daily_driver_enrollment.findMany.mockResolvedValue([enrollment(11, 1), enrollment(12, 2)]);
    prisma.pkg_order.findMany.mockResolvedValue([
      order(1, "2026-10-13T12:00:00", "10.00"),
      order(1, "2026-10-13T15:30:00", "7.50"),
      order(1, "2026-10-13T21:00:00", "99.00"), // after the duty window
      order(1, "2026-10-12T12:00:00", "50.00"), // another day
      order(2, "2026-10-13T11:00:00", "4.00"),
    ]);
    const r = res();
    await ctrl.listEnrollments({ query: {} }, r);
    const rows = r.json.mock.calls[0][0].data;
    expect(rows.find((e) => e.id === 11).next_day_discount_total).toBe(17.5);
    expect(rows.find((e) => e.id === 12).next_day_discount_total).toBe(4);
  });

  it("is 0 for an enrollment without next-day orders", async () => {
    prisma.daily_driver_enrollment.findMany.mockResolvedValue([enrollment(11, 1)]);
    prisma.pkg_order.findMany.mockResolvedValue([]);
    const r = res();
    await ctrl.listEnrollments({ query: {} }, r);
    expect(r.json.mock.calls[0][0].data[0].next_day_discount_total).toBe(0);
  });

  it("only reads completed orders that carry a recorded discount, for the listed riders", async () => {
    prisma.daily_driver_enrollment.findMany.mockResolvedValue([enrollment(11, 1)]);
    prisma.pkg_order.findMany.mockResolvedValue([]);
    await ctrl.listEnrollments({ query: {} }, res());
    expect(prisma.pkg_order.findMany.mock.calls[0][0].where).toMatchObject({
      rid: { in: [1] }, o_status: "Completed", next_day_discount_amount: { not: null },
    });
  });

  it("still lists enrollments (total null) when the discount lookup fails", async () => {
    prisma.daily_driver_enrollment.findMany.mockResolvedValue([enrollment(11, 1)]);
    prisma.pkg_order.findMany.mockRejectedValue(new Error("db"));
    const r = res();
    await ctrl.listEnrollments({ query: {} }, r);
    expect(r.status).not.toHaveBeenCalledWith(500);
    expect(r.json.mock.calls[0][0].data[0].next_day_discount_total).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not query orders when there are no enrollments", async () => {
    prisma.daily_driver_enrollment.findMany.mockResolvedValue([]);
    const r = res();
    await ctrl.listEnrollments({ query: {} }, r);
    expect(prisma.pkg_order.findMany).not.toHaveBeenCalled();
    expect(r.json.mock.calls[0][0].data).toEqual([]);
  });
});
