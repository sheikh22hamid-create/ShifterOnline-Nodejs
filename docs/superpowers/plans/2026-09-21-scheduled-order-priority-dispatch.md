# Scheduled Order Driver Priority Dispatch (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let drivers browse upcoming `booking_type=2` scheduled orders ahead of time, mark interest (non-binding), get first crack at the popup when the order goes live (30 min before pickup, 15-minute exclusive window), then fall back to the existing radius-based cascade everyone else already uses for instant orders. Customer gets a "searching" push when the order goes live and a "may run a few minutes late" heads-up if the accepting driver has little buffer left.

**Architecture:** Reuses the existing accept/popup machinery end to end instead of building a parallel one: the priority round and the fallback round both emit the **same** `order:request` socket event and write the **same** `tbl_order_requests` row that `dispatchManager`'s live-order cascade already uses — so `claimOrderForRider`'s existing atomic accept transaction (already race-safe today) handles both without any new locking or new accept code path. A new `pkg_order_interest` table (many-to-many, no lock semantics) records who's interested. A rewritten `dispatchDueScheduledOrders` sweep drives the two-stage timing. The driver app's popup already has dead plumbing (`SocketOrderRouter.mapOrderRequestData`'s `order_date` ← `schedule_date_time` mapping) that this plan finally renders.

**Tech Stack:** Node.js/Express/Prisma (backend), native Android/Java (`ShifterDriver`), React (`frontend` admin panel).

**Spec:** `docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md`

## Global Constraints

- `booking_type=1` (instant) and `booking_type=3` (next-day) flows must not change — every change here is additively gated on `booking_type === 2`, following the same posture the existing next-day feature established (`docs/superpowers/specs/2026-09-10-next-day-booking-design.md` §2).
- The fallback round is a plain, unmodified call to `dispatchManager.startDispatch(order, ...)` — the same function instant orders already use. No new cascade/lock logic is written for it.
- Go-live lead time: 30 minutes before `schedule_date_time`. Priority (interested-only) window: 15 minutes. Late-accept customer warning buffer: 10 minutes (spec §3, confirmed values).
- This plan assumes Phase A (`docs/superpowers/plans/2026-09-21-scheduled-order-datetime-picker.md`) has landed, so real `schedule_date_time` values exist on `booking_type=2` orders.

---

### Task 1: Data model — `pkg_order_interest` table + `priority_notify_sent` column

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: a new Prisma migration (via `npx prisma migrate dev`)
- Test: `backend/src/controllers/__tests__/riderScheduledTrips.test.js` (created fully in Task 6; this task just needs the migration applied so `prisma.pkg_order_interest` exists for that later test file to use)

**Interfaces:**
- Produces: `prisma.pkg_order_interest` model with fields `id`, `order_id`, `rider_id`, `created_at`, unique on `(order_id, rider_id)`. `prisma.pkg_order.priority_notify_sent` (nullable boolean, default false). Both consumed by Tasks 3, 4, 6.

- [ ] **Step 1: Add the schema changes**

In `backend/prisma/schema.prisma`, inside `model pkg_order { ... }`, add one field near the existing `driver_notify_sent` field (around line 231):

```prisma
  driver_notify_sent     Boolean?           @default(false)
  priority_notify_sent   Boolean?           @default(false)
```

Add a new model anywhere else in the file (convention in this file is alphabetical-ish by introduction order — add it right after `pkg_order`'s closing brace):

```prisma
model pkg_order_interest {
  id         Int      @id @default(autoincrement())
  order_id   Int
  rider_id   Int
  created_at DateTime @default(now())

  @@unique([order_id, rider_id])
  @@index([order_id])
  @@index([rider_id])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run (from `backend/`):
```bash
npx prisma migrate dev --name add_pkg_order_interest_and_priority_notify_sent
```
Expected: a new folder under `backend/prisma/migrations/` is created, and the command reports the migration applied successfully to the dev database.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: completes with no errors; `prisma.pkg_order_interest` and `prisma.pkg_order.priority_notify_sent` are now usable from JS (verify by running `node -e "const p = require('./src/config/db'); console.log(typeof p.pkg_order_interest.findMany)"` from `backend/` — expect `function`).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add pkg_order_interest table and priority_notify_sent column"
```

---

### Task 2: New timing constants

**Files:**
- Modify: `backend/src/config/constants.js`

**Interfaces:**
- Produces: `SCHEDULED_ORDER_GO_LIVE_LEAD_MS`, `SCHEDULED_ORDER_PRIORITY_WINDOW_MS`, `SCHEDULED_ORDER_LATE_ACCEPT_BUFFER_MS` — consumed by Tasks 4 and 6 (indirectly, via the sweep).

- [ ] **Step 1: Add the constants**

In `backend/src/config/constants.js`, right after the existing `SCHEDULED_ORDER_REMINDER_LEAD_MS` / `SCHEDULED_ORDER_SWEEP_INTERVAL_MS` block (around line 74-75), add:

```js
  // Driver priority-interest dispatch (booking_type=2) — see
  // docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md §3/§6.
  // An order "goes live" this long before schedule_date_time; drivers who
  // marked interest ahead of time get an exclusive popup window this long
  // before it falls back to the normal radius-based cascade every instant
  // order already uses.
  SCHEDULED_ORDER_GO_LIVE_LEAD_MS: 30 * 60 * 1000,
  SCHEDULED_ORDER_PRIORITY_WINDOW_MS: 15 * 60 * 1000,
  // If the accepting driver has less than this much time left before
  // schedule_date_time, the customer gets an extra "may run a few minutes
  // late" push alongside the normal "driver assigned" notification.
  SCHEDULED_ORDER_LATE_ACCEPT_BUFFER_MS: 10 * 60 * 1000,
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/config/constants.js
git commit -m "feat: add scheduled-order priority-dispatch timing constants"
```

---

### Task 3: `dispatchManager` — carry `schedule_date_time` into `order:request`, add `offerToInterestedRiders`

**Files:**
- Modify: `backend/src/services/dispatchManager.js`
- Test: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `pricingEngine.priceForPackage` (existing), `prisma.tbl_order_requests.create` (existing), `pushNotifier.notifyDriverOrderRequest` (existing), `buildOrderRequestPayload` (existing, modified — see Step 1).
- Produces: `dispatchManager.offerToInterestedRiders(order, riderIds, pkg, discount)` → `Promise<{ offeredRiderIds: number[] }>`. Consumed by Task 4's sweep.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/services/__tests__/dispatchManager.test.js` (follow the existing file's mocking setup at its top — it already mocks `prisma`, `getIO`/`requireIo`, and `pushNotifier`; reuse those same mocks rather than adding new ones):

```js
describe("schedule_date_time passthrough on order:request", () => {
  it("includes schedule_date_time in the payload when the order has one", async () => {
    // Arrange a normal single-tier order exactly like the file's existing
    // "offers to nearest eligible drivers" test does, but with
    // booking_type: 2 and a schedule_date_time set.
    const order = makeOrder({ id: 900, booking_type: 2, schedule_date_time: "2026-09-22T15:00:00.000Z" });
    mockEligibleDrivers([{ rider_id: 1, distance_km: 2, fcm_token: "tok1" }]);

    await dispatchManager.startDispatch(order);
    await flushAsync();

    const requests = emitted.filter((e) => e.event === "order:request" && e.room === "driver_1");
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.schedule_date_time).toBe("2026-09-22T15:00:00.000Z");
  });

  it("omits schedule_date_time when the order doesn't have one (instant orders unaffected)", async () => {
    const order = makeOrder({ id: 901, booking_type: 1, schedule_date_time: null });
    mockEligibleDrivers([{ rider_id: 2, distance_km: 2, fcm_token: "tok2" }]);

    await dispatchManager.startDispatch(order);
    await flushAsync();

    const requests = emitted.filter((e) => e.event === "order:request" && e.room === "driver_2");
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.schedule_date_time).toBeUndefined();
  });
});

describe("offerToInterestedRiders", () => {
  it("prices and offers the order to each given rider, writes tbl_order_requests, and returns their ids", async () => {
    const order = makeOrder({ id: 902, booking_type: 2, schedule_date_time: "2026-09-22T15:00:00.000Z" });
    mockRidersById({
      5: { id: 5, rlats: "12.90", rlongs: "77.60", fcm_token: "tok5", vehicle: order.category },
      6: { id: 6, rlats: "12.91", rlongs: "77.61", fcm_token: "tok6", vehicle: order.category },
    });

    const result = await dispatchManager.offerToInterestedRiders(order, [5, 6], { id: 6, title: "Model 1" }, 0);

    expect(result.offeredRiderIds.sort()).toEqual([5, 6]);
    const requests = emitted.filter((e) => e.event === "order:request");
    expect(requests.map((r) => r.room).sort()).toEqual(["driver_5", "driver_6"]);
    expect(prisma.tbl_order_requests.create).toHaveBeenCalledTimes(2);
    // Priority offers use a longer expiry than the normal 15s cascade popup.
    expect(requests[0].payload.expires_at).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it("skips a rider who's gone offline/stale since marking interest", async () => {
    const order = makeOrder({ id: 903, booking_type: 2, schedule_date_time: "2026-09-22T15:00:00.000Z" });
    mockRidersById({
      5: { id: 5, rlats: "12.90", rlongs: "77.60", fcm_token: "tok5", vehicle: order.category },
      // rider 6 not found / offline — mockRidersById omits it
    });

    const result = await dispatchManager.offerToInterestedRiders(order, [5, 6], { id: 6, title: "Model 1" }, 0);

    expect(result.offeredRiderIds).toEqual([5]);
  });
});
```

Note: `makeOrder`, `mockEligibleDrivers`, `flushAsync`, `emitted` are existing helpers already used throughout this test file — check the file's top for their exact current signatures before use (they may already exist under slightly different names; match whatever this file already has rather than inventing new helpers). `mockRidersById` is new — add it as a small helper near the file's other mock setup, backing `prisma.tbl_rider.findMany`'s mock to return rows keyed by the ids this test passes in.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest dispatchManager.test.js -t "schedule_date_time|offerToInterestedRiders"`
Expected: FAIL — `offerToInterestedRiders` is not a function; `schedule_date_time` assertions fail (field not present).

- [ ] **Step 3: Carry `schedule_date_time` into the existing cascade's payload**

In `backend/src/services/dispatchManager.js`, find the `order:request` emit inside `runBatchInner` (around line 669-678, right after `buildOrderRequestPayload(...)` is called). Change:

```js
          const payload = buildOrderRequestPayload(
            currentOrder, packageId, distanceKm.toFixed(1), fare, packageTitle,
            armedAt + POPUP_TIMEOUT_MS,
            driverTitle,
            state.customerStats?.customerRating,
            state.customerStats?.customerOrders
          );

          requireIo().to(`driver_${riderId}`).emit("order:request", payload);
```

to:

```js
          const payload = buildOrderRequestPayload(
            currentOrder, packageId, distanceKm.toFixed(1), fare, packageTitle,
            armedAt + POPUP_TIMEOUT_MS,
            driverTitle,
            state.customerStats?.customerRating,
            state.customerStats?.customerOrders
          );
          // Scheduled orders (booking_type=2) carry their real pickup time
          // into the driver's popup so it reads "Scheduled pickup: ..."
          // instead of looking like an instant order — see
          // docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md §8.
          // Absent/undefined for every other booking type, so this is a
          // pure no-op addition for instant/next-day orders.
          if (currentOrder.schedule_date_time) {
            payload.schedule_date_time = currentOrder.schedule_date_time;
          }

          requireIo().to(`driver_${riderId}`).emit("order:request", payload);
```

- [ ] **Step 4: Add `offerToInterestedRiders`**

Add this new function to `backend/src/services/dispatchManager.js`, near `startDispatch` (module-level, exported alongside it):

```js
/**
 * Priority round for a scheduled order (booking_type=2) that has drivers
 * who marked interest ahead of time (pkg_order_interest) — see
 * docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md
 * §6/§7. Offers to exactly the given riders (no distance-based selection —
 * the caller already picked them), reusing the same tbl_order_requests +
 * order:request + claimOrderForRider machinery the normal cascade uses, so
 * the very same atomic accept path (already race-safe across concurrent
 * accepts today) resolves who actually gets it. Unlike the tiered cascade,
 * there is exactly one round here — no per-driver lock, no batching.
 */
async function offerToInterestedRiders(order, riderIds, pkg, discount) {
  if (!riderIds || riderIds.length === 0) return { offeredRiderIds: [] };

  const riders = await prisma.tbl_rider.findMany({
    where: {
      id: { in: riderIds.map(Number) },
      a_status: 1,
      status: 1,
      vehicle: order.category,
    },
  });

  const distanceKm = Number(order.distance) || 0;
  const armedAt = Date.now();
  const expiresAt = armedAt + SCHEDULED_ORDER_PRIORITY_WINDOW_MS;

  const offeredRiderIds = [];
  await Promise.all(
    riders.map(async (driver) => {
      const riderId = Number(driver.id);
      const driverDistanceKm = haversineKm(
        Number(order.plat), Number(order.plong),
        Number(driver.rlats), Number(driver.rlongs)
      );

      await prisma.tbl_order_requests.create({
        data: {
          order_id: order.id,
          rider_id: riderId,
          package_id: Number(pkg.id),
          status: "sent",
          lat: driver.rlats ? String(driver.rlats) : null,
          lng: driver.rlongs ? String(driver.rlongs) : null,
        },
      });

      const { fare, driverTitle } = pricingEngine.priceForPackage(
        pkg, distanceKm,
        Number.isFinite(driverDistanceKm) && driverDistanceKm > 0 ? driverDistanceKm : 1,
        0, discount
      );

      const payload = buildOrderRequestPayload(
        order, pkg.id, distanceKm.toFixed(1), fare, pkg.title, expiresAt, driverTitle
      );
      payload.schedule_date_time = order.schedule_date_time;

      requireIo().to(`driver_${riderId}`).emit("order:request", payload);
      await pushNotifier.notifyDriverOrderRequest(driver.fcm_token, payload);
      offeredRiderIds.push(riderId);
    })
  );

  return { offeredRiderIds };
}
```

Add `SCHEDULED_ORDER_PRIORITY_WINDOW_MS` to this file's existing constants import at the top (find the `const { ... } = require("../config/constants")` line and add it to the destructured list). Check whether this file already has a `haversineKm` helper (it likely does, or one lives in `backend/src/utils/geoDistance.js` per the next-day spec's own reference to `haversineKm` in that file) — import it from there rather than redefining it:

