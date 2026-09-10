# Next Day Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually-managed "Next Day Booking" flow — customer app creates it, it never enters automatic dispatch, and admin assigns it (individually or as a nearest-neighbor-sequenced batch) to a driver, who gets a forced (no accept/reject) notification.

**Architecture:** One new `booking_type=3` value threaded through the existing Node/Prisma order pipeline. New, separate backend functions/routes/frontend page mirror the existing `booking_type=2` ("Scheduled Orders") admin pattern instead of extending it, so nothing shared with the live automatic-dispatch path is touched. New native-Android socket listener delivers the driver-side notification.

**Tech Stack:** Node/Express/Prisma (MySQL) backend, React admin frontend, Flutter customer app (`ShifterOnline`), native Android driver app (`ShifterDriver`, Java), Socket.IO.

**Spec:** `docs/superpowers/specs/2026-09-10-next-day-booking-design.md`

## Global Constraints

- Every new code path is gated behind `booking_type === 3`. Do not modify `dispatchManager.js`, `tripLifecycle.js`, `adminOrderController.listScheduled`, `adminOrderController.assignScheduledDriver`, or `pages/ScheduledOrders.jsx` — these serve `booking_type=1`/`2` and must stay byte-for-byte unchanged.
- Sequencing distance uses `haversineKm` only — no Google Routes API calls (cost/latency reasons, and it's only a suggestion admin can reorder).
- Next-day driver assignment is forced/informational — no accept/reject affordance anywhere (backend, admin UI copy, or driver app).
- Backend is Node only. Do not add or touch PHP (`Php Backend/`) — the customer app's order-creation call already goes to Node (`ShifterOnline/lib/screens/home/pickupdrop.dart:5672`, `Config.nodeOrderCreate = "api/order/create"`).
- No new npm/pub/gradle dependencies — every task uses libraries already in each project.

---

### Task 1: Add `next_day_sequence` to the Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma:220` (inside `model pkg_order`, right after the `booking_type` field)

**Interfaces:**
- Produces: `pkg_order.next_day_sequence` (`Int?`, nullable), available on every Prisma Client query/update from Task 2 onward.

- [ ] **Step 1: Add the field**

In `backend/prisma/schema.prisma`, inside `model pkg_order`, change:

```prisma
  booking_type           Int?
  city_id                Int?
```

to:

```prisma
  booking_type           Int?
  next_day_sequence      Int?
  city_id                Int?
```

- [ ] **Step 2: Regenerate the Prisma Client**

Run (from `backend/`):
```bash
npx prisma generate
```
Expected: `Generated Prisma Client` with no errors — this updates the typed client so `next_day_sequence` is a valid field in every later task's code, independent of whether a live database is reachable from this machine.

- [ ] **Step 3: Sync the database schema, if a dev database is reachable**

This repo has no `prisma/migrations` history (schema changes are applied with `db push`, not `migrate dev` — confirmed: `ls backend/prisma/` shows only `schema.prisma`). Run:
```bash
npx prisma db push
```
If this fails to connect (no `DATABASE_URL`/no reachable DB from this machine), skip it here and tell whoever owns the deployment to run the same command against the real dev/production database before Task 2's code goes live — `npx prisma generate` in Step 2 is enough for local development and tests to pass.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(db): add next_day_sequence column to pkg_order"
```

---

### Task 2: `createOrderCore` — skip dispatch and auto-set schedule date for `booking_type=3`

**Files:**
- Modify: `backend/src/controllers/orderController.js:11-13` (add helper), `:269-277` (guard dispatch call), and the `pkg_order.create` data block (`:258-259`)
- Test: `backend/src/controllers/__tests__/orderController.test.js`

**Interfaces:**
- Produces: `nextDayScheduleDateIST(now?: Date): string` — pure function, `"YYYY-MM-DD"` for the calendar day after `now`, computed in IST (not server-local/UTC) so the "next day" boundary matches India's calendar day regardless of what timezone the server runs in.
- Consumes: nothing new — reuses `dispatchManager.startDispatch` (already imported) and the existing `createOrderCore` parameters.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/__tests__/orderController.test.js`, inside the existing `describe("orderController.createOrderCore", ...)` block (after the existing tests, using the file's existing `baseInput` and mocks already set up in its `beforeEach`):

```javascript
  it("does not start automatic dispatch for a next-day booking (booking_type 3)", async () => {
    const result = await createOrderCore({ ...baseInput, bookingType: 3 });

    expect(result.ok).toBe(true);
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  it("still starts automatic dispatch for a normal booking (booking_type 1)", async () => {
    const result = await createOrderCore({ ...baseInput, bookingType: 1 });

    expect(result.ok).toBe(true);
    expect(dispatchManager.startDispatch).toHaveBeenCalledTimes(1);
  });

  it("auto-computes tomorrow's date (IST) as schedule_date_time for a next-day booking, ignoring any client-sent value", async () => {
    await createOrderCore({ ...baseInput, bookingType: 3, scheduleDateTime: "should be ignored" });

    expect(prisma.pkg_order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          booking_type: 3,
          schedule_date_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      })
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`):
```bash
npx jest src/controllers/__tests__/orderController.test.js -t "next-day"
```
Expected: FAIL — `does not start automatic dispatch` fails because `dispatchManager.startDispatch` is still called unconditionally; `auto-computes tomorrow's date` fails because `schedule_date_time` is `null` (nothing currently sets it for `bookingType: 3`).

- [ ] **Step 3: Add the `nextDayScheduleDateIST` helper**

In `backend/src/controllers/orderController.js`, right after the existing `isFiniteNumber` function (line 13), add:

```javascript
// Next-day orders have no fixed pickup time (admin assigns a window
// separately) — only the calendar DATE matters, and it must be "tomorrow"
// on India's calendar, not the server's. Render runs UTC (see
// pricingEngine.isNightNow's comment for the same class of bug already
// hit once), so the IST offset is applied explicitly rather than trusting
// server-local time.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function nextDayScheduleDateIST(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCDate(ist.getUTCDate() + 1);
  return ist.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Set `schedule_date_time` for booking_type 3 in the create data**

In `createOrderCore`, the `finalScheduleDateTime` line currently reads (around line 224):

```javascript
  const finalScheduleDateTime = (scheduleDateTime || schedule_date_time) ? String(scheduleDateTime || schedule_date_time) : null;
```

Change it to:

```javascript
  const finalScheduleDateTime = Number(bookingType) === 3
    ? nextDayScheduleDateIST()
    : ((scheduleDateTime || schedule_date_time) ? String(scheduleDateTime || schedule_date_time) : null);
```

- [ ] **Step 5: Skip `dispatchManager.startDispatch` for booking_type 3**

The existing call (around line 269-277) reads:

```javascript
  dispatchManager.startDispatch(order, {
    fare, driverEarning, commission, packageTitle: firstPkg?.title || null,
    // Handed through so dispatchManager can price each eligible driver's own
    // popup off their real pickup distance without a redundant re-fetch of
    // the package row/discount it already looked up for tier 0 above.
    pkg: firstPkg, discount: planDiscount,
  }).catch((err) =>
    logger.error(`createOrderCore: dispatch failed to start for order ${order.id}:`, err)
  );
```

Wrap it in a guard so `booking_type=1`/`2` behavior is unchanged and `booking_type=3` never enters automatic dispatch:

```javascript
  // Next-day orders (booking_type 3) are never auto-dispatched — admin
  // assigns them manually, individually or as a sequenced batch, from the
  // Next Day Orders admin panel. See docs/superpowers/specs/2026-09-10-next-day-booking-design.md §5.
  if (Number(bookingType) !== 3) {
    dispatchManager.startDispatch(order, {
      fare, driverEarning, commission, packageTitle: firstPkg?.title || null,
      pkg: firstPkg, discount: planDiscount,
    }).catch((err) =>
      logger.error(`createOrderCore: dispatch failed to start for order ${order.id}:`, err)
    );
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
npx jest src/controllers/__tests__/orderController.test.js
```
Expected: PASS — all tests in the file, including the 3 new ones and every pre-existing test (confirms `booking_type=1` behavior, the hard constraint, is unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.test.js
git commit -m "feat(orders): next-day bookings skip auto-dispatch and auto-date themselves"
```

---

### Task 3: Nearest-neighbor sequencing utility

**Files:**
- Modify: `backend/src/utils/geoDistance.js` (add function + export)
- Test: `backend/src/utils/__tests__/geoDistance.test.js` (new file)

**Interfaces:**
- Produces: `buildNextDaySequence(driverLat: number, driverLng: number, orders: Array<{id: number, plat: string|number, plong: string|number, dlat: string|number, dlong: string|number}>): Array<{order_id: number, pickup_distance_km: number}>` — greedy nearest-pickup chain starting from the driver's position, moving to each chosen order's drop before picking the next.
- Consumes: the existing `haversineKm(lat1, lon1, lat2, lon2)` in the same file.

- [ ] **Step 1: Write the failing test**

Create `backend/src/utils/__tests__/geoDistance.test.js`:

```javascript
const { buildNextDaySequence } = require("../geoDistance");

describe("buildNextDaySequence", () => {
  it("chains nearest-pickup-from-current-position, in order", () => {
    // Driver starts at (0,0). Order A's pickup is at (0,1) [~111km away],
    // order B's pickup is at (0,5) [~555km away]. Driver should go to A
    // first. A's drop is at (0,2) — from there B's pickup (0,5) is now the
    // only one left, so B is next regardless of distance.
    const orders = [
      { id: 100, plat: 0, plong: 5, dlat: 0, dlong: 6 }, // "B" — farther pickup
      { id: 200, plat: 0, plong: 1, dlat: 0, dlong: 2 }, // "A" — nearer pickup
    ];

    const sequence = buildNextDaySequence(0, 0, orders);

    expect(sequence.map((s) => s.order_id)).toEqual([200, 100]);
    expect(sequence[0].pickup_distance_km).toBeGreaterThan(0);
    expect(sequence[1].pickup_distance_km).toBeGreaterThan(0);
  });

  it("returns an empty array for an empty order list", () => {
    expect(buildNextDaySequence(0, 0, [])).toEqual([]);
  });

  it("handles a single order", () => {
    const sequence = buildNextDaySequence(0, 0, [{ id: 1, plat: 0, plong: 1, dlat: 0, dlong: 2 }]);
    expect(sequence).toEqual([{ order_id: 1, pickup_distance_km: expect.any(Number) }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`):
```bash
npx jest src/utils/__tests__/geoDistance.test.js
```
Expected: FAIL with `buildNextDaySequence is not a function`.

- [ ] **Step 3: Implement `buildNextDaySequence`**

In `backend/src/utils/geoDistance.js`, add before the final `module.exports` line:

```javascript
/**
 * Greedy nearest-neighbor route for bundling several next-day orders onto
 * one driver: from the driver's current position, repeatedly pick whichever
 * remaining order's PICKUP is closest, then continue from THAT order's DROP
 * — never re-computes an optimal tour (n is small, e.g. a day's worth of
 * orders, and this is only a suggestion the admin can manually reorder).
 * Straight-line haversine only, not the Google Routes API — see
 * docs/superpowers/specs/2026-09-10-next-day-booking-design.md §7.2 for why.
 */
function buildNextDaySequence(driverLat, driverLng, orders) {
  const remaining = orders.map((o) => ({
    id: o.id,
    pickupLat: Number(o.plat),
    pickupLng: Number(o.plong),
    dropLat: Number(o.dlat),
    dropLng: Number(o.dlong),
  }));

  const sequence = [];
  let currentLat = driverLat;
  let currentLng = driverLng;

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistanceKm = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const distanceKm = haversineKm(currentLat, currentLng, remaining[i].pickupLat, remaining[i].pickupLng);
      if (distanceKm < nearestDistanceKm) {
        nearestDistanceKm = distanceKm;
        nearestIndex = i;
      }
    }
    const next = remaining[nearestIndex];
    sequence.push({ order_id: next.id, pickup_distance_km: Math.round(nearestDistanceKm * 100) / 100 });
    remaining.splice(nearestIndex, 1);
    currentLat = next.dropLat;
    currentLng = next.dropLng;
  }

  return sequence;
}
```

Then change the final line of the file from:
```javascript
module.exports = { haversineKm, getRoadDistanceKm };
```
to:
```javascript
module.exports = { haversineKm, getRoadDistanceKm, buildNextDaySequence };
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx jest src/utils/__tests__/geoDistance.test.js
```
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/geoDistance.js backend/src/utils/__tests__/geoDistance.test.js
git commit -m "feat(geo): add greedy nearest-neighbor sequencing for next-day order batches"
```

---

### Task 4: Admin API — list, suggest-sequence, assign-batch

**Files:**
- Modify: `backend/src/controllers/adminOrderController.js` (add 3 functions + import + exports)
- Modify: `backend/src/routes/adminRoutes.js:76-77` (add 3 routes, before `/orders/:id`)
- Test: `backend/src/controllers/__tests__/adminOrderController.test.js`

**Interfaces:**
- Consumes: `buildNextDaySequence` from Task 3 (`require("../utils/geoDistance")`).
- Produces: `listNextDay(req, res)`, `suggestNextDaySequence(req, res)`, `assignNextDayBatch(req, res)` — exported from `adminOrderController.js`, wired to `GET /orders/next-day`, `POST /orders/next-day/suggest-sequence`, `POST /orders/next-day/assign-batch`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/controllers/__tests__/adminOrderController.test.js`. First extend the top-of-file mocks (the file currently mocks `../../config/db` with only `pkg_order`/`tbl_rider`/`order_status_history`/`$executeRaw` — add the fields these new functions need):

Replace:
```javascript
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  order_status_history: { create: jest.fn() },
  $executeRaw: jest.fn(),
}));
```
with:
```javascript
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  order_status_history: { create: jest.fn() },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
```

Then extend the existing import line (`const { assignRider } = require("../adminOrderController");`) to also pull in the 3 new functions:

```javascript
const { assignRider, listNextDay, suggestNextDaySequence, assignNextDayBatch } = require("../adminOrderController");
```

Then add this new `describe` block at the end of the file, after the existing `describe("adminOrderController.assignRider", ...)` block:

```javascript
describe("adminOrderController next-day orders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listNextDay", () => {
    it("filters to booking_type 3 only", async () => {
      prisma.pkg_order.findMany.mockResolvedValue([{ id: 1, booking_type: 3 }]);
      const req = { query: {}, scopedCityId: null };
      const res = makeRes();

      await listNextDay(req, res);

      expect(prisma.pkg_order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { booking_type: 3 } })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("suggestNextDaySequence", () => {
    it("orders by nearest-pickup-from-driver, then nearest-pickup-from-previous-drop", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, rlats: "0", rlongs: "0" });
      prisma.pkg_order.findMany.mockResolvedValue([
        { id: 100, booking_type: 3, plat: 0, plong: 5, dlat: 0, dlong: 6 },
        { id: 200, booking_type: 3, plat: 0, plong: 1, dlat: 0, dlong: 2 },
      ]);
      const req = { body: { rider_id: "2", order_ids: [100, 200] } };
      const res = makeRes();

      await suggestNextDaySequence(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.map((s) => s.order_id)).toEqual([200, 100]);
    });

    it("404s when the driver doesn't exist", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue(null);
      const req = { body: { rider_id: "999", order_ids: [1] } };
      const res = makeRes();

      await suggestNextDaySequence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("assignNextDayBatch", () => {
    it("sets rid and next_day_sequence on every order in the batch, and notifies the driver once", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1 });
      prisma.pkg_order.findMany.mockResolvedValue([
        { id: 200, booking_type: 3, city_id: 1, paddress: "A", daddress: "B" },
        { id: 100, booking_type: 3, city_id: 1, paddress: "C", daddress: "D" },
      ]);
      prisma.$transaction.mockResolvedValue([{}, {}]);
      getIO.mockReturnValue({ to: jest.fn().mockReturnThis(), emit: jest.fn() });
      const req = {
        body: {
          rider_id: "2",
          notify_driver_now: true,
          sequence: [{ order_id: 200, position: 1 }, { order_id: 100, position: 2 }],
        },
        user: { role: "superadmin" },
      };
      const res = makeRes();

      await assignNextDayBatch(req, res);

      expect(prisma.$transaction).toHaveBeenCalledWith([
        expect.anything(),
        expect.anything(),
      ]);
      expect(prisma.pkg_order.update).toHaveBeenNthCalledWith(1, {
        where: { id: 200 },
        data: { rid: 2, next_day_sequence: 1 },
      });
      expect(prisma.pkg_order.update).toHaveBeenNthCalledWith(2, {
        where: { id: 100 },
        data: { rid: 2, next_day_sequence: 2 },
      });
      expect(prisma.tbl_rnoti.create).toHaveBeenCalledTimes(1);
      const io = getIO.mock.results[0].value;
      expect(io.emit).toHaveBeenCalledWith("order:next_day_assigned", expect.objectContaining({
        orders: expect.arrayContaining([expect.objectContaining({ order_id: 200, sequence: 1 })]),
      }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("rejects a batch containing a non-next-day order", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1 });
      prisma.pkg_order.findMany.mockResolvedValue([{ id: 200, booking_type: 1, city_id: 1 }]);
      const req = { body: { rider_id: "2", sequence: [{ order_id: 200, position: 1 }] }, user: { role: "superadmin" } };
      const res = makeRes();

      await assignNextDayBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`):
