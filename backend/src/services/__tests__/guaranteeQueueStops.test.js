jest.mock("../../config/db", () => ({
  guarantee_outside_candidate: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../guaranteeQueueService");

describe("attachOffer extra stops", () => {
  beforeEach(() => {
    prisma.guarantee_outside_candidate.findMany.mockResolvedValue([]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    prisma.pkg_order.findMany.mockResolvedValue([
      { id: 7, paddress: "A", daddress: "D", total_dcharge: 42 },
      { id: 8, paddress: "B", daddress: "E", total_dcharge: 10 },
    ]);
  });

  it("attaches each order's stops in sequence order, and none when it has none", async () => {
    prisma.pkg_order_stops.findMany.mockResolvedValue([
      { order_id: 7, sequence: 1, address: "S1", landmark: null, contact_name: "X" },
      { order_id: 7, sequence: 2, address: "S2", landmark: null, contact_name: null },
    ]);
    const out = await svc.attachOffer([{ id: 1, order_id: 7 }, { id: 2, order_id: 8 }]);
    expect(out[0].order.stops.map((s) => s.address)).toEqual(["S1", "S2"]);
    expect(out[1].order.stops).toEqual([]);
    expect(prisma.pkg_order_stops.findMany).toHaveBeenCalledTimes(1);
  });

  it("still returns the cases when the stops table is unavailable", async () => {
    prisma.pkg_order_stops.findMany.mockRejectedValue(new Error("no such table"));
    const out = await svc.attachOffer([{ id: 1, order_id: 7 }]);
    expect(out[0].order.stops).toEqual([]);
    expect(out[0].order.paddress).toBe("A");
  });
});
