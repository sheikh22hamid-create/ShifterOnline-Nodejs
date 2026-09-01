# PHP↔Node Order-Flow Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Node's dispatch engine (`backend/`) the sole owner of the order-dispatch cascade for the live PHP-backed mobile apps, without changing any app code, by turning the relevant PHP endpoints into thin bridges to new Node routes and replacing Socket.IO-only driver/customer notifications with real FCM push.

**Architecture:** New Node routes under `/legacy/*` (protected by a shared-secret header) receive requests from PHP in PHP's existing field-name shape and answer in PHP's existing response shape. Node's `dispatchManager` fires FCM push at every point it currently only emits a socket event, so the real mobile apps (which have no socket client) actually receive ride-request popups and dismissals. PHP keeps the business logic this plan explicitly does not migrate (advance-payment pricing in `accept_order.php`, wallet/penalty logic in `pks_cancle.php`, everything in `order_status_change.php`), and gets one new outbound call added to tell Node's cascade to stop when an order is taken or cancelled.

**Tech Stack:** Node/Express, Prisma (MySQL), `firebase-admin` (already a dependency, already wrapped in `backend/src/config/firebase.js`), Jest. PHP 7/8 with `mysqli` (existing legacy stack, `curl` for the new outbound calls).

**Spec:** `docs/superpowers/specs/2026-09-01-php-node-order-flow-bridge-design.md`

## Global Constraints