```bash
npx jest src/controllers/__tests__/adminOrderController.test.js
```
Expected: FAIL — `listNextDay`/`suggestNextDaySequence`/`assignNextDayBatch` are not exported yet.

- [ ] **Step 3: Implement the three functions**

In `backend/src/controllers/adminOrderController.js`, add the import at the top (alongside the existing requires):

```javascript
const { buildNextDaySequence } = require("../utils/geoDistance");
```

Then add these three functions right after `assignScheduledDriver` (before the `module.exports` line):

```javascript
// --- Next-day bookings (booking_type=3) — manual-only, never auto-dispatched.
// Deliberately separate from listScheduled/assignScheduledDriver above
// (booking_type=2) even though the shape is similar: see
// docs/superpowers/specs/2026-09-10-next-day-booking-design.md §7 for why
// these stay independent functions instead of parameterizing the existing
// pair over booking_type.

async function listNextDay(req, res) {
  try {
    const where = { booking_type: 3 };
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query.date) where.schedule_date_time = { contains: req.query.date };
    if (req.query.status === "unassigned") where.rid = 0;
    if (req.query.status === "assigned") where.rid = { not: 0 };

    const rows = await prisma.pkg_order.findMany({ where, orderBy: [{ schedule_date_time: "asc" }, { id: "asc" }] });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "orders.listNextDay");
  }
}

async function suggestNextDaySequence(req, res) {
  try {
    const riderId = parseInt(req.body.rider_id, 10);
    const orderIds = Array.isArray(req.body.order_ids) ? req.body.order_ids.map(Number) : [];
    if (!riderId || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: "rider_id and a non-empty order_ids array are required" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    const orders = await prisma.pkg_order.findMany({ where: { id: { in: orderIds }, booking_type: 3 } });
    if (orders.length !== orderIds.length) {
      return res.status(400).json({ success: false, message: "One or more order ids are not valid next-day orders" });
    }

    const driverLat = Number(rider.rlats);
    const driverLng = Number(rider.rlongs);
    if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng)) {
      return res.status(400).json({ success: false, message: "Driver has no known location yet" });
    }

    const sequence = buildNextDaySequence(driverLat, driverLng, orders);
    return res.status(200).json({ success: true, data: sequence });
  } catch (err) {
    return internalError(res, err, "orders.suggestNextDaySequence");
  }
}

async function assignNextDayBatch(req, res) {
  try {
    const riderId = parseInt(req.body.rider_id, 10);
    const sequence = Array.isArray(req.body.sequence) ? req.body.sequence : [];
    if (!riderId || sequence.length === 0) {
      return res.status(400).json({ success: false, message: "rider_id and a non-empty sequence array are required" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const orderIds = sequence.map((s) => Number(s.order_id));
    const orders = await prisma.pkg_order.findMany({ where: { id: { in: orderIds } } });
    if (orders.length !== orderIds.length || orders.some((o) => o.booking_type !== 3)) {
      return res.status(400).json({ success: false, message: "One or more order ids are not valid next-day orders" });
    }
    if (orders.some((o) => isScopedOut(req, o.city_id))) {
      return res.status(403).json({ success: false, message: "Forbidden: an order is outside your assigned city" });
    }

    await prisma.$transaction(
      sequence.map((s) =>
        prisma.pkg_order.update({
          where: { id: Number(s.order_id) },
          data: { rid: riderId, next_day_sequence: Number(s.position) },
        })
      )
    );

    if (req.body.notify_driver_now) {
      await prisma.tbl_rnoti.create({
        data: {
          rid: riderId,
          title: "Next-day orders assigned",
          msg: `You've been assigned ${sequence.length} order(s) for tomorrow's pickup run.`,
          type: "next_day_order",
          date: new Date(),
        },
      });
      try {
        const orderedForDriver = orders
          .slice()
          .sort((a, b) => {
            const posA = sequence.find((s) => Number(s.order_id) === a.id)?.position ?? 0;
            const posB = sequence.find((s) => Number(s.order_id) === b.id)?.position ?? 0;
            return posA - posB;
          })
          .map((o) => ({
            order_id: o.id,
            pickup_address: o.paddress,
            drop_address: o.daddress,
            sequence: sequence.find((s) => Number(s.order_id) === o.id)?.position ?? 0,
          }));
        getIO().to(`driver_${riderId}`).emit("order:next_day_assigned", { orders: orderedForDriver });
      } catch (socketErr) {
        logger.error(`assignNextDayBatch: socket notify failed for rider ${riderId}:`, socketErr);
      }
    }

    return res.status(200).json({ success: true, message: "Next-day orders assigned", assigned_count: sequence.length });
  } catch (err) {
    return internalError(res, err, "orders.assignNextDayBatch");
  }
}
```