```js
const { haversineKm } = require("../utils/geoDistance");
```

If `backend/src/utils/geoDistance.js` doesn't export a plain `haversineKm(lat1, lng1, lat2, lng2)` function (check its actual exports first), add one there with the standard haversine formula, matching the same distance convention `countNearbyOnlineDrivers`'s raw SQL already uses in `orderAvailabilityController.js:77-102`, and export it — don't duplicate the formula inline in `dispatchManager.js`.

Add `offerToInterestedRiders` to this file's `module.exports` block, alongside `startDispatch`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest dispatchManager.test.js`
Expected: PASS — including every pre-existing test in this file (confirms no regression to the instant-order cascade).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js backend/src/utils/geoDistance.js
git commit -m "feat: add offerToInterestedRiders priority round and schedule_date_time passthrough"
```

---

### Task 4: `tripLifecycle` — two-stage go-live sweep + late-accept customer push

**Files:**
- Modify: `backend/src/services/tripLifecycle.js`
- Test: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `dispatchManager.offerToInterestedRiders` (Task 3), `dispatchManager.startDispatch` (existing, unmodified), `pushNotifier.notifyCustomerOrderLive` and `pushNotifier.notifyCustomerLatePickup` (Task 5 — write this task's calls to them now, Task 5 defines the functions; run this task's tests only after Task 5 lands, or stub them locally in this task's test file in the meantime).
- Produces: `dispatchDueScheduledOrders` — same exported name, same call site in `server.js`, new internal two-stage behavior. No signature change.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/services/__tests__/tripLifecycle.test.js` (match this file's existing Prisma-mocking conventions — check its top for how `prisma.pkg_order.findMany`/`update` are already mocked elsewhere in the file):

```js
describe("dispatchDueScheduledOrders — two-stage priority sweep", () => {
  const NOW = new Date("2026-09-22T14:30:00.000Z").getTime(); // 30 min before a 3:00 PM pickup

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  it("sends a priority offer (not the fallback cascade) when the order just went live and has interested riders", async () => {
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 10, booking_type: 2, o_status: "Pending", driver_notify_sent: false, priority_notify_sent: false, schedule_date_time: "2026-09-22T15:00:00.000Z", uid: 1 },
    ]);
    prisma.pkg_order_interest.findMany.mockResolvedValueOnce([{ rider_id: 5 }, { rider_id: 6 }]);

    await tripLifecycle.dispatchDueScheduledOrders();

    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10 }), [5, 6], expect.anything(), expect.anything()
    );
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({ priority_notify_sent: true }),
    });
  });

  it("skips straight to the fallback cascade when the order goes live with zero interested riders", async () => {
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 11, booking_type: 2, o_status: "Pending", driver_notify_sent: false, priority_notify_sent: false, schedule_date_time: "2026-09-22T15:00:00.000Z", uid: 1 },
    ]);
    prisma.pkg_order_interest.findMany.mockResolvedValueOnce([]);

    await tripLifecycle.dispatchDueScheduledOrders();

    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ driver_notify_sent: true }),
    });
  });

  it("starts the fallback cascade once the 15-minute priority window has elapsed unaccepted", async () => {
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      {
        id: 12, booking_type: 2, o_status: "Pending", driver_notify_sent: false,
        priority_notify_sent: true, priority_started_at: new Date(NOW - 15 * 60 * 1000),
        schedule_date_time: "2026-09-22T15:00:00.000Z", uid: 1,
      },
    ]);

    await tripLifecycle.dispatchDueScheduledOrders();

    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({ driver_notify_sent: true }),
    });
  });

  it("does not touch an order whose priority window hasn't elapsed yet", async () => {
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      {
        id: 13, booking_type: 2, o_status: "Pending", driver_notify_sent: false,
        priority_notify_sent: true, priority_started_at: new Date(NOW - 5 * 60 * 1000),
        schedule_date_time: "2026-09-22T15:00:00.000Z", uid: 1,
      },
    ]);

    await tripLifecycle.dispatchDueScheduledOrders();

    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });

  it("ignores an order that hasn't reached its 30-minute go-live lead yet", async () => {
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 14, booking_type: 2, o_status: "Pending", driver_notify_sent: false, priority_notify_sent: false, schedule_date_time: "2026-09-22T15:05:00.000Z", uid: 1 },
    ]);

    await tripLifecycle.dispatchDueScheduledOrders();

    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });
});

describe("finalizeAcceptedOrder — late-accept customer warning (booking_type=2)", () => {
  it("sends the late-pickup push when the accepting driver has less than 10 minutes of buffer left", async () => {
    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-09-22T14:52:00.000Z").getTime());
    // ...existing finalizeAcceptedOrder test setup for a successful accept,
    // with the order's schedule_date_time set to "2026-09-22T15:00:00.000Z"
    // (8 minutes of buffer left — under the 10-minute threshold)...

    await tripLifecycle.finalizeAcceptedOrder(/* existing args this file's other finalizeAcceptedOrder tests already use */);

    expect(pushNotifier.notifyCustomerLatePickup).toHaveBeenCalled();
  });

  it("does not send it when there's plenty of buffer, or for non-scheduled orders", async () => {
    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-09-22T14:00:00.000Z").getTime());
    // ...same setup, schedule_date_time "2026-09-22T15:00:00.000Z" (60 min buffer)...

    await tripLifecycle.finalizeAcceptedOrder(/* same args */);

    expect(pushNotifier.notifyCustomerLatePickup).not.toHaveBeenCalled();
  });
});
```

The `finalizeAcceptedOrder` tests above reference "existing setup" — this file already has full working tests for `finalizeAcceptedOrder`'s success path (pricing, `advance_payment`, admin notify); copy that existing setup rather than rebuilding it, and just add the `schedule_date_time` field to the mocked order plus the new assertion. Mock `dispatchManager.offerToInterestedRiders` and `pushNotifier.notifyCustomerLatePickup`/`notifyCustomerOrderLive` at this file's existing `jest.mock(...)` block for those modules.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tripLifecycle.test.js -t "priority sweep|late-accept"`
Expected: FAIL — current `dispatchDueScheduledOrders` has no priority-window logic; `notifyCustomerLatePickup` is never called.

- [ ] **Step 3: Rewrite `dispatchDueScheduledOrders`**

In `backend/src/services/tripLifecycle.js`, replace the existing function (currently lines 1287-1314, the one with the `// STEP 2 (PHP): actually dispatch...` comment) with:

```js
// STEP 2: once schedule_date_time is within SCHEDULED_ORDER_GO_LIVE_LEAD_MS,
// the order "goes live" — see docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md
// §3/§6. Drivers who marked interest (pkg_order_interest) get first crack
// via a 15-minute priority-only window (dispatchManager.offerToInterestedRiders);
// only once that elapses unaccepted (or if nobody was interested to begin
// with) does this fall back to the exact same radius-based cascade every
// instant order already uses (dispatchManager.startDispatch) — untouched
// by this feature.
async function dispatchDueScheduledOrders() {
  let candidates;
  try {
    candidates = await prisma.pkg_order.findMany({
      where: { booking_type: 2, o_status: "Pending", driver_notify_sent: false },
    });
  } catch (err) {
    logger.error("dispatchDueScheduledOrders: failed to query candidates:", err);
    return;
  }

  const now = Date.now();
  for (const order of candidates) {
    const scheduleMs = order.schedule_date_time ? Date.parse(order.schedule_date_time) : NaN;
    // No parseable time -> treat as immediately due, same fallback the
    // pre-existing behavior used (see the historical note this replaces:
    // ShifterOnline previously never sent schedule_date_time at all).
    const isLive = Number.isNaN(scheduleMs) || (scheduleMs - now) <= SCHEDULED_ORDER_GO_LIVE_LEAD_MS;
    if (!isLive) continue;

    try {
      if (!order.priority_notify_sent) {
        const interestRows = await prisma.pkg_order_interest.findMany({ where: { order_id: order.id } });
        const interestedRiderIds = interestRows.map((r) => Number(r.rider_id));

        if (interestedRiderIds.length > 0) {
          const { pkg, discount } = await pricingEngine.getFirstTierPricingContext(order);
          await dispatchManager.offerToInterestedRiders(order, interestedRiderIds, pkg, discount);
          await prisma.pkg_order.update({
            where: { id: order.id },
            data: { priority_notify_sent: true, priority_started_at: new Date() },
          });
          pushNotifier.notifyCustomerOrderLive(order).catch((err) =>
            logger.error(`dispatchDueScheduledOrders: notifyCustomerOrderLive failed for order ${order.id}:`, err)
          );
          logger.info(`dispatchDueScheduledOrders: order ${order.id} went live — priority offer sent to ${interestedRiderIds.length} interested rider(s)`);
          continue;
        }

        // Nobody interested — no priority window to wait out, go straight
        // to the fallback cascade this same tick.
        await prisma.pkg_order.update({ where: { id: order.id }, data: { driver_notify_sent: true } });
        dispatchManager.startDispatch(order).catch((err) =>
          logger.error(`dispatchDueScheduledOrders: fallback dispatch failed to start for order ${order.id}:`, err)
        );
        pushNotifier.notifyCustomerOrderLive(order).catch((err) =>
          logger.error(`dispatchDueScheduledOrders: notifyCustomerOrderLive failed for order ${order.id}:`, err)
        );
        logger.info(`dispatchDueScheduledOrders: order ${order.id} went live — no interested riders, fallback dispatch started`);
        continue;
      }

      // Priority window already started on an earlier tick — check whether
      // it's elapsed.
      const priorityStartedMs = order.priority_started_at ? new Date(order.priority_started_at).getTime() : now;
      if ((now - priorityStartedMs) < SCHEDULED_ORDER_PRIORITY_WINDOW_MS) continue;

      await prisma.pkg_order.update({ where: { id: order.id }, data: { driver_notify_sent: true } });
      dispatchManager.startDispatch(order).catch((err) =>
        logger.error(`dispatchDueScheduledOrders: fallback dispatch failed to start for order ${order.id}:`, err)
      );
      logger.info(`dispatchDueScheduledOrders: order ${order.id} priority window elapsed unaccepted — fallback dispatch started`);
    } catch (err) {
      logger.error(`dispatchDueScheduledOrders: failed for order ${order.id}:`, err);
    }
  }
}
```

Add `priority_started_at DateTime?` to the `pkg_order` Prisma model (Task 1's migration should have included this — go back and add it there if missed, in the same migration; do not create a second migration for one forgotten column). Add `SCHEDULED_ORDER_GO_LIVE_LEAD_MS` and `SCHEDULED_ORDER_PRIORITY_WINDOW_MS` to this file's existing constants import at the top.

Check whether `pricingEngine` already exposes something equivalent to a
"first-tier pricing context for an order" (`createOrderCore` in
`orderController.js:210-216` already computes `firstPkg`/discount for a
new order — check if that logic is already factored into a reusable
`pricingEngine` function; if not, add a small
`pricingEngine.getFirstTierPricingContext(order)` that loads the order's
cheapest-tier package (`order.delivery_type` or the first id in
`JSON.parse(order.allowed_delivery_types)`) and the customer's active
plan discount, mirroring what `createOrderCore` already does for a fresh
order — reuse that exact logic rather than re-deriving it differently
here).

- [ ] **Step 4: Add the late-accept customer push to `finalizeAcceptedOrder`**

In `backend/src/services/tripLifecycle.js`, in `finalizeAcceptedOrder` (the function documented at lines 155-254), right after the existing customer notification call near the end (the `notifyAdminStatus(order)` / customer FCM section around line 210-238), add:

```js
  if (Number(order.booking_type) === 2 && order.schedule_date_time) {
    const scheduleMs = Date.parse(order.schedule_date_time);
    if (!Number.isNaN(scheduleMs) && (scheduleMs - Date.now()) < SCHEDULED_ORDER_LATE_ACCEPT_BUFFER_MS) {
      pushNotifier.notifyCustomerLatePickup(customer?.fcm_token, orderId, order.schedule_date_time).catch((err) =>
        logger.error(`finalizeAcceptedOrder: notifyCustomerLatePickup failed for order ${orderId}:`, err)
      );
    }
  }
```

(Place this after the existing `const customer = await prisma.tbl_user.findUnique(...)` line already in this function, so `customer` is in scope — check the exact line this sits at, around 238, before writing the insert point.) Add `SCHEDULED_ORDER_LATE_ACCEPT_BUFFER_MS` to this file's constants import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tripLifecycle.test.js`
Expected: PASS — including every pre-existing test in this file.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/services/__tests__/tripLifecycle.test.js backend/src/services/pricingEngine.js backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: two-stage priority/fallback sweep for scheduled orders + late-accept customer warning"
```

---

### Task 5: `pushNotifier` — customer "order live" and "may be late" pushes

**Files:**
- Modify: `backend/src/services/pushNotifier.js`
- Test: `backend/src/services/__tests__/pushNotifier.test.js` (create if this file doesn't already exist — check first; if `pushNotifier` has no existing test file, mirror the mocking pattern from `dispatchManager.test.js`'s push-related assertions instead of building a new harness from scratch)

**Interfaces:**
- Produces: `notifyCustomerOrderLive(order)`, `notifyCustomerLatePickup(fcmToken, orderId, scheduleDateTime)` — both consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/__tests__/pushNotifier.test.js (new or appended)
const pushNotifier = require("../pushNotifier");

// Mirror this file's/sibling test files' existing sendPushNotification mock
// pattern — check pushNotifier.js's own sendPushNotification implementation
// (likely Firebase Admin) and mock at that boundary, same as any existing
// push-related test elsewhere in the suite already does.
jest.mock("../../config/firebase", () => ({
  messaging: () => ({ send: jest.fn().mockResolvedValue("ok") }),
}));

describe("notifyCustomerOrderLive", () => {
  it("sends a push naming the order id", async () => {
    const order = { id: 55, uid: 1 };
    // customer fcm_token lookup — check how notifyCustomerScheduleReminder's
    // existing tests (if any) source it; if notifyCustomerOrderLive itself
    // is responsible for the DB lookup rather than the caller, mock
    // prisma.tbl_user.findUnique accordingly.
    await expect(pushNotifier.notifyCustomerOrderLive(order)).resolves.not.toThrow();
  });
});

describe("notifyCustomerLatePickup", () => {
  it("sends a push mentioning the order id and schedule time", async () => {
    await expect(
      pushNotifier.notifyCustomerLatePickup("fcm-token-123", 55, "2026-09-22T15:00:00.000Z")
    ).resolves.not.toThrow();
  });
});
```

Before finalizing this test, open `backend/src/services/pushNotifier.js` in full and check whether existing functions like `notifyCustomerScheduleReminder` take an `fcmToken` directly (as its signature at line 110 shows) or look it up themselves — match that exact convention for the two new functions rather than inventing a different calling convention. Adjust the test and Task 4's call sites (Step 4/Step 3 above) accordingly if this differs from what's assumed there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest pushNotifier.test.js`
Expected: FAIL — `notifyCustomerOrderLive` / `notifyCustomerLatePickup` are not functions.

- [ ] **Step 3: Implement**

In `backend/src/services/pushNotifier.js`, add two functions following the exact style of the existing `notifyCustomerScheduleReminder` (line 110-117):

```js
async function notifyCustomerOrderLive(order) {
  const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
  if (!customer?.fcm_token) return;
  return sendPushNotification(
    customer.fcm_token,
    "Finding your driver",
    `We're now finding a driver for your scheduled order #${order.id}.`,
    { type: "schedule_live", order_id: String(order.id) }
  );
}

async function notifyCustomerLatePickup(fcmToken, orderId, scheduleDateTime) {
  if (!fcmToken) return;
  return sendPushNotification(
    fcmToken,
    "Pickup may run a few minutes late",
    `Your driver for order #${orderId} was assigned close to your requested pickup time and may arrive a few minutes after it.`,
    { type: "schedule_late_pickup", order_id: String(orderId), schedule_date_time: scheduleDateTime || "" }
  );
}
```

(If `prisma` isn't already imported at the top of `pushNotifier.js`, check how `sendPushNotification` itself sources tokens elsewhere in the file first — this file may deliberately take tokens as parameters everywhere and never query Prisma itself, in which case change `notifyCustomerOrderLive`'s signature to `notifyCustomerOrderLive(fcmToken, orderId)` instead, matching the file's actual convention, and update Task 4 Step 3's call site to pass `order.uid`'s looked-up token the same way `finalizeAcceptedOrder` already does for its own customer push.)

Add both to this file's `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest pushNotifier.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pushNotifier.js backend/src/services/__tests__/pushNotifier.test.js
git commit -m "feat: add customer order-live and late-pickup push notifications"
```

---

### Task 6: Driver API — list scheduled trips, mark/remove interest

**Files:**
- Create: `backend/src/controllers/driverScheduledTripsController.js`
- Modify: `backend/src/routes/riderRoutes.js`
- Test: `backend/src/controllers/__tests__/driverScheduledTripsController.test.js`

**Interfaces:**
- Produces: `listScheduledTrips(req, res)`, `markInterest(req, res)`, `removeInterest(req, res)` — Express handlers. Consumed by Task 8 (driver app's REST calls).
- Routes: `POST /driver/scheduled-trips` (list), `POST /driver/scheduled-trips/interest` (mark), `POST /driver/scheduled-trips/interest/remove` (remove) — POST-only, body-driven, matching this router's existing convention (no REST verbs, no auth middleware beyond what's already standard here — see `riderController.packageListForDriver`'s `uid`-in-body pattern).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/controllers/__tests__/driverScheduledTripsController.test.js
const { listScheduledTrips, markInterest, removeInterest } = require("../driverScheduledTripsController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  pkg_order_interest: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
}));

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("listScheduledTrips", () => {
  it("returns 401-shaped error when uid is missing", async () => {
    const res = mockRes();
    await listScheduledTrips({ body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("lists pending booking_type=2 orders in the rider's own category and city, within 7 days, marking which ones the rider is already interested in", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValueOnce({ id: 7, vehicle: "Bike", city_id: 3 });
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 100, category: "Bike", city_id: 3, schedule_date_time: "2026-09-22T15:00:00.000Z", paddress: "A", daddress: "B", total_dcharge: 120 },
    ]);
    prisma.pkg_order_interest.findMany.mockResolvedValueOnce([{ order_id: 100, rider_id: 7 }]);

    const res = mockRes();
    await listScheduledTrips({ body: { uid: 7 } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ResponseCode: "200",
      TripData: [expect.objectContaining({ id: "100", is_interested: "1" })],
    }));
  });
});

describe("markInterest", () => {
  it("requires uid and order_id", async () => {
    const res = mockRes();
    await markInterest({ body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("upserts a pkg_order_interest row", async () => {
    prisma.pkg_order_interest.create.mockResolvedValueOnce({});
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.create).toHaveBeenCalledWith({
      data: { order_id: 100, rider_id: 7 },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "200" }));
  });

  it("treats a duplicate mark (unique constraint) as success, not an error", async () => {
    prisma.pkg_order_interest.create.mockRejectedValueOnce({ code: "P2002" });
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "200" }));
  });
});

describe("removeInterest", () => {
  it("deletes the rider's interest row for the order", async () => {
    prisma.pkg_order_interest.deleteMany.mockResolvedValueOnce({ count: 1 });
    const res = mockRes();
    await removeInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.deleteMany).toHaveBeenCalledWith({
      where: { order_id: 100, rider_id: 7 },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "200" }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest driverScheduledTripsController.test.js`
Expected: FAIL — the controller module doesn't exist yet.

- [ ] **Step 3: Implement the controller**

```js
// backend/src/controllers/driverScheduledTripsController.js
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Driver-facing browse + interest-marking for booking_type=2 scheduled
// orders — see docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md
// §8. Follows this router's existing body-driven convention (riderController.js's
// packageListForDriver etc.) rather than path params/REST verbs.

async function listScheduledTrips(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    if (!riderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid is required" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { vehicle: true, city_id: true } });
    if (!rider) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Rider not found" });
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const orders = await prisma.pkg_order.findMany({
      where: {
        booking_type: 2,
        o_status: "Pending",
        rid: 0,
        category: rider.vehicle,
        ...(rider.city_id ? { city_id: rider.city_id } : {}),
      },
      orderBy: { schedule_date_time: "asc" },
    });

    const inWindow = orders.filter((o) => {
      const ms = o.schedule_date_time ? Date.parse(o.schedule_date_time) : NaN;
      return !Number.isNaN(ms) && ms >= now.getTime() && ms <= horizon.getTime();
    });

    const interestRows = inWindow.length
      ? await prisma.pkg_order_interest.findMany({
          where: { order_id: { in: inWindow.map((o) => o.id) }, rider_id: riderId },
        })
      : [];
    const interestedOrderIds = new Set(interestRows.map((r) => r.order_id));

    const tripData = inWindow.map((o) => ({
      id: String(o.id),
      category: o.category,
      pickup_address: o.paddress || "",
      delivery_address: o.daddress || "",
      schedule_date_time: o.schedule_date_time,
      estimated_fare: String(o.total_dcharge),
      is_interested: interestedOrderIds.has(o.id) ? "1" : "0",
    }));

    return res.status(200).json({ TripData: tripData, ResponseCode: "200", Result: "true", ResponseMsg: "Scheduled Trips Fetched Successfully" });
  } catch (err) {
    logger.error("listScheduledTrips failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function markInterest(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!riderId || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid and order_id are required" });
    }

    try {
      await prisma.pkg_order_interest.create({ data: { order_id: orderId, rider_id: riderId } });
    } catch (err) {
      // P2002 = Prisma unique-constraint violation — the rider already
      // marked interest, which is not an error from the app's point of
      // view (idempotent tap of the same button).
      if (err.code !== "P2002") throw err;
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Marked as interested" });
  } catch (err) {
    logger.error("markInterest failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function removeInterest(req, res) {
  try {
    const riderId = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!riderId || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid and order_id are required" });
    }

    await prisma.pkg_order_interest.deleteMany({ where: { order_id: orderId, rider_id: riderId } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Interest removed" });
  } catch (err) {
    logger.error("removeInterest failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { listScheduledTrips, markInterest, removeInterest };
```

- [ ] **Step 4: Wire the routes**

In `backend/src/routes/riderRoutes.js`, add near the other driver-facing order endpoints (around line 37, next to `router.post("/package-list", ...)`):

```js
const driverScheduledTripsController = require("../controllers/driverScheduledTripsController");
```

and, in the route list:

```js
router.post("/scheduled-trips", driverScheduledTripsController.listScheduledTrips);
router.post("/scheduled-trips/interest", driverScheduledTripsController.markInterest);
router.post("/scheduled-trips/interest/remove", driverScheduledTripsController.removeInterest);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest driverScheduledTripsController.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/driverScheduledTripsController.js backend/src/controllers/__tests__/driverScheduledTripsController.test.js backend/src/routes/riderRoutes.js
git commit -m "feat: add driver-facing scheduled-trips list and interest endpoints"
```

---

### Task 7: Admin — "Interested" count on `ScheduledOrders.jsx`

**Files:**
- Modify: `backend/src/controllers/adminOrderController.js` (`listScheduled`, lines 423-436)
- Modify: `frontend/src/pages/ScheduledOrders.jsx`
- Test: `backend/src/controllers/__tests__/adminOrderController.test.js`

**Interfaces:**
- Modifies `listScheduled`'s response shape: each row in `data` gains an `interested_count` integer field. Purely additive — no existing field removed.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/controllers/__tests__/adminOrderController.test.js` (near this file's existing `listScheduled` tests, if any — check first; if none exist yet, add this as the first one, following the mocking conventions the file's `listNextDay`/`assignScheduledDriver` tests already use):

```js
it("listScheduled includes an interested_count per order", async () => {
  prisma.pkg_order.findMany.mockResolvedValueOnce([{ id: 100, booking_type: 2 }]);
  prisma.pkg_order_interest.groupBy.mockResolvedValueOnce([{ order_id: 100, _count: { order_id: 2 } }]);

  const res = mockRes();
  await adminOrderController.listScheduled({ query: {} }, res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    data: [expect.objectContaining({ id: 100, interested_count: 2 })],
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest adminOrderController.test.js -t "interested_count"`
Expected: FAIL — `interested_count` not present in the response.

- [ ] **Step 3: Implement**

In `backend/src/controllers/adminOrderController.js`'s `listScheduled` (lines 423-436), change:

```js
    const rows = await prisma.pkg_order.findMany({ where, orderBy: { schedule_date_time: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
```

to:

```js
    const rows = await prisma.pkg_order.findMany({ where, orderBy: { schedule_date_time: "asc" } });

    const counts = rows.length
      ? await prisma.pkg_order_interest.groupBy({
          by: ["order_id"],
          where: { order_id: { in: rows.map((r) => r.id) } },
          _count: { order_id: true },
        })
      : [];
    const countByOrderId = new Map(counts.map((c) => [c.order_id, c._count.order_id]));
    const rowsWithInterest = rows.map((r) => ({ ...r, interested_count: countByOrderId.get(r.id) || 0 }));

    return res.status(200).json({ success: true, total: rowsWithInterest.length, data: rowsWithInterest });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest adminOrderController.test.js`
Expected: PASS.

- [ ] **Step 5: Add the column to the admin UI**

In `frontend/src/pages/ScheduledOrders.jsx`, add `'Interested'` to the header array (line 36, after `'Driver'`):

```jsx
{['Order', 'Category', 'Pickup', 'Scheduled for', 'Fare', 'Status', 'Driver', 'Interested', ''].map((h) => (
```

And a corresponding cell in the row map (after the existing Driver `<td>`, around line 93-94):

```jsx
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.interested_count > 0 ? `${o.interested_count} interested` : '—'}
                    </td>
```

Update every `colSpan={8}` in this file's loading/error/empty-state rows to `colSpan={9}` (one new column added) — three occurrences (lines 47, 54, 61).

- [ ] **Step 6: Manual check**

Run the admin frontend dev server, open Scheduled Orders, confirm the new column renders (0/blank state is fine without Task 6's driver-side interest-marking having been exercised yet).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/adminOrderController.js backend/src/controllers/__tests__/adminOrderController.test.js frontend/src/pages/ScheduledOrders.jsx
git commit -m "feat: show interested-driver count on admin Scheduled Orders page"
```

---

### Task 8: Driver app (Android) — render scheduled pickup time in the popup

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java`

**Interfaces:**
- Consumes: `orderData.get("order_date")` / `orderData.get("schedule_date_time")` — both already populated today by `SocketOrderRouter.mapOrderRequestData`'s existing pass-through + explicit `order_date ← schedule_date_time` mapping (`SocketOrderRouter.java:119-124,139`); Task 3 is what starts actually putting a non-empty `schedule_date_time` into `order:request` payloads for `booking_type=2` orders, so this is the first time that existing mapping carries real data.

- [ ] **Step 1: Add the scheduled-pickup subtitle**

In `OrderDialogHelper.java`'s `showOrderDialog` (around line 152-163, right after the existing `isDirectAssign` subtitle-setting block), add:

```java
        String scheduleDateTime = getMapValue(orderData, "schedule_date_time", getMapValue(orderData, "order_date", null));
        if (scheduleDateTime != null && !scheduleDateTime.isEmpty()) {
            android.widget.TextView txtSubtitle = view.findViewById(com.shifter.driver.R.id.txt_header_subtitle);
            if (txtSubtitle != null) {
                txtSubtitle.setText("Scheduled pickup: " + formatScheduleLabel(scheduleDateTime));
                txtSubtitle.setVisibility(android.view.View.VISIBLE);
            }
        }
```

Add the small formatting helper as a private static method in the same class:

```java
    /**
     * schedule_date_time arrives as an ISO-8601 string (see
     * ShifterOnline's select_vehicle.dart DateTime.toIso8601String() and
     * backend's Date.parse() usage) — this only needs to be
     * human-readable in the popup, not machine-parsed again anywhere in
     * this app, so a lenient best-effort format is fine: fall back to the
     * raw string if parsing fails rather than showing nothing.
     */
    private static String formatScheduleLabel(String isoDateTime) {
        try {
            java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            java.util.Date parsed = iso.parse(isoDateTime.length() >= 19 ? isoDateTime.substring(0, 19) : isoDateTime);
            java.text.SimpleDateFormat display = new java.text.SimpleDateFormat("EEE, d MMM Ãÿ h:mm a", java.util.Locale.US);
            return display.format(parsed);
        } catch (Exception e) {
            return isoDateTime;
        }
    }
```

(If the codebase already has a shared date-formatting utility used elsewhere in this app — check `com.shifter.driver.utility` for an existing `DateUtils`/`TimeUtils`-style class before adding a new one-off formatter here; reuse it if present, following its existing method rather than adding a parallel one.)

- [ ] **Step 2: Manual verification**

This has no existing Android test harness to extend (checked: no JUnit/Espresso test files reference `OrderDialogHelper` in this module). Verify manually:
- Trigger a normal instant-order popup (existing behavior) — confirm the subtitle is unaffected (no `schedule_date_time` in that payload, so the new block is skipped).
- Once Task 3/4/6 are live end-to-end, trigger a scheduled-order priority or fallback popup and confirm the subtitle reads "Scheduled pickup: <formatted time>".

- [ ] **Step 3: Commit**

```bash
git add ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java
git commit -m "feat: show scheduled pickup time in the driver order popup"
```

---

### Task 9: Driver app (Android) — "Scheduled Trips" browse + interest screen

**Files:**
- Create: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/ScheduledTripsActivity.java`
- Create: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/adapter/ScheduledTripsAdapter.java`
- Create: `ShifterDriver/ShifterDriver/app/src/main/res/layout/activity_scheduled_trips.xml`
- Create: `ShifterDriver/ShifterDriver/app/src/main/res/layout/item_scheduled_trip.xml`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/HomeActivity.java` (nav entry)
- Modify: `ShifterDriver/ShifterDriver/app/src/main/AndroidManifest.xml` (register the new Activity)

**Interfaces:**
- Consumes: `POST /driver/scheduled-trips`, `POST /driver/scheduled-trips/interest`, `POST /driver/scheduled-trips/interest/remove` (Task 6).

Before writing this task's code, read `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/OrderItleListActivity.java` in full to copy this app's actual existing HTTP-client pattern (this repo's driver app doesn't use Retrofit anywhere confirmed so far — check whether it's Volley, OkHttp directly, or a custom `ApiClient` wrapper class, and what base-URL constant it reads) and its existing `RecyclerView`/adapter wiring style, so the new Activity/adapter match established conventions exactly rather than introducing a second networking pattern into the app. Substitute the real client calls below with whatever that file actually shows — the structure (list endpoint → bind rows → tap toggles interest → re-render that row) stays the same regardless of which HTTP client this app uses.

- [ ] **Step 1: Layouts**

```xml
<!-- activity_scheduled_trips.xml -->
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <androidx.appcompat.widget.Toolbar
        android:id="@+id/toolbar"
        android:layout_width="match_parent"
        android:layout_height="?attr/actionBarSize"
        android:title="Scheduled Trips" />

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/recycler_scheduled_trips"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />

    <TextView
        android:id="@+id/txt_empty_state"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center"
        android:padding="24dp"
        android:text="No scheduled trips right now."
        android:visibility="gone" />

</LinearLayout>
```

```xml
<!-- item_scheduled_trip.xml -->
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="16dp">

    <TextView
        android:id="@+id/txt_schedule_time"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:textStyle="bold" />

    <TextView
        android:id="@+id/txt_pickup"
        android:layout_width="match_parent"
        android:layout_height="wrap_content" />

    <TextView
        android:id="@+id/txt_fare"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content" />

    <Button
        android:id="@+id/btn_interest_toggle"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="end" />

</LinearLayout>
```

- [ ] **Step 2: Adapter**

```java
package com.shifter.driver.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ScheduledTripsAdapter extends RecyclerView.Adapter<ScheduledTripsAdapter.ViewHolder> {

    public interface OnInterestToggle {
        void onToggle(JSONObject trip, boolean nowInterested);
    }

    private final List<JSONObject> trips = new ArrayList<>();
    private final OnInterestToggle listener;

    public ScheduledTripsAdapter(OnInterestToggle listener) {
        this.listener = listener;
    }

    public void setTrips(List<JSONObject> newTrips) {
        trips.clear();
        trips.addAll(newTrips);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_scheduled_trip, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        JSONObject trip = trips.get(position);
        holder.scheduleTime.setText(trip.optString("schedule_date_time", ""));
        holder.pickup.setText(trip.optString("pickup_address", ""));
        holder.fare.setText("₹" + trip.optString("estimated_fare", "0"));

        boolean interested = "1".equals(trip.optString("is_interested", "0"));
        holder.interestToggle.setText(interested ? "Interested ✓" : "I'm Interested");
        holder.interestToggle.setOnClickListener(v -> {
            boolean nowInterested = !interested;
            try {
                trip.put("is_interested", nowInterested ? "1" : "0");
            } catch (Exception ignored) {}
            holder.interestToggle.setText(nowInterested ? "Interested ✓" : "I'm Interested");
            if (listener != null) listener.onToggle(trip, nowInterested);
        });
    }

    @Override
    public int getItemCount() {
        return trips.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView scheduleTime;
        final TextView pickup;
        final TextView fare;
        final Button interestToggle;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            scheduleTime = itemView.findViewById(R.id.txt_schedule_time);
            pickup = itemView.findViewById(R.id.txt_pickup);
            fare = itemView.findViewById(R.id.txt_fare);
            interestToggle = itemView.findViewById(R.id.btn_interest_toggle);
        }
    }
}
```

- [ ] **Step 3: Activity**

Read `OrderItleListActivity.java` first (per this task's header note) and replace the two `TODO_NETWORK_CALL` markers below with that file's actual HTTP-client call pattern (its base URL constant, request-building helper, and callback/response shape) — these markers are explicitly not final code, they're the two integration points this task's own "no placeholders" bar depends on you filling from a real reference:

```java
package com.shifter.driver;

import android.os.Bundle;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.adapter.ScheduledTripsAdapter;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Browse upcoming booking_type=2 scheduled trips and mark interest ahead of
 * time — see docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md
 * §8. Interest is non-binding: it only affects whether this driver gets the
 * 15-minute priority popup window when the order goes live
 * (dispatchManager.offerToInterestedRiders on the backend) — it does not
 * reserve or lock the trip.
 */
public class ScheduledTripsActivity extends AppCompatActivity {

    private ScheduledTripsAdapter adapter;
    private int riderId;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_scheduled_trips);

        riderId = com.shifter.driver.utility.SessionManager.getInstance(this).getRiderId(); // match this app's actual session-storage accessor — verify name against an existing Activity's usage before assuming it's called this.

        RecyclerView recycler = findViewById(R.id.recycler_scheduled_trips);
        recycler.setLayoutManager(new LinearLayoutManager(this));
        adapter = new ScheduledTripsAdapter(this::onToggleInterest);
        recycler.setAdapter(adapter);

        loadTrips();
    }

    private void loadTrips() {
        JSONObject body = new JSONObject();
        try {
            body.put("uid", riderId);
        } catch (Exception ignored) {}

        // TODO_NETWORK_CALL: POST body to "<base-url>/driver/scheduled-trips",
        // matching OrderItleListActivity's existing request-sending helper
        // exactly (its method name, callback interface, and how it reads
        // BASE_URL) rather than the placeholder below.
        // onScheduledTripsResponse(responseJson) is the callback this
        // Activity expects once that real call is wired in.
    }

    private void onScheduledTripsResponse(JSONObject response) {
        List<JSONObject> trips = new ArrayList<>();
        JSONArray tripData = response.optJSONArray("TripData");
        if (tripData != null) {
            for (int i = 0; i < tripData.length(); i++) {
                JSONObject trip = tripData.optJSONObject(i);
                if (trip != null) trips.add(trip);
            }
        }
        adapter.setTrips(trips);
        findViewById(R.id.txt_empty_state).setVisibility(trips.isEmpty() ? android.view.View.VISIBLE : android.view.View.GONE);
    }

    private void onToggleInterest(JSONObject trip, boolean nowInterested) {
        String orderId = trip.optString("id", "");
        if (orderId.isEmpty()) return;

        JSONObject body = new JSONObject();
        try {
            body.put("uid", riderId);
            body.put("order_id", orderId);
        } catch (Exception ignored) {}

        String endpoint = nowInterested ? "/driver/scheduled-trips/interest" : "/driver/scheduled-trips/interest/remove";
        // TODO_NETWORK_CALL: POST body to "<base-url>" + endpoint, same
        // client pattern as loadTrips() above. On failure, revert the
        // adapter's optimistic toggle and show a Toast — mirror how
        // OrderItleListActivity (or wherever else this app already does an
        // optimistic-then-revert-on-failure toggle, if it has one)
        // structures that, rather than leaving the UI in a state that
        // silently disagrees with the backend.
    }
}
```

- [ ] **Step 4: Wire navigation**

In `HomeActivity.java`, add an entry point to `ScheduledTripsActivity` — the design spec (§8) explicitly leaves exact placement (bottom nav item vs. a button inside `HomeFragment`) as an implementation-time call. Given the existing bottom nav already has 5 fixed slots (home, orders, wallet, notification, account — per this repo's own `HomeActivity.java:259-293`), adding a 6th tab would require redesigning that bar; the lower-risk option is a button/list item inside `HomeFragment` (or a menu item on the existing `OrderActivity`/orders list) that starts `ScheduledTripsActivity` via a plain `startActivity(new Intent(this, ScheduledTripsActivity.class))`. Open `HomeFragment`'s layout to find an appropriate existing action row/menu to extend before adding a new one.

- [ ] **Step 5: Register the Activity**

In `AndroidManifest.xml`, add:

```xml
<activity android:name=".ScheduledTripsActivity" android:exported="false" />
```

(Match the `exported`/theme attributes an existing sibling Activity declaration uses, rather than assuming `false` is correct for every case — check e.g. `OrderItleListActivity`'s own manifest entry first.)

- [ ] **Step 6: Manual smoke test**

Build and run the driver app. From the new entry point, open Scheduled Trips, confirm the list loads (may be empty until Phase A/Task 1-7 have real scheduled orders in the system), tap "I'm Interested" on a trip, confirm the button flips to "Interested ✓", relaunch the screen and confirm the state persisted (re-fetches `is_interested: "1"` from the backend).

- [ ] **Step 7: Commit**

```bash
git add ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/ScheduledTripsActivity.java ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/adapter/ScheduledTripsAdapter.java ShifterDriver/ShifterDriver/app/src/main/res/layout/activity_scheduled_trips.xml ShifterDriver/ShifterDriver/app/src/main/res/layout/item_scheduled_trip.xml ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/HomeActivity.java ShifterDriver/ShifterDriver/app/src/main/AndroidManifest.xml
git commit -m "feat: add Scheduled Trips browse and interest-marking screen to driver app"
```

---

## Self-Review Notes

- **Spec coverage:** §3 timeline → Task 4 (sweep) + Task 3 (priority offer mechanism). §4 picker → out of scope here, covered by the separate Phase A plan. §5 data model → Task 1. §6 dispatch timing → Task 4. §7 priority popup mechanism → Task 3. §8 driver app → Tasks 8-9. §9 admin → Task 7. §10 testing → a test task accompanies every backend change (Tasks 1, 3-7); Android has no existing test harness for this kind of UI, so Tasks 8-9 rely on the manual smoke tests the spec's own §10 already calls for. §11 non-goals are respected — no per-category tuning, no re-notification, no priority-window admin override added anywhere in this plan.
- **Placeholder scan:** the two `TODO_NETWORK_CALL` markers in Task 9 Step 3 are a deliberate, narrow exception — they mark exactly the two points where this plan cannot know the real answer without a human first reading `OrderItleListActivity.java` (a file this plan's author didn't have open), and the task's own header instructs the implementer to read that file and replace them before writing anything else in that step. Every other step in every task has real, complete code.
- **Type consistency:** `schedule_date_time` (ISO string) flows unchanged from Task 3's payload addition → Task 8's popup render → Task 9's list response field name (`schedule_date_time`) and Task 6's controller (same field name). `order_id` vs `id` — Task 6's `pkg_order_interest` rows use `order_id`/`rider_id` consistently across Tasks 1, 3, 4, 6, 7; the driver-app JSON list response uses `id` for the order's own id (matching the rest of this app's existing JSON conventions, e.g. `TripData[].id`) — confirmed no task conflates the two.