- Every `/legacy/*` Node route requires the `X-Legacy-Bridge-Secret` header to match `process.env.LEGACY_BRIDGE_SECRET`, enforced by one shared middleware — no route-specific auth logic.
- `rider_api/accept_order.php`, `cust_api/pks_cancle.php`, and `rider_api/order_status_change.php` keep 100% of their existing PHP logic untouched. This plan only *adds* one outbound call to the first two; it does not touch the third at all.
- `cust_api/pks_order.php` and `rider_api/reject_order.php` become full proxies with zero remaining business logic beyond (for `pks_order.php` only) saving uploaded photos to disk.
- No task may regress an existing test. Run `npx jest` inside `backend/` after every task that touches `backend/src/**` and confirm the full suite still passes before moving on.
- Known, deliberately deferred gaps (do not silently "fix" these — they are out of scope for this plan): `pkg_order.otp` is not set by Node's create path (stays NULL); `radius_charge`, `schedule_date_time`, `loading_charge`, `unloading_charge`, `wating_charge`, `free_waiting_time`, `gst_number` are not computed/forwarded by Node's create path (stay at their current defaults, same as Node's create behaves today); OneSignal-based notifications (e.g. "order received" at creation) are not ported — only FCM-based dispatch/lifecycle push is in scope.

---

### Task 1: `legacyAuth` shared-secret middleware

**Files:**
- Create: `backend/src/middleware/legacyAuth.js`
- Test: `backend/src/middleware/__tests__/legacyAuth.test.js`

**Interfaces:**
- Produces: `module.exports = function legacyAuth(req, res, next)` — an Express middleware. Reads `process.env.LEGACY_BRIDGE_SECRET` and the `x-legacy-bridge-secret` request header.

- [ ] **Step 1: Write the failing tests**

```js
const legacyAuth = require("../legacyAuth");

describe("legacyAuth", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function mockRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
  }

  it("rejects with 503 when LEGACY_BRIDGE_SECRET is not configured", () => {
    delete process.env.LEGACY_BRIDGE_SECRET;
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    legacyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the header is missing or wrong", () => {
    process.env.LEGACY_BRIDGE_SECRET = "correct-secret";
    const req = { headers: { "x-legacy-bridge-secret": "wrong" } };
    const res = mockRes();
    const next = jest.fn();

    legacyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the header matches", () => {
    process.env.LEGACY_BRIDGE_SECRET = "correct-secret";
    const req = { headers: { "x-legacy-bridge-secret": "correct-secret" } };
    const res = mockRes();
    const next = jest.fn();

    legacyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npx jest src/middleware/__tests__/legacyAuth.test.js`
Expected: FAIL with "Cannot find module '../legacyAuth'"

- [ ] **Step 3: Write the implementation**

```js
const logger = require("../utils/logger");

module.exports = function legacyAuth(req, res, next) {
  const expected = process.env.LEGACY_BRIDGE_SECRET;
  if (!expected) {
    logger.error("legacyAuth: LEGACY_BRIDGE_SECRET is not set — refusing all /legacy requests");
    return res.status(503).json({ Result: false, msg: "Bridge not configured" });
  }

  const provided = req.headers["x-legacy-bridge-secret"];
  if (provided !== expected) {
    return res.status(401).json({ Result: false, msg: "Unauthorized" });
  }

  next();
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/middleware/__tests__/legacyAuth.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/legacyAuth.js backend/src/middleware/__tests__/legacyAuth.test.js
git commit -m "feat(legacy-bridge): add shared-secret auth middleware for /legacy routes"
```

---

### Task 2: `pushNotifier` service

**Files:**
- Create: `backend/src/services/pushNotifier.js`
- Test: `backend/src/services/__tests__/pushNotifier.test.js`

**Interfaces:**
- Consumes: `sendPushNotification(fcmToken, title, body, data)` from `backend/src/config/firebase.js` (already exists — resolves to `{sent, reason?}`, never throws).
- Produces: `notifyDriverOrderRequest(fcmToken, payload)`, `notifyDriverDismiss(fcmToken, orderId, reason)`, `notifyCustomerOrderAssigned(fcmToken, data)`, `notifyCustomerNoDriverFound(fcmToken, orderId)` — all `async`, all resolve to whatever `sendPushNotification` resolves to, all safe to call with a falsy `fcmToken`.

- [ ] **Step 1: Write the failing tests**

```js
jest.mock("../../config/firebase", () => ({ sendPushNotification: jest.fn().mockResolvedValue({ sent: true }) }));

const { sendPushNotification } = require("../../config/firebase");
const pushNotifier = require("../pushNotifier");

describe("pushNotifier", () => {
  beforeEach(() => jest.clearAllMocks());

  it("notifyDriverOrderRequest sends the order payload as string-valued FCM data", async () => {
    await pushNotifier.notifyDriverOrderRequest("tok-1", {
      order_id: "42",
      pickup_address: "A",
      delivery_address: "B",
    });

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-1",
      "New Order Request",
      expect.any(String),
      expect.objectContaining({ order_id: "42", type: "order" })
    );
  });

  it("notifyDriverDismiss sends a dismiss payload with the reason", async () => {
    await pushNotifier.notifyDriverDismiss("tok-2", 42, "timeout");

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-2",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: "order_dismiss", order_id: "42", reason: "timeout" })
    );
  });

  it("notifyCustomerOrderAssigned sends the assigned rider's info", async () => {
    await pushNotifier.notifyCustomerOrderAssigned("tok-3", { order_id: 42, rider_name: "Deepak", otp: 1234 });

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-3",
      "Order Assigned!",
      expect.stringContaining("Deepak"),
      expect.objectContaining({ type: "order_assigned", otp: "1234" })
    );
  });

  it("notifyCustomerNoDriverFound sends a no-driver payload", async () => {
    await pushNotifier.notifyCustomerNoDriverFound("tok-4", 42);

    expect(sendPushNotification).toHaveBeenCalledWith(
      "tok-4",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: "no_driver_found", order_id: "42" })
    );
  });

  it("passes through a falsy fcmToken without throwing", async () => {
    await expect(pushNotifier.notifyDriverOrderRequest(null, { order_id: "1" })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/pushNotifier.test.js`
Expected: FAIL with "Cannot find module '../pushNotifier'"

- [ ] **Step 3: Write the implementation**

```js
const { sendPushNotification } = require("../config/firebase");

function stringifyPayload(payload) {
  return Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? "")]));
}

async function notifyDriverOrderRequest(fcmToken, payload) {
  return sendPushNotification(
    fcmToken,
    "New Order Request",
    `${payload.pickup_address || ""} -> ${payload.delivery_address || ""}`,
    stringifyPayload({ ...payload, type: "order" })
  );
}

async function notifyDriverDismiss(fcmToken, orderId, reason) {
  return sendPushNotification(
    fcmToken,
    "Order No Longer Available",
    "This order is no longer available.",
    { type: "order_dismiss", order_id: String(orderId), reason: String(reason) }
  );
}

async function notifyCustomerOrderAssigned(fcmToken, data) {
  return sendPushNotification(
    fcmToken,
    "Order Assigned!",
    `${data.rider_name || "A driver"} is on the way.`,
    stringifyPayload({ ...data, type: "order_assigned" })
  );
}

async function notifyCustomerNoDriverFound(fcmToken, orderId) {
  return sendPushNotification(
    fcmToken,
    "No Driver Found",
    "We couldn't find a driver for your order. Please try again.",
    { type: "no_driver_found", order_id: String(orderId) }
  );
}

module.exports = {
  notifyDriverOrderRequest,
  notifyDriverDismiss,
  notifyCustomerOrderAssigned,
  notifyCustomerNoDriverFound,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/__tests__/pushNotifier.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pushNotifier.js backend/src/services/__tests__/pushNotifier.test.js
git commit -m "feat(legacy-bridge): add pushNotifier service wrapping FCM sends"
```

---

### Task 3: Wire driver-popup push into `dispatchManager.runBatch`

**Files:**
- Modify: `backend/src/services/dispatchManager.js:222-260` (the locking loop and its `Promise.all` block inside `runBatch`)
- Modify: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `pushNotifier.notifyDriverOrderRequest(fcmToken, payload)` from Task 2.
- Produces: nothing new consumed by later tasks (Task 4 threads driver rows through a *different* variable, added there).

- [ ] **Step 1: Write the failing test**

This file's top only requires `prisma`, `dispatchManager`, `lockManager`, and the two constants (no `pushNotifier` yet). Add it the same way `lockManager` is already required, and auto-mock it (no factory needed — the assertions below only check `toHaveBeenCalledWith`, and dispatchManager's `await pushNotifier.xxx(...)` awaiting an auto-mocked `jest.fn()`'s `undefined` return is not an error):

```js
jest.mock("../pushNotifier");
```

Add this alongside this file's other `jest.mock(...)` calls at the top (after the existing `jest.mock("../pricingEngine", ...)` block), and add the require alongside the other top-level requires:

```js
const pushNotifier = require("../pushNotifier");
```

Then add a new test near the other batch-dispatch tests, inside `describe("dispatchManager overlapping batch cascade", ...)`. The file's `beforeEach` already queues `prisma.$queryRaw` to return `[1,2,3,4].map(makeRiderRow)` for tier 0 — reuse that, don't requeue it:

```js
  it("pushes an FCM notification to each driver locked in a batch, alongside the socket emit", async () => {
    await dispatchManager.startDispatch(order);
    await flush();

    expect(pushNotifier.notifyDriverOrderRequest).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ order_id: String(order.id) })
    );
  });
```

(`order` and `makeRiderRow` are this file's existing top-level `const order = {...}` and `function makeRiderRow(riderId) {...}` — `makeRiderRow` already sets `fcm_token: "tok"` on every row it produces, which is what the assertion above checks.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/dispatchManager.test.js -t "pushes an FCM notification"`
Expected: FAIL — `pushNotifier.notifyDriverOrderRequest` was not called.

- [ ] **Step 3: Wire the push call into `runBatch`**

In `backend/src/services/dispatchManager.js`, add the import near the top with the other `require`s:

```js
const pushNotifier = require("./pushNotifier");
```

Then change the `Promise.all` block inside `runBatch` (currently ends with `requireIo().to(...).emit("order:request", payload);`) to:

```js
    if (lockedThisRoundDrivers.length > 0) {
      const payload = buildOrderRequestPayload(currentOrder, packageId, distanceKm.toFixed(1), driverEarning);
      await Promise.all(
        lockedThisRoundDrivers.map(async (driver) => {
          const riderId = Number(driver.rider_id);
          await prisma.tbl_order_requests.create({
            data: {
              order_id: orderId,
              rider_id: riderId,
              package_id: Number(packageId),
              status: "sent",
              lat: driver.rlats ? String(driver.rlats) : null,
              lng: driver.rlongs ? String(driver.rlongs) : null,
            },
          });

          requireIo().to(`driver_${riderId}`).emit("order:request", payload);
          await pushNotifier.notifyDriverOrderRequest(driver.fcm_token, payload);
        })
      );
    }
```

(Only the two new lines — `pushNotifier` import and the `await pushNotifier.notifyDriverOrderRequest(...)` call — are new; everything else in this block is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS, full file (all existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(legacy-bridge): push FCM order-request notification alongside socket emit"
```

---

### Task 4: Thread driver rows into `scheduleExpiry` and push the dismiss

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (`runBatch`'s `lockedRiderIds`/`lockedDrivers` tracking, the call to `scheduleExpiry`, and `scheduleExpiry` itself)
- Modify: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `pushNotifier.notifyDriverDismiss(fcmToken, orderId, reason)` from Task 2.
- Produces: `scheduleExpiry(orderId, tierIndex, drivers)` now takes an array of driver rows (`{rider_id, fcm_token, ...}`), not an array of bare rider IDs — this is a signature change from `riderIds` to `drivers`.

- [ ] **Step 1: Write the failing test**

Add to `dispatchManager.test.js` (this depends on Task 3 already having added `jest.mock("../pushNotifier")` and the top-level `pushNotifier` require — do not add them again):

```js
  it("pushes a dismiss FCM notification to drivers whose popup times out", async () => {
    await dispatchManager.startDispatch(order);
    await flush();

    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
    await flush();

    expect(pushNotifier.notifyDriverDismiss).toHaveBeenCalledWith("tok", order.id, "timeout");
  });
```

This relies on the file's existing `beforeEach` defaults: `prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 })` (so the dismiss branch isn't skipped) and the tier-0 queue of `[1,2,3,4].map(makeRiderRow)` (so there's a locked driver to expire). `POPUP_TIMEOUT_MS` is already imported at the top of this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/dispatchManager.test.js -t "pushes a dismiss"`
Expected: FAIL — `pushNotifier.notifyDriverDismiss` was not called (or called with `undefined` for the token, since `riderIds` currently carries no `fcm_token`).

- [ ] **Step 3: Thread driver rows through, and push in `scheduleExpiry`**

In `runBatch`, change the locking loop to also accumulate full driver rows (not just IDs). Find:

```js
  const consideredThisBatch = new Set();
  const lockedRiderIds = [];
  let round = 0;
```

Replace with:

```js
  const consideredThisBatch = new Set();
  const lockedRiderIds = [];
  const lockedDrivers = [];
  let round = 0;
```

Find, inside the `for (const driver of eligibleBatch)` loop:

```js
      lockedRiderIds.push(riderId);
      lockedThisRound++;
      lockedThisRoundDrivers.push(driver);
```

Replace with:

```js
      lockedRiderIds.push(riderId);
      lockedDrivers.push(driver);
      lockedThisRound++;
      lockedThisRoundDrivers.push(driver);
```

Find the call site after the while-loop:

```js
  if (lockedRiderIds.length > 0) {
    scheduleExpiry(orderId, tierIndex, lockedRiderIds);
    state.consecutiveEmptyTurns = 0;
```

Replace with:

```js
  if (lockedDrivers.length > 0) {
    scheduleExpiry(orderId, tierIndex, lockedDrivers);
    state.consecutiveEmptyTurns = 0;
```

Now update `scheduleExpiry` itself. Replace its signature and body:

```js
function scheduleExpiry(orderId, tierIndex, drivers) {
  const state = activeDispatches.get(orderId);
  if (!state) return;

  state.activeExpiryTimers = (state.activeExpiryTimers || 0) + 1;

  const timer = setTimeout(async () => {
    state.timers.delete(timer);
    state.activeExpiryTimers = Math.max(0, (state.activeExpiryTimers || 1) - 1);

    try {
      const stillPendingDrivers = drivers.filter((driver) => {
        const lock = lockManager.peekLock(Number(driver.rider_id));
        return lock && lock.orderId === orderId;
      });

      await Promise.all(
        stillPendingDrivers.map(async (driver) => {
          const riderId = Number(driver.rider_id);
          lockManager.releaseLock(riderId);
          const result = await prisma.tbl_order_requests.updateMany({
            where: { order_id: orderId, rider_id: riderId, status: "sent" },
            data: { status: "timeout" },
          });
          if (result.count === 0) return;
          requireIo().to(`driver_${riderId}`).emit("order:dismiss", {
            order_id: String(orderId),
            reason: "timeout",
          });
          await pushNotifier.notifyDriverDismiss(driver.fcm_token, orderId, "timeout");
        })
      );

      await checkCascadeTermination(orderId);
    } catch (err) {
      logger.error(`dispatchManager expiry handler failed for order ${orderId}, tier ${tierIndex}:`, err);
    }
  }, POPUP_TIMEOUT_MS);

  state.timers.add(timer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(legacy-bridge): thread driver fcm_token through scheduleExpiry, push dismiss"
```

---

### Task 5: Push dismiss from `stopDispatch`

**Files:**
- Modify: `backend/src/services/dispatchManager.js:385-414` (`stopDispatch`)
- Modify: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `prisma.tbl_rider.findMany` — **new key**, not yet in this file's `jest.mock("../../config/db", ...)` factory at all (that factory currently only has `$queryRaw`, `pkg_order`, `tbl_order_requests`).
- Consumes: `pushNotifier.notifyDriverDismiss` from Task 2 (already wired into this test file by Task 3).

- [ ] **Step 1: Write the failing test**

First, add `tbl_rider: { findMany: jest.fn() }` to this file's `jest.mock("../../config/db", () => ({ ... }))` factory at the top (it currently has `$queryRaw`, `pkg_order`, `tbl_order_requests` — add `tbl_rider` as a sibling key).

`lockManager` is required as the real module in this file (`const lockManager = require("../lockManager");`, unmocked) — other existing tests in this file already call its real `isLocked`/etc. directly, so use its real `acquireLock` to set up state rather than mocking it:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/dispatchManager.test.js -t "stopDispatch pushes"`
Expected: FAIL — `prisma.tbl_rider.findMany` is not a function (factory not yet updated) or `pushNotifier.notifyDriverDismiss` not called.

- [ ] **Step 3: Implement the push in `stopDispatch`**

Replace the function body:

```js
function stopDispatch(orderId, reason) {
  const state = activeDispatches.get(orderId);
  if (state) {
    for (const timer of state.timers) clearTimeout(timer);
    activeDispatches.delete(orderId);
  }

  const riderIds = lockManager.getLockedRidersForOrder(orderId);
  const newRequestStatus = reason === "accepted_by_other" ? "auto_rejected" : "timeout";

  for (const riderId of riderIds) {
    lockManager.releaseLock(riderId);
    if (ioRef) {
      ioRef.to(`driver_${riderId}`).emit("order:dismiss", { order_id: String(orderId), reason });
    }
  }

  if (riderIds.length > 0) {
    prisma.tbl_rider
      .findMany({ where: { id: { in: riderIds } }, select: { id: true, fcm_token: true } })
      .then((riders) => Promise.all(riders.map((r) => pushNotifier.notifyDriverDismiss(r.fcm_token, orderId, reason))))
      .catch((err) => logger.error(`stopDispatch: failed pushing dismiss for order ${orderId}:`, err));

    prisma.tbl_order_requests
      .updateMany({
        where: { order_id: orderId, rider_id: { in: riderIds }, status: "sent" },
        data: { status: newRequestStatus },
      })
      .catch((err) => logger.error(`stopDispatch: failed updating tbl_order_requests for order ${orderId}:`, err));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(legacy-bridge): push dismiss FCM notification from stopDispatch"
```

---

### Task 6: Push "no driver found" to the customer from `checkCascadeTermination`

**Files:**
- Modify: `backend/src/services/dispatchManager.js:123-150` (`checkCascadeTermination`)
- Modify: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `prisma.tbl_user.findUnique` (add `tbl_user: { findUnique: jest.fn() }` to this file's `jest.mock("../../config/db", ...)` factory if not already present).
- Consumes: `pushNotifier.notifyCustomerNoDriverFound` from Task 2.

- [ ] **Step 1: Write the failing test**

`dispatchManager.test.js` already has this exact test (find it by its title): `"all tiers exhausted with no acceptance still reaches the existing no_driver_found flow"`. Extend its body — do not write a new test — by adding the `pushNotifier` assertion to it:

```js
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
```

(Only the `pushNotifier` local reference, the `prisma.tbl_user.findUnique.mockResolvedValue(...)` line, and the final `expect` are new — every other line already exists in the file exactly as shown, so replacing the existing test body with this one is a pure addition, not a behavior change.) Add `tbl_user: { findUnique: jest.fn() }` to this file's `jest.mock("../../config/db", () => ({ ... }))` factory — it is not there yet (that factory currently only has `$queryRaw`, `pkg_order`, `tbl_order_requests`, plus `tbl_rider` added in Task 5). `pushNotifier` is already required at the top of this file from Task 3 — do not add `jest.mock("../pushNotifier")` again.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/dispatchManager.test.js -t "no-driver-found"`
Expected: FAIL — `pushNotifier.notifyCustomerNoDriverFound` not called.

- [ ] **Step 3: Implement the push**

In `checkCascadeTermination`, replace:

```js
    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { o_status: "Cancelled", cancel_reason: "No driver found" },
    });
    requireIo().to(`customer_${order.uid}`).emit("order:no_driver_found", {
      order_id: String(orderId),
    });
    activeDispatches.delete(orderId);
```

with:

```js
    await prisma.pkg_order.update({
      where: { id: orderId },
      data: { o_status: "Cancelled", cancel_reason: "No driver found" },
    });
    requireIo().to(`customer_${order.uid}`).emit("order:no_driver_found", {
      order_id: String(orderId),
    });

    const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
    await pushNotifier.notifyCustomerNoDriverFound(customer?.fcm_token, orderId);

    activeDispatches.delete(orderId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(legacy-bridge): push no-driver-found FCM notification to customer"
```

---

### Task 7: Extract `createOrderCore` from `orderController.createOrder`

**Files:**
- Modify: `backend/src/controllers/orderController.js:47-201`
- Create: `backend/src/controllers/__tests__/orderController.test.js`

**Interfaces:**
- Produces: `async function createOrderCore(input)` where `input` is `{ uid, category, deliveryTypeIds, bookingType, plat, plong, paddress, pickName, pmobile, pickType, dlat, dlong, daddress, dropName, dmobile, dropType, packageWeight, packageCost, description, pMethodId, transactionId, extraMileCharge, couId, couAmt, radiusKm, cityId, photos }` (`deliveryTypeIds` must already be a normalized array of numbers; `radiusKm` must already be a resolved number — callers do their own field-name/format adaptation before calling this). Resolves to `{ ok: true, order }` or `{ ok: false, code: "VALIDATION", msg }` or `{ ok: false, code: "INVALID_PACKAGES", invalidPackageIds }`. Never throws for expected validation failures; still throws on unexpected errors (DB down, etc.) — callers keep their own try/catch.
- Exported alongside the existing exports: `module.exports = { getCategories, fareEstimate, createOrder, createOrderCore, getOrderDetails, customerCancel, rateOrder };`

- [ ] **Step 1: Write the failing tests**

```js
jest.mock("../../config/db", () => ({
  tbl_package: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  pkg_order: { create: jest.fn() },
}));
jest.mock("../../services/pricingEngine", () => ({ priceForPackage: jest.fn() }));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyNewOrder: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const dispatchManager = require("../../services/dispatchManager");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { createOrderCore } = require("../orderController");

describe("orderController.createOrderCore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10 }]);
    pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
    prisma.pkg_order.create.mockResolvedValue({ id: 501, booking_type: 1 });
  });

  const baseInput = {
    uid: 1,
    category: "Bike",
    deliveryTypeIds: [6],
    bookingType: 1,
    plat: 28.7,
    plong: 77.1,
    paddress: "A",
    pickName: "P",
    pmobile: "999",
    pickType: "",
    dlat: 28.8,
    dlong: 77.2,
    daddress: "B",
    dropName: "D",
    dmobile: "888",
    dropType: "",
    packageWeight: "2 Kg",
    packageCost: 100,
    description: "",
    pMethodId: 1,
    transactionId: "",
    extraMileCharge: 0,
    couId: 0,
    couAmt: 0,
    radiusKm: 10,
    cityId: 2,
    photos: null,
  };

  it("creates the order, prices it from the first tier package, and starts dispatch", async () => {
    const result = await createOrderCore(baseInput);

    expect(result.ok).toBe(true);
    expect(result.order.id).toBe(501);
    expect(pricingEngine.priceForPackage).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }), 5);
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(
      result.order,
      { fare: 50, driverEarning: 40, commission: 5 }
    );
  });

  it("stores the provided photos string on the created order", async () => {
    await createOrderCore({ ...baseInput, photos: "images/pack_img/a.jpg,images/pack_img/b.jpg" });

    expect(prisma.pkg_order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ photos: "images/pack_img/a.jpg,images/pack_img/b.jpg" }) })
    );
  });

  it("fails validation when deliveryTypeIds is empty", async () => {
    const result = await createOrderCore({ ...baseInput, deliveryTypeIds: [] });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("VALIDATION");
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("fails with INVALID_PACKAGES when a requested package id doesn't exist", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([]);

    const result = await createOrderCore(baseInput);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_PACKAGES");
    expect(result.invalidPackageIds).toEqual([6]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/controllers/__tests__/orderController.test.js`
Expected: FAIL — `createOrderCore` is not exported.

- [ ] **Step 3: Extract `createOrderCore` and rewrite `createOrder` to use it**

Replace `backend/src/controllers/orderController.js`'s `createOrder` function (lines 47-201) with:

```js
async function createOrderCore({
  uid, category, deliveryTypeIds, bookingType, plat, plong, paddress, pickName, pmobile, pickType,
  dlat, dlong, daddress, dropName, dmobile, dropType, packageWeight, packageCost, description,
  pMethodId, transactionId, extraMileCharge, couId, couAmt, radiusKm, cityId, photos,
}) {
  if (
    !uid ||
    !category ||
    !Array.isArray(deliveryTypeIds) ||
    deliveryTypeIds.length === 0 ||
    ![plat, plong, dlat, dlong].every(isFiniteNumber)
  ) {
    return { ok: false, code: "VALIDATION", msg: "uid, category, a non-empty delivery_type array, and valid coordinates are required" };
  }

  const requestedPackageIds = deliveryTypeIds.map(Number);

  const [validPackages, customer, distanceResult] = await Promise.all([
    prisma.tbl_package.findMany({ where: { id: { in: requestedPackageIds }, status: 1 } }),
    cityId ? Promise.resolve(null) : prisma.tbl_user.findUnique({ where: { id: Number(uid) }, select: { city_id: true } }),
    getRoadDistanceKm(Number(plat), Number(plong), Number(dlat), Number(dlong)),
  ]);

  const packagesById = new Map(validPackages.map((p) => [p.id, p]));
  const invalidPackageIds = requestedPackageIds.filter((id) => !packagesById.has(id));

  if (invalidPackageIds.length > 0) {
    return { ok: false, code: "INVALID_PACKAGES", invalidPackageIds };
  }

  const resolvedCityId = cityId ? Number(cityId) : (customer?.city_id ?? null);

  const parsedRadiusKm = Number(radiusKm);
  const resolvedRadiusKm = Number.isFinite(parsedRadiusKm) ? Math.min(Math.max(parsedRadiusKm, 1), 100) : SEARCH_RADIUS_KM;

  const firstTierPackageId = requestedPackageIds[0];
  const { distanceKm } = distanceResult;
  const { fare, driverEarning, commission } = pricingEngine.priceForPackage(packagesById.get(firstTierPackageId), distanceKm);

  const parsedWeight = parseFloat(String(packageWeight));

  const order = await prisma.pkg_order.create({
    data: {
      uid: Number(uid),
      category,
      o_status: "Pending",
      odate: new Date(),
      p_method_id: Number(pMethodId) || 0,
      plat: String(plat),
      plong: String(plong),
      dlat: String(dlat),
      dlong: String(dlong),
      paddress: paddress || null,
      daddress: daddress || null,
      pmobile: pmobile || null,
      dmobile: dmobile || null,
      pick_type: pickType || "",
      drop_type: dropType || "",
      pick_name: pickName || "",
      drop_name: dropName || "",
      description: description || null,
      distance: distanceKm,
      d_charge: fare,
      total_dcharge: fare,
      commission,
      extra_mile_charge: Number(extraMileCharge) || 0,
      time_duration: 0,
      package_weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
      package_cost: Number(packageCost) || 0,
      cou_id: Number(couId) || 0,
      cou_amt: Number(couAmt) || 0,
      radius_range: Math.round(resolvedRadiusKm),
      radius_charge: 0,
      booking_type: Number(bookingType) || 1,
      city_id: resolvedCityId,
      delivery_type: firstTierPackageId,
      allowed_delivery_types: JSON.stringify(requestedPackageIds),
      trans_id: transactionId || null,
      photos: photos || null,
    },
  });

  dispatchManager.startDispatch(order, { fare, driverEarning, commission }).catch((err) =>
    logger.error(`createOrderCore: dispatch failed to start for order ${order.id}:`, err)
  );

  try {
    adminSocket.notifyNewOrder(order);
  } catch (err) {
    logger.error(`createOrderCore: admin socket notify failed for order ${order.id}:`, err);
  }

  return { ok: true, order };
}

async function createOrder(req, res) {
  try {
    const {
      uid, category, delivery_type, booking_type, plat, plong, paddress, pick_name, pmobile, pick_type,
      dlat, dlong, daddress, drop_name, dmobile, drop_type, package_weight, package_cost, description,
      p_method_id, transaction_id, extra_mile_charge, cou_id, cou_amt, radius_km, city_id,
    } = req.body;

    const result = await createOrderCore({
      uid, category, deliveryTypeIds: delivery_type, bookingType: booking_type, plat, plong, paddress,
      pickName: pick_name, pmobile, pickType: pick_type, dlat, dlong, daddress, dropName: drop_name,
      dmobile, dropType: drop_type, packageWeight: package_weight, packageCost: package_cost, description,
      pMethodId: p_method_id, transactionId: transaction_id, extraMileCharge: extra_mile_charge,
      couId: cou_id, couAmt: cou_amt, radiusKm: radius_km, cityId: city_id, photos: null,
    });

    if (!result.ok && result.code === "VALIDATION") {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: result.msg });
    }
    if (!result.ok && result.code === "INVALID_PACKAGES") {
      return res.status(400).json({
        ResponseCode: "400",
        Result: "false",
        ResponseMsg: `Invalid or inactive package id(s) in delivery_type: ${result.invalidPackageIds.join(", ")}. Call /api/order/fare-estimate first to get valid package_id values for this cat_id.`,
      });
    }

    const { order } = result;
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      order_id: order.id,
      booking_type: order.booking_type,
      ResponseMsg: "Package Order Placed Successfully!!!",
    });
  } catch (err) {
    logger.error("createOrder failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}
```

Update the file's final export line to include `createOrderCore`:

```js
module.exports = { getCategories, fareEstimate, createOrder, createOrderCore, getOrderDetails, customerCancel, rateOrder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/controllers/__tests__/orderController.test.js`
Expected: PASS (4 tests). Then run the full suite: `npx jest` — confirm no regression (this refactor must produce byte-identical behavior for the existing `/api/order/create` route; there is no pre-existing `orderController` test to regress, but re-run the full suite anyway per the Global Constraints).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.test.js
git commit -m "refactor(order-flow): extract createOrderCore for reuse by the legacy bridge"
```

---

### Task 8: `legacyController.createOrder` + route

**Files:**
- Create: `backend/src/controllers/legacyController.js` (this task only adds `createOrder` to it; Tasks 9 and 10 add the other two functions to the same file)
- Create: `backend/src/routes/legacyRoutes.js`
- Create: `backend/src/controllers/__tests__/legacyController.test.js`

**Interfaces:**
- Consumes: `orderController.createOrderCore` from Task 7.
- Produces: `legacyController.createOrder(req, res)` — an Express handler matching `cust_api/pks_order.php`'s current response shape.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../orderController", () => ({ createOrderCore: jest.fn() }));

const orderController = require("../orderController");
const legacyController = require("../legacyController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("legacyController.createOrder", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parses PHP's bracket-string delivery_type and resolves radius from radius_range", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: true, order: { id: 501, booking_type: 1 } });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "[6,7]", radius_range: "12", plat: "28.7", plong: "77.1", dlat: "28.8", dlong: "77.2" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(orderController.createOrderCore).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryTypeIds: [6, 7], radiusKm: 12 })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", order_id: 501 }));
  });

  it("falls back through the legacy radius aliases when radius_range is absent", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: true, order: { id: 502, booking_type: 1 } });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "6", search_radius: "8" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(orderController.createOrderCore).toHaveBeenCalledWith(expect.objectContaining({ radiusKm: 8 }));
  });

  it("returns a soft failure JSON when delivery_type is empty, matching PHP's shape", async () => {
    const req = { body: { uid: "1", category: "Bike", delivery_type: "" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(orderController.createOrderCore).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "delivery_type required" });
  });

  it("returns 'No package found' when createOrderCore reports INVALID_PACKAGES", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: false, code: "INVALID_PACKAGES", invalidPackageIds: [6] });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "6" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "No package found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/controllers/__tests__/legacyController.test.js`
Expected: FAIL — `Cannot find module '../legacyController'`.

- [ ] **Step 3: Implement `legacyController.createOrder`**

```js
const orderController = require("./orderController");
const logger = require("../utils/logger");
const { POPUP_TIMEOUT_MS } = require("../config/constants");

function parseDeliveryTypes(raw) {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  if (typeof raw !== "string") return [];
  return raw
    .replace(/[[\]]/g, "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function resolveRadiusKm(body) {
  const radiusRange = Number(body.radius_range);
  if (Number.isFinite(radiusRange) && radiusRange > 0) return radiusRange;
  return Number(body.radius) || Number(body.search_radius) || Number(body.pickup_radius) || Number(body.driver_radius) || 10;
}

async function createOrder(req, res) {
  try {
    const raw = req.body;
    const deliveryTypeIds = parseDeliveryTypes(raw.delivery_type);

    if (deliveryTypeIds.length === 0) {
      return res.json({ Result: false, msg: "delivery_type required" });
    }

    const result = await orderController.createOrderCore({
      uid: raw.uid,
      category: raw.category,
      deliveryTypeIds,
      bookingType: raw.booking_type,
      plat: raw.plat,
      plong: raw.plong,
      paddress: raw.paddress,
      pickName: raw.pick_name,
      pmobile: raw.pmobile,
      pickType: raw.pick_type,
      dlat: raw.dlat,
      dlong: raw.dlong,
      daddress: raw.daddress,
      dropName: raw.drop_name,
      dmobile: raw.dmobile,
      dropType: raw.drop_type,
      packageWeight: raw.package_weight,
      packageCost: raw.package_cost,
      description: raw.description,
      pMethodId: raw.p_method_id,
      transactionId: raw.transaction_id,
      extraMileCharge: raw.extra_mile_charge,
      couId: raw.cou_id,
      couAmt: raw.cou_amt,
      radiusKm: resolveRadiusKm(raw),
      cityId: raw.city_id,
      photos: raw.photos || null,
    });

    if (!result.ok && result.code === "VALIDATION") {
      return res.json({ Result: false, msg: result.msg });
    }
    if (!result.ok && result.code === "INVALID_PACKAGES") {
      return res.json({ Result: false, msg: "No package found" });
    }

    const { order } = result;
    return res.json({
      order_id: order.id,
      booking_type: order.booking_type,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: order.booking_type === 3
        ? "Your order has been placed successfully. Delivery will be scheduled for the next day between 9:00 AM and 10:00 AM."
        : "Package Order Placed Successfully!!!",
      batch_no: 1,
      drivers_notified: 0,
      driver_ids: [],
      popup_duration: POPUP_TIMEOUT_MS / 1000,
      expires_at: "",
      next_batch_in: 5,
    });
  } catch (err) {
    logger.error("legacyController.createOrder failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { createOrder };
```

Note: `drivers_notified`/`driver_ids`/`expires_at` are deliberately static placeholders in the *response body* (`0`, `[]`, `""`), not a code placeholder — Node's dispatch is fire-and-forget for response-speed reasons (see Task 7's `createOrderCore`, which does not `await dispatchManager.startDispatch`), so these informational fields cannot be populated synchronously without slowing down every order-creation response by the same latency currently seen in Batch 1 dispatch. The app does not need these fields for correctness — driver popups are delivered by push (Tasks 3-4), independent of what this response says.

Create `backend/src/routes/legacyRoutes.js`:

```js
const express = require("express");
const legacyAuth = require("../middleware/legacyAuth");
const legacyController = require("../controllers/legacyController");

const router = express.Router();

router.use(legacyAuth);

router.post("/order/create", legacyController.createOrder);

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/controllers/__tests__/legacyController.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/legacyController.js backend/src/routes/legacyRoutes.js backend/src/controllers/__tests__/legacyController.test.js
git commit -m "feat(legacy-bridge): add /legacy/order/create route"
```

---

### Task 9: `legacyController.rejectOrder` + route

**Files:**
- Modify: `backend/src/controllers/legacyController.js` (add `rejectOrder`)
- Modify: `backend/src/routes/legacyRoutes.js` (add the route)
- Modify: `backend/src/controllers/__tests__/legacyController.test.js`

**Interfaces:**
- Consumes: `tripLifecycle.rejectOrder(orderId, riderId)` (already exists, already imported into `legacyController.js` in Task 8).
- Produces: `legacyController.rejectOrder(req, res)`, response shape `{"Result": true}` exactly matching PHP's current `rider_api/reject_order.php`.

- [ ] **Step 1: Write the failing test**

Add to `legacyController.test.js`:

```js
jest.mock("../../services/tripLifecycle", () => ({ rejectOrder: jest.fn().mockResolvedValue({ success: true }) }));

describe("legacyController.rejectOrder", () => {
  it("calls tripLifecycle.rejectOrder and returns {Result: true}", async () => {
    const tripLifecycle = require("../../services/tripLifecycle");
    const req = { body: { rider_id: "3", order_id: "42" } };
    const res = mockRes();

    await legacyController.rejectOrder(req, res);

    expect(tripLifecycle.rejectOrder).toHaveBeenCalledWith(42, 3);
    expect(res.json).toHaveBeenCalledWith({ Result: true });
  });

  it("returns 400 when rider_id or order_id is missing", async () => {
    const req = { body: { rider_id: "3" } };
    const res = mockRes();

    await legacyController.rejectOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

(`mockRes()` is already defined once at the top of this test file, above the `createOrder` describe block from Task 8 — reuse it as-is, do not redefine it. Place this new `describe("legacyController.rejectOrder", ...)` block alongside the existing `describe("legacyController.createOrder", ...)` block, not nested inside it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/controllers/__tests__/legacyController.test.js -t "rejectOrder"`
Expected: FAIL — `legacyController.rejectOrder` is not a function.

- [ ] **Step 3: Implement `rejectOrder`**

Add `const tripLifecycle = require("../services/tripLifecycle");` to `backend/src/controllers/legacyController.js`'s existing require block at the top (alongside `orderController`/`logger`/`POPUP_TIMEOUT_MS`).

Add to `backend/src/controllers/legacyController.js`, above `module.exports`:

```js
async function rejectOrder(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    const orderId = Number(req.body.order_id);
    if (!Number.isFinite(riderId) || !Number.isFinite(orderId)) {
      return res.status(400).json({ Result: false, msg: "rider_id and order_id are required" });
    }

    await tripLifecycle.rejectOrder(orderId, riderId);
    return res.json({ Result: true });
  } catch (err) {
    logger.error("legacyController.rejectOrder failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}
```

Update the export line:

```js
module.exports = { createOrder, rejectOrder };
```

Add the route to `backend/src/routes/legacyRoutes.js`:

```js
router.post("/order/reject", legacyController.rejectOrder);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/controllers/__tests__/legacyController.test.js`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/legacyController.js backend/src/routes/legacyRoutes.js backend/src/controllers/__tests__/legacyController.test.js
git commit -m "feat(legacy-bridge): add /legacy/order/reject route"
```

---

### Task 10: `legacyController.stopDispatch` + route (accept/cancel notify endpoint)

**Files:**
- Modify: `backend/src/controllers/legacyController.js` (add `stopDispatch`)
- Modify: `backend/src/routes/legacyRoutes.js` (add the route)
- Modify: `backend/src/controllers/__tests__/legacyController.test.js`

**Interfaces:**
- Consumes: `dispatchManager.stopDispatch(orderId, reason)` (already exists, already imported in Task 8), `pushNotifier.notifyCustomerOrderAssigned` from Task 2, `prisma.pkg_order.findUnique`, `prisma.tbl_rider.findUnique`, `prisma.tbl_user.findUnique`.
- Produces: `legacyController.stopDispatch(req, res)`, called by PHP from `accept_order.php` (with `accepted_rider_id`) and `pks_cancle.php` (without it).

- [ ] **Step 1: Write the failing test**

Add to `legacyController.test.js`:

```js
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock("../../services/dispatchManager", () => ({ stopDispatch: jest.fn(), startDispatch: jest.fn() }));
jest.mock("../../services/pushNotifier", () => ({ notifyCustomerOrderAssigned: jest.fn().mockResolvedValue({ sent: true }) }));

describe("legacyController.stopDispatch", () => {
  const prisma = require("../../config/db");
  const dispatchManager = require("../../services/dispatchManager");
  const pushNotifier = require("../../services/pushNotifier");

  beforeEach(() => jest.clearAllMocks());

  it("stops the dispatch cascade and returns {Result: true} when no rider is given (cancel path)", async () => {
    const req = { body: { order_id: "42", reason: "cancelled_by_user" } };
    const res = mockRes();

    await legacyController.stopDispatch(req, res);

    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(42, "cancelled_by_user");
    expect(pushNotifier.notifyCustomerOrderAssigned).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ Result: true });
  });

  it("also pushes an order-assigned notification to the customer when accepted_rider_id is given (accept path)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 42, uid: 9, otp: 1234 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 3, first_name: "Deepak", last_name: "", fmobile: "999", vehicle_no: "MP-01" });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });

    const req = { body: { order_id: "42", reason: "accepted_by_other", accepted_rider_id: "3" } };
    const res = mockRes();

    await legacyController.stopDispatch(req, res);

    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(42, "accepted_by_other");
    expect(pushNotifier.notifyCustomerOrderAssigned).toHaveBeenCalledWith(
      "cust-tok",
      expect.objectContaining({ order_id: 42, rider_name: "Deepak", otp: 1234 })
    );
    expect(res.json).toHaveBeenCalledWith({ Result: true });
  });

  it("returns 400 when order_id is missing", async () => {
    const req = { body: {} };
    const res = mockRes();

    await legacyController.stopDispatch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/controllers/__tests__/legacyController.test.js -t "stopDispatch"`
Expected: FAIL — `legacyController.stopDispatch` is not a function.

- [ ] **Step 3: Implement `stopDispatch`**

Add these three requires to `backend/src/controllers/legacyController.js`'s existing require block at the top (alongside `orderController`/`tripLifecycle`/`logger`/`POPUP_TIMEOUT_MS`):

```js
const dispatchManager = require("../services/dispatchManager");
const pushNotifier = require("../services/pushNotifier");
const prisma = require("../config/db");
```

Add to `backend/src/controllers/legacyController.js`, above `module.exports`:

```js
async function stopDispatch(req, res) {
  try {
    const orderId = Number(req.body.order_id);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ Result: false, msg: "order_id is required" });
    }
    const reason = req.body.reason || "accepted_by_other";

    dispatchManager.stopDispatch(orderId, reason);

    const riderId = Number(req.body.accepted_rider_id);
    if (Number.isFinite(riderId) && riderId > 0) {
      const [order, rider] = await Promise.all([
        prisma.pkg_order.findUnique({ where: { id: orderId } }),
        prisma.tbl_rider.findUnique({ where: { id: riderId } }),
      ]);

      if (order) {
        const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
        await pushNotifier.notifyCustomerOrderAssigned(customer?.fcm_token, {
          order_id: orderId,
          rider_name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "",
          rider_phone: rider ? rider.fmobile : "",
          vehicle_no: rider ? rider.vehicle_no : "",
          otp: order.otp,
        });
      }
    }

    return res.json({ Result: true });
  } catch (err) {
    logger.error("legacyController.stopDispatch failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}
```

Update the export line:

```js
module.exports = { createOrder, rejectOrder, stopDispatch };
```

Add the route to `backend/src/routes/legacyRoutes.js`:

```js
router.post("/dispatch/stop", legacyController.stopDispatch);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/controllers/__tests__/legacyController.test.js`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/legacyController.js backend/src/routes/legacyRoutes.js backend/src/controllers/__tests__/legacyController.test.js
git commit -m "feat(legacy-bridge): add /legacy/dispatch/stop route for accept/cancel notify"
```

---

### Task 11: Mount `/legacy` in `app.js`, document env vars

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/.env.example`

**Interfaces:** none (wiring only).

- [ ] **Step 1: Mount the router**

In `backend/src/app.js`, add near the other route requires:

```js
const legacyRoutes = require("./routes/legacyRoutes");
```

And near the other `app.use("/api/...")` lines:

```js
app.use("/legacy", legacyRoutes);
```

- [ ] **Step 2: Document the new env vars**

Append to `backend/.env.example`:

```
# Shared secret the legacy PHP backend must send as the X-Legacy-Bridge-Secret
# header on every request to /legacy/* — generate a long random string and
# set the exact same value in the PHP admin/include/NodeBridge.php constant.
LEGACY_BRIDGE_SECRET=change-me-to-a-long-random-string

# Path to the Firebase service-account JSON (already present in the legacy
# PHP admin folder) — required for driver/customer push notifications.
# FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/shifter-new-firebase-adminsdk-fbsvc-xxxxx.json
```

- [ ] **Step 3: Verify the app still boots and the full suite passes**

Run (from `backend/`): `npx jest`
Expected: PASS, full suite, no regressions.

Run: `node -e "require('./src/app.js'); console.log('app.js loaded OK')"`
Expected: prints `app.js loaded OK` with no thrown error (confirms the new route file has no syntax/require errors).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.js backend/.env.example
git commit -m "feat(legacy-bridge): mount /legacy routes, document required env vars"
```

---

### Task 12: Push "order assigned" from Node's own `tripLifecycle.acceptOrder` too

**Files:**
- Modify: `backend/src/services/tripLifecycle.js:100-116` (end of `acceptOrder`)
- Modify: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `pushNotifier.notifyCustomerOrderAssigned` from Task 2.

This keeps behavior consistent between an order accepted through Node directly (the Socket.IO `order:accept` handler, used by the simulator/any future Node-native client) and one accepted through the PHP bridge (Task 10) — both paths end up pushing the same customer notification.

- [ ] **Step 1: Write the failing test**

Add to `tripLifecycle.test.js`'s existing `acceptOrder` describe block:

```js
it("pushes an order-assigned FCM notification to the customer", async () => {
  const pushNotifier = require("../pushNotifier");
  prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
  prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 297, uid: 9, delivery_type: 6, distance: 15.4, otp: 4321 });
  prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });

  await tripLifecycle.acceptOrder(297, 1);

  expect(pushNotifier.notifyCustomerOrderAssigned).toHaveBeenCalledWith(
    "cust-tok",
    expect.objectContaining({ order_id: 297, rider_name: "Deepak", otp: 4321 })
  );
});
```

Add `jest.mock("../pushNotifier", () => ({ notifyCustomerOrderAssigned: jest.fn().mockResolvedValue({ sent: true }) }));` near this file's other `jest.mock` calls, and add `tbl_user: { findUnique: jest.fn() }` to the existing `jest.mock("../../config/db", ...)` factory (it currently doesn't have `tbl_user`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/tripLifecycle.test.js -t "order-assigned"`
Expected: FAIL — `pushNotifier.notifyCustomerOrderAssigned` not called.

- [ ] **Step 3: Add the push to `acceptOrder`**

In `backend/src/services/tripLifecycle.js`, add the import near the top:

```js
const pushNotifier = require("./pushNotifier");
```

Replace the end of `acceptOrder` (currently ending with `lockManager.releaseLock(riderId); dispatchManager.stopDispatch(orderId, "accepted_by_other"); const rider = await prisma.tbl_rider.findUnique(...); notifyAdminStatus(order); return {...}`):

```js
  lockManager.releaseLock(riderId);
  dispatchManager.stopDispatch(orderId, "accepted_by_other");

  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  notifyAdminStatus(order);

  const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
  await pushNotifier.notifyCustomerOrderAssigned(customer?.fcm_token, {
    order_id: orderId,
    rider_name: `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
    rider_phone: rider.fmobile,
    vehicle_no: rider.vehicle_no,
    otp: order.otp,
  });

  return {
    success: true,
    order: { ...order, ...priced, package: pkg },
    rider,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/__tests__/tripLifecycle.test.js`
Expected: PASS, full file. Then `npx jest` for the full suite.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/services/__tests__/tripLifecycle.test.js
git commit -m "feat(legacy-bridge): push order-assigned FCM notification from tripLifecycle.acceptOrder"
```

---

### Task 13: PHP `NodeBridge.php` shared helper

**Files:**
- Create: `php backend/public_html/admin/include/NodeBridge.php`

**Interfaces:**
- Produces: `callNodeLegacy($path, $payload)` — PHP function, returns the decoded JSON array from Node, or a `{"Result": false, "msg": "...", "_bridge_error": true}` array if Node is unreachable or returns invalid JSON. Never throws.

No automated test for this task (no PHP test runner exists in this repo) — verified manually in Task 19.

- [ ] **Step 1: Create the file**

```php
<?php

if (!defined('NODE_BACKEND_URL')) {
    // Set this to your deployed Node backend's base URL.
    define('NODE_BACKEND_URL', 'http://localhost:5000');
}
if (!defined('NODE_BRIDGE_SECRET')) {
    // Must exactly match LEGACY_BRIDGE_SECRET in backend/.env
    define('NODE_BRIDGE_SECRET', 'change-me-to-match-backend-env-LEGACY_BRIDGE_SECRET');
}

if (!function_exists('callNodeLegacy')) {
    function callNodeLegacy($path, $payload) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => rtrim(NODE_BACKEND_URL, '/') . $path,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Legacy-Bridge-Secret: ' . NODE_BRIDGE_SECRET,
            ],
            CURLOPT_TIMEOUT => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
        ]);

        $response = curl_exec($ch);
        $curlErr = curl_error($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false) {
            return ['Result' => false, 'msg' => 'Node backend unreachable: ' . $curlErr, '_bridge_error' => true];
        }

        $decoded = json_decode($response, true);
        if (!is_array($decoded)) {
            return ['Result' => false, 'msg' => 'Node backend returned an invalid response', '_bridge_error' => true, '_http_code' => $httpCode];
        }

        return $decoded;
    }
}
```

- [ ] **Step 2: Fill in the real config values**

Edit the two `define(...)` calls at the top of the file just created: set `NODE_BACKEND_URL` to the actual deployed Node backend URL (e.g. `https://shifteronline-nodejs.onrender.com`, per `backend/scripts/test-render-live-order-flow.js`), and set `NODE_BRIDGE_SECRET` to the exact same value you set for `LEGACY_BRIDGE_SECRET` in `backend/.env` (Task 11).

- [ ] **Step 3: Commit**

```bash
git add "php backend/public_html/admin/include/NodeBridge.php"
git commit -m "feat(legacy-bridge): add PHP-side helper for calling Node's /legacy routes"
```

---

### Task 14: `cust_api/pks_order.php` becomes a thin proxy

**Files:**
- Modify: `php backend/public_html/admin/cust_api/pks_order.php` (full rewrite — replace the entire 820-line file)

**Interfaces:**
- Consumes: `callNodeLegacy` from Task 13.

- [ ] **Step 1: Replace the file's entire contents**

```php
<?php
require dirname(dirname(__FILE__)).'/include/dbconfig.php';
require dirname(dirname(__FILE__)).'/include/NodeBridge.php';

header('Content-type: application/json');

// Photo upload stays here — this is the only PHP-side concern left. Node
// receives the resulting relative paths as a comma-joined "photos" string,
// exactly as pkg_order.photos already stores them.
$size = isset($_POST['size']) ? (int)$_POST['size'] : 0;
$target_path = dirname(dirname(__FILE__)).'/images/pack_img/';
$url = 'images/pack_img/';
$v = array();
for ($x = 0; $x < $size; $x++) {
    if (!isset($_FILES['image'.$x])) continue;
    $newname = uniqid().date('YmdHis', time()).mt_rand().'.jpg';
    $v[] = $url.$newname;
    move_uploaded_file($_FILES['image'.$x]['tmp_name'], $target_path.$newname);
}
$photos = implode(',', $v);

$payload = $_POST;
$payload['photos'] = $photos;

$result = callNodeLegacy('/legacy/order/create', $payload);

echo json_encode($result);
```

- [ ] **Step 2: Commit**

```bash
git add "php backend/public_html/admin/cust_api/pks_order.php"
git commit -m "refactor(legacy-bridge): pks_order.php becomes a thin proxy to Node's dispatch engine"
```

---

### Task 15: `rider_api/reject_order.php` becomes a thin proxy

**Files:**
- Modify: `php backend/public_html/admin/rider_api/reject_order.php` (full rewrite)

**Interfaces:**
- Consumes: `callNodeLegacy` from Task 13.

- [ ] **Step 1: Replace the file's entire contents**

```php
<?php
require '../include/dbconfig.php';
require '../include/NodeBridge.php';

header('Content-type: application/json');

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) $data = array();

$result = callNodeLegacy('/legacy/order/reject', [
    'rider_id' => (int)($data['rider_id'] ?? 0),
    'order_id' => (int)($data['order_id'] ?? 0),
]);

echo json_encode($result);
```

- [ ] **Step 2: Commit**

```bash
git add "php backend/public_html/admin/rider_api/reject_order.php"
git commit -m "refactor(legacy-bridge): reject_order.php becomes a thin proxy to Node"
```

---

### Task 16: `rider_api/accept_order.php` — add the stop-dispatch notify call

**Files:**
- Modify: `php backend/public_html/admin/rider_api/accept_order.php` (one insertion, right after `$mysqli->commit();`)

**Interfaces:**
- Consumes: `callNodeLegacy` from Task 13.

This file's existing pricing/advance-payment logic is untouched — this task only adds one new call.

- [ ] **Step 1: Add the `require` near the top of the file**

Immediately after the existing `require '../include/dbconfig.php';` line, add:

```php
require '../include/NodeBridge.php';
```

- [ ] **Step 2: Add the notify call right after the commit**

Find:

```php
$mysqli->commit();

$out = array(
```

Replace with:

```php
$mysqli->commit();

// Tell Node's dispatch engine this order is taken so it stops offering it
// to other drivers and dismisses everyone else's popup. Best-effort: if
// Node is unreachable, those other popups still self-expire on their own
// 15s timeout, so this driver's acceptance above is already safe either way.
callNodeLegacy('/legacy/dispatch/stop', [
    'order_id' => $order_id,
    'reason' => 'accepted_by_other',
    'accepted_rider_id' => $rider_id,
]);

$out = array(
```

- [ ] **Step 3: Commit**

```bash
git add "php backend/public_html/admin/rider_api/accept_order.php"
git commit -m "feat(legacy-bridge): notify Node to stop dispatch when a driver accepts"
```

---

### Task 17: `cust_api/pks_cancle.php` — add the stop-dispatch notify call

**Files:**
- Modify: `php backend/public_html/admin/cust_api/pks_cancle.php` (one insertion)

**Interfaces:**
- Consumes: `callNodeLegacy` from Task 13.

This file's existing wallet-penalty/driver-compensation/push logic is untouched — this task only adds one new call.

- [ ] **Step 1: Add the `require` near the top of the file**

Immediately after the existing `require dirname(dirname(__FILE__)) . '/include/Common.php';` line, add:

```php
require dirname(dirname(__FILE__)) . '/include/NodeBridge.php';
```

- [ ] **Step 2: Add the notify call right after the cancellation update**

Find:

```php
        $table  = "pkg_order";
        $field  = array('o_status' => "Cancelled", 'cancel_reason' => $comment_esc);
        $where  = "where uid='" . $uid . "' AND id=" . $order_id;
        $h      = new Common();
        $check  = $h->UpdateData_Api($field, $table, $where);

   
        // ❌ Agar driver ne already accept kar li thi
```

Replace with:

```php
        $table  = "pkg_order";
        $field  = array('o_status' => "Cancelled", 'cancel_reason' => $comment_esc);
        $where  = "where uid='" . $uid . "' AND id=" . $order_id;
        $h      = new Common();
        $check  = $h->UpdateData_Api($field, $table, $where);

        // Tell Node's dispatch engine to stop offering this order — a no-op
        // if it was already accepted (Node has no cascade state left for it
        // by then), and best-effort otherwise: any already-sent popups still
        // self-expire on their own 15s timeout if this call fails.
        callNodeLegacy('/legacy/dispatch/stop', [
            'order_id' => (int)$order_id,
            'reason' => 'cancelled_by_user',
        ]);

        // ❌ Agar driver ne already accept kar li thi
```

- [ ] **Step 3: Commit**

```bash
git add "php backend/public_html/admin/cust_api/pks_cancle.php"
git commit -m "feat(legacy-bridge): notify Node to stop dispatch on customer cancel"
```

---

### Task 18: `cust_api/check_driver.php` — remove the dispatch/expire logic it no longer owns

**Files:**
- Modify: `php backend/public_html/admin/cust_api/check_driver.php`

**Interfaces:** none — this is a deletion, not a new interface.

Node's `dispatchManager` now owns marking popups as timed out (Task 4) and computing/dispatching every batch (already true before this plan — `runBatch`'s own timers). If this file keeps calling `expireStaleRequests()` and computing/dispatching its own batches, it will race Node's cascade and double-fire. The app-facing "has my order been assigned or cancelled yet" read stays, unchanged in shape.

- [ ] **Step 1: Remove the `expireStaleRequests` call**

Find (around line 368):

```php
/* =========================================================
   STEP 0 — PURANE POPUPS EXPIRE
   ========================================================= */

expireStaleRequests($mysqli);
```

Replace with:

```php
/* =========================================================
   STEP 0 — REMOVED: Node's dispatchManager now owns expiring
   stale popups and dispatching every batch. This file is now
   read-only status reporting past this point.
   ========================================================= */
```

(The `expireStaleRequests` and `getBlockedDriverIds`/`computePackagePrice` function definitions earlier in the file can stay — they're now unused but harmless; removing them is not necessary for correctness.)

- [ ] **Step 2: Replace everything from STEP 4 onward with a read-only "still searching" response**

Find the STEP 4 comment block (starts right after STEP 3's `exit;` — search for `STEP 4 — CATEGORY`) and delete everything from that comment block through the end of the file. Replace it with:

```php
/* =========================================================
   STEP 4 — REMOVED: batch computation and dispatch now live
   entirely in Node's dispatchManager (see backend/src/services/
   dispatchManager.js). This endpoint is read-only past STEP 3:
   if we reach here, the order is still unassigned and not
   cancelled, so just report that.
   ========================================================= */

echo json_encode([
    "Result"    => true,
    "assigned"  => false,
    "cancelled" => false,
    "msg"       => "Still searching for a driver"
]);
exit;
```

- [ ] **Step 3: Commit**

```bash
git add "php backend/public_html/admin/cust_api/check_driver.php"
git commit -m "refactor(legacy-bridge): check_driver.php no longer owns batch dispatch/expiry"
```

---

### Task 19: End-to-end verification against a local PHP server

**Files:**
- Create: `backend/scripts/test-php-node-bridge.js`

**Interfaces:** none — this is a verification script, not code other tasks depend on.

This requires a local PHP dev server pointed at `php backend/public_html/admin`, with `NODE_BACKEND_URL` in `NodeBridge.php` set to `http://localhost:5000` (or wherever the local Node server runs) and `LEGACY_BRIDGE_SECRET`/`NODE_BRIDGE_SECRET` set to matching values in both `backend/.env` and `NodeBridge.php`.

- [ ] **Step 1: Start both servers locally**

Run (from `backend/`): `npm run dev` (or however the existing dev script starts the Node server — check `package.json`'s `scripts` block; use `node src/server.js` if there is no dev script)

Run (from `php backend/public_html/admin`, in a separate terminal): `php -S localhost:8080`

- [ ] **Step 2: Write the verification script**

```js
/**
 * Drives the full create -> driver popup -> accept flow through the PHP
 * URLs (not Node directly), confirming the PHP-to-Node bridge works
 * end-to-end. Requires both servers running locally (see Task 19's Step 1).
 */
const ioClient = require("socket.io-client");

const PHP_BASE_URL = process.env.PHP_BASE_URL || "http://localhost:8080";
const NODE_BASE_URL = process.env.NODE_BASE_URL || "http://localhost:5000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log(`Connecting a test driver socket to ${NODE_BASE_URL}...`);
  const driverSocket = ioClient(NODE_BASE_URL, { transports: ["websocket"], forceNew: true });
  const testRiderId = Number(process.env.TEST_RIDER_ID || 1);

  await new Promise((resolve) => driverSocket.on("connect", resolve));
  driverSocket.emit("driver:join", { rider_id: testRiderId });

  const orderRequestPromise = new Promise((resolve) => {
    driverSocket.once("order:request", resolve);
  });

  console.log(`Placing an order through the PHP URL (${PHP_BASE_URL}/cust_api/pks_order.php)...`);
  const createRes = await fetch(`${PHP_BASE_URL}/cust_api/pks_order.php`, {
    method: "POST",
    body: new URLSearchParams({
      uid: process.env.TEST_UID || "1",
      category: "Bike",
      delivery_type: "[6]",
      booking_type: "1",
      plat: "22.7356214",
      plong: "75.9110814",
      dlat: "22.7156214",
      dlong: "75.8810814",
      paddress: "Test Pickup",
      daddress: "Test Drop",
      pick_name: "Bridge Test",
      pmobile: "9999900000",
      package_weight: "2",
      package_cost: "100",
      size: "0",
    }),
  });
  const createJson = await createRes.json();
  console.log("PHP create-order response:", createJson);

  if (createJson.Result !== "true" && createJson.Result !== true) {
    throw new Error("Order creation through PHP failed");
  }

  console.log("Waiting up to 10s for the driver socket to receive 'order:request' via Node's cascade...");
  const orderRequest = await Promise.race([
    orderRequestPromise,
    sleep(10000).then(() => null),
  ]);

  if (!orderRequest) {
    throw new Error("Driver socket never received order:request — bridge is broken");
  }
  console.log("Driver socket received order:request:", orderRequest);

  console.log(`Accepting through the PHP URL (${PHP_BASE_URL}/rider_api/accept_order.php)...`);
  const acceptRes = await fetch(`${PHP_BASE_URL}/rider_api/accept_order.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rider_id: testRiderId, order_id: Number(createJson.order_id) }),
  });
  const acceptJson = await acceptRes.json();
  console.log("PHP accept response:", acceptJson);

  if (acceptJson.Result !== true) {
    throw new Error("Accept through PHP failed");
  }

  console.log("SUCCESS: PHP -> Node bridge round-trip verified.");
  driverSocket.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Bridge verification FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it and confirm success**

Run (from `backend/`): `TEST_RIDER_ID=<a real online test driver's id> TEST_UID=<a real test customer's id> node scripts/test-php-node-bridge.js`
Expected: prints `SUCCESS: PHP -> Node bridge round-trip verified.` and exits 0. If it fails, check: `LEGACY_BRIDGE_SECRET` matches on both sides, both servers are actually running, and the test rider is online with a valid `fcm_token`/joined the `driver_<id>` room (an FCM send failure alone won't break this script since it only asserts the socket event, but check Node's logs for `sendPushNotification failed` to confirm push itself also works if a real device is available to test against).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/test-php-node-bridge.js
git commit -m "test(legacy-bridge): add end-to-end PHP-to-Node verification script"
```
