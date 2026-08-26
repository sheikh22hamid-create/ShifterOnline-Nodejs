jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  tbl_order_requests: { create: jest.fn(), updateMany: jest.fn() },
}));

jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ fare: 100, driverEarning: 50 }),
}));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const lockManager = require("../lockManager");
const { POPUP_TIMEOUT_MS, BATCH_GAP_MS } = require("../../config/constants");

const flush = async (ticks = 20) => {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
};

function makeRiderRow(riderId) {
  return { rider_id: riderId, rlats: "28.70", rlongs: "77.10", fcm_token: "tok" };
}

describe("dispatchManager overlapping batch cascade", () => {
  const order = {
    id: 297,
    uid: 7,
    plat: "28.704059",
    plong: "77.102490",
    dlat: "28.613939",
    dlong: "77.209021",
    distance: 15.4,
    category: "Bike",
    pmobile: "9876543210",
    paddress: "Rohini Sector 7",
    daddress: "Connaught Place",
    pick_name: "Rahul Sharma",
    rid: 0,
    order_status: 0,
    allowed_delivery_types: JSON.stringify([6, 7]),
  };

  let emitted;
  let io;

  beforeEach(() => {
    jest.useFakeTimers();
    emitted = [];
    io = {
      to: (room) => ({
        emit: (event, payload) => emitted.push({ room, event, payload }),
      }),
    };
    dispatchManager.init(io);

    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    prisma.pkg_order.update.mockResolvedValue({});
    prisma.tbl_order_requests.create.mockResolvedValue({});
    prisma.tbl_order_requests.updateMany.mockResolvedValue({});

    prisma.$queryRaw
      .mockResolvedValueOnce([1, 2, 3, 4].map(makeRiderRow)) // tier 0 (package 6)
      .mockResolvedValueOnce([5, 6, 7, 8].map(makeRiderRow)); // tier 1 (package 7)
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const riderId of [1, 2, 3, 4, 5, 6, 7, 8]) {
      lockManager.releaseLock(riderId);
    }
  });

  it("dispatches batch 1 immediately, batch 2 at +5s while batch 1 is still active, and expires batch 1 at +15s", async () => {
    await dispatchManager.startDispatch(order);
    await flush();

    const batch1Requests = emitted.filter((e) => e.event === "order:request");
    expect(batch1Requests.map((e) => e.room).sort()).toEqual([
      "driver_1",
      "driver_2",
      "driver_3",
      "driver_4",
    ]);
    expect([1, 2, 3, 4].every((id) => lockManager.isLocked(id))).toBe(true);

    // T = 5s: batch 2 fires, batch 1 still holds its locks
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    expect([1, 2, 3, 4].every((id) => lockManager.isLocked(id))).toBe(true);
    const batch2Requests = emitted.filter(
      (e) => e.event === "order:request" && [5, 6, 7, 8].includes(Number(e.room.split("_")[1]))
    );
    expect(batch2Requests.map((e) => e.room).sort()).toEqual([
      "driver_5",
      "driver_6",
      "driver_7",
      "driver_8",
    ]);

    // T = 15s: batch 1 expires and releases its drivers
    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS - BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(0);
    await flush();

    expect([1, 2, 3, 4].every((id) => !lockManager.isLocked(id))).toBe(true);
    const batch1Dismissals = emitted.filter(
      (e) => e.event === "order:dismiss" && [1, 2, 3, 4].includes(Number(e.room.split("_")[1]))
    );
    expect(batch1Dismissals).toHaveLength(4);
    expect(batch1Dismissals[0].payload.reason).toBe("timeout");

    // Batch 2 (tier 1, the last tier) is still active at this point
    expect([5, 6, 7, 8].every((id) => lockManager.isLocked(id))).toBe(true);
  });

  it("stopDispatch cancels pending timers and dismisses every currently-locked driver", async () => {
    await dispatchManager.startDispatch(order);
    await flush();

    expect([1, 2, 3, 4].every((id) => lockManager.isLocked(id))).toBe(true);

    dispatchManager.stopDispatch(order.id, "accepted_by_other");
    await flush();

    expect([1, 2, 3, 4].every((id) => !lockManager.isLocked(id))).toBe(true);
    const dismissals = emitted.filter((e) => e.event === "order:dismiss");
    expect(dismissals).toHaveLength(4);
    expect(dismissals.every((d) => d.payload.reason === "accepted_by_other")).toBe(true);

    // Advancing time after stopDispatch must not fire batch 2 (its timer was cleared)
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(4);
  });
});
