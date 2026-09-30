# Pickup Relocation + OTP-Timeout Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OTP-timeout auto-cancel timer branch correctly on how far a
mid-wait pickup change moves the pickup point, add a hard ceiling so the
order always eventually resolves, compensate the driver when an order times
out anyway, and price the trip off wherever the OTP is actually verified
(with a review flag when that differs materially from the last confirmed
point) — backend + driver-app (Android) UI.

**Architecture:** Extends the already-built pickup-change service
(`orderPickupService.js`) and OTP-timeout sweep (`tripLifecycle.js`) with
distance-gated branching and a second, independent ceiling sweep. All new
thresholds live in the existing `app_settings` key-value table, read fresh
on every check (no caching), matching the `pickup_otp_timeout_minutes`
convention already in this codebase. Driver-app changes reuse the existing
broadcast-receiver pattern that already carries `order:destination_updated`
into `OrderDetailsActivity`.

**Tech Stack:** Node/Express + Prisma (MySQL) backend, React admin frontend,
native Android (Java) driver app, Jest for backend tests.

**Spec:** `docs/superpowers/specs/2026-09-30-pickup-relocate-otp-timeout-design.md`

## Global Constraints

- No caching on any new admin setting — every read goes straight to
  `app_settings`, exactly like `getPickupOtpTimeoutMinutes()`.
- Every new DB write that touches `pkg_order`/`pkg_order_wait_timer` inside
  an existing transaction (`orderPickupService.confirmPickupChange`,
  `driverTripService.progressTrip`) uses that transaction's `tx`, never a
  bare `prisma` call, matching the existing convention in both files.
- `otp_verify_lat/lng/at` continue to be written unconditionally on every
  OTP verification (reporting), regardless of whether the mismatch branch
  also fires.
- Driver-app changes reuse the existing broadcast-receiver plumbing
  (`SocketOrderRouter` → `Intent` broadcast → `OrderDetailsActivity`
  receiver) already used for `order:destination_updated`; no new socket
  library or transport.

## Review Focus

- **A pickup change arrives while `order_status` is 0 or 1** (not yet
  arrived) — the small/large-move branch only applies to status 2;
  statuses 0/1 must keep working exactly as they do today (no distance
  check, no timer to pause since none is running yet).
- **The distance check runs with a missing or zero-length driver GPS
  fix** — `haversineKm` on two identical or two invalid coordinate pairs
  must not throw and must not wrongly classify as "large move" by
  accident of `NaN` comparisons.
- **Ceiling sweep runs for an order with `first_arrival_at` still `null`**
  (never arrived, or a pre-migration row) — must be skipped, not treated
  as "infinitely overdue".
- **`cancelOverduePickup` runs when `pickup_timeout_driver_compensation`
  is 0 or unset** — no wallet write, no notification claiming a payment,
  matching today's "driver keeps nothing extra" behavior exactly.
- **OTP verified with no GPS fix at all** (`hasFix` false) — the mismatch
  check must be skipped entirely, not treated as a mismatch by default.

---

## Task 1: Schema — `first_arrival_at` and `pickup_otp_mismatch_flag`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/sql/20260930_pickup_relocate_ceiling.sql`

**Interfaces:**
- Produces: `pkg_order_wait_timer.first_arrival_at` (`DateTime?`), read/written
  by Tasks 3 and 6.
- Produces: `pkg_order.pickup_otp_mismatch_flag` (`Boolean`, default `false`),
  written by Task 7.

- [ ] **Step 1: Add the two columns to the Prisma schema**

In `backend/prisma/schema.prisma`, find the `pkg_order_wait_timer` model
(it already has `pickup_wait_banked_seconds`) and add, right after that
field:

```prisma
  // Set once, the very first time this order's wait-timer row is created
  // (the first 1->2 arrival). Never touched by any later pause/resume or
  // small-move relocation cycle - this is what the relocation ceiling sweep
  // (tripLifecycle.sweepPickupRelocationCeiling) measures against, distinct
  // from pickup_wait_start which DOES get cleared on every pause.
  first_arrival_at         DateTime? @db.DateTime(0)
```

In the `pkg_order` model, find the `otp_verify_lat/lng/at` block (see the
comment about "recalculating fare off a later location is out of scope")
and replace that comment + add the new column. The old comment documented
a decision this plan reverses — leaving it in place would contradict the
new behavior in Task 7:

```prisma
  // otp_verify_lat/lng/at record where the driver actually was when they
  // confirmed the pickup OTP. As of 2026-09-30 this DOES drive pricing:
  // driverTripService.progressTrip repricess the trip against this point
  // when it differs materially (pickup_otp_mismatch_flag_m app_setting)
  // from the last confirmed pickup point, and sets the flag below so an
  // admin can review moves that happened without an explicit customer
  // pickup-change confirmation.
  otp_verify_lat      String?   @db.VarChar(30)
  otp_verify_lng      String?   @db.VarChar(30)
  otp_verify_at       DateTime? @db.DateTime(0)
  pickup_otp_mismatch_flag Boolean @default(false)
```

- [ ] **Step 2: Write the (not-yet-applied) migration SQL**

Create `backend/sql/20260930_pickup_relocate_ceiling.sql`:

```sql
ALTER TABLE pkg_order_wait_timer ADD COLUMN first_arrival_at DATETIME NULL;
ALTER TABLE pkg_order ADD COLUMN pickup_otp_mismatch_flag TINYINT(1) NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Update the stale comment in `driverTripService.js`**

The comment at the top of the `hasFix` block (around the `pickup_wait_end`
update inside the `'pickup'` action) currently says this GPS fix is
"never used for pricing". Task 7 changes that. Update it now so it's not
contradicted mid-plan — open `backend/src/services/driverTripService.js`,
find:

```
        // Reporting-only snapshot of where the driver actually was when they
        // confirmed the pickup OTP - never used for pricing (see the
        // otp_verify_lat/lng schema comment). Silently skipped if the app
