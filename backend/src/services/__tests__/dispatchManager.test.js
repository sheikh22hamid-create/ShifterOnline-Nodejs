jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  tbl_order_requests: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));

jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ fare: 100, driverEarning: 50 }),
}));

jest.mock("../pushNotifier");

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const lockManager = require("../lockManager");
const pushNotifier = require("../pushNotifier");
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
  let orderRequestsStore;

  beforeEach(() => {
    jest.useFakeTimers();
    // Clears call history (not just resolved values) so mock.calls-based
    // assertions in one test never see calls made by a previous test.
    jest.clearAllMocks();
    dispatchManager._resetForTests();
    emitted = [];
    io = {
      to: (room) => ({
        emit: (event, payload) => emitted.push({ room, event, payload }),
      }),
    };
    dispatchManager.init(io);

    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    prisma.pkg_order.update.mockResolvedValue({});
    // count:1 = a real Prisma updateMany affecting a row (the normal timeout
    // case). Individual tests override this to count:0 to simulate a row
    // that was already resolved another way (e.g. accepted) by the time the
    // expiry sweep reaches it.
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
    // Default: no riders found, so stopDispatch's push lookup resolves to an
    // empty list instead of throwing on an unconfigured mock (every test's
    // afterEach calls stopDispatch as cleanup, whether or not it cares about
    // the push side-effect).
    prisma.tbl_rider.findMany.mockResolvedValue([]);

    // Minimal fake backing store so getRejectedRiderIds() sees what
    // create() has actually written — real reject-only exclusion behavior,
    // not a canned return value.
    orderRequestsStore = [];
    prisma.tbl_order_requests.create.mockImplementation(({ data }) => {
      orderRequestsStore.push({ ...data });
      return Promise.resolve({ id: orderRequestsStore.length, ...data });
    });
    prisma.tbl_order_requests.findMany.mockImplementation(({ where }) => {
      const riderIds = [
        ...new Set(
          orderRequestsStore
            .filter((r) => r.order_id === where.order_id && (where.status === undefined || r.status === where.status))
            .map((r) => r.rider_id)
        ),
      ];
      return Promise.resolve(riderIds.map((rider_id) => ({ rider_id })));
    });

    // Reset (not just re-stack) — a test that starts a cascade without
    // advancing every scheduled tier (e.g. the idempotency-guard test)
    // leaves its later mockResolvedValueOnce entries unconsumed, which
    // would otherwise bleed into the next test's queue.
    prisma.$queryRaw.mockReset();
    // Base fallback for any round-robin revisit beyond the two queued turns
    // below (the cursor cycles back to tier 0 once every tier has had a
    // turn) — an empty pool, not a crash from an unconfigured mock call.
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([1, 2, 3, 4].map(makeRiderRow)) // tier 0 (package 6) primary
      .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck — nobody else pending
      .mockResolvedValueOnce([5, 6, 7, 8].map(makeRiderRow)) // tier 1 (package 7) primary
      .mockResolvedValueOnce([]); // tier 1 sameOrderLockBlocking recheck — nobody else pending
  });

  afterEach(() => {
    // dispatchManager's activeDispatches map is module-level state that
    // outlives a single test (e.g. a test that ends mid-cascade, with a
    // later tier still active) — every test here reuses order.id 297, and
    // the new startDispatch idempotency guard would otherwise treat the
    // next test's startDispatch call as a duplicate and silently no-op.
    // Must run BEFORE useRealTimers(): stopDispatch's clearTimeout calls
    // need to happen while fake timers are still installed, or Jest's fake
    // timer bookkeeping never learns those pending timers were cancelled —
    // they then fire (or are seen as "still scheduled") in a LATER test.
    dispatchManager.stopDispatch(order.id, "test_cleanup");
    jest.useRealTimers();
    // Generic sweep (not a hardcoded id list) — the concurrency tests below
    // use their own rider id ranges, so this must catch everything any test
    // left locked, not just 1-8.
    for (const riderId of lockManager.getAllLockedRiderIds()) {
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

  it("pushes an FCM notification to each driver locked in a batch, alongside the socket emit", async () => {
    await dispatchManager.startDispatch(order);
    await flush();

    expect(pushNotifier.notifyDriverOrderRequest).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ order_id: String(order.id) })
    );
  });

  it("pushes a dismiss FCM notification to drivers whose popup times out", async () => {
    await dispatchManager.startDispatch(order);
    await flush();

    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
    await flush();

    expect(pushNotifier.notifyDriverDismiss).toHaveBeenCalledWith("tok", order.id, "timeout");
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

  it("stopDispatch pushes a dismiss FCM notification to every rider still locked on the order", async () => {
    lockManager.acquireLock(7, 999, POPUP_TIMEOUT_MS);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 7, fcm_token: "tok-7" }]);
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });

    dispatchManager.stopDispatch(999, "accepted_by_other");
    await flush();

    expect(prisma.tbl_rider.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      select: { id: true, fcm_token: true },
    });
    expect(pushNotifier.notifyDriverDismiss).toHaveBeenCalledWith("tok-7", 999, "accepted_by_other");
  });

  describe("cross-tier rider re-entry", () => {
    it("a driver whose popup timed out in an earlier tier IS re-offered in a later tier, once free", async () => {
      // Simulates: driver 1 was offered in Model 1, its popup expired
      // (status flipped to 'timeout') and its lock is free by the time
      // Model 2's batch fires. Model 2 must be allowed to re-offer them.
      orderRequestsStore.push({ order_id: order.id, rider_id: 1, package_id: 6, status: "timeout" });

      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$queryRaw
        .mockResolvedValueOnce([2].map(makeRiderRow)) // tier 0 (package 6) primary
        .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck
        .mockResolvedValueOnce([1, 3].map(makeRiderRow)); // tier 1 (package 7) — driver 1 is free again

      await dispatchManager.startDispatch(order);
      await flush();
      await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
      await flush();

      const requests = emitted.filter((e) => e.event === "order:request");
      expect(requests.map((e) => e.room).sort()).toEqual(["driver_1", "driver_2", "driver_3"]);
    });

    it("a driver already rejected on this order in an earlier tier is not re-offered in a later tier", async () => {
      // tripLifecycle.rejectOrder marks the tbl_order_requests row status "10".
      orderRequestsStore.push({ order_id: order.id, rider_id: 1, package_id: 6, status: "10" });

      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$queryRaw
        .mockResolvedValueOnce([2].map(makeRiderRow)) // tier 0 (package 6) primary
        .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck
        .mockResolvedValueOnce([1, 3].map(makeRiderRow)); // tier 1 (package 7)

      await dispatchManager.startDispatch(order);
      await flush();
      await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
      await flush();

      const requests = emitted.filter((e) => e.event === "order:request");
      expect(requests.map((e) => e.room).sort()).toEqual(["driver_2", "driver_3"]);
      expect(lockManager.isLocked(1)).toBe(false);
    });
  });

  describe("fair per-tier coverage across multiple eligible drivers (order #1491)", () => {
    it("every driver gets a turn at every tier they're eligible for, instead of skipping tiers due to timing luck", async () => {
      // Live report: 2 drivers online, driver A enabled for Models 2-5,
      // driver B enabled for all 5. Whichever of them wasn't busy at the
      // instant a given tier was checked got locked for it first, so the
      // cascade advanced past that tier immediately — driver A ended up
      // skipping Models 3 and 5 entirely, driver B skipping Models 2 and 4,
      // purely because of which one happened to be free at that moment, even
      // though both were genuinely eligible for those tiers. The fix (the
      // broadened sameOrderLockBlocking check above) makes the cascade wait
      // for a temporarily-busy-but-eligible driver instead of skipping past
      // them, so both drivers here must receive every tier they qualify for.
      const driverA = 10; // eligible for Models 2-5 (7, 21, 33, 34), not Model 1
      const driverB = 20; // eligible for all 5 models

      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockImplementation((_strings, ...values) => {
        const packageIdStr = values.find((v) => typeof v === "string" && ["6", "7", "21", "33", "34"].includes(v));
        const pool = packageIdStr === "6" ? [driverB] : [driverA, driverB];
        return Promise.resolve(pool.map(makeRiderRow));
      });

      const orderI = { ...order, id: 1491, allowed_delivery_types: JSON.stringify([6, 7, 21, 33, 34]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderI });

      await dispatchManager.startDispatch(orderI);
      await flush();

      // Generous — enough real turns for both drivers to cycle through
      // every tier they're eligible for, including the waits each blocked
      // retry needs for the other to free up from their own popup.
      for (let i = 0; i < 12; i++) {
        await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
        await flush();
      }

      const packageIdsOfferedTo = (riderId) =>
        new Set(
          emitted
            .filter((e) => e.event === "order:request" && e.room === `driver_${riderId}`)
            .map((e) => e.payload.package_id)
        );

      expect([...packageIdsOfferedTo(driverA)].sort()).toEqual(["21", "33", "34", "7"]);
      expect([...packageIdsOfferedTo(driverB)].sort()).toEqual(["21", "33", "34", "6", "7"]);

      dispatchManager.stopDispatch(1491, "test_cleanup");
    });
  });

  it("tier exhaustion: exhausts all eligible drivers in Model 1 before advancing to Model 2", async () => {
    // Model 1 (tier 0) has 5 eligible drivers — batch 1 selects 4, so
    // driver 5 is left over. Batch 2 in +5s offers driver 5 for Model 1,
    // and only after Model 1 is exhausted does batch 3 offer Model 2 (6, 7, 8).
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([1, 2, 3, 4, 5].map(makeRiderRow)) // tier 0 turn 1
      .mockResolvedValueOnce([5].map(makeRiderRow)) // tier 0 turn 2 (leftover exhausted)
      .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck, after turn 2
      .mockResolvedValueOnce([6, 7, 8].map(makeRiderRow)); // tier 1 turn 1 (Model 2)

    await dispatchManager.startDispatch(order);
    await flush();

    const batch1 = emitted.filter((e) => e.event === "order:request");
    expect(batch1.map((e) => e.room).sort()).toEqual(["driver_1", "driver_2", "driver_3", "driver_4"]);

    // +5s: batch 2 must be Model 1's leftover (driver 5), exhausting Model 1.
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    expect(emitted.some((e) => e.event === "order:request" && e.room === "driver_5")).toBe(true);

    // +10s: now that Model 1 is exhausted, batch 3 goes to Model 2 (6, 7, 8).
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    const batch3 = emitted.filter(
      (e) => e.event === "order:request" && ["driver_6", "driver_7", "driver_8"].includes(e.room)
    );
    expect(batch3.map((e) => e.room).sort()).toEqual(["driver_6", "driver_7", "driver_8"]);
  });

  it("stops issuing further topup rounds within a batch the instant the order is accepted mid-batch", async () => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([1, 2, 3, 4].map(makeRiderRow)) // tier 0 round 0
      .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck
      .mockImplementationOnce(() => {
        // Tier 1 round 0: 5 and 6 are already locked elsewhere (contention),
        // so only 7 and 8 lock here — normally that shortfall would trigger
        // a topup round. But an out-of-band accept lands (via stopDispatch)
        // right as this round's query resolves, so the topup round must
        // never fire.
        lockManager.acquireLock(5, 999, POPUP_TIMEOUT_MS);
        lockManager.acquireLock(6, 999, POPUP_TIMEOUT_MS);
        dispatchManager.stopDispatch(order.id, "accepted_by_other");
        return Promise.resolve([5, 6, 7, 8].map(makeRiderRow));
      });

    await dispatchManager.startDispatch(order);
    await flush();
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    const tier1Requests = emitted.filter(
      (e) => e.event === "order:request" && [5, 6, 7, 8].includes(Number(e.room.split("_")[1]))
    );
    expect(tier1Requests.map((e) => e.room).sort()).toEqual(["driver_7", "driver_8"]);
    // tier 0 round 0 + its sameOrderLockBlocking recheck + tier 1 round 0 —
    // no topup round despite the shortfall, because the guard broke the
    // while loop before it could fire, and no recheck after tier 1 either,
    // since the accept mid-batch already tore the cascade down by then.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("a single driver eligible for every tier is not skipped past while locked on an earlier tier's popup", async () => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0 (package 6) primary — only driver_1 in range
      .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck — nobody else for tier 0
      .mockResolvedValueOnce([]) // tier 1 (package 7) send query — driver_1 excluded, currently locked on tier 0
      .mockResolvedValueOnce([1].map(makeRiderRow)); // tier 1 genuinely-empty re-check, ignoring this order's own locks — finds driver_1

    await dispatchManager.startDispatch(order);
    await flush();

    expect(emitted.filter((e) => e.event === "order:request").map((e) => e.room)).toEqual(["driver_1"]);

    // Tier 1's only real candidate is driver_1, currently locked on tier 0's
    // still-open popup — the cursor must NOT treat tier 1 as exhausted and
    // skip past it just because of that.
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(1);

    // Driver_1's tier 0 popup is dismissed (without waiting the full 15s) —
    // the cascade must offer them tier 1 next, not some later tier it would
    // have wrongly skipped ahead to.
    lockManager.releaseLock(1);
    prisma.$queryRaw.mockResolvedValueOnce([1].map(makeRiderRow)); // tier 1 send query, driver_1 now free

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    const tier1Request = emitted.find(
      (e) => e.event === "order:request" && e.room === "driver_1" && e.payload.package_id === "7"
    );
    expect(tier1Request).toBeDefined();
  });

  it("does not re-offer a rider whose reject lands mid-batch, after this batch's rejectedRiderIds snapshot was already taken", async () => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValueOnce([5].map(makeRiderRow)); // tier 0 (package 6) — only driver_5 in range

    // First findMany call inside this runBatch is getRejectedRiderIds()'s own
    // snapshot, taken before driver_5's reject has landed — empty. The
    // second is this batch's own mid-batch re-check, by which point the
    // reject has committed — finds driver_5.
    prisma.tbl_order_requests.findMany
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => [{ rider_id: 5 }]);

    await dispatchManager.startDispatch(order);
    await flush();

    expect(emitted.some((e) => e.event === "order:request" && e.room === "driver_5")).toBe(false);
    expect(prisma.tbl_order_requests.create).not.toHaveBeenCalled();
    expect(lockManager.isLocked(5)).toBe(false);
  });

  it("zero eligible drivers in tier 0 does not block the cascade from reaching tier 1", async () => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // tier 0 (package 6) — nobody eligible
      // Genuinely-empty re-check (ignoring this order's own locks, of which
      // there are none here) — confirms tier 0 isn't just blocked by a
      // same-order lock, so the cursor is free to advance.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([5, 6].map(makeRiderRow)); // tier 1 (package 7)

    await dispatchManager.startDispatch(order);
    await flush();

    expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    const requests = emitted.filter((e) => e.event === "order:request");
    expect(requests.map((e) => e.room).sort()).toEqual(["driver_5", "driver_6"]);
  });

  it("all tiers exhausted with no acceptance still reaches the existing no_driver_found flow", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });

    await dispatchManager.startDispatch(order);
    await flush();

    // T = 5s: tier 1 batch fires
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    // T = 15s: tier 0 expires
    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS - BATCH_GAP_MS);
    await flush();

    // T = 20s: tier 1, the final tier, expires with nobody having accepted
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(0);
    await flush();

    const noDriverEvents = emitted.filter((e) => e.event === "order:no_driver_found");
    expect(noDriverEvents).toHaveLength(1);
    expect(noDriverEvents[0].room).toBe(`customer_${order.uid}`);

    const cancelledUpdate = prisma.pkg_order.update.mock.calls.some(
      ([args]) => args.data && args.data.o_status === "Cancelled"
    );
    expect(cancelledUpdate).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 8].every((id) => !lockManager.isLocked(id))).toBe(true);

    expect(pushNotifier.notifyCustomerNoDriverFound).toHaveBeenCalledWith("cust-tok", order.id);
  });

  it("a lone rider who only ever lets the popup time out (never accepting or rejecting) eventually reaches no_driver_found instead of looping forever", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });
    prisma.$queryRaw.mockReset();
    // driver_1 is the only ever candidate the SQL "finds" for every tier and
    // every re-check — real exclusion still happens downstream via
    // selectEligibleDrivers' own JS-level filter against lockManager, so
    // this correctly comes back empty while he's locked and non-empty once
    // his popup naturally times out and frees him again.
    prisma.$queryRaw.mockResolvedValue([1].map(makeRiderRow));

    // 5 tiers, matching the real Model 1-5 cascade — this is what actually
    // exposed the infinite loop live (a 2-tier cascade happens to still
    // reach consecutiveEmptyTurns' own threshold as a side effect, masking
    // the bug this test exists to catch).
    const orderF = { ...order, id: 506, allowed_delivery_types: JSON.stringify([6, 7, 21, 33, 34]) };
    prisma.pkg_order.findUnique.mockResolvedValue({ ...orderF });

    await dispatchManager.startDispatch(orderF);
    await flush();

    // Well past a single lap (5 tiers) worth of natural timeouts, into a
    // second lap re-offering the exact same rider with nothing new — this
    // is exactly the shape that used to loop forever before staleLaps.
    for (let i = 0; i < 20; i++) {
      await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
      await flush();
    }

    const requestsToDriver1 = emitted.filter((e) => e.event === "order:request" && e.room === "driver_1");
    // Exactly one offer per tier for the one lap that actually runs (5
    // tiers, 5 offers) — offeredRiderIdsByTier means the sameOrderLockBlocking
    // recheck recognizes driver_1 already had their turn at every tier, so
    // lap 2 is correctly recognized as stale (staleLaps) before it ever
    // re-offers them anything, instead of drifting into extra redundant
    // re-offers the way an earlier version of this logic did.
    expect(requestsToDriver1.length).toBe(5);

    const noDriverEvents = emitted.filter((e) => e.event === "order:no_driver_found");
    expect(noDriverEvents).toHaveLength(1);
    expect(lockManager.isLocked(1)).toBe(false);

    dispatchManager.stopDispatch(506, "test_cleanup");
  });

  it("startDispatch is a no-op if a cascade is already active for the order (idempotency guard)", async () => {
    await dispatchManager.startDispatch(order);
    await flush();
    expect([1, 2, 3, 4].every((id) => lockManager.isLocked(id))).toBe(true);

    // Duplicate call (retry, duplicate event, etc.) must not start a second
    // overlapping set of timers/batches for the same order.
    await dispatchManager.startDispatch(order);
    await flush();

    expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(4);
  });

  it("does not emit order:dismiss for a rider whose request was already resolved by the time the expiry sweep reaches it", async () => {
    await dispatchManager.startDispatch(order);
    await flush();
    expect([1, 2, 3, 4].every((id) => lockManager.isLocked(id))).toBe(true);

    // Simulate rider 1 having been accepted concurrently, just before this
    // batch's expiry sweep runs: its conditional UPDATE (status:'sent' ->
    // 'timeout') no-ops because the row is no longer 'sent' (count 0).
    // Riders 2-4 are still genuinely pending (count 1, real timeouts).
    prisma.tbl_order_requests.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({ count: where.rider_id === 1 ? 0 : 1 })
    );

    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
    await flush();

    const dismissals = emitted.filter((e) => e.event === "order:dismiss");
    const dismissedRiderIds = dismissals.map((d) => Number(d.room.split("_")[1])).sort();
    expect(dismissedRiderIds).toEqual([2, 3, 4]); // rider 1 (already accepted) gets no false timeout dismiss
  });

  it("uses precomputed tier-0 pricing/order and skips the redundant re-fetch/update for tier 0 only", async () => {
    // createOrder already validated+priced this exact package/distance
    // moments earlier — startDispatch is handed that result directly.
    const tier0Pricing = { fare: 24.78, driverEarning: 1.24, commission: 0 };

    await dispatchManager.startDispatch(order, tier0Pricing);
    await flush();

    expect(prisma.pkg_order.findUnique).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();

    const requests = emitted.filter((e) => e.event === "order:request");
    expect(requests).toHaveLength(4);
    // Uses the precomputed pricing, not pricingEngine.priceForPackageId's mocked
    expect(requests.every((r) => r.payload.driver_earning === "24.78")).toBe(true);
    expect(requests.every((r) => r.payload.trip_total === "24.78")).toBe(true);
  });

  describe("tier cursor race regression (order #1481)", () => {
    it("a second concurrent runBatch call for the same order is deferred, never run alongside the first", async () => {
      // Reproduces a live bug: runBatch can be invoked for the same order
      // from two independent triggers close enough together to run
      // concurrently — the chained setTimeout from the previous turn, and
      // scheduleExpiry's own un-awaited call when a popup expires. With a
      // single lone driver, BATCH_GAP_MS (3s) evenly divides
      // POPUP_TIMEOUT_MS (15s), so this collision recurs on a predictable
      // schedule rather than being a rare fluke. Each invocation used to
      // capture its own `tierIndex` snapshot before its awaits; when the
      // tier at hand was genuinely empty (not just lock-blocked — the
      // sameOrderLockBlocking recheck further down only guards the
      // lock-blocked case), BOTH concurrent calls could independently
      // decide to advance state.tierCursor, silently skipping the next tier
      // — the live symptom on order #1481: Model 5 was never offered, and
      // the cascade wrapped straight back to Model 1 instead.
      const orderG = { ...order, id: 1481, allowed_delivery_types: JSON.stringify([6, 7, 21]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderG });
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw
        .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0 (Model 1), driven by startDispatch
        .mockResolvedValue([]); // every later call — tier 1 genuinely empty

      await dispatchManager.startDispatch(orderG);
      await flush();
      // Tier 0 locked driver 1 and advanced the cursor to tier 1.
      expect(lockManager.isLocked(1)).toBe(true);

      prisma.pkg_order.findUnique.mockClear();

      // Fire two concurrent turns for tier 1, without awaiting between
      // them — the exact overlap that used to race.
      const p1 = dispatchManager._runBatchForTests(1481);
      const p2 = dispatchManager._runBatchForTests(1481);

      // Synchronously, before either call's own first await has resolved:
      // only the call that actually acquires the turn may read the order
      // (the first statement inside a real turn, since tier 1 isn't
      // precomputed). The second concurrent call must be deferred by the
      // batchInFlight guard rather than entering the batch body alongside
      // the first — that's what stops both from independently reading the
      // same stale tierIndex and both advancing the cursor.
      expect(prisma.pkg_order.findUnique).toHaveBeenCalledTimes(1);

      await Promise.all([p1, p2]);
      await flush();

      dispatchManager.stopDispatch(1481, "test_cleanup");
    });

    it("a deferred concurrent call does not bypass BATCH_GAP_MS pacing for the next tier (order #1489/#1491)", async () => {
      // Reproduces a second live bug, introduced by the very fix for the
      // first one: the mutex's initial version fired an immediate follow-up
      // turn (no setTimeout) whenever a concurrent call got deferred, so
      // every such collision let the cascade advance a tier with ~0 delay
      // instead of the intended BATCH_GAP_MS gap. Confirmed live: Models 2-4
      // collapsed into under a second of each other while Models 1 and 5
      // (which didn't happen to follow a collision) held their normal
      // duration. A deferred call must be dropped, not queued to re-fire —
      // the winning call's own runBatchInner already schedules the next
      // turn through the normal setTimeout(delayMs) path.
      const orderH = { ...order, id: 1489, allowed_delivery_types: JSON.stringify([6, 7, 21]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderH });
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw
        .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0, driven by startDispatch
        .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck
        .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 1 — the winning concurrent call finds driver 1 free
        .mockResolvedValue([]); // tier 2 onward — irrelevant to this test

      await dispatchManager.startDispatch(orderH);
      await flush();
      expect(lockManager.isLocked(1)).toBe(true);

      // Tier 0's own completion already scheduled its own natural "run tier
      // 1" timer (plus its scheduleExpiry timer) — clear both so the only
      // triggers left for tier 1 are the two manual concurrent calls below,
      // isolating the exact collision this test is about.
      jest.clearAllTimers();

      // Simulate driver 1 already being free for tier 1 (as if their tier 0
      // popup had just been dismissed) without waiting out POPUP_TIMEOUT_MS.
      lockManager.releaseLock(1);
      prisma.pkg_order.findUnique.mockClear();

      const p1 = dispatchManager._runBatchForTests(1489);
      const p2 = dispatchManager._runBatchForTests(1489);
      await Promise.all([p1, p2]);
      await flush();

      // Tier 1 (Model 2) succeeded exactly once — the deferred call did not
      // also run.
      const tier1Requests = emitted.filter(
        (e) => e.event === "order:request" && e.room === "driver_1" && e.payload.package_id === "7"
      );
      expect(tier1Requests).toHaveLength(1);
      expect(prisma.pkg_order.findUnique).toHaveBeenCalledTimes(1);

      // Immediately after — no time advanced — tier 2 must NOT have started
      // yet. An immediate catch-up rerun would have fired it right here.
      const tier2RequestsBeforeDelay = emitted.filter(
        (e) => e.event === "order:request" && e.payload.package_id === "21"
      );
      expect(tier2RequestsBeforeDelay).toHaveLength(0);
      expect(prisma.pkg_order.findUnique).toHaveBeenCalledTimes(1);

      // Only once the normal BATCH_GAP_MS gap has actually elapsed does the
      // next turn (tier 2) run.
      await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
      await flush();
      expect(prisma.pkg_order.findUnique).toHaveBeenCalledTimes(2);

      dispatchManager.stopDispatch(1489, "test_cleanup");
    });
  });

  describe("concurrent driver selection (no global mutex)", () => {
    it("two independent orders with disjoint candidate pools both dispatch fully, concurrently", async () => {
      const orderA = { ...order, id: 501, category: "Bike" };
      const orderB = { ...order, id: 502, category: "Scooter" };

      prisma.pkg_order.findUnique.mockImplementation(({ where }) => {
        if (where.id === 501) return Promise.resolve({ ...orderA });
        if (where.id === 502) return Promise.resolve({ ...orderB });
        return Promise.resolve(null);
      });

      // Discriminate by category (interpolated literally into the raw SQL)
      // since both orders otherwise share the same fixture fields.
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockImplementation((_strings, ...values) => {
        const category = values.find((v) => v === "Bike" || v === "Scooter");
        const pool = category === "Bike" ? [601, 602, 603, 604] : [701, 702, 703, 704];
        return Promise.resolve(pool.map(makeRiderRow));
      });

      await Promise.all([dispatchManager.startDispatch(orderA), dispatchManager.startDispatch(orderB)]);
      await flush();

      const roomsA = emitted.filter((e) => e.event === "order:request" && [601, 602, 603, 604].includes(Number(e.room.split("_")[1])));
      const roomsB = emitted.filter((e) => e.event === "order:request" && [701, 702, 703, 704].includes(Number(e.room.split("_")[1])));
      expect(roomsA).toHaveLength(4);
      expect(roomsB).toHaveLength(4);
      expect([601, 602, 603, 604].every((id) => lockManager.isLocked(id))).toBe(true);
      expect([701, 702, 703, 704].every((id) => lockManager.isLocked(id))).toBe(true);

      dispatchManager.stopDispatch(501, "test_cleanup");
      dispatchManager.stopDispatch(502, "test_cleanup");
    });

    it("when two orders' candidate queries overlap, exactly one reserves each contested driver and the loser tops up", async () => {
      // Round 1's SQL (mocked) returns the same 4 nearest candidates
      // regardless of which order asked — realistic: neither order's query
      // knew about the other's not-yet-acquired locks. The mock simulates
      // that a rider becomes locked (by "another order", not by us) between
      // the query running and us processing its results, exactly the race
      // this design must survive without a global mutex.
      const pool = [801, 802, 803, 804, 805, 806, 807, 808];
      let call = 0;
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockImplementation(() => {
        call++;
        const available = pool.filter((id) => !lockManager.isLocked(id));
        const candidates = available.slice(0, 4);
        if (call === 1) {
          // Simulate a concurrent order winning 2 of these 4 first.
          lockManager.acquireLock(candidates[0], 9999, POPUP_TIMEOUT_MS);
          lockManager.acquireLock(candidates[2], 9999, POPUP_TIMEOUT_MS);
        }
        return Promise.resolve(candidates.map(makeRiderRow));
      });

      const orderC = { ...order, id: 503, allowed_delivery_types: JSON.stringify([6]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderC });

      await dispatchManager.startDispatch(orderC);
      await flush();

      const requests = emitted.filter((e) => e.event === "order:request");
      expect(requests).toHaveLength(4); // topped up to the full batch size despite losing 2 of round 1
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // exactly one top-up round, not more than needed

      // No duplicate offer: every offered rider appears exactly once, and
      // none of them are the 2 riders the "concurrent order" (9999) won.
      const offeredIds = requests.map((e) => Number(e.room.split("_")[1]));
      expect(new Set(offeredIds).size).toBe(offeredIds.length);
      expect(offeredIds.some((id) => lockManager.peekLock(id)?.orderId === 9999)).toBe(false);

      dispatchManager.stopDispatch(503, "test_cleanup");
      lockManager.releaseLock(pool[0]);
      lockManager.releaseLock(pool[2]);
    });

    it("a genuinely small eligible pool (2 drivers) finishes with 2 and does not retry needlessly", async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockImplementation(() => Promise.resolve([901, 902].map(makeRiderRow)));

      const orderD = { ...order, id: 504, allowed_delivery_types: JSON.stringify([6]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderD });

      await dispatchManager.startDispatch(orderD);
      await flush();

      const requests = emitted.filter((e) => e.event === "order:request");
      expect(requests).toHaveLength(2);
      // A short round (< MAX_DRIVERS_PER_BATCH) means the pool is exhausted —
      // must not retry looking for candidates that don't exist.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

      dispatchManager.stopDispatch(504, "test_cleanup");
    });

    it("bounds top-up retries even under persistent contention — stops after MAX_TOPUP_ROUNDS, does not loop forever", async () => {
      const bigPool = Array.from({ length: 40 }, (_, i) => 1000 + i);
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockImplementation(() => {
        const available = bigPool.filter((id) => !lockManager.isLocked(id));
        const candidates = available.slice(0, 4);
        // Aggressive persistent contention: 3 of every 4 returned candidates
        // get grabbed by "another order" before we can lock them ourselves,
        // so this order nets at most 1 per round, forever, on a full pool.
        lockManager.acquireLock(candidates[0], 9999, POPUP_TIMEOUT_MS);
        lockManager.acquireLock(candidates[1], 9999, POPUP_TIMEOUT_MS);
        lockManager.acquireLock(candidates[2], 9999, POPUP_TIMEOUT_MS);
        return Promise.resolve(candidates.map(makeRiderRow));
      });

      const orderE = { ...order, id: 505, allowed_delivery_types: JSON.stringify([6]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderE });

      await dispatchManager.startDispatch(orderE);
      await flush();

      // 1 initial round + MAX_TOPUP_ROUNDS(2) retries = 3 rounds max, never more,
      // even though the batch never actually fills to 4 under this contention.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      const requests = emitted.filter((e) => e.event === "order:request");
      expect(requests.length).toBeLessThan(4);
      expect(requests.length).toBeGreaterThan(0);

      dispatchManager.stopDispatch(505, "test_cleanup");
      for (const id of bigPool) lockManager.releaseLock(id);
    });
  });
});
