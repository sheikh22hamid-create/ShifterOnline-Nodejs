jest.mock("../../config/db", () => ({
  guarantee_outside_candidate: { findMany: jest.fn() },
  booking_guarantee_audit: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  guarantee_candidate_distance: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../guaranteeQueueService");

const cand = (id, caseId, riderId) => ({ id, case_id: caseId, order_id: 100 + caseId, rider_id: riderId, name: "D", mobile: "9876543210", vehicle_number: "", vehicle_name: "", fare: null, status: "ready" });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  prisma.pkg_order.findMany.mockResolvedValue([]);
  prisma.pkg_order_stops.findMany.mockResolvedValue([]);
  prisma.guarantee_candidate_distance.findMany.mockResolvedValue([]);
});

describe("attachOffer: Drivers Fleet registration of the offered driver", () => {
  it("says registered when the bot found the mobile already in the fleet, not registered when it created the driver", async () => {
    prisma.guarantee_outside_candidate.findMany.mockResolvedValue([cand(1, 1, 11), cand(2, 2, 22), cand(3, 3, 33), cand(4, 4, 44)]);
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([
      { case_id: 1, meta: JSON.stringify({ rider_id: 11, kind: "already_on_shifter" }) },
      { case_id: 2, meta: JSON.stringify({ rider_id: 22, kind: "trial_activated" }) },
      { case_id: 3, meta: JSON.stringify({ rider_id: 33, kind: "trial_created" }) },
      // case 4 has no registration row: unknown
    ]);
    const out = await svc.attachOffer([{ id: 1, order_id: 101 }, { id: 2, order_id: 102 }, { id: 3, order_id: 103 }, { id: 4, order_id: 104 }]);
    expect(out.map((c) => c.candidate.already_registered)).toEqual([true, true, false, null]);
  });

  it("ignores a registration row of an earlier, rejected driver of the same case", async () => {
    prisma.guarantee_outside_candidate.findMany.mockResolvedValue([cand(2, 1, 22)]);
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([
      { case_id: 1, meta: JSON.stringify({ rider_id: 11, kind: "already_on_shifter" }) },
      { case_id: 1, meta: JSON.stringify({ rider_id: 22, kind: "trial_created" }) },
    ]);
    const [c] = await svc.attachOffer([{ id: 1, order_id: 101 }]);
    expect(c.candidate.already_registered).toBe(false);
  });

  it("shows nothing (unknown) rather than guessing when the lookup fails", async () => {
    prisma.guarantee_outside_candidate.findMany.mockResolvedValue([cand(1, 1, 11)]);
    prisma.booking_guarantee_audit.findMany.mockRejectedValue(new Error("db down"));
    const [c] = await svc.attachOffer([{ id: 1, order_id: 101 }]);
    expect(c.candidate.already_registered).toBeNull();
  });
});