```

Replace with:

```
        // Snapshot of where the driver actually was when they confirmed the
        // pickup OTP. Always recorded for reporting; Task 7's mismatch check
        // (below) additionally reprices the trip against this point when it
        // differs materially from the last confirmed pickup (see the
        // otp_verify_lat/lng schema comment). Silently skipped if the app
```

(leave the rest of that comment paragraph as-is — only this lead-in changes).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/sql/20260930_pickup_relocate_ceiling.sql backend/src/services/driverTripService.js
git commit -m "schema: add first_arrival_at and pickup_otp_mismatch_flag columns"
```

---

## Task 2: New admin-settings reader

**Files:**
- Create: `backend/src/utils/pickupRelocateSettings.js`
- Test: `backend/src/utils/__tests__/pickupRelocateSettings.test.js`

**Interfaces:**
- Produces: `getPickupRelocateSettings()` returning
  `{ ceilingMinutes: number, smallMoveThresholdM: number, otpMismatchFlagM: number, driverCompensation: number }`.
  Consumed by Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
}));
const prisma = require("../../config/db");
const { getPickupRelocateSettings } = require("../pickupRelocateSettings");

describe("getPickupRelocateSettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns defaults when no admin settings exist", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    const settings = await getPickupRelocateSettings();
    expect(settings).toEqual({
      ceilingMinutes: 35,
      smallMoveThresholdM: 200,
      otpMismatchFlagM: 500,
      driverCompensation: 0,
    });
  });

  it("uses admin-configured values when present", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "pickup_relocate_ceiling_minutes", setting_value: "45" },
      { setting_key: "pickup_small_move_threshold_m", setting_value: "150" },
      { setting_key: "pickup_otp_mismatch_flag_m", setting_value: "600" },
      { setting_key: "pickup_timeout_driver_compensation", setting_value: "25" },
    ]);
    const settings = await getPickupRelocateSettings();
    expect(settings).toEqual({
      ceilingMinutes: 45,
      smallMoveThresholdM: 150,
      otpMismatchFlagM: 600,
      driverCompensation: 25,
    });
  });

  it("falls back to defaults for unparseable or non-positive values", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "pickup_relocate_ceiling_minutes", setting_value: "not-a-number" },
      { setting_key: "pickup_small_move_threshold_m", setting_value: "-5" },
    ]);
    const settings = await getPickupRelocateSettings();
    expect(settings.ceilingMinutes).toBe(35);
    expect(settings.smallMoveThresholdM).toBe(200);
  });

  it("returns defaults if the DB read fails", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    const settings = await getPickupRelocateSettings();
    expect(settings).toEqual({
      ceilingMinutes: 35,
      smallMoveThresholdM: 200,
      otpMismatchFlagM: 500,
      driverCompensation: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/__tests__/pickupRelocateSettings.test.js`
Expected: FAIL with "Cannot find module '../pickupRelocateSettings'"

- [ ] **Step 3: Write the implementation**

```js
const prisma = require("../config/db");
const logger = require("./logger");

// Mirrors pickupOtpTimeout.js's convention exactly: no caching, one
// indexed lookup per call, defaults on any parse failure or missing row.
const DEFAULTS = {
  ceilingMinutes: 35,
  smallMoveThresholdM: 200,
  otpMismatchFlagM: 500,
  driverCompensation: 0,
};

const KEYS = {
  pickup_relocate_ceiling_minutes: "ceilingMinutes",
  pickup_small_move_threshold_m: "smallMoveThresholdM",
  pickup_otp_mismatch_flag_m: "otpMismatchFlagM",
  pickup_timeout_driver_compensation: "driverCompensation",
};

function parsePositive(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function getPickupRelocateSettings() {
  try {
    const rows = await prisma.app_settings.findMany({
      where: { setting_key: { in: Object.keys(KEYS) } },
    });
    const settings = { ...DEFAULTS };
    for (const row of rows) {
      const field = KEYS[row.setting_key];
      if (field) settings[field] = parsePositive(row.setting_value, DEFAULTS[field]);
    }
    return settings;
  } catch (err) {
    logger.error("getPickupRelocateSettings: failed to read admin settings, using defaults:", err);
    return { ...DEFAULTS };
  }
}

module.exports = { getPickupRelocateSettings };
```

Note: `driverCompensation` allows 0 as a valid configured value (default is
also 0), so `parsePositive`'s ">0" floor only matters for the other three
fields in practice — a compensation of exactly 0 falls through to the
fallback 0 either way, so no special-casing is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/__tests__/pickupRelocateSettings.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/pickupRelocateSettings.js backend/src/utils/__tests__/pickupRelocateSettings.test.js
git commit -m "feat: add pickupRelocateSettings admin-config reader"
```

---

## Task 3: Set `first_arrival_at` on first arrival

**Files:**
- Modify: `backend/src/services/driverTripService.js` (the `arrive()` function's `'arrived'` branch)
- Test: `backend/src/services/__tests__/driverTripService.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pkg_order_wait_timer.first_arrival_at` set exactly once per
  order, consumed by Task 6's ceiling sweep.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/services/__tests__/driverTripService.test.js`, after
the existing `'auto arrival persists exactly one milestone...'` test:

```js
test('first arrival stamps first_arrival_at once; later pauses/re-arrivals never overwrite it', async () => {
  const samples = [0, 10000, 20000, 30000].map(t => ({ timestamp: now - 30000 + t, lat: 28.6, lng: 77.2, accuracy: 10, speed: 0 }));
  await call('sync', { samples });
  const firstStamp = timer.first_arrival_at;
  expect(firstStamp).toBeTruthy();

  // Simulate a pickup-change revert (Task 4/5's territory) clearing pickup_wait_start
  // but NOT first_arrival_at, then a second arrival at a new point.
  timer.pickup_wait_start = null;
  order.order_status = 1;
  await call('sync', { samples });
  expect(timer.first_arrival_at).toEqual(firstStamp);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/driverTripService.test.js -t "first_arrival_at"`
Expected: FAIL — `timer.first_arrival_at` is `undefined`

- [ ] **Step 3: Implement**

In `backend/src/services/driverTripService.js`, inside `arrive()`, the
`'arrived'` branch currently does:

```js
        timer = await tx.pkg_order_wait_timer.upsert({ where: timerKey,
          create: { order_id: orderId, rid: riderId, pickup_wait_start: at, created_at: new Date() },
          update: { pickup_wait_start: at, pickup_wait_end: null, pickup_wait_seconds: 0, updated_at: new Date() } });
```

Change to:

```js
        timer = await tx.pkg_order_wait_timer.upsert({ where: timerKey,
          create: { order_id: orderId, rid: riderId, pickup_wait_start: at, first_arrival_at: at, created_at: new Date() },
          update: { pickup_wait_start: at, pickup_wait_end: null, pickup_wait_seconds: 0, updated_at: new Date(),
            // Only set on the row's FIRST arrival — an upsert's `update`
            // branch means the row already existed, so only stamp this if
            // a prior cycle (pause/relocation) left it unset.
            ...(timer?.first_arrival_at ? {} : { first_arrival_at: at }) } });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/driverTripService.test.js`
Expected: PASS (all tests in this file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverTripService.js backend/src/services/__tests__/driverTripService.test.js
git commit -m "feat: stamp first_arrival_at once on the first pickup arrival"
```

---

## Task 4: `orderPickupService` — small-move vs large-move branch

**Files:**
- Modify: `backend/src/services/orderPickupService.js`
- Modify: `backend/src/services/__tests__/orderPickupService.test.js`

**Interfaces:**
- Consumes: `getPickupRelocateSettings()` from Task 2, `haversineKm` from
  `backend/src/utils/geoDistance.js` (already exported).
- Produces: no interface change — `confirmPickupChange`'s return shape and
  the `order:pickup_updated` event payload are unchanged; only whether
  `wasWaitingAtPickup`'s branch runs is now distance-gated.

- [ ] **Step 1: Write the failing test**

Read the existing `describe` block covering `confirmPickupChange`'s
status-2 banking behavior in `orderPickupService.test.js` first (it mocks
`prisma.pkg_order_wait_timer.findUnique` with a `pickup_wait_start`). Add,
in that same `describe` block:

```js
jest.mock("../../utils/pickupRelocateSettings", () => ({
  getPickupRelocateSettings: jest.fn().mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
  }),
}));
// (add this jest.mock near the file's other jest.mock calls, alongside
// the existing orderRouteRepricing mock)

it("does NOT bank/revert when the new pickup is within the small-move threshold", async () => {
  const { getPickupRelocateSettings } = require("../../utils/pickupRelocateSettings");
  // Original pickup at 28.6000/77.2000; new point ~90m away.
  prisma.pkg_order.findUnique.mockResolvedValue({
    id: 101, uid: 22, rid: 22, order_status: 2, o_status: "Pickup",
    plat: "28.6000", plong: "77.2000", dlat: "28.7", dlong: "77.3",
    extra_mile_charge: 0, delivery_type: 1, distance: 5, total_dcharge: 100, d_charge: 100,
  });
  prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({
    order_id: 101, rid: 22, pickup_wait_start: new Date(), pickup_wait_end: null, pickup_wait_banked_seconds: 0,
  });

  await orderPickupService.confirmPickupChange({
    uid: 22, orderId: 101, newPlat: "28.6008", newPlong: "77.2000", newPaddress: "Nearby spot",
  });

  expect(getPickupRelocateSettings).toHaveBeenCalled();
  expect(prisma.pkg_order.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.not.objectContaining({ order_status: 1 }),
  }));
  expect(prisma.pkg_order_wait_timer.update).not.toHaveBeenCalled();
  expect(prisma.driver_trip_event.deleteMany).not.toHaveBeenCalled();
});

it("still banks/reverts when the new pickup is beyond the small-move threshold", async () => {
  prisma.pkg_order.findUnique.mockResolvedValue({
    id: 102, uid: 22, rid: 22, order_status: 2, o_status: "Pickup",
    plat: "28.6000", plong: "77.2000", dlat: "28.7", dlong: "77.3",
    extra_mile_charge: 0, delivery_type: 1, distance: 5, total_dcharge: 100, d_charge: 100,
  });
  prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({
    order_id: 102, rid: 22, pickup_wait_start: new Date(), pickup_wait_end: null, pickup_wait_banked_seconds: 0,
  });

  await orderPickupService.confirmPickupChange({
    // ~1.1km away
    uid: 22, orderId: 102, newPlat: "28.6100", newPlong: "77.2000", newPaddress: "Far spot",
  });

  expect(prisma.pkg_order.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ order_status: 1, o_status: "Processing" }),
  }));
  expect(prisma.pkg_order_wait_timer.update).toHaveBeenCalled();
  expect(prisma.driver_trip_event.deleteMany).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/orderPickupService.test.js`
Expected: FAIL — the small-move test fails because the current code always
reverts (no distance gate exists yet).

- [ ] **Step 3: Implement**

In `backend/src/services/orderPickupService.js`:

1. Add the import at the top, alongside the existing `orderRouteRepricing` import:

```js
const { getPickupRelocateSettings } = require("../utils/pickupRelocateSettings");
const { haversineKm } = require("../utils/geoDistance");
```

2. Change the `wasWaitingAtPickup` line inside `confirmPickupChange`'s
transaction from:

```js
    const wasWaitingAtPickup = order.order_status === 2 && order.rid > 0;
