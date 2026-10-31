jest.mock("../../config/db", () => ({
  pkg_order_fare_history: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const h = require("../orderFareHistory");

beforeEach(() => jest.clearAllMocks());

describe("orderFareHistory", () => {
  test("recordOriginal writes once, never overwrites", async () => {
    prisma.pkg_order_fare_history.findFirst.mockResolvedValueOnce(null);
    await h.recordOriginal(5, 200);
    expect(prisma.pkg_order_fare_history.create).toHaveBeenCalledWith({
      data: { order_id: 5, kind: "original", reason: "Original booking fare", amount_diff: 0, new_total: 200 },
    });
    prisma.pkg_order_fare_history.create.mockClear();
    prisma.pkg_order_fare_history.findFirst.mockResolvedValueOnce({ id: 1 });
    await h.recordOriginal(5, 999);
    expect(prisma.pkg_order_fare_history.create).not.toHaveBeenCalled();
  });

  test("recordChange stores signed diff and seeds the original for legacy orders", async () => {
    prisma.pkg_order_fare_history.findFirst.mockResolvedValue(null);
    await h.recordChange({ orderId: 5, kind: h.KIND.STOP_ADDED, reason: "Additional stop 1", oldFare: 200, newFare: 230 });
    const calls = prisma.pkg_order_fare_history.create.mock.calls.map((c) => c[0].data);
    expect(calls[0]).toMatchObject({ kind: "original", new_total: 200 });
    expect(calls[1]).toMatchObject({ kind: "stop_added", amount_diff: 30, new_total: 230 });
  });

  test("a decrease is stored as a negative diff", async () => {
    prisma.pkg_order_fare_history.findFirst.mockResolvedValue({ id: 1 });
    await h.recordChange({ orderId: 5, kind: h.KIND.DROP_CHANGE, reason: "Drop", oldFare: 280, newFare: 250 });
    expect(prisma.pkg_order_fare_history.create.mock.calls[0][0].data.amount_diff).toBe(-30);
  });

  test("driver assignment with no fare movement writes nothing", async () => {
    await h.recordChange({ orderId: 5, kind: h.KIND.DRIVER_ASSIGNED, reason: "x", oldFare: 100, newFare: 100 });
    expect(prisma.pkg_order_fare_history.create).not.toHaveBeenCalled();
  });

  test("uses the transaction client when given one", async () => {
    const tx = { pkg_order_fare_history: { findFirst: jest.fn().mockResolvedValue({ id: 1 }), create: jest.fn() } };
    await h.recordChange({ orderId: 5, kind: h.KIND.PICKUP_CHANGE, reason: "P", oldFare: 100, newFare: 110, client: tx });
    expect(tx.pkg_order_fare_history.create).toHaveBeenCalled();
    expect(prisma.pkg_order_fare_history.create).not.toHaveBeenCalled();
  });

  test("a missing table / DB error never throws (existing flows must not break)", async () => {
    prisma.pkg_order_fare_history.findFirst.mockRejectedValue(new Error("P2021 table does not exist"));
    await expect(h.recordOriginal(5, 100)).resolves.toBeUndefined();
    await expect(h.recordChange({ orderId: 5, kind: "drop_change", reason: "r", oldFare: 1, newFare: 2 })).resolves.toBeUndefined();
    prisma.pkg_order_fare_history.findMany.mockRejectedValue(new Error("boom"));
    await expect(h.getHistory(5)).resolves.toEqual([]);
  });

  test("getHistory returns chronological entries with numeric amounts", async () => {
    prisma.pkg_order_fare_history.findMany.mockResolvedValue([
      { kind: "original", reason: "Original booking fare", amount_diff: "0.00", new_total: "200.00", created_at: new Date(0) },
      { kind: "stop_added", reason: "Additional stop 1", amount_diff: "30.00", new_total: "230.00", created_at: new Date(1) },
    ]);
    const rows = await h.getHistory(5);
    expect(prisma.pkg_order_fare_history.findMany).toHaveBeenCalledWith({ where: { order_id: 5 }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.amount_diff, r.new_total])).toEqual([[0, 200], [30, 230]]);
  });
});
