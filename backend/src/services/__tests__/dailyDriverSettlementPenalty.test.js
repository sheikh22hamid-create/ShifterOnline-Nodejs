jest.mock("../../config/db", () => ({ $transaction: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tierPenaltyService", () => ({ settlePendingForEnrollment: jest.fn() }));

const prisma = require("../../config/db");
const tierPenalty = require("../tierPenaltyService");
const { settleEnrollment } = require("../dailyDriverSettlementService");

beforeEach(() => {
  jest.clearAllMocks();
});

function makeTx() {
  const enrollment = {
    id: 33, rider_id: 9, plan_id: 1, status: "approved", enrollment_date: new Date("2026-10-11T00:00:00Z"),
    plan: {
      plan_name: "Standard", price: 1400, required_duty_hours: 10, free_km: 100, extra_km_rate: 10,
      overtime_hourly_rate: 100, duty_start_time: "08:00:00", duty_end_time: "18:00:00",
    },
    duty_log: { id: 3, total_in_zone_minutes: 600 },
  };
  return {
    daily_driver_enrollment: { findUnique: jest.fn().mockResolvedValue(enrollment), update: jest.fn().mockResolvedValue({}) },
    pkg_order: { findMany: jest.fn().mockResolvedValue([]) },
    daily_driver_duty_log: { update: jest.fn().mockResolvedValue({ id: 3 }) },
    daily_driver_ledger: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn().mockResolvedValue({}) },
    tbl_rider: { update: jest.fn().mockResolvedValue({}) },
  };
}

it("collects the enrollment's pending penalties after crediting the payout, before marking it settled", async () => {
  const tx = makeTx();
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  tierPenalty.settlePendingForEnrollment.mockResolvedValue(300);
  const order = [];
  tx.tbl_rider.update.mockImplementation(async () => { order.push("payout"); return {}; });
  tierPenalty.settlePendingForEnrollment.mockImplementation(async () => { order.push("penalties"); return 300; });
  tx.daily_driver_enrollment.update.mockImplementation(async () => { order.push("settled"); return {}; });

  await settleEnrollment(33);

  expect(tierPenalty.settlePendingForEnrollment).toHaveBeenCalledWith(tx, { enrollmentId: 33, riderId: 9 });
  expect(order).toEqual(["payout", "penalties", "settled"]);
});

it("an already settled enrollment is returned untouched and no penalty is collected twice", async () => {
  const tx = makeTx();
  const settled = { ...(await tx.daily_driver_enrollment.findUnique()), status: "settlement_completed" };
  tx.daily_driver_enrollment.findUnique.mockResolvedValue(settled);
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));

  await settleEnrollment(33);

  expect(tierPenalty.settlePendingForEnrollment).not.toHaveBeenCalled();
});