```

to:

```js
    let wasWaitingAtPickup = false;
    if (order.order_status === 2 && order.rid > 0) {
      const { smallMoveThresholdM } = await getPickupRelocateSettings();
      const oldLat = Number(order.plat), oldLng = Number(order.plong);
      const moveDistanceM = [oldLat, oldLng].every(Number.isFinite)
        ? haversineKm(oldLat, oldLng, Number(newPlat), Number(newPlong)) * 1000
        : Infinity; // missing/invalid old coordinates -> always treat as a large move
      wasWaitingAtPickup = moveDistanceM > smallMoveThresholdM;
    }
```

(The rest of the function — the `if (wasWaitingAtPickup) { ... }` block — is
unchanged; it now simply runs conditionally on distance instead of
unconditionally on status.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/orderPickupService.test.js`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orderPickupService.js backend/src/services/__tests__/orderPickupService.test.js
git commit -m "feat: branch pickup-change timer handling on move distance"
```

---

## Task 5: Driver compensation on OTP-timeout auto-cancel

**Files:**
- Modify: `backend/src/services/tripLifecycle.js` (`cancelOverduePickup`)
- Modify: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `getPickupRelocateSettings()` from Task 2.
- Produces: no signature change to `cancelOverduePickup(orderId, riderId, timeoutMinutes)`.

- [ ] **Step 1: Write the failing test**

Add to the `"tripLifecycle.cancelOverduePickup / sweepOverduePickups"`
describe block in `tripLifecycle.test.js`:

```js
it("credits the driver's wallet when a compensation amount is configured", async () => {
  getPickupRelocateSettings.mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 15,
  });

  await tripLifecycle.cancelOverduePickup(400, 3);

  expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
    where: { id: 3 },
    data: { wallet_balance: { increment: 15 } },
  });
  expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ user_id: 3, amount: 15, type: "credit", wallet_type: "driver", order_id: 400 }),
  });
});