Update the `module.exports` line at the bottom from:
```javascript
module.exports = { list, getOne, assignRider, update, cancel, invoice, listScheduled, assignScheduledDriver };
```
to:
```javascript
module.exports = {
  list, getOne, assignRider, update, cancel, invoice, listScheduled, assignScheduledDriver,
  listNextDay, suggestNextDaySequence, assignNextDayBatch,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx jest src/controllers/__tests__/adminOrderController.test.js
```
Expected: PASS — all tests in the file, including the pre-existing `assignRider` test (confirms it's unaffected by the mock changes in Step 1).

- [ ] **Step 5: Wire the routes**

In `backend/src/routes/adminRoutes.js`, the existing block (lines 73-77) reads:

```javascript
// --- Orders & Live Dispatch Intervention ------------------------------------
// NOTE: /orders/scheduled must be registered before /orders/:id, or Express
// would match "scheduled" as the :id param.
router.get("/orders/scheduled", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.listScheduled);
router.post("/orders/scheduled/:id/assign-driver", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.assignScheduledDriver);
```

Add the next-day routes right after (same "before `/orders/:id`" requirement applies — `/orders/next-day` would otherwise be swallowed by the `:id` param):

```javascript
// --- Orders & Live Dispatch Intervention ------------------------------------
// NOTE: /orders/scheduled and /orders/next-day must be registered before
// /orders/:id, or Express would match "scheduled"/"next-day" as the :id param.
router.get("/orders/scheduled", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.listScheduled);
router.post("/orders/scheduled/:id/assign-driver", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.assignScheduledDriver);

router.get("/orders/next-day", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.listNextDay);
router.post("/orders/next-day/suggest-sequence", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.suggestNextDaySequence);
router.post("/orders/next-day/assign-batch", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.assignNextDayBatch);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminOrderController.js backend/src/controllers/__tests__/adminOrderController.test.js backend/src/routes/adminRoutes.js
git commit -m "feat(admin): add next-day order list, sequence-suggestion and batch-assign API"
```

---

### Task 5: Admin frontend — Next Day Orders page + assign modal

**Files:**
- Create: `frontend/src/components/orders/NextDaySequenceModal.jsx`
- Create: `frontend/src/pages/NextDayOrders.jsx`
- Modify: `frontend/src/App.jsx` (lazy import + route)
- Modify: `frontend/src/config/navigation.js` (nav entry)

**Interfaces:**
- Consumes: `GET /orders/next-day`, `POST /orders/next-day/suggest-sequence`, `POST /orders/next-day/assign-batch` from Task 4; `GET /riders` (existing); `Modal`, `Badge`, `useApiQuery`, `useRealtimeSync`, `formatCurrency`, `truncate`, `orderStatusTone`/`orderStatusLabel` (all existing, same imports `ScheduledOrders.jsx` already uses).
- Produces: route `/orders/next-day`, nav item "Next Day Orders".

- [ ] **Step 1: Create the sequencing/assign modal**

Create `frontend/src/components/orders/NextDaySequenceModal.jsx`:

```jsx
import { useCallback, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useApiQuery from '../../hooks/useApiQuery'
import { formatCurrency } from '../../utils/format'

export default function NextDaySequenceModal({ open, orders, onClose, onAssigned }) {
  const [selectedRiderId, setSelectedRiderId] = useState('')
  const [sequence, setSequence] = useState(null) // [{ order_id, pickup_distance_km }]
  const [notifyNow, setNotifyNow] = useState(true)
  const [suggesting, setSuggesting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fetcher = useCallback(() => {
    if (!open) return Promise.resolve([])
    return api.get('/riders', { params: { status: 1 } }).then((res) => res.data.data)
  }, [open])
  const { data, loading } = useApiQuery(fetcher)
  const drivers = data ?? []

  const ordersById = new Map((orders || []).map((o) => [o.id, o]))

  async function handleSuggest() {
    if (!selectedRiderId) return
    setSuggesting(true)
    setError('')
    try {
      const res = await api.post('/orders/next-day/suggest-sequence', {
        rider_id: selectedRiderId,
        order_ids: (orders || []).map((o) => o.id),
      })
      setSequence(res.data.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not suggest a sequence.')
    } finally {
      setSuggesting(false)
    }
  }

  function moveUp(index) {
    if (index === 0) return
    setSequence((prev) => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index) {
    setSequence((prev) => {
      if (index === prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  async function handleAssign() {
    if (!selectedRiderId || !sequence || sequence.length === 0) return
    setSubmitting(true)
    setError('')
    try {
      await api.post('/orders/next-day/assign-batch', {
        rider_id: selectedRiderId,
        notify_driver_now: notifyNow,
        sequence: sequence.map((s, i) => ({ order_id: s.order_id, position: i + 1 })),
      })
      onAssigned()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not assign this batch.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign ${orders?.length || 0} next-day order(s)`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!sequence || sequence.length === 0 || submitting}
            onClick={handleAssign}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Assigning…' : 'Assign All'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="next-day-driver">
        Driver
      </label>
      <div className="mb-3 flex gap-2">
        <select
          id="next-day-driver"
          value={selectedRiderId}
          onChange={(e) => { setSelectedRiderId(e.target.value); setSequence(null) }}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
        >
          <option value="">{loading ? 'Loading…' : 'Select driver'}</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name || `Driver #${d.id}`} — {d.fmobile}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedRiderId || suggesting}
          onClick={handleSuggest}
          className="whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
        >
          {suggesting ? 'Suggesting…' : 'Suggest Sequence'}
        </button>
      </div>

      {sequence && (
        <div className="mb-3 space-y-1.5">
          {sequence.map((s, i) => {
            const order = ordersById.get(s.order_id)
            return (
              <div key={s.order_id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                <span className="font-mono-data font-semibold" style={{ color: 'var(--ink)' }}>#{i + 1}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--ink-muted)' }}>
                  Order #{s.order_id} — {order?.paddress || 'pickup'} ({s.pickup_distance_km} km away) — {formatCurrency(order?.total_dcharge)}
                </span>
                <button type="button" onClick={() => moveUp(i)} disabled={i === 0} className="disabled:opacity-30" style={{ color: 'var(--ink-faint)' }}>↑</button>
                <button type="button" onClick={() => moveDown(i)} disabled={i === sequence.length - 1} className="disabled:opacity-30" style={{ color: 'var(--ink-faint)' }}>↓</button>
              </div>
            )
          })}
        </div>
      )}

      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        <input type="checkbox" checked={notifyNow} onChange={(e) => setNotifyNow(e.target.checked)} />
        Notify the driver now (informational only — no accept/reject)
      </label>
    </Modal>
  )
}
```

- [ ] **Step 2: Create the list page**

Create `frontend/src/pages/NextDayOrders.jsx`:

```jsx
import { useCallback, useState } from 'react'
import { Sunrise, Users } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import NextDaySequenceModal from '../components/orders/NextDaySequenceModal'
import { orderStatusTone, orderStatusLabel } from '../utils/orderStatus'
import { formatCurrency, truncate } from '../utils/format'

