jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
  tbl_order_requests: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));

jest.mock("../pricingEngine", () => {
  const actual = jest.requireActual("../pricingEngine");
  return {
    ...actual,
    // Only the DB-touching lookups are mocked — priceForPackage itself stays
    // real so tests exercise the actual radius-charge formula (see
    // calculateRadiusCharge) against realistic per-driver distances.
    getPackageById: jest.fn().mockResolvedValue({ id: 6, title: "Model 1", min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 10 }),
    getActivePlanDiscount: jest.fn().mockResolvedValue(null),
  };
});

jest.mock("../pushNotifier");

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const lockManager = require("../lockManager");
const pushNotifier = require("../pushNotifier");
const { POPUP_TIMEOUT_MS, BATCH_GAP_MS, MAX_DRIVERS_PER_BATCH } = require("../../config/constants");

const flush = async (ticks = 20) => {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
};

// `{ distanceKm } = {}` (not a plain 2nd positional param) is deliberate:
// every existing call site uses `.map(makeRiderRow)`, which invokes the
// callback with (item, index, array) — a plain 2nd param would silently take
// the array INDEX as the distance for every row past the first. Destructuring
// out of that index instead just finds no .distanceKm property and falls
// back to the default, same as the array's default.
function makeRiderRow(riderId, { distanceKm = 0.5 } = {}) {
  // distance_km mirrors selectEligibleDrivers' own SQL haversine column —
  // defaults inside the free 1km so existing tests that don't care about the
  // exact fare keep seeing one uniform (zero-radius-charge) number.
  return { rider_id: riderId, rlats: "28.70", rlongs: "77.10", fcm_token: "tok", distance_km: distanceKm };
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
    // Default: every Model 1 miss looks like a low, unremarkable streak —
    // tests that specifically exercise the Model 1 suspension threshold
    // override this to walk the streak up to MODEL1_MISS_LIMIT.
    prisma.tbl_rider.update.mockResolvedValue({ model1_miss_streak: 1 });

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

  // Regression: the driver app used to start a fresh popup_duration-second
  // countdown from whenever the push/socket event happened to reach the
  // device, which double-counted delivery latency already eaten into the
  // server's own 15s window — a driver could tap Accept while their local
  // timer still read a few seconds left, after the server's real deadline
  // had already passed (see the expires_at doc comment in
  // buildOrderRequestPayload). expires_at must be an absolute deadline the
  // client can diff against its own clock instead.
  it("stamps order:request with expires_at = armed time + POPUP_TIMEOUT_MS, not just a relative popup_duration", async () => {
    const armedAt = Date.now();
    await dispatchManager.startDispatch(order);
    await flush();

    const batch1Requests = emitted.filter((e) => e.event === "order:request");
    expect(batch1Requests.length).toBeGreaterThan(0);
    for (const request of batch1Requests) {
      expect(request.payload.popup_duration).toBe(String(POPUP_TIMEOUT_MS / 1000));
      expect(Number(request.payload.expires_at)).toBe(armedAt + POPUP_TIMEOUT_MS);
    }
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

  describe("tier-scoped lock/expiry cleanup (order #1503)", () => {
    it("a stale expiry for an OLDER tier does not touch a rider's genuinely-active NEWER tier lock or request row", async () => {
      // Live bug: scheduleExpiry's cleanup matched a rider by orderId alone.
      // A rider who moves on to a newer tier of the same order before an
      // older tier's own 15s timer fires — a real, intended cross-tier
      // re-entry — left that older timer still armed; when it eventually
      // fired, it released the rider's CURRENT (newer) lock and flipped the
      // newer tier's still-legitimately-'sent' row to 'timeout', using only
      // (order_id, rider_id) in the WHERE clause. Confirmed against real
      // production data for order #1503. The fix threads packageId through
      // acquireLock/scheduleExpiry so a stale cleanup can tell its own tier
      // apart from whatever the rider is currently actually holding.
      const twoTierOrder = { ...order, id: 1503, allowed_delivery_types: JSON.stringify([6, 7]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...twoTierOrder });
      prisma.$queryRaw.mockReset();
      // Driver 1 is the only ever candidate the SQL "finds" — real exclusion
      // happens downstream via lockManager, so tier 1's own primary query
      // (while driver 1 is genuinely locked, whatever the package) still
      // correctly filters down to nobody, while the sameOrderLockBlocking
      // recheck (which ignores this order's own locks) correctly still
      // finds driver 1, keeping tier 1 from prematurely wrapping the cursor.
      prisma.$queryRaw.mockResolvedValue([1].map(makeRiderRow));

      await dispatchManager.startDispatch(twoTierOrder);
      await flush();
      expect(lockManager.isLocked(1)).toBe(true);
      expect(lockManager.peekLock(1)).toMatchObject({ packageId: 6 });

      // Simulate driver 1 having legitimately moved on to tier 1 (Model 2)
      // already — e.g. their tier 0 popup was dismissed by some other path
      // and they were re-offered tier 1 — without waiting out tier 0's own
      // still-armed 15s expiry timer.
      lockManager.releaseLock(1);
      lockManager.acquireLock(1, 1503, POPUP_TIMEOUT_MS, 7);
      prisma.tbl_order_requests.updateMany.mockClear();

      // Tier 0's own expiry timer, armed back when it first locked driver 1,
      // fires on its original schedule.
      await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
      await flush();

      // Driver 1's CURRENT (tier 1) lock must survive untouched.
      expect(lockManager.isLocked(1)).toBe(true);
      expect(lockManager.peekLock(1)).toMatchObject({ orderId: 1503, packageId: 7 });

      // Tier 0's stale cleanup must not have written anything for tier 1's
      // (package_id 7) row, and must not have dismissed driver 1's current
      // popup.
      expect(prisma.tbl_order_requests.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ package_id: 7 }) })
      );
      expect(emitted.some((e) => e.event === "order:dismiss" && e.room === "driver_1")).toBe(false);

      lockManager.releaseLock(1);
      dispatchManager.stopDispatch(1503, "test_cleanup");
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

  it("a single driver eligible for every tier is not skipped past a SECOND time, at the next tier too (order #1655)", async () => {
    // The prior test only proves the tier 0 -> tier 1 hop is guarded — live
    // order #1655 showed a real driver correctly offered Model 1 then Model
    // 2, but Model 3 was skipped entirely and the cascade jumped straight to
    // Model 4. Repeats the exact same wait-then-release pattern one more hop
    // (tier 1 -> tier 2) to prove sameOrderLockBlocking doesn't stop
    // protecting a tier after the first successful hop.
    const threeTierOrder = { ...order, allowed_delivery_types: JSON.stringify([6, 7, 21]) };

    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0 (package 6) primary — only driver_1 in range
      .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck — nobody else for tier 0
      .mockResolvedValueOnce([]) // tier 1 (package 7) send query — driver_1 excluded, currently locked on tier 0
      .mockResolvedValueOnce([1].map(makeRiderRow)); // tier 1 genuinely-empty re-check, ignoring locks — finds driver_1

    await dispatchManager.startDispatch(threeTierOrder);
    await flush();
    expect(emitted.filter((e) => e.event === "order:request").map((e) => e.room)).toEqual(["driver_1"]);

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(1);

    // Tier 0 -> tier 1 hop (as in the prior test)
    lockManager.releaseLock(1);
    prisma.$queryRaw.mockResolvedValueOnce([1].map(makeRiderRow)); // tier 1 send query, driver_1 now free

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    const tier1Request = emitted.find(
      (e) => e.event === "order:request" && e.room === "driver_1" && e.payload.package_id === "7"
    );
    expect(tier1Request).toBeDefined();

    // Tier 1 -> tier 2 hop — driver_1 is now locked on tier 1's own popup.
    // Tier 2 (package 21) must wait for it exactly the same way tier 1 waited
    // for tier 0, not treat it as exhausted and skip to a later tier.
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // tier 2 (package 21) send query — driver_1 excluded, locked on tier 1
      .mockResolvedValueOnce([1].map(makeRiderRow)); // tier 2 genuinely-empty re-check, ignoring locks — finds driver_1

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    expect(
      emitted.filter((e) => e.event === "order:request" && e.payload.package_id === "21")
    ).toHaveLength(0);

    lockManager.releaseLock(1);
    prisma.$queryRaw.mockResolvedValueOnce([1].map(makeRiderRow)); // tier 2 send query, driver_1 now free

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    const tier2Request = emitted.find(
      (e) => e.event === "order:request" && e.room === "driver_1" && e.payload.package_id === "21"
    );
    expect(tier2Request).toBeDefined();
  });

  it("a candidate's lock expiring WHILE the sameOrderLockBlocking recheck query is in flight still holds the tier, not skip it (order #1655 root cause)", async () => {
    // The exact race: this tier's recheck query ("is anyone eligible here,
    // ignoring locks?") is a real async DB round-trip. If the candidate's
    // lock from an earlier tier of this SAME order happens to expire and
    // release (via its own independent scheduleExpiry timer) while that
    // query is still in flight, peekLock sees nothing by the time the query
    // resolves — sameOrderLockBlocking used to come back false right as the
    // driver became free to take this exact tier, and the cursor skipped it.
    const twoTierOrder = { ...order, allowed_delivery_types: JSON.stringify([6, 7]) };

    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0 (package 6) primary — only driver_1 in range
      .mockResolvedValueOnce([]); // tier 0 sameOrderLockBlocking recheck — nobody else for tier 0

    await dispatchManager.startDispatch(twoTierOrder);
    await flush();
    expect(emitted.filter((e) => e.event === "order:request").map((e) => e.room)).toEqual(["driver_1"]);

    // Tier 1's turn: driver_1 is still locked when the main send query runs
    // (so it excludes them), but its recheck query's own resolution is what
    // releases the lock mid-flight — simulating the lock's independent
    // scheduleExpiry timer firing during that exact await.
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // tier 1 (package 7) send query — driver_1 still locked
      .mockImplementationOnce(async () => {
        lockManager.releaseLock(1); // races the peekLock check right after this resolves
        return [1].map(makeRiderRow);
      });

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    // Must NOT have been silently skipped — no request for package_id "7" yet
    // is fine (this turn may not have offered it either, if a fresh query is
    // needed), but the cascade must not have moved past tier 1 without ever
    // offering it to driver_1.
    prisma.$queryRaw.mockResolvedValueOnce([1].map(makeRiderRow)); // tier 1 send query, driver_1 free

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
    // Exactly one offer per tier, one lap only (5 offers) — the cascade is
    // capped at a single pass through the tiers per order (product
    // decision): once the cursor would wrap back to Model 1 a second time,
    // staleLaps stops it instead of looping again, regardless of whether
    // driver_1 is still around to re-offer.
    expect(requestsToDriver1.length).toBe(5);
    expect(requestsToDriver1.map((e) => e.payload.package_id)).toEqual(["6", "7", "21", "33", "34"]);

    const noDriverEvents = emitted.filter((e) => e.event === "order:no_driver_found");
    expect(noDriverEvents).toHaveLength(1);
    expect(lockManager.isLocked(1)).toBe(false);

    dispatchManager.stopDispatch(506, "test_cleanup");
  });

  it("a genuinely eligible driver who only becomes free after the cascade's one lap already finished is still not offered (single-lap-only product decision)", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });
    prisma.$queryRaw.mockReset();
    // Both driver_1 and driver_2 are in range for tier 0 (package 6) the
    // whole time — real exclusion happens downstream via lockManager, same
    // "belt and suspenders" pattern as the rest of this suite. Nobody is
    // ever eligible for tier 1.
    prisma.$queryRaw.mockImplementation((_strings, ...values) => {
      const packageIdStr = values.find((v) => typeof v === "string" && ["6", "7"].includes(v));
      return Promise.resolve(packageIdStr === "6" ? [1, 2].map(makeRiderRow) : []);
    });

    // driver_2 is busy on a completely unrelated order throughout lap 1 —
    // not a candidate yet, through no fault of this cascade.
    lockManager.acquireLock(2, 999, POPUP_TIMEOUT_MS);

    await dispatchManager.startDispatch(order); // order fixture: 2 tiers [6, 7]
    await flush();

    // Lap 1 tier 0: only driver_1 is actually free right now.
    expect(emitted.filter((e) => e.event === "order:request").map((e) => e.room)).toEqual(["driver_1"]);

    // Tier 1 has no real candidates at all (regardless of driver_2's lock
    // state, since the mock never returns anyone for package 7), so one
    // BATCH_GAP_MS turn is enough for the cursor to reach lap 2's tier 0 —
    // well before driver_1's own tier 0 popup naturally expires.
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();

    // driver_2 finishes their unrelated order right as lap 2 would begin —
    // the exact "new driver shows up late" case the old rider-count-based
    // staleLaps check would have let through into a second lap. The
    // single-lap cap must not care: one lap per order, full stop, regardless
    // of who becomes available afterward.
    lockManager.releaseLock(2);

    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS); // lap 2's tier 0 attempt
    await flush();

    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
      await flush();
    }

    expect(emitted.some((e) => e.event === "order:request" && e.room === "driver_2")).toBe(false);
    expect(emitted.some((e) => e.event === "order:no_driver_found")).toBe(true);

    lockManager.releaseLock(2);
    dispatchManager.stopDispatch(order.id, "test_cleanup");
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

  it("uses precomputed tier-0 order/pkg/discount and skips the redundant re-fetch/update for tier 0 only", async () => {
    // createOrder already validated+priced this exact package/distance
    // moments earlier — startDispatch is handed that result directly.
    const tier0Pricing = {
      fare: 25, driverEarning: 1, commission: 0,
      pkg: { id: 6, min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 10 },
      discount: null,
    };

    await dispatchManager.startDispatch(order, tier0Pricing);
    await flush();

    expect(prisma.pkg_order.findUnique).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();

    const requests = emitted.filter((e) => e.event === "order:request");
    expect(requests).toHaveLength(4);
    // Every rider here is at the default makeRiderRow distance (0.5km, within
    // the free 1km) — so they all land on the SAME real per-driver fare
    // (min_charge + per_km_charge*tripDistance, zero radius charge), not the
    // raw precomputed.fare/driverEarning placeholder itself.
    // dCharge = 20 + 5*15.4 = 97; no radius charge (0.5km < 1km free).
    expect(requests.every((r) => r.payload.trip_total === "97")).toBe(true);
    expect(requests.every((r) => r.payload.driver_earning === "97")).toBe(true);
  });

  it("sends net driver earning after admin commission, not the gross fare", async () => {
    const tier0Pricing = {
      fare: 100, driverEarning: 80, commission: 20,
      pkg: { id: 6, title: "Model 1", min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 10, driver_per_percent: 20 },
      discount: null,
    };

    await dispatchManager.startDispatch({ ...order, distance: 16 }, tier0Pricing);
    await flush();

    const requests = emitted.filter((r) => r.event === "order:request");
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.payload.estimated_earning === r.payload.driver_earning)).toBe(true);
    expect(requests.every((r) => r.payload.estimated_earning === "80")).toBe(true);
    expect(requests.every((r) => r.payload.trip_total === "80")).toBe(true);
  });

  it("prices each driver's popup off their OWN pickup distance, not one shared per-tier fare", async () => {
    // Regression: widening the customer's search radius used to inflate the
    // fare shown to every eligible driver, even ones sitting right at the
    // pickup — the radius charge must depend on each driver's real distance,
    // not the customer's chosen search radius setting.
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw
      .mockResolvedValueOnce([makeRiderRow(1, { distanceKm: 0.5 }), makeRiderRow(2, { distanceKm: 5 })]) // tier 0: one nearby, one far
      .mockResolvedValueOnce([]) // tier 0 sameOrderLockBlocking recheck
      .mockResolvedValue([]); // everything after

    const tier0Pricing = {
      fare: 20, driverEarning: 20, commission: 0,
      pkg: { id: 6, min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 10 },
      discount: null,
    };

    await dispatchManager.startDispatch(order, tier0Pricing);
    await flush();

    const requests = emitted.filter((e) => e.event === "order:request");
    const nearby = requests.find((r) => r.room === "driver_1").payload;
    const far = requests.find((r) => r.room === "driver_2").payload;

    // Both: dCharge base = 20 + 5*15.4 = 97.
    // Rider 1 @ 0.5km: within the free 1km -> no radius charge -> 97.
    expect(nearby.trip_total).toBe("97");
    // Rider 2 @ 5km: chargeable 4km * pickup_per_km_charge(10) = 40 -> 137.
    expect(far.trip_total).toBe("137");
    expect(far.trip_total).not.toBe(nearby.trip_total);
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

    it("two real orders started at the same instant against a shared pool of 8 drivers split 4-and-4, with no duplicate or wasted driver", async () => {
      // Both orders are genuinely eligible for the exact same 8 drivers (same
      // category/radius) — the "8 drivers online, 2 customers order within
      // the same instant" case. The mock reflects only currently-unlocked
      // drivers, nearest-first, truncated the way the real SQL's own
      // LIMIT/NOT-IN would — neither order's query "knows" about the other's
      // locks except through this shared, live lock state.
      const pool = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008];
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockImplementation(() => {
        const available = pool.filter((id) => !lockManager.isLocked(id));
        return Promise.resolve(available.slice(0, MAX_DRIVERS_PER_BATCH + 1).map(makeRiderRow));
      });

      const orderX = { ...order, id: 511, allowed_delivery_types: JSON.stringify([6]) };
      const orderY = { ...order, id: 512, allowed_delivery_types: JSON.stringify([6]) };
      prisma.pkg_order.findUnique.mockImplementation(({ where }) => {
        if (where.id === 511) return Promise.resolve({ ...orderX });
        if (where.id === 512) return Promise.resolve({ ...orderY });
        return Promise.resolve(null);
      });

      // startDispatch's own kick-off (runBatch(order.id).catch(...)) is
      // fire-and-forget, not awaited — this is what actually happens when
      // two HTTP requests land back to back, not an artificially serialized
      // call.
      await Promise.all([dispatchManager.startDispatch(orderX), dispatchManager.startDispatch(orderY)]);
      await flush();

      const requestsX = emitted.filter((e) => e.event === "order:request" && e.payload.order_id === "511");
      const requestsY = emitted.filter((e) => e.event === "order:request" && e.payload.order_id === "512");
      const idsX = requestsX.map((e) => Number(e.room.split("_")[1]));
      const idsY = requestsY.map((e) => Number(e.room.split("_")[1]));

      // The headline guarantee: every driver goes to exactly one order (no
      // double-booking), each order gets a full batch of 4 (8 drivers is
      // exactly enough for both), and all 8 drivers actually get used — none
      // sit idle just because both queries raced.
      expect(idsX).toHaveLength(4);
      expect(idsY).toHaveLength(4);
      const allIds = [...idsX, ...idsY];
      expect(new Set(allIds).size).toBe(8);
      expect(allIds.sort((a, b) => a - b)).toEqual(pool);

      dispatchManager.stopDispatch(511, "test_cleanup");
      dispatchManager.stopDispatch(512, "test_cleanup");
      for (const id of pool) lockManager.releaseLock(id);
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

    it("a second order whose entire eligible pool is already locked by a first order's active popups does not instantly report no_driver_found, and still dispatches once those locks clear", async () => {
      // Both drivers are eligible for every tier of orderG (packages 6 and 7
      // alike) — the real-world "two customers order within moments of each
      // other and only a couple of drivers are online nearby" case.
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([901, 902].map(makeRiderRow));

      // Simulate order 9999 (some other customer's cascade, already in
      // flight) having locked out the entire pool moments before orderG was
      // even created.
      lockManager.acquireLock(901, 9999, POPUP_TIMEOUT_MS);
      lockManager.acquireLock(902, 9999, POPUP_TIMEOUT_MS);

      const orderG = { ...order, id: 602, allowed_delivery_types: JSON.stringify([6, 7]) };
      prisma.pkg_order.findUnique.mockResolvedValue({ ...orderG });

      await dispatchManager.startDispatch(orderG);
      await flush();

      // Before this fix, a tier whose only candidates were locked by another
      // order was treated identically to "nobody eligible at all" and
      // advanced with zero delay — a multi-tier cascade could reach
      // checkCascadeTermination and cancel the order within the same tick,
      // long before the other order's 15s popups had any chance to resolve.
      expect(emitted.some((e) => e.event === "order:no_driver_found")).toBe(false);
      expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(0);

      // The other order's popups resolve (reject/timeout) partway through
      // orderG's own first tier's retry window — well within its single lap.
      lockManager.releaseLock(901);
      lockManager.releaseLock(902);

      await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
      await flush();

      // orderG must still be able to pick them up, on this same cascade —
      // not have already given up before they ever had a chance to free up.
      const requests = emitted.filter((e) => e.event === "order:request").map((e) => e.room);
      expect(requests.sort()).toEqual(["driver_901", "driver_902"]);
      expect(emitted.some((e) => e.event === "order:no_driver_found")).toBe(false);

      dispatchManager.stopDispatch(602, "test_cleanup");
      lockManager.releaseLock(901);
      lockManager.releaseLock(902);
    });
  });

  describe("recordModel1Outcome (Model 1 reliability suspension)", () => {
    it("is a no-op for any package other than Model 1", async () => {
      await dispatchManager.recordModel1Outcome(1, 7, "miss");
      await dispatchManager.recordModel1Outcome(1, 21, "accept");
      expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    });

    it("increments the miss streak on a Model 1 miss, below the suspension limit", async () => {
      prisma.tbl_rider.update.mockResolvedValue({ model1_miss_streak: 3 });

      await dispatchManager.recordModel1Outcome(42, 6, "miss");

      expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
      expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { model1_miss_streak: { increment: 1 } },
        select: { model1_miss_streak: true },
      });
    });

    it("resets the streak to 0 on a Model 1 accept, without touching the suspension field", async () => {
      await dispatchManager.recordModel1Outcome(42, 6, "accept");

      expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
      expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { model1_miss_streak: 0 },
      });
    });

    it("suspends the rider from Model 1 for 24h once the miss streak reaches the limit, and resets the streak", async () => {
      prisma.tbl_rider.update.mockResolvedValueOnce({ model1_miss_streak: 5 });

      await dispatchManager.recordModel1Outcome(42, 6, "miss");

      expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(2);
      const [, secondCallArgs] = prisma.tbl_rider.update.mock.calls;
      expect(secondCallArgs[0].where).toEqual({ id: 42 });
      expect(secondCallArgs[0].data.model1_miss_streak).toBe(0);
      const suspendedUntil = secondCallArgs[0].data.model1_suspended_until;
      expect(suspendedUntil).toBeInstanceOf(Date);
      const hoursFromNow = (suspendedUntil.getTime() - Date.now()) / (60 * 60 * 1000);
      expect(hoursFromNow).toBeGreaterThan(23.9);
      expect(hoursFromNow).toBeLessThanOrEqual(24);
    });

    it("does not suspend while the miss streak is still below the limit", async () => {
      prisma.tbl_rider.update.mockResolvedValueOnce({ model1_miss_streak: 4 });

      await dispatchManager.recordModel1Outcome(42, 6, "miss");

      expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("Model 1 suspension excludes the rider from Model 1 offers (order-level)", () => {
    it("a Model 1 popup that times out records a miss for that rider", async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$queryRaw
        .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0 (package 6) primary
        .mockResolvedValueOnce([]); // tier 0 sameOrderLockBlocking recheck

      await dispatchManager.startDispatch(order); // order fixture: tiers [6, 7]
      await flush();

      expect(emitted.some((e) => e.event === "order:request" && e.room === "driver_1")).toBe(true);

      await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS); // tier 0 (Model 1) expires
      await flush();

      expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { model1_miss_streak: { increment: 1 } },
        select: { model1_miss_streak: true },
      });

      dispatchManager.stopDispatch(order.id, "test_cleanup");
    });

    it("a driver's excluded from the SQL's Model 1 candidate query with a suspension-aware WHERE clause, but not for other tiers", async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);

      await dispatchManager.selectEligibleDrivers(order, 6, []);
      const [tier0Call] = prisma.$queryRaw.mock.calls;
      const tier0Sql = tier0Call[0].join(" ");
      expect(tier0Sql).toContain("model1_suspended_until");

      prisma.$queryRaw.mockClear();
      await dispatchManager.selectEligibleDrivers(order, 7, []);
      const [tier1Call] = prisma.$queryRaw.mock.calls;
      // The same static query text is used for every tier (the suspension
      // check itself is neutralized in SQL when packageId != 6, not omitted
      // from the query string) — asserting the values passed in confirms
      // package 7 doesn't match MODEL_1_PACKAGE_ID, so the OR short-circuits
      // true and the suspension clause never actually excludes anyone.
      expect(tier1Call.slice(1)).toContain(7);
    });
  });

  describe("scheduleExpiry timing anchored to real lock time (orders #1550/#1552)", () => {
    it("a slow DB write between locking and scheduleExpiry does not extend the popup's real duration", async () => {
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$queryRaw
        .mockResolvedValueOnce([1].map(makeRiderRow)) // tier 0 primary
        .mockResolvedValueOnce([]); // tier 0 sameOrderLockBlocking recheck

      // Simulates a slow remote-DB write for the request row created right
      // after the lock is acquired — real production latency (belt-and
      // -suspenders reject recheck + this create + push notify) that lands
      // between lockManager.acquireLock (which stamps the lock's real
      // expiresAt) and scheduleExpiry actually being called.
      const DB_LATENCY_MS = 5000;
      prisma.tbl_order_requests.create.mockImplementationOnce(({ data }) => {
        orderRequestsStore.push({ ...data });
        jest.setSystemTime(new Date(Date.now() + DB_LATENCY_MS));
        return Promise.resolve({ id: orderRequestsStore.length, ...data });
      });

      await dispatchManager.startDispatch(order);
      await flush();

      expect(lockManager.isLocked(1)).toBe(true);

      // The lock's real expiresAt was stamped BEFORE the simulated 5s DB
      // delay, so only POPUP_TIMEOUT_MS - DB_LATENCY_MS more should be
      // needed to reach it — not a full fresh POPUP_TIMEOUT_MS counted from
      // whenever scheduleExpiry actually got called (after the delay).
      await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS - DB_LATENCY_MS);
      await flush();

      expect(lockManager.isLocked(1)).toBe(false);
      expect(emitted.some((e) => e.event === "order:dismiss" && e.room === "driver_1")).toBe(true);
      // The request row must actually get closed out to 'timeout' — the
      // orphaned-at-'sent'-forever symptom this regression guards against
      // (orders #1550/#1552) happens when the expiry fires too late to
      // still recognize the rider as pending on this tier.
      expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({
        where: { order_id: order.id, rider_id: 1, package_id: 6, status: "sent" },
        data: { status: "timeout" },
      });
    });
  });
});