it("does not touch the driver's wallet when compensation is 0", async () => {
  getPickupRelocateSettings.mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
  });

  await tripLifecycle.cancelOverduePickup(400, 3);

  expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1); // only the customer's debit
});
```

Also add, near the top of the file with the other `jest.mock` calls:

```js
jest.mock("../../utils/pickupRelocateSettings", () => ({
  getPickupRelocateSettings: jest.fn().mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
  }),
}));
```

and import it: `const { getPickupRelocateSettings } = require("../../utils/pickupRelocateSettings");`

Add `update: jest.fn()` to the `tbl_rider` mock in the `jest.mock("../../config/db", ...)` block if it isn't already there (check first — line 9 of the existing mock already has `tbl_rider: { findUnique: jest.fn(), update: jest.fn() }`, so no change needed there).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycle.test.js -t "compensation"`
Expected: FAIL — `prisma.tbl_rider.update` was never called.

- [ ] **Step 3: Implement**

In `backend/src/services/tripLifecycle.js`, add the import near the top
(alongside the existing `getPickupOtpTimeoutMinutes` import):

```js
const { getPickupRelocateSettings } = require("../utils/pickupRelocateSettings");
```

In `cancelOverduePickup`, after the existing customer-cancellation-charge
block (right after the `if (cancellationCharge > 0) { ... }` block, before
the `dispatchManager.emitCustomerEvent(...)` call), add:

```js
  // Driver earns nothing today when an order times out on them through no
  // fault of their own - this fixed, admin-configured amount (default 0,
  // i.e. unchanged behavior) removes the incentive to stall an order
  // indefinitely rather than accept it may time out.
  const { driverCompensation } = await getPickupRelocateSettings();
  if (driverCompensation > 0 && riderId) {
    await prisma.tbl_rider.update({ where: { id: riderId }, data: { wallet_balance: { increment: driverCompensation } } });
    await prisma.tbl_wallet_history.create({
      data: {
        user_id: riderId,
        amount: driverCompensation,
        type: "credit",
        remark: `OTP-timeout compensation — order #${orderId}`,
        wallet_type: "driver",
        order_id: orderId,
        created_at: istNow(),
      },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycle.test.js`
Expected: PASS (full file, including both new tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/services/__tests__/tripLifecycle.test.js
git commit -m "feat: compensate driver on OTP-timeout auto-cancel when configured"
```

---

## Task 6: Hard-ceiling sweep

**Files:**
- Modify: `backend/src/services/tripLifecycle.js` (new function + export)
- Modify: `backend/src/config/constants.js`
- Modify: `backend/src/server.js`
- Modify: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `cancelOverduePickup` (existing, now also does Task 5's
  compensation), `getPickupRelocateSettings()` from Task 2.
- Produces: `tripLifecycle.sweepPickupRelocationCeiling()`, wired into
  `server.js` on its own interval.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `tripLifecycle.test.js`:

```js
describe("tripLifecycle.sweepPickupRelocationCeiling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$executeRaw.mockResolvedValue(1);
    pricingEngine.getPackageById.mockResolvedValue({ cancellation_charge_customer: 30 });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "customer_tok" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "rider_tok" });
  });

  it("cancels orders whose first_arrival_at is older than the ceiling, regardless of pause state", async () => {
    getPickupRelocateSettings.mockResolvedValue({
      ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
    });
    prisma.pkg_order_wait_timer.findMany.mockResolvedValue([
      { order_id: 500, rid: 8 }, // pickup_wait_start may be null (mid-pause) - irrelevant here
    ]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, uid: 11, rid: 8, delivery_type: 6, o_status: "Pickup" });

    await tripLifecycle.sweepPickupRelocationCeiling();

    expect(prisma.pkg_order_wait_timer.findMany).toHaveBeenCalledWith({
      where: { first_arrival_at: { lte: expect.any(Date) } },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // cancelOverduePickup ran
  });

  it("uses the admin-configured ceiling minutes", async () => {
    getPickupRelocateSettings.mockResolvedValue({
      ceilingMinutes: 60, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
    });
    prisma.pkg_order_wait_timer.findMany.mockResolvedValue([]);

    const before = Date.now();
    await tripLifecycle.sweepPickupRelocationCeiling();

    const cutoffArg = prisma.pkg_order_wait_timer.findMany.mock.calls[0][0].where.first_arrival_at.lte;
    expect(before - cutoffArg.getTime()).toBeGreaterThan(59 * 60 * 1000);
    expect(before - cutoffArg.getTime()).toBeLessThan(61 * 60 * 1000);
  });

  it("doesn't let one failing cancellation stop the rest", async () => {
    getPickupRelocateSettings.mockResolvedValue({
      ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
    });
    prisma.pkg_order_wait_timer.findMany.mockResolvedValue([
      { order_id: 500, rid: 8 },
      { order_id: 501, rid: 9 },
    ]);
    prisma.pkg_order.findUnique
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce({ id: 501, uid: 12, rid: 9, delivery_type: 6, o_status: "Pickup" });

    await tripLifecycle.sweepPickupRelocationCeiling();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycle.test.js -t "sweepPickupRelocationCeiling"`