export default function NextDayOrders() {
  const toast = useToast()
  const [selectedIds, setSelectedIds] = useState([])
  const [assigning, setAssigning] = useState(false)

  const fetcher = useCallback(() => api.get('/orders/next-day').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const orders = data?.data ?? []
  const unassigned = orders.filter((o) => !o.rid)
  const selectedOrders = unassigned.filter((o) => selectedIds.includes(o.id))

  useRealtimeSync(['admin:new_order', 'admin:order_status_update'], refetch)

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Next Day Orders
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Next-day bookings, priced at Model 1 with no fixed pickup time (10 AM–8 PM) — never auto-dispatched, assign manually to a driver.
      </p>

      {selectedIds.length > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: 'var(--brand-soft)' }}>
          <span className="text-[13px]" style={{ color: 'var(--brand)' }}>{selectedIds.length} order(s) selected</span>
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Users size={13} /> Assign to Driver
          </button>
        </div>
      )}

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['', 'Order', 'Category', 'Pickup', 'For date', 'Fare', 'Status', 'Driver'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={8} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <Sunrise size={20} className="mx-auto mb-2" style={{ color: 'var(--ink-faint)' }} />
                    <p className="text-[13px]" style={{ color: 'var(--ink-faint)' }}>No next-day bookings yet.</p>
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                orders.map((o) => (
                  <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5">
                      {!o.rid && (
                        <input type="checkbox" checked={selectedIds.includes(o.id)} onChange={() => toggleSelect(o.id)} />
                      )}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>#{o.id}</td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>{o.category}</td>
                    <td className="max-w-[220px] truncate px-4 py-2.5" style={{ color: 'var(--ink-muted)' }} title={o.paddress}>
                      {truncate(o.paddress, 32)}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.schedule_date_time || '—'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(o.total_dcharge)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: o.rid ? 'var(--success)' : 'var(--ink-faint)' }}>
                      {o.rid ? `Driver #${o.rid}${o.next_day_sequence ? ` (stop ${o.next_day_sequence})` : ''}` : 'Unassigned'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <NextDaySequenceModal
        open={assigning}
        orders={selectedOrders}
        onClose={() => setAssigning(false)}
        onAssigned={() => {
          setAssigning(false)
          setSelectedIds([])
          toast.success('Next-day orders assigned.')
          refetch()
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Wire the route**

In `frontend/src/App.jsx`, add the lazy import next to `ScheduledOrders` (line 15):

```javascript
const ScheduledOrders = lazy(() => import('./pages/ScheduledOrders'))
const NextDayOrders = lazy(() => import('./pages/NextDayOrders'))
```

And add the route next to `/orders/scheduled` (line 69):

```jsx
<Route path="/orders/scheduled" element={<ScheduledOrders />} />
<Route path="/orders/next-day" element={<NextDayOrders />} />
```

- [ ] **Step 4: Wire the nav entry**

In `frontend/src/config/navigation.js`, add `Sunrise` to the `lucide-react` import list (line 1-29), then add the nav item right after `/orders/scheduled` (line 48):

```javascript
{ to: '/orders/scheduled', label: 'Scheduled Orders', icon: CalendarClock, roles: ALL_STAFF, built: true },
{ to: '/orders/next-day', label: 'Next Day Orders', icon: Sunrise, roles: ALL_STAFF, built: true },
```

- [ ] **Step 5: Build and manually verify**

Run (from `frontend/`):
```bash
npm run build
```
Expected: build succeeds with no errors. Then run `npm run dev`, log into the admin panel, open "Next Day Orders" in the sidebar, and confirm the page loads (empty state is fine — no next-day orders exist until Task 6 ships).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/orders/NextDaySequenceModal.jsx frontend/src/pages/NextDayOrders.jsx frontend/src/App.jsx frontend/src/config/navigation.js
git commit -m "feat(admin): add Next Day Orders page with nearest-neighbor batch assignment"
```

---

### Task 6: Customer app — enable the Next Day Booking option

**Files:**
- Modify: `ShifterOnline/lib/screens/home/pickupdrop.dart:5403` (uncomment option), `:5473` area (add info note)

**Interfaces:**
- Consumes: nothing new — `selectedBookingType`, `Config.nodeOrderCreate`, and the existing `nodeData` payload map are all pre-existing in this file and already handle `booking_type: 3` correctly (the schedule-picker `if (selectedBookingType == 2)` guard at line 5474 and the payload's `if (selectedBookingType == 2 && ...)` guard at line 5665 already exclude type 3 — no changes needed there, confirmed by reading both).

- [ ] **Step 1: Uncomment the Next Day Booking option**

In `ShifterOnline/lib/screens/home/pickupdrop.dart`, inside `_buildBookingTypeSelector()` (around line 5400-5404), change:

```dart
    final List<Map<String, dynamic>> bookingOptions = [
      {'type': 1, 'label': 'Current\nBooking',  'icon': Icons.flash_on_rounded},
      {'type': 2, 'label': 'Schedule\nBooking', 'icon': Icons.calendar_month_rounded},
      //{'type': 3, 'label': 'Next Day\nBooking', 'icon': Icons.wb_sunny_rounded},
    ];
```

to:

```dart
    final List<Map<String, dynamic>> bookingOptions = [
      {'type': 1, 'label': 'Current\nBooking',  'icon': Icons.flash_on_rounded},
      {'type': 2, 'label': 'Schedule\nBooking', 'icon': Icons.calendar_month_rounded},
      {'type': 3, 'label': 'Next Day\nBooking', 'icon': Icons.wb_sunny_rounded},
    ];
```

- [ ] **Step 2: Add the pickup-window info note for Next Day Booking**

Right after the `Row(children: bookingOptions.map(...))` widget closes (line 5471, `),` right before the `// ── Schedule date/time picker` comment at line 5473), add a new conditional block:

```dart
        ),

        // ── Info note — only shown for type 3 (no fixed pickup time)
        if (selectedBookingType == 3) ...[
          SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: notifier.getBgColor,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: notifier.bordecolor, width: 1),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline_rounded, color: greaycolor, size: 16),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    "Pickup will happen sometime between 10 AM and 8 PM tomorrow — exact time isn't fixed.".tr,
                    style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11.5),
                  ),
                ),
              ],
            ),
          ),
        ],

        // ── Schedule date/time picker — only shown for type 2
```

(This leaves the existing `if (selectedBookingType == 2) ...[` block on the following lines completely untouched.)

- [ ] **Step 3: Verify with static analysis**

Run (from `ShifterOnline/`):
```bash
flutter analyze lib/screens/home/pickupdrop.dart
```
Expected: no new errors introduced (this file may already have pre-existing warnings — confirm the count doesn't increase from this change).

- [ ] **Step 4: Manual smoke test**

Run the app (`flutter run`), open the booking screen, and confirm:
1. "Next Day Booking" now appears as a third tappable option.
2. Selecting it shows the info note and hides the date/time picker.
3. Selecting "Schedule Booking" (type 2) still shows its date/time picker exactly as before (regression check).
4. Placing a Next Day Booking order succeeds (check the debug log line `🎯 NODE ORDER CREATE DATA:` shows `booking_type: 3` and no `schedule_date_time` key).

- [ ] **Step 5: Commit**

```bash
git add ShifterOnline/lib/screens/home/pickupdrop.dart
git commit -m "feat(booking): enable Next Day Booking option with pickup-window note"
```

---

### Task 7: Driver app — socket listener for forced next-day notification

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/MyApplication.java`
- Create: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/NextDayOrderNotifier.java`

**Interfaces:**
- Produces: `NodeSocketManager.NextDayAssignmentListener` interface + `setNextDayAssignmentListener(listener)`, socket listener for event `"order:next_day_assigned"` (payload: `{ orders: [{order_id, pickup_address, drop_address, sequence}] }` — matches Task 4's `assignNextDayBatch` emit exactly).
- Consumes: nothing from the existing `OrderRequestListener`/accept-reject path — fully additive, new interface, new channel.

- [ ] **Step 1: Add the socket listener and interface**

In `NodeSocketManager.java`, add a new interface right after the existing `OrderRequestListener` interface (around line 42):

```java
    public interface NextDayAssignmentListener {
        void onNextDayAssigned(JSONObject data);
    }
```

Add a field next to `orderRequestListener` (around line 48):

```java
    private NextDayAssignmentListener nextDayAssignmentListener;
```

Add the socket listener registration right after the existing `socket.on("order:dismiss", ...)` block (around line 110), still inside `connectDriver`, before `socket.connect();`:

```java
        socket.on("order:next_day_assigned", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && nextDayAssignmentListener != null) {
                nextDayAssignmentListener.onNextDayAssigned(data);
            }
        }));
```

Add the setter right after `setOrderRequestListener` (around line 118):

```java
    /** Set once, e.g. from MyApplication — forced next-day-order notification, no accept/reject. */
    public void setNextDayAssignmentListener(NextDayAssignmentListener listener) {
        this.nextDayAssignmentListener = listener;
    }
```

- [ ] **Step 2: Create the notification helper**

Create `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/NextDayOrderNotifier.java`:

```java
package com.shifter.driver.utility;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import com.shifter.driver.R;
import com.shifter.driver.activity.NextDayOrdersActivity;

/**
 * Purely informational notification for a forced next-day order assignment
 * (see docs/superpowers/specs/2026-09-10-next-day-booking-design.md §9) —
 * no accept/reject affordance, deliberately separate from the
 * order_channel_silent_v1 / order_notifications_v5 channels the live
 * dispatch popup uses, same reasoning as the existing
 * order_dismiss_channel_v1 (MyApplication.createOrderNotificationChannels):
 * this is "informational, no action needed", not an actionable popup.
 */
public class NextDayOrderNotifier {

    private static final String CHANNEL_ID = "next_day_order_channel_v1";
    private static final int NOTIFICATION_ID = 9001;

    public static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Next Day Orders",
                NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Next-day orders assigned to you by admin — informational only");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    /** data matches the order:next_day_assigned payload: { orders: [...] }. */
    public static void show(Context context, JSONObject data) {
        JSONArray orders = data.optJSONArray("orders");
        int count = orders != null ? orders.length() : 0;

        Intent intent = new Intent(context, NextDayOrdersActivity.class);
        intent.putExtra("orders_json", orders != null ? orders.toString() : "[]");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Next-day orders assigned")
                .setContentText(count + " order(s) assigned for tomorrow's pickup run")
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, builder.build());
        }
    }
}
```

- [ ] **Step 3: Register the channel and listener in MyApplication**

In `MyApplication.java`, inside `createOrderNotificationChannels()`, add a call right before the closing brace of the `if (android.os.Build.VERSION.SDK_INT >= ...)` block (after the existing `order_dismiss_channel_v1` creation, around line 226):

```java
            com.shifter.driver.utility.NextDayOrderNotifier.createChannel(this);
```

Then, right after the existing `NodeSocketManager.getInstance().setOrderRequestListener(new NodeSocketManager.OrderRequestListener() { ... });` block (around line 69), register the new listener:

```java
        NodeSocketManager.getInstance().setNextDayAssignmentListener(data ->
            com.shifter.driver.utility.NextDayOrderNotifier.show(this, data)
        );
```

- [ ] **Step 4: Create the minimal order-list activity**

Create `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/NextDayOrdersActivity.java` — a plain list, no accept/reject, reading the order array passed via the notification's intent (avoids depending on a driver-side "my orders" list endpoint that doesn't exist yet):

```java
package com.shifter.driver.activity;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** Plain, read-only list of this driver's assigned next-day orders (informational only — no accept/reject). */
public class NextDayOrdersActivity extends BaseActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scrollView = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        container.setPadding(pad, pad, pad, pad);
        scrollView.addView(container);
        setContentView(scrollView);

        TextView header = new TextView(this);
        header.setText("Tomorrow's Pickup Run");
        header.setTextSize(20);
        header.setPadding(0, 0, 0, pad);
        container.addView(header);

        String json = getIntent().getStringExtra("orders_json");
        try {
            JSONArray orders = new JSONArray(json != null ? json : "[]");
            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.getJSONObject(i);
                container.addView(buildOrderRow(order));
            }
        } catch (Exception ignored) {
            // Malformed/missing payload — show the header with no rows rather than crash.
        }
    }

    private View buildOrderRow(JSONObject order) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (12 * getResources().getDisplayMetrics().density);
        row.setPadding(pad, pad, pad, pad);
        row.setGravity(Gravity.START);

        TextView stop = new TextView(this);
        stop.setText("Stop " + order.optInt("sequence", 0) + " — Order #" + order.optInt("order_id", 0));
        stop.setTextSize(16);
        stop.setTextColor(Color.parseColor("#1A1A1A"));
        row.addView(stop);

        TextView pickup = new TextView(this);
        pickup.setText("Pickup: " + order.optString("pickup_address", "—"));
        pickup.setTextSize(13);
        row.addView(pickup);

        TextView drop = new TextView(this);
        drop.setText("Drop: " + order.optString("drop_address", "—"));
        drop.setTextSize(13);
        row.addView(drop);

        return row;
    }
}
```

- [ ] **Step 5: Register the activity in the manifest**

In `ShifterDriver/ShifterDriver/app/src/main/AndroidManifest.xml`, add a new `<activity>` entry alongside the existing ones (match the existing entries' style — find one such as `OrderDetailsActivity` and copy its attribute pattern, changing only the name):

```xml
        <activity android:name=".activity.NextDayOrdersActivity" android:exported="false" />
```

- [ ] **Step 6: Build to verify**

Run (from `ShifterDriver/ShifterDriver/`):
```bash
./gradlew assembleDebug
```
On Windows use `gradlew.bat assembleDebug`. Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Manual smoke test**

Trigger `POST /orders/next-day/assign-batch` with `notify_driver_now: true` against a running backend + a logged-in driver app (real device/emulator with the driver's socket connected), and confirm:
1. A plain notification titled "Next-day orders assigned" appears (no accept/reject buttons).
2. Tapping it opens `NextDayOrdersActivity` listing the assigned stops in sequence order.
3. The existing live-dispatch popup (place a normal `booking_type=1` order) still shows its usual Accept/Reject UI — regression check.

- [ ] **Step 8: Commit**

```bash
git add ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/MyApplication.java ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/NextDayOrderNotifier.java ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/NextDayOrdersActivity.java ShifterDriver/ShifterDriver/app/src/main/AndroidManifest.xml
git commit -m "feat(driver): forced notification + read-only list for next-day order assignment"
```

---

### Task 8: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run (from `backend/`):
```bash
npx jest
```
Expected: PASS, 0 failures — this includes every pre-existing test (`orderController`, `adminOrderController`, `uploadController`, and any `tripLifecycle`/`dispatchManager` tests already in the repo), proving `booking_type=1` and `booking_type=2` behavior is byte-for-byte unchanged.

- [ ] **Step 2: Manual end-to-end smoke test — Current Booking (booking_type=1)**

Using the customer app, place a normal Current Booking order and confirm: it appears in the driver app as a live popup with Accept/Reject, gets accepted, and the admin panel's "Live Orders" page shows it progressing normally. This is the single most important check — it directly verifies the hard constraint in the spec (§2) and this plan's Global Constraints.

- [ ] **Step 3: Manual end-to-end smoke test — Schedule Booking (booking_type=2)**

Confirm the existing `ScheduledOrders.jsx` admin page still lists and pre-assigns `booking_type=2` orders exactly as before (this plan touched nothing in that path, but verify nothing accidentally regressed from the `adminOrderController.js` edits in Task 4, e.g. the mock-object change to the test file's `jest.mock` block).

- [ ] **Step 4: Manual end-to-end smoke test — Next Day Booking (booking_type=3)**

Place a Next Day Booking order in the customer app → confirm it appears in the admin panel's "Next Day Orders" page, unassigned → select it (and ideally a second one) → pick a driver → "Suggest Sequence" → "Assign All" → confirm the driver app shows the forced notification and the read-only stop list in the correct sequence.

- [ ] **Step 5: Commit the plan's final state (if any fixes were needed)**

If Steps 1-4 surfaced any fix, commit it now with a message describing exactly what regression it corrects. If nothing needed fixing, this task produces no commit — the previous 7 tasks' commits are the deliverable.