Expected: FAIL — `tripLifecycle.sweepPickupRelocationCeiling is not a function`

- [ ] **Step 3: Implement the sweep function**

In `backend/src/services/tripLifecycle.js`, add this new function right
after `sweepOverduePickups` (reuses `cancelOverduePickup`, same file):

```js
/**
 * Independent from sweepOverduePickups' 10-minute-since-arrival clock:
 * this measures total elapsed time since the FIRST arrival
 * (pkg_order_wait_timer.first_arrival_at, set once in driverTripService and
 * never touched by any pause/relocation cycle), so however many times a
 * pickup change pauses/resumes the OTP-timeout timer, the order is
 * guaranteed to resolve once this outer ceiling passes. Queries every row
 * with a first_arrival_at old enough regardless of current pickup_wait_start
 * state (paused orders have pickup_wait_start === null and would otherwise
 * never be swept by anything).
 */
async function sweepPickupRelocationCeiling() {
  const { ceilingMinutes } = await getPickupRelocateSettings();
  const cutoff = new Date(Date.now() - ceilingMinutes * 60000);
  let overdue;
  try {
    overdue = await prisma.pkg_order_wait_timer.findMany({
      where: { first_arrival_at: { lte: cutoff } },
    });
  } catch (err) {
    logger.error("sweepPickupRelocationCeiling: failed to query overdue wait timers:", err);
    return;
  }

  for (const waitRow of overdue) {
    try {
      await cancelOverduePickup(waitRow.order_id, waitRow.rid, ceilingMinutes);
    } catch (err) {
      logger.error(`sweepPickupRelocationCeiling: failed cancelling order ${waitRow.order_id}:`, err);
    }
  }
}
```

Add `sweepPickupRelocationCeiling` to `module.exports` at the bottom of the
file (alongside `sweepOverduePickups`).

Note: `cancelOverduePickup`'s guard is `WHERE o_status = 'Pickup'` (see its
existing `$executeRaw`) — an order already past status 2 (OTP verified) or
already cancelled by something else naturally no-ops here, same race
protection it already has for `sweepOverduePickups`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycle.test.js`
Expected: PASS (full file)

- [ ] **Step 5: Add the sweep interval constant**

In `backend/src/config/constants.js`, find `PICKUP_TIMEOUT_SWEEP_INTERVAL_MS`
and add, right after it:

```js
  // Independent ceiling sweep (tripLifecycle.sweepPickupRelocationCeiling) -
  // same 60s cadence as PICKUP_TIMEOUT_SWEEP_INTERVAL_MS is fine since the
  // ceiling itself is tens of minutes; no need for a coarser interval.
  PICKUP_RELOCATION_CEILING_SWEEP_INTERVAL_MS: 60 * 1000,
```

- [ ] **Step 6: Wire it into server.js**

In `backend/src/server.js`, add `PICKUP_RELOCATION_CEILING_SWEEP_INTERVAL_MS`
to the destructured import from `./config/constants`, and add, right after
the existing `sweepOverduePickups` interval block:

```js
// Outer ceiling on how long a pickup relocation can be strung out across
// pause/resume cycles - see tripLifecycle.sweepPickupRelocationCeiling doc
// comment. Independent sweep from sweepOverduePickups above (different
// timestamp column, different admin-configured window).
setInterval(() => {
  tripLifecycle.sweepPickupRelocationCeiling().catch((err) =>
    logger.error("sweepPickupRelocationCeiling interval failed:", err)
  );
}, PICKUP_RELOCATION_CEILING_SWEEP_INTERVAL_MS);
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/services/__tests__/tripLifecycle.test.js backend/src/config/constants.js backend/src/server.js
git commit -m "feat: add hard ceiling sweep for pickup relocation cycles"
```

---

## Task 7: Reprice + flag on OTP-location mismatch

**Files:**
- Modify: `backend/src/services/driverTripService.js`
- Modify: `backend/src/services/__tests__/driverTripService.test.js`

**Interfaces:**
- Consumes: `getPickupRelocateSettings()` (Task 2),
  `getDriverRealDistanceKm`/`computeRouteDistanceKm` (existing,
  `orderRouteRepricing.js`), `haversineKm` (existing, `geoDistance.js`),
  `pricingEngine.priceForPackageId` (existing).
- Produces: no new exported function — extends the existing `'pickup'`
  action branch in `progressTrip`.

- [ ] **Step 1: Write the failing test**

Add to `driverTripService.test.js` (needs new mocks for
`pricingEngine`, `orderRouteRepricing`, and the settings reader — add these
`jest.mock` calls near the top, alongside the existing ones):

```js
jest.mock('../pricingEngine', () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ fare: 300, driverEarning: 270, commission: 30 }),
}));
jest.mock('../orderRouteRepricing', () => ({
  getDriverRealDistanceKm: jest.fn().mockResolvedValue(1),
  computeRouteDistanceKm: jest.fn().mockResolvedValue(12.5),
}));
jest.mock('../../utils/pickupRelocateSettings', () => ({
  getPickupRelocateSettings: jest.fn().mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
  }),
}));
```

Add these two tests after the existing `'correct OTP starts pickup
atomically...'` test:

```js
test('OTP verified far from the confirmed pickup reprices the trip and sets the mismatch flag', async () => {
  const pricingEngine = require('../pricingEngine');
  await call('arrived');
  // order.plat/plong are '28.6'/'77.2' (from beforeEach); ~1.1km away.
  await call('pickup', { otp: '1234', lat: 28.61, lng: 77.2 });

  expect(pricingEngine.priceForPackageId).toHaveBeenCalled();
  expect(order.plat).toBe('28.61');
  expect(order.plong).toBe('77.2');
  expect(order.pickup_otp_mismatch_flag).toBe(true);
  expect(order.d_charge).toBe(300);
});

test('OTP verified near the confirmed pickup does not reprice or flag', async () => {
  const pricingEngine = require('../pricingEngine');
  await call('arrived');
  // ~10m away - well under the 500m default threshold.
  await call('pickup', { otp: '1234', lat: 28.6001, lng: 77.2 });

  expect(pricingEngine.priceForPackageId).not.toHaveBeenCalled();
  expect(order.pickup_otp_mismatch_flag).toBeFalsy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/driverTripService.test.js -t "mismatch"`
Expected: FAIL — `order.pickup_otp_mismatch_flag` is `undefined`, no reprice happened.

- [ ] **Step 3: Implement**

In `backend/src/services/driverTripService.js`, add the imports at the top:

```js
const { getPickupRelocateSettings } = require('../utils/pickupRelocateSettings');
const { getDriverRealDistanceKm, computeRouteDistanceKm } = require('./orderRouteRepricing');
const { haversineKm } = require('../utils/geoDistance');
```

Inside the `'verify_otp' || 'pickup'` branch, the existing code after
`order_status: 3, o_status: 'On_Route', pickup_time: now` is:

```js
        const hasFix = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
        timer = await tx.pkg_order_wait_timer.update({ where: timerKey, data: {
          pickup_wait_end: now, pickup_wait_seconds: timer?.pickup_wait_start ? Math.max(0, Math.floor((now - new Date(timer.pickup_wait_start)) / 1000)) : 0,
          ...(hasFix ? { otp_verify_lat: String(lat), otp_verify_lng: String(lng), otp_verify_at: now } : {}),
        } });
```

Add, right after that `timer = await tx.pkg_order_wait_timer.update(...)`
call, still inside the `if (action === 'pickup' && ...)` block:

```js
        if (hasFix) {
          const oldLat = Number(order.plat), oldLng = Number(order.plong);
          const mismatchDistanceM = [oldLat, oldLng].every(Number.isFinite)
            ? haversineKm(oldLat, oldLng, Number(lat), Number(lng)) * 1000
            : Infinity;
          const { otpMismatchFlagM } = await getPickupRelocateSettings();
          if (mismatchDistanceM > otpMismatchFlagM) {
            const newDistanceKm = await computeRouteDistanceKm({ plat: lat, plong: lng, stops, dlat: order.dlat, dlong: order.dlong });
            const radiusKm = await getDriverRealDistanceKm(order.rid, lat, lng);
            const packageId = Number(order.delivery_type) || 1;
            const { fare, driverEarning, commission } = await require('./pricingEngine').priceForPackageId(
              packageId, newDistanceKm, radiusKm, Number(order.extra_mile_charge) || 0, order.uid
            );
            Object.assign(order, await tx.pkg_order.update({ where: { id: orderId }, data: {
              plat: String(lat), plong: String(lng), distance: Math.round(newDistanceKm * 100) / 100,
              d_charge: Math.round(fare), total_dcharge: Math.round(fare),
              driver_earning: driverEarning, commission, pickup_otp_mismatch_flag: true,
            } }));
          }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/driverTripService.test.js`
Expected: PASS (full file)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverTripService.js backend/src/services/__tests__/driverTripService.test.js
git commit -m "feat: reprice and flag OTP verification far from confirmed pickup"
```

---

## Task 8: Admin settings UI

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

**Interfaces:**
- Consumes: existing `flags` state / `setFlags` pattern already in this file.
- Produces: nothing new consumed elsewhere — pure UI, writes through the
  existing generic `flags` save path (`updateSettings`'s `flags` handling,
  already built).

- [ ] **Step 1: Add the four fields**

In `frontend/src/pages/Settings.jsx`, right after the existing
`flag-pickup_otp_timeout_minutes` block (ends around line 360), add:

```jsx
          <div>
            <Label htmlFor="flag-pickup_relocate_ceiling_minutes">Pickup relocation ceiling (min)</Label>
            <Input
              id="flag-pickup_relocate_ceiling_minutes"
              type="number"
              min="1"
              placeholder="e.g. 35"
              value={flags.pickup_relocate_ceiling_minutes ?? '35'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_relocate_ceiling_minutes: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              However many times a pickup change pauses/resumes the OTP timer, the order is force-resolved once this many minutes have passed since the driver's first arrival.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_small_move_threshold_m">Pickup small-move threshold (m)</Label>
            <Input
              id="flag-pickup_small_move_threshold_m"
              type="number"
              min="1"
              placeholder="e.g. 200"
              value={flags.pickup_small_move_threshold_m ?? '200'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_small_move_threshold_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              A pickup-location change within this distance keeps the OTP timer running as-is; beyond it, the timer pauses until the driver reaches the new point.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_otp_mismatch_flag_m">OTP-location mismatch flag distance (m)</Label>
            <Input
              id="flag-pickup_otp_mismatch_flag_m"
              type="number"
              min="1"
              placeholder="e.g. 500"
              value={flags.pickup_otp_mismatch_flag_m ?? '500'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_otp_mismatch_flag_m: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              If the driver verifies the OTP this far from the last confirmed pickup point, the trip re-prices against where the OTP was actually verified and is flagged for review.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-pickup_timeout_driver_compensation">Driver OTP-timeout compensation (₹)</Label>
            <Input
              id="flag-pickup_timeout_driver_compensation"
              type="number"
              min="0"
              placeholder="e.g. 0"
              value={flags.pickup_timeout_driver_compensation ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, pickup_timeout_driver_compensation: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Paid to the driver's wallet if an order auto-cancels because the customer never handed over the OTP. Set to 0 to pay nothing (today's behavior).
            </p>
          </div>
```

- [ ] **Step 2: Manually verify**

Run: `cd frontend && npm run dev`, open Settings, confirm the four new
fields render under the existing Pickup OTP timeout field, save once, and
confirm (via the Network tab or backend logs) that `flags` in the PUT
`/settings` payload includes the four new keys.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat: add pickup-relocation admin settings to Settings page"
```

---

## Task 9: Android — wire the `order:pickup_updated` socket event

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/socket/SocketOrderRouter.java`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/MyApplication.java`

**Interfaces:**
- Produces: `SocketOrderRouter.ACTION_ORDER_PICKUP_UPDATED` broadcast,
  carrying `order_id`, `plat`, `plong`, `paddress`, `fare`, `distance`,
  `fare_diff`, `order_status` (the exact keys `orderPickupService.js`'s
  `eventPayload` already sends). Consumed by Task 10.

This mirrors the existing `order:destination_updated` wiring exactly — that
event currently has no driver-app listener at all, even though the backend
(`orderPickupService.js`) has been emitting it since the feature was built.

- [ ] **Step 1: Add the listener interface and field to `NodeSocketManager.java`**

Add, right after the existing `OrderDestinationUpdatedListener` interface:

```java
    /** order:pickup_updated — customer (or the OTP-mismatch reprice) updated the pickup point on an active trip. */
    public interface OrderPickupUpdatedListener {
        void onOrderPickupUpdated(JSONObject data);
    }
```

Add the field, right after `orderDestinationUpdatedListener`:

```java
    private OrderPickupUpdatedListener orderPickupUpdatedListener;
```

- [ ] **Step 2: Register the socket handler**

Right after the existing `socket.on("order:destination_updated", ...)` block:

```java
        socket.on("order:pickup_updated", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && orderPickupUpdatedListener != null) {
                orderPickupUpdatedListener.onOrderPickupUpdated(data);
            }
        }));
```

- [ ] **Step 3: Add the setter**

Right after the existing `setOrderDestinationUpdatedListener` method:

```java
    public void setOrderPickupUpdatedListener(OrderPickupUpdatedListener listener) {
        this.orderPickupUpdatedListener = listener;
    }
```

- [ ] **Step 4: Add the broadcast action + handler to `SocketOrderRouter.java`**

Add the constant, right after `ACTION_ORDER_DESTINATION_UPDATED`:

```java
    /** order:pickup_updated for an active order — see OrderDetailsActivity's receiver. */
    public static final String ACTION_ORDER_PICKUP_UPDATED = "com.shifter.driver.ORDER_PICKUP_UPDATED";
```

Add the handler, right after `handleOrderDestinationUpdated`:

```java
    /**
     * order:pickup_updated — the customer changed the pickup location during
     * the OTP wait, or the trip re-priced against where the OTP was actually
     * verified. order_status distinguishes the two branches the backend can
     * take: 2 = small move, timer kept running; 1 = large move, timer paused
     * until the driver reaches the new point (see OrderDetailsActivity).
     */
    public static void handleOrderPickupUpdated(Context context, JSONObject data) {
        String orderId = data.optString("order_id", null);
        if (orderId == null) return;

        Log.d(TAG, "order:pickup_updated for order " + orderId);

        Intent updateBroadcast = new Intent(ACTION_ORDER_PICKUP_UPDATED);
        updateBroadcast.putExtra("order_id", orderId);
        updateBroadcast.putExtra("plat", data.optString("plat", ""));
        updateBroadcast.putExtra("plong", data.optString("plong", ""));
        updateBroadcast.putExtra("paddress", data.optString("paddress", ""));
        updateBroadcast.putExtra("distance", data.optString("distance", ""));
        updateBroadcast.putExtra("fare", data.optString("fare", ""));
        updateBroadcast.putExtra("fare_diff", data.optString("fare_diff", ""));
        updateBroadcast.putExtra("order_status", data.optInt("order_status", 0));
        updateBroadcast.setPackage(context.getPackageName());
        context.sendBroadcast(updateBroadcast);
    }
```

- [ ] **Step 5: Wire the listener in `MyApplication.java`**

Right after the existing
`NodeSocketManager.getInstance().setOrderDestinationUpdatedListener(...)`
line:

```java
        NodeSocketManager.getInstance().setOrderPickupUpdatedListener(data -> SocketOrderRouter.handleOrderPickupUpdated(MyApplication.this, data));
```

- [ ] **Step 6: Build-verify**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug` (or the
project's normal debug build command). Expected: builds without errors —
no automated test exists for this wiring, per this repo's Android
convention.

- [ ] **Step 7: Commit**

```bash
git add ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/socket/SocketOrderRouter.java ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/MyApplication.java
git commit -m "feat(android): wire order:pickup_updated socket event"
```

---

## Task 10: Android — pickup-change banner and paused-timer UI in `OrderDetailsActivity`

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/OrderDetailsActivity.java`

**Interfaces:**
- Consumes: `SocketOrderRouter.ACTION_ORDER_PICKUP_UPDATED` broadcast from
  Task 9.

- [ ] **Step 1: Register the receiver**

Find `registerDestinationUpdatedReceiver()` and its call site (search for
where it's invoked, likely alongside `registerDestinationUpdatedReceiver();`
in `onCreate`/`onResume`). Add a sibling call
`registerPickupUpdatedReceiver();` right next to it, and declare a matching
field near the existing `destinationUpdatedReceiver` field declaration:

```java
    private android.content.BroadcastReceiver pickupUpdatedReceiver;
```

- [ ] **Step 2: Implement the receiver**

Add this method right after `registerDestinationUpdatedReceiver()`:

```java
    private void registerPickupUpdatedReceiver() {
        pickupUpdatedReceiver = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(android.content.Context context, Intent intent) {
                if (intent == null) return;
                String incomingOrderId = intent.getStringExtra("order_id");
                if (orderItem == null || incomingOrderId == null || !incomingOrderId.equals(orderItem.getId())) {
                    return;
                }
                String newPlat = intent.getStringExtra("plat");
                String newPlong = intent.getStringExtra("plong");
                String newAddress = intent.getStringExtra("paddress");
                String newFare = intent.getStringExtra("fare");
                String fareDiff = intent.getStringExtra("fare_diff");
                int newOrderStatus = intent.getIntExtra("order_status", 0);

                try {
                    if (newPlat != null && !newPlat.isEmpty()) orderItem.setPlat(Double.parseDouble(newPlat));
                    if (newPlong != null && !newPlong.isEmpty()) orderItem.setPlong(Double.parseDouble(newPlong));
                } catch (Exception ignored) {}

                if (newAddress != null && !newAddress.isEmpty()) {
                    orderItem.setCustomerPaddress(newAddress);
                }
                if (newFare != null && !newFare.isEmpty()) {
                    orderItem.setTotal(newFare);
                }
                orderItem.setOrderFlowId(String.valueOf(newOrderStatus));

                // order_status 2 = small move, OTP-timeout timer kept running (no
                // pause happened server-side); anything else (1) = a large move,
                // the timer is paused server-side until GPS arrival-detection
                // fires again at the new point (normal 1->2 flow, unchanged).
                boolean isSmallMove = newOrderStatus == 2;
                runOnUiThread(() -> onPickupUpdatedFromCustomer(newAddress, newFare, fareDiff, isSmallMove));
            }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter(
                com.shifter.driver.socket.SocketOrderRouter.ACTION_ORDER_PICKUP_UPDATED);
        androidx.core.content.ContextCompat.registerReceiver(
                this, pickupUpdatedReceiver, filter, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
    }
```

- [ ] **Step 3: Implement the UI reaction**

Add this method right after `onDestinationUpdatedFromCustomer` (reuse its
exact structure — same currency lookup, same `setupUI()`/`updateLocationPath()`
refresh):

```java
    private void onPickupUpdatedFromCustomer(String newAddress, String newFare, String fareDiff, boolean isSmallMove) {
        if (orderItem == null) return;

        setupUI();
        updateLocationPath();
        updateTripControls();
        updateArrivalHint();

        String currency = sessionManager != null ? sessionManager.getStringData(com.shifter.driver.utility.SessionManager.currency) : "₹";
        String message = isSmallMove
                ? "Pickup location updated nearby:\n" + (newAddress != null ? newAddress : "") + "\n\nContinue as normal - your OTP timer keeps running."
                : "Pickup location changed to:\n" + (newAddress != null ? newAddress : "") + "\n\nYour OTP timer is paused - navigate to the new location. It resumes automatically when you arrive.";
        if (newFare != null && !newFare.isEmpty()) {
            message += "\n\nRevised Fare: " + currency + newFare;
            if (fareDiff != null && !fareDiff.isEmpty() && !fareDiff.equals("0")) {
                try {
                    double diff = Double.parseDouble(fareDiff);
                    message += diff > 0 ? " (+" + currency + fareDiff + ")" : " (-" + currency + Math.abs(diff) + ")";
                } catch (Exception ignored) {}
            }
        }

        new android.app.AlertDialog.Builder(OrderDetailsActivity.this)
                .setTitle(isSmallMove ? "Pickup Updated" : "Pickup Moved — Navigate to New Location")
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show();
    }
```

Note: `updateTripControls()` already sets `binding.txtConfirm`'s text from
`orderItem.getOrderFlowId()` (see the existing `case "1"` / `case "2"`
branches at lines 1822-1834) — because the receiver sets
`orderItem.setOrderFlowId(String.valueOf(newOrderStatus))` before calling
this, the existing "REACHED PICKUP · MANUAL" (status 1, paused/re-approaching)
vs "VERIFY OTP & START DELIVERY" (status 2, still active) button text
switches automatically; no new button-state code is needed beyond calling
`updateTripControls()`. Similarly `updateArrivalHint()` already produces
the right `txtTripLocationStatus` copy for status 1 (distance-to-pickup) vs
status 2 ("Pickup reached. Verify OTP...") — both are pre-existing methods
being re-invoked with the just-updated `orderItem`/`plat`/`plong`, not new
logic.

- [ ] **Step 4: Unregister the receiver**

Find where `destinationUpdatedReceiver` is unregistered (likely in
`onDestroy()`), and add the matching line for `pickupUpdatedReceiver`
right next to it:

```java
        if (pickupUpdatedReceiver != null) unregisterReceiver(pickupUpdatedReceiver);
```

- [ ] **Step 5: Build-verify**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: builds without errors. Manually verify by triggering a pickup
change from the customer app/API while a driver app instance is on the
`OrderDetailsActivity` screen for that order, for both a small move
(<200m) and a large move (>200m), confirming the dialog text and button
label differ as designed.

- [ ] **Step 6: Commit**

```bash
git add ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/OrderDetailsActivity.java
git commit -m "feat(android): react to pickup-change events with distance-appropriate UI"
```

---

## Task 11: Full backend suite + final review

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: PASS for every file this plan touched
(`pickupRelocateSettings`, `driverTripService`, `orderPickupService`,
`tripLifecycle`). Any pre-existing unrelated failures (confirm via
`git status --porcelain=v1` that the failing files weren't touched by this
plan) are out of scope, same convention as this codebase's prior work on
the original pickup-change feature.

- [ ] **Step 2: Confirm the migration file is present but not yet applied**

Run: `cat backend/sql/20260930_pickup_relocate_ceiling.sql` and confirm it
exists — this plan does NOT run it against any database; the user applies
it manually when ready, per this repo's established convention for schema
changes in this project.

- [ ] **Step 3: Commit any remaining stragglers, if the review turns any up**

```bash
git status
```

If clean, no commit needed — every task already committed its own changes.
