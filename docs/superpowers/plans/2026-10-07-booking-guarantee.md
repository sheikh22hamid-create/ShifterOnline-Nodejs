# Booking Guarantee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When every model a customer switched ON fails to find a driver, hold the order for a configurable admin-assignment window; if no driver is assigned in time, cancel it and credit the customer the highest selected model's configured compensation, exactly once.

**Architecture:** A `booking_guarantee_case` row (unique per order) owns the wait. `dispatchManager.checkCascadeTermination` opens the case instead of cancelling; `assignRider` / customer cancel / admin cancel close it; an interval sweeper (also run at boot) expires overdue cases in one DB transaction (flip case, cancel order, credit wallet), then runs the idempotent refunds. Compensation is computed by one pure function from `tbl_package.sort_order` + a new `tbl_package.no_driver_compensation`, so no model number is hard-coded.

**Tech Stack:** Node 18 / Express 5, Prisma 6 (MySQL), Jest, Socket.IO; React 19 + Vite admin panel (`frontend/`); Flutter customer app (`ShifterOnline/`).

**Spec:** `docs/superpowers/specs/2026-10-07-booking-guarantee-design.md`

## Global Constraints

- No hard-coded Model 1–5 anywhere. "Highest model" = highest `tbl_package.sort_order` among the order's `allowed_delivery_types` (ties broken by higher id).
- Do not rebuild the model toggle, the model config, or the driver search; do not change cascade behaviour when a driver is found.
- Compensation payable only when all selected models failed AND the admin window expired AND no driver was assigned.
- Compensation and selected models are frozen on the case at open time; later config edits never change them.
- One case per order (`booking_guarantee_case.order_id` UNIQUE). Wallet credit idempotency key: `tbl_wallet_history.payment_id = "booking_guarantee_credit:<orderId>"`.
- Admin Assignment Time: integer minutes, 1–1440, default 10, stored in `app_settings` key `booking_guarantee_assign_minutes`; each case snapshots its own `deadline_at`.
- Customer events: `order:guarantee_pending { order_id, amount, deadline_at }`; `order:no_driver_found` gains `compensation_amount`. Admin alert message: `BOOKING GUARANTEE – MANUAL DRIVER ASSIGNMENT REQUIRED`.
- Wallet ledger timestamps use `istNow()` from `backend/src/utils/istTime.js`. Case/audit timestamps use plain `new Date()`.
- Backend tests: `cd backend && npx jest <path>`. Commit after every task. Branch: `feature/booking-guarantee`.
- The prepaid-fare refund still happens separately from compensation (existing `refundIfWalletPaid` + `refundReferralPointsForOrder`).

## Review Focus

Failure modes the spec implies but no spec section spells out — each is pinned by a test in the owning task:

1. **Server restart while a case is open** — `reconcileStaleOffersOnStartup` cancels every `Pending, rid=0` order older than 2 min with NO compensation. Expected: orders with an open case are skipped, then paid by the sweeper. (Task 5)
2. **Admin assigns at the same instant the sweeper expires** — exactly one wins; the loser does nothing and no money moves. (Task 4)
3. **Sweeper runs twice / two instances** — the customer is credited once. (Task 4)
4. **Crash between the money transaction and the fare refund** — the order is cancelled and compensation paid but the wallet-prepaid fare refund never ran. Expected: the sweeper's repair pass finishes the refunds. (Task 4)
5. **Order already cancelled/assigned by another path when the case expires** — no compensation, case closed as `cancelled`. (Task 4)
6. **Config edited mid-window** (package deleted/disabled/compensation changed) — payout uses the frozen amount. (Task 4)
7. **Customer app safety timer** — the waiting screen auto-closes after 130 s, long before a 10+ min admin window; on `order:guarantee_pending` it must stop that timer or the customer is dumped to Home while their order is still alive. (Task 11)

---

## File Structure

**Backend – create**
- `backend/prisma/migrations/20261007020000_add_booking_guarantee/migration.sql` — column + 2 tables.
- `backend/src/services/bookingGuaranteeRules.js` — pure: `computeGuaranteeCompensation`, `guaranteeStateFor`.
- `backend/src/services/bookingGuaranteeSettings.js` — assignment-window setting get/set.
- `backend/src/services/bookingGuaranteeService.js` — open / close / expire / quote / view.
- `backend/src/controllers/bookingGuaranteeController.js` — customer `quote` endpoint.
- `backend/src/controllers/adminBookingGuaranteeController.js` — admin settings + cases + audit.
- Tests: `backend/src/services/__tests__/bookingGuaranteeRules.test.js`, `bookingGuaranteeSettings.test.js`, `bookingGuaranteeService.test.js`, `backend/src/controllers/__tests__/bookingGuaranteeController.test.js`, `adminBookingGuaranteeController.test.js`.

**Backend – modify**
- `backend/prisma/schema.prisma` — `tbl_package.no_driver_compensation`, two new models.
- `backend/src/config/constants.js` — default minutes + sweep interval.
- `backend/src/services/dispatchManager.js` — open case in `checkCascadeTermination`; exclude open cases from startup reconciliation.
- `backend/src/sockets/adminSocket.js` — `notifyDispatchAlert` accepts an `extra` payload.
- `backend/src/controllers/adminOrderController.js` — `assignRider` resolves case; `cancel` closes case.
- `backend/src/services/tripLifecycle.js` — `customerCancel` closes case.
- `backend/src/services/pushNotifier.js` — `notifyCustomerNoDriverFound` optional compensation text.
- `backend/src/controllers/orderController.js` — `guarantee` block in `getOrderDetails`.
- `backend/src/routes/orderRoutes.js`, `backend/src/routes/adminRoutes.js` — routes.
- `backend/src/controllers/rateCardController.js` — `no_driver_compensation` create/update + validation.
- `backend/src/server.js` — sweeper interval + boot run.
- Test files that mock modules `dispatchManager` / `tripLifecycle` / `adminOrderController` — add a `bookingGuaranteeService` mock (listed per task).

**Admin panel – create/modify**
- Create `frontend/src/pages/BookingGuarantee.jsx`, `frontend/src/components/orders/GuaranteeCountdown.jsx`, `frontend/src/components/orders/GuaranteeBanner.jsx`.
- Modify `frontend/src/App.jsx`, `frontend/src/config/navigation.js`, `frontend/src/pages/Orders.jsx`, `frontend/src/components/layout/AppShell.jsx`, `frontend/src/components/ratecards/RateCardFormModal.jsx`.

**Customer app – create/modify**
- Create `ShifterOnline/lib/services/booking_guarantee_api_service.dart`, `ShifterOnline/lib/utils/booking_guarantee.dart`, `ShifterOnline/test/booking_guarantee_test.dart`.
- Modify `ShifterOnline/lib/Api/config.dart`, `lib/utils/node_socket_manager.dart`, `lib/screens/home/waiting_screen.dart`, `lib/screens/home/select_vehicle.dart`, `lib/bottombar.dart`.

---

### Task 1: Schema, migration, spec amendments

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `tbl_package` ~L780; append two models at end)
- Create: `backend/prisma/migrations/20261007020000_add_booking_guarantee/migration.sql`
- Modify: `docs/superpowers/specs/2026-10-07-booking-guarantee-design.md`

**Interfaces:**
- Produces: Prisma models `booking_guarantee_case`, `booking_guarantee_audit`; field `tbl_package.no_driver_compensation` (Decimal). Case statuses (strings): `open`, `resolved_assigned`, `expired_compensated`, `cancelled`.

- [ ] **Step 1: Add the column to `tbl_package`**

In `backend/prisma/schema.prisma`, inside `model tbl_package`, directly after the `driver_earning` line (~L817), add:

```prisma
  no_driver_compensation       Decimal          @default(0.00) @db.Decimal(10, 2)
```

- [ ] **Step 2: Append the two models at the end of `schema.prisma`**

```prisma

/// Booking Guarantee (spec 2026-10-07): one row per order that exhausted every selected model.
model booking_guarantee_case {
  id                      Int       @id @default(autoincrement())
  order_id                Int       @unique(map: "uq_bgc_order")
  uid                     Int
  status                  String    @db.VarChar(30)
  selected_package_ids    String    @db.Text
  compensation_package_id Int?
  compensation_amount     Decimal   @default(0.00) @db.Decimal(10, 2)
  opened_at               DateTime  @default(now()) @db.DateTime(0)
  deadline_at             DateTime  @db.DateTime(0)
  closed_at               DateTime? @db.DateTime(0)
  resolved_by_admin_id    Int?
  wallet_history_id       Int?
  refunds_done_at         DateTime? @db.DateTime(0)

  @@index([status, deadline_at], map: "idx_bgc_status_deadline")
  @@index([uid], map: "idx_bgc_uid")
}

model booking_guarantee_audit {
  id         Int      @id @default(autoincrement())
  case_id    Int
  order_id   Int
  event      String   @db.VarChar(40)
  admin_id   Int?
  meta       String?  @db.Text
  created_at DateTime @default(now()) @db.DateTime(0)

  @@index([case_id], map: "idx_bga_case")
  @@index([order_id], map: "idx_bga_order")
}
```

- [ ] **Step 3: Write the migration SQL**

Create `backend/prisma/migrations/20261007020000_add_booking_guarantee/migration.sql`:

```sql
-- Booking Guarantee (spec 2026-10-07). Apply on prod BEFORE deploying the backend.
ALTER TABLE `tbl_package`
  ADD COLUMN `no_driver_compensation` DECIMAL(10,2) NOT NULL DEFAULT 0.00;

CREATE TABLE `booking_guarantee_case` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `selected_package_ids` TEXT NOT NULL,
  `compensation_package_id` INT NULL,
  `compensation_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `opened_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `deadline_at` DATETIME(0) NOT NULL,
  `closed_at` DATETIME(0) NULL,
  `resolved_by_admin_id` INT NULL,
  `wallet_history_id` INT NULL,
  `refunds_done_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_bgc_order` (`order_id`),
  INDEX `idx_bgc_status_deadline` (`status`, `deadline_at`),
  INDEX `idx_bgc_uid` (`uid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `booking_guarantee_audit` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `event` VARCHAR(40) NOT NULL,
  `admin_id` INT NULL,
  `meta` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_bga_case` (`case_id`),
  INDEX `idx_bga_order` (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 4: Amend the spec to match the plan**

In `docs/superpowers/specs/2026-10-07-booking-guarantee-design.md`: in the `booking_guarantee_case` table add the row `| refunds_done_at | set once the prepaid-fare/points refunds ran; the sweeper repairs cases where it is NULL |`; in the audit events list replace `fare_refunded` with `refunds_processed`, and add `order_already_closed`; in "Admin panel" change the Settings bullet to "A dedicated Booking Guarantee page holds the Admin Assignment Time setting and the case history."

- [ ] **Step 5: Validate and generate**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma\schema.prisma is valid` and `Generated Prisma Client`. If generate fails with EPERM on `query_engine-windows.dll.node`, stop the running dev server and retry.

- [ ] **Step 6: Apply to the dev DB**

Run the SQL from Step 3 against the DEV database (the `.env` DB) using the project's usual method (same as the earlier hand-applied migrations). Verify: `cd backend && node -e "require('./src/config/db').booking_guarantee_case.count().then(c=>{console.log('ok',c);process.exit(0)})"` prints `ok 0`.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20261007020000_add_booking_guarantee docs/superpowers/specs/2026-10-07-booking-guarantee-design.md
git commit -m "feat(booking-guarantee): schema + migration for case, audit and package compensation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure rules (compensation + customer state)

**Files:**
- Create: `backend/src/services/bookingGuaranteeRules.js`
- Test: `backend/src/services/__tests__/bookingGuaranteeRules.test.js`

**Interfaces:**
- Produces:
  - `computeGuaranteeCompensation(packages: {id:number, sort_order:number, no_driver_compensation:number|string|Decimal}[]) → { packageId: number|null, amount: number }`
  - `guaranteeStateFor(row: {status:string, compensation_amount:number|string}|null) → "none"|"pending"|"paid"|"not_paid"`

- [ ] **Step 1: Write the failing tests**

```js
const { computeGuaranteeCompensation, guaranteeStateFor } = require("../bookingGuaranteeRules");

// Ids are deliberately NOT in sort order (Model 1 has the highest id) to prove the rule uses sort_order.
const PKGS = [
  { id: 30, sort_order: 1, no_driver_compensation: "0.00" },
  { id: 20, sort_order: 2, no_driver_compensation: "100.00" },
  { id: 10, sort_order: 3, no_driver_compensation: "500.00" },
  { id: 40, sort_order: 4, no_driver_compensation: "1000.00" },
  { id: 50, sort_order: 5, no_driver_compensation: "2000.00" },
];
const pick = (...orders) => PKGS.filter((p) => orders.includes(p.sort_order));

describe("computeGuaranteeCompensation - the five spec examples", () => {
  it("Model 1 only -> 0", () => expect(computeGuaranteeCompensation(pick(1)).amount).toBe(0));
  it("Models 1,2 -> 100 (Model 2 ON beats Model 1)", () => expect(computeGuaranteeCompensation(pick(1, 2)).amount).toBe(100));
  it("Models 1,2,3 -> 500", () => expect(computeGuaranteeCompensation(pick(1, 2, 3)).amount).toBe(500));
  it("Models 1-4 -> 1000", () => expect(computeGuaranteeCompensation(pick(1, 2, 3, 4)).amount).toBe(1000));
  it("Models 1-5 -> 2000", () => expect(computeGuaranteeCompensation(pick(1, 2, 3, 4, 5)).amount).toBe(2000));
});

describe("computeGuaranteeCompensation - generality", () => {
  it("a Model 6 added later works with no code change", () => {
    const withSix = [...PKGS, { id: 60, sort_order: 6, no_driver_compensation: 5000 }];
    expect(computeGuaranteeCompensation(withSix)).toEqual({ packageId: 60, amount: 5000 });
  });
  it("the highest sort_order wins even when it is not the highest id", () => {
    expect(computeGuaranteeCompensation(pick(1, 3)).packageId).toBe(10); // sort_order 3 has id 10
  });
  it("a non-contiguous toggle (1 and 5 ON, 2-4 OFF) pays Model 5's amount", () => {
    expect(computeGuaranteeCompensation(pick(1, 5)).amount).toBe(2000);
  });
  it("equal sort_order is broken by the higher id", () => {
    const tied = [{ id: 1, sort_order: 2, no_driver_compensation: 10 }, { id: 9, sort_order: 2, no_driver_compensation: 20 }];
    expect(computeGuaranteeCompensation(tied)).toEqual({ packageId: 9, amount: 20 });
  });
  it("empty / invalid input pays nothing", () => {
    expect(computeGuaranteeCompensation([])).toEqual({ packageId: null, amount: 0 });
    expect(computeGuaranteeCompensation(null)).toEqual({ packageId: null, amount: 0 });
  });
  it("a negative or non-numeric configured amount is treated as 0", () => {
    expect(computeGuaranteeCompensation([{ id: 1, sort_order: 1, no_driver_compensation: -50 }]).amount).toBe(0);
    expect(computeGuaranteeCompensation([{ id: 1, sort_order: 1, no_driver_compensation: "abc" }]).amount).toBe(0);
  });
  it("rounds to 2 decimals", () => {
    expect(computeGuaranteeCompensation([{ id: 1, sort_order: 1, no_driver_compensation: "10.456" }]).amount).toBe(10.46);
  });
});

describe("guaranteeStateFor", () => {
  it("no case -> none", () => expect(guaranteeStateFor(null)).toBe("none"));
  it("open -> pending", () => expect(guaranteeStateFor({ status: "open", compensation_amount: "100" })).toBe("pending"));
  it("expired with money -> paid", () => expect(guaranteeStateFor({ status: "expired_compensated", compensation_amount: "100" })).toBe("paid"));
  it("expired with 0 -> not_paid", () => expect(guaranteeStateFor({ status: "expired_compensated", compensation_amount: "0" })).toBe("not_paid"));
  it("admin assigned / cancelled -> none", () => {
    expect(guaranteeStateFor({ status: "resolved_assigned", compensation_amount: "100" })).toBe("none");
    expect(guaranteeStateFor({ status: "cancelled", compensation_amount: "100" })).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeRules.test.js`
Expected: FAIL — `Cannot find module '../bookingGuaranteeRules'`.

- [ ] **Step 3: Implement**

```js
// Booking Guarantee (spec 2026-10-07): pure rules, no I/O.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The package whose configured amount applies = the highest sort_order among the
 * selected packages (sort_order is the tier priority, see orderController). Never
 * keyed on package id or model number, so a new Model 6/7 needs no change here.
 */
function computeGuaranteeCompensation(packages) {
  let top = null;
  for (const p of Array.isArray(packages) ? packages : []) {
    if (!p) continue;
    const order = Number(p.sort_order);
    const topOrder = top === null ? -Infinity : Number(top.sort_order);
    if (top === null || order > topOrder || (order === topOrder && Number(p.id) > Number(top.id))) top = p;
  }
  if (!top) return { packageId: null, amount: 0 };
  const raw = Number(top.no_driver_compensation);
  const amount = Number.isFinite(raw) && raw > 0 ? round2(raw) : 0;
  return { packageId: top.id, amount };
}

/** What the customer app is told: none | pending | paid | not_paid. */
function guaranteeStateFor(row) {
  if (!row) return "none";
  if (row.status === "open") return "pending";
  if (row.status === "expired_compensated") return Number(row.compensation_amount) > 0 ? "paid" : "not_paid";
  return "none";
}

module.exports = { computeGuaranteeCompensation, guaranteeStateFor };
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeRules.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bookingGuaranteeRules.js backend/src/services/__tests__/bookingGuaranteeRules.test.js
git commit -m "feat(booking-guarantee): pure compensation rule and customer state mapping

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin Assignment Time setting + constants

**Files:**
- Modify: `backend/src/config/constants.js`
- Create: `backend/src/services/bookingGuaranteeSettings.js`
- Test: `backend/src/services/__tests__/bookingGuaranteeSettings.test.js`

**Interfaces:**
- Produces: `getAssignWindowMinutes(): Promise<number>`, `setAssignWindowMinutes(minutes: any): Promise<number>` (throws `Error` with `statusCode = 400` on invalid), constant `BOOKING_GUARANTEE_ASSIGN_KEY`, constants `BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES = 10`, `BOOKING_GUARANTEE_SWEEP_INTERVAL_MS = 15000`.

- [ ] **Step 1: Add constants**

In `backend/src/config/constants.js`, directly after the `MODEL_1_PACKAGE_ID: 6,` line (~L41), add:

```js
  // Booking Guarantee (spec 2026-10-07): default admin assignment window and how often overdue cases are swept.
  BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES: 10,
  BOOKING_GUARANTEE_SWEEP_INTERVAL_MS: 15 * 1000,
```

- [ ] **Step 2: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn(), upsert: jest.fn() },
}));

const prisma = require("../../config/db");
const settings = require("../bookingGuaranteeSettings");

beforeEach(() => jest.clearAllMocks());

describe("getAssignWindowMinutes", () => {
  it("falls back to the default (10) when unset", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await settings.getAssignWindowMinutes()).toBe(10);
  });
  it("reads a stored value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "15" });
    expect(await settings.getAssignWindowMinutes()).toBe(15);
  });
  it("ignores a corrupt or non-positive stored value", async () => {
    for (const bad of ["abc", "0", "-5", ""]) {
      prisma.app_settings.findFirst.mockResolvedValue({ setting_value: bad });
      expect(await settings.getAssignWindowMinutes()).toBe(10);
    }
  });
});

describe("setAssignWindowMinutes", () => {
  it("stores a valid integer", async () => {
    prisma.app_settings.upsert.mockResolvedValue({});
    expect(await settings.setAssignWindowMinutes("20")).toBe(20);
    expect(prisma.app_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { setting_key: "booking_guarantee_assign_minutes" },
      update: expect.objectContaining({ setting_value: "20" }),
    }));
  });
  it.each([0, -1, 1.5, "abc", 1441, null, undefined])("rejects %p with a 400", async (bad) => {
    await expect(settings.setAssignWindowMinutes(bad)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeSettings.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```js
const prisma = require("../config/db");
const { BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES } = require("../config/constants");

const BOOKING_GUARANTEE_ASSIGN_KEY = "booking_guarantee_assign_minutes";
const MAX_MINUTES = 24 * 60;

/** Admin Assignment Time in whole minutes; the default when unset or corrupt. */
async function getAssignWindowMinutes() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: BOOKING_GUARANTEE_ASSIGN_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES;
  }
  const parsed = parseInt(row.setting_value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? BOOKING_GUARANTEE_DEFAULT_ASSIGN_MINUTES : parsed;
}

async function setAssignWindowMinutes(minutes) {
  const n = typeof minutes === "string" && /^\d+$/.test(minutes.trim()) ? Number(minutes) : minutes;
  if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) {
    throw Object.assign(new Error(`assign_minutes must be a whole number between 1 and ${MAX_MINUTES}`), { statusCode: 400 });
  }
  await prisma.app_settings.upsert({
    where: { setting_key: BOOKING_GUARANTEE_ASSIGN_KEY },
    update: { setting_value: String(n) },
    create: { setting_key: BOOKING_GUARANTEE_ASSIGN_KEY, setting_value: String(n) },
  });
  return n;
}

module.exports = { getAssignWindowMinutes, setAssignWindowMinutes, BOOKING_GUARANTEE_ASSIGN_KEY };
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeSettings.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/constants.js backend/src/services/bookingGuaranteeSettings.js backend/src/services/__tests__/bookingGuaranteeSettings.test.js
git commit -m "feat(booking-guarantee): configurable admin assignment window setting

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Core service (open, close, expire, quote, view)

**Files:**
- Create: `backend/src/services/bookingGuaranteeService.js`
- Modify: `backend/src/sockets/adminSocket.js:108-115` (`notifyDispatchAlert` accepts `extra`)
- Modify: `backend/src/services/pushNotifier.js:65-72` (`notifyCustomerNoDriverFound` optional compensation)
- Test: `backend/src/services/__tests__/bookingGuaranteeService.test.js`

**Interfaces:**
- Consumes: `computeGuaranteeCompensation`, `guaranteeStateFor` (Task 2); `getAssignWindowMinutes` (Task 3); `adminSocket.notifyDispatchAlert(orderId, cityId, message, extra)`; `dispatchManager.emitCustomerEvent(userId, event, payload)`; `walletPrepayment.refundIfWalletPaid(order, {note})`; `refundReferralPointsForOrder(orderId)`; `walletNotifier.notifyCustomerWalletTransaction(userId, {type, amount, remark})`; `pushNotifier.notifyCustomerNoDriverFound(fcmToken, orderId, compensationAmount)`.
- Produces (all exported):
  - `openForExhaustedOrder(order, selectedIds: number[]) → Promise<boolean>` — `true` = order is being held (case opened or already open); `false` = caller must run the normal cancel.
  - `closeOnAssign(orderId, adminId) → Promise<boolean>`
  - `closeOnCancel(orderId, event: "customer_cancelled"|"admin_cancelled", adminId?) → Promise<boolean>`
  - `expireCase(caseId) → Promise<boolean>`; `expireDue(now?: Date) → Promise<void>`
  - `quote(packageIds: any[]) → Promise<{packageId:number|null, amount:number}>`
  - `getView(order) → Promise<{state:string, amount:number, deadline_at:string|null}>` (never throws)
  - `STATUS`, `ALERT_MESSAGE`

- [ ] **Step 1: Extend `adminSocket.notifyDispatchAlert`**

Replace the function (lines 108–115) with:

```js
function notifyDispatchAlert(orderId, cityId, message, extra) {
  broadcastToScope(cityId, "admin:dispatch_alert", {
    order_id: orderId,
    city_id: cityId,
    message: message || `Attention: Order #${orderId} requires manual assignment!`,
    timestamp: Date.now(),
    ...(extra || {}),
  });
}
```

- [ ] **Step 2: Extend `pushNotifier.notifyCustomerNoDriverFound`**

Replace lines 65–72 with:

```js
async function notifyCustomerNoDriverFound(fcmToken, orderId, compensationAmount = 0) {
  const paid = Number(compensationAmount) > 0;
  return sendCustomerPush(
    fcmToken,
    "No drivers found",
    paid
      ? `No drivers found. ₹${Number(compensationAmount).toFixed(2)} has been added to your wallet as our Booking Guarantee.`
      : "No drivers found. None of the available drivers accepted your order. Please try again.",
    { type: "no_driver_found", order_id: String(orderId) }
  );
}
```

- [ ] **Step 3: Write the failing service tests**

Create `backend/src/services/__tests__/bookingGuaranteeService.test.js`:

```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn().mockResolvedValue({}) },
  tbl_package: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), updateMany: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock("../bookingGuaranteeSettings", () => ({ getAssignWindowMinutes: jest.fn().mockResolvedValue(15) }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null) }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const adminSocket = require("../../sockets/adminSocket");
const walletPrepayment = require("../walletPrepaymentRefund");
const { refundReferralPointsForOrder } = require("../referralPointsRefund");
const walletNotifier = require("../walletNotifier");
const pushNotifier = require("../pushNotifier");
const svc = require("../bookingGuaranteeService");

const order = { id: 500, uid: 7, city_id: 3, rid: 0, order_status: 0 };
const caseRow = (o = {}) => ({
  id: 1, order_id: 500, uid: 7, status: "open", selected_package_ids: "[10,20]", compensation_package_id: 20,
  compensation_amount: "100.00", deadline_at: new Date("2026-10-07T10:00:00Z"), wallet_history_id: null, refunds_done_at: null, ...o,
});
const auditEvents = () => prisma.booking_guarantee_audit.create.mock.calls.map(([a]) => a.data.event);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
});

describe("openForExhaustedOrder", () => {
  it("opens a case with the highest selected model's amount frozen, alerts admin and the customer", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([
      { id: 10, sort_order: 1, no_driver_compensation: "0.00" },
      { id: 20, sort_order: 2, no_driver_compensation: "100.00" },
    ]);
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));

    const held = await svc.openForExhaustedOrder(order, [10, 20]);

    expect(held).toBe(true);
    const data = prisma.booking_guarantee_case.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ order_id: 500, uid: 7, status: "open", selected_package_ids: "[10,20]", compensation_package_id: 20, compensation_amount: 100 });
    expect(data.deadline_at.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(data.deadline_at.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(500, 3, svc.ALERT_MESSAGE, expect.objectContaining({ kind: "booking_guarantee", amount: 100 }));
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:guarantee_pending", expect.objectContaining({ order_id: "500", amount: 100 }));
    expect(auditEvents()).toEqual(["opened", "admin_alerted"]);
  });

  it("an already-open case keeps holding the order without a second alert", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow());
    expect(await svc.openForExhaustedOrder(order, [10, 20])).toBe(true);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("an already-closed case does not hold the order", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ status: "expired_compensated" }));
    expect(await svc.openForExhaustedOrder(order, [10, 20])).toBe(false);
  });

  it("losing the unique-key race (P2002) still holds the order, with no duplicate alert", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([]);
    prisma.booking_guarantee_case.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("selected models with no compensation configured still open a case for the alert/window (amount 0)", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "0.00" }]);
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    expect(prisma.booking_guarantee_case.create.mock.calls[0][0].data.compensation_amount).toBe(0);
  });
});

describe("closeOnAssign / closeOnCancel", () => {
  it("assign closes an open case as resolved_assigned and audits the admin", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ status: "resolved_assigned" }));
    expect(await svc.closeOnAssign(500, 9)).toBe(true);
    expect(prisma.booking_guarantee_case.updateMany).toHaveBeenCalledWith({
      where: { order_id: 500, status: "open" },
      data: expect.objectContaining({ status: "resolved_assigned", resolved_by_admin_id: 9 }),
    });
    expect(auditEvents()).toEqual(["admin_assigned"]);
  });
  it("assign on an order with no open case is a no-op", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.closeOnAssign(500, 9)).toBe(false);
    expect(prisma.booking_guarantee_audit.create).not.toHaveBeenCalled();
  });
  it("customer cancel closes the case as cancelled with no payment", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ status: "cancelled" }));
    expect(await svc.closeOnCancel(500, "customer_cancelled")).toBe(true);
    expect(auditEvents()).toEqual(["customer_cancelled"]);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("expireCase", () => {
  const setupExpiry = ({ amount = "100.00", cancelCount = 1, flipCount = 1, dup = null } = {}) => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: flipCount });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ compensation_amount: amount, status: "expired_compensated" }));
    prisma.pkg_order.updateMany.mockResolvedValue({ count: cancelCount });
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(dup);
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 777 });
    prisma.tbl_user.update.mockResolvedValue({});
    prisma.booking_guarantee_case.update.mockResolvedValue({});
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, uid: 7, p_method_id: -2 });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
  };

  it("cancels the order, credits the frozen amount once, refunds the fare, and tells the customer", async () => {
    setupExpiry();
    expect(await svc.expireCase(1)).toBe(true);

    expect(prisma.pkg_order.updateMany).toHaveBeenCalledWith({
      where: { id: 500, rid: 0, order_status: 0 },
      data: { o_status: "Cancelled", cancel_reason: "No driver found", order_status: 4 },
    });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 100 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 7, amount: 100, type: "credit", wallet_type: "user", order_id: 500, payment_id: "booking_guarantee_credit:500" }),
    });
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(expect.objectContaining({ id: 500 }), { note: "no driver found" });
    expect(refundReferralPointsForOrder).toHaveBeenCalledWith(500);
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:no_driver_found", { order_id: "500", compensation_amount: 100 });
    expect(pushNotifier.notifyCustomerNoDriverFound).toHaveBeenCalledWith("tok", 500, 100);
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 100 }));
    expect(prisma.booking_guarantee_case.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ refunds_done_at: expect.any(Date) }) });
    expect(auditEvents()).toEqual(expect.arrayContaining(["expired", "wallet_credited", "refunds_processed"]));
  });

  it("losing the race (case no longer open) moves no money", async () => {
    setupExpiry({ flipCount: 0 });
    expect(await svc.expireCase(1)).toBe(false);
    expect(prisma.pkg_order.updateMany).not.toHaveBeenCalled();
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).not.toHaveBeenCalled();
  });

  it("an order already cancelled/assigned by another path: no compensation, case closed as cancelled", async () => {
    setupExpiry({ cancelCount: 0 });
    expect(await svc.expireCase(1)).toBe(false);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.booking_guarantee_case.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "cancelled" } });
    expect(auditEvents()).toContain("order_already_closed");
  });

  it("zero compensation: order still cancelled, refunds run, no wallet credit", async () => {
    setupExpiry({ amount: "0.00" });
    expect(await svc.expireCase(1)).toBe(true);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:no_driver_found", { order_id: "500", compensation_amount: 0 });
  });

  it("a wallet row with the idempotency key already present is never credited twice", async () => {
    setupExpiry({ dup: { id: 555 } });
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("pays the FROZEN amount even if package config changed since (config is never re-read)", async () => {
    setupExpiry({ amount: "100.00" });
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 20, sort_order: 2, no_driver_compensation: "9999.00" }]);
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 100 } } });
    expect(prisma.tbl_package.findMany).not.toHaveBeenCalled();
  });
});

describe("expireDue", () => {
  it("expires every overdue open case, then repairs expired cases whose refunds never ran", async () => {
    prisma.booking_guarantee_case.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // due open cases
      .mockResolvedValueOnce([caseRow({ id: 3, status: "expired_compensated", wallet_history_id: 9, compensation_amount: "100.00" })]); // repair
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 }); // both due cases already taken by another worker
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, uid: 7, p_method_id: -2 });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
    prisma.booking_guarantee_case.update.mockResolvedValue({});

    await svc.expireDue(new Date());

    expect(prisma.booking_guarantee_case.findMany.mock.calls[0][0].where).toMatchObject({ status: "open", deadline_at: { lte: expect.any(Date) } });
    expect(prisma.booking_guarantee_case.findMany.mock.calls[1][0].where).toMatchObject({ status: "expired_compensated", refunds_done_at: null });
    // repair pass re-ran the idempotent refunds and reported the already-credited amount
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledTimes(1);
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:no_driver_found", { order_id: "500", compensation_amount: 100 });
  });

  it("one failing case does not stop the rest", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([]);
    prisma.$transaction.mockRejectedValueOnce(new Error("db down")).mockImplementationOnce((cb) => cb(prisma));
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.expireDue(new Date())).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe("quote / getView", () => {
  it("quote returns the highest selected model's amount from enabled packages", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([
      { id: 10, sort_order: 1, no_driver_compensation: "0" },
      { id: 20, sort_order: 2, no_driver_compensation: "100" },
    ]);
    expect(await svc.quote(["10", 20, 20, "x", -1])).toEqual({ packageId: 20, amount: 100 });
    expect(prisma.tbl_package.findMany.mock.calls[0][0].where).toEqual({ id: { in: [10, 20] }, status: 1 });
  });
  it("quote with no valid ids is 0 and never queries", async () => {
    expect(await svc.quote([])).toEqual({ packageId: null, amount: 0 });
    expect(prisma.tbl_package.findMany).not.toHaveBeenCalled();
  });
  it("getView of an open case is pending with its deadline", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow());
    expect(await svc.getView({ id: 500 })).toEqual({ state: "pending", amount: 100, deadline_at: "2026-10-07T10:00:00.000Z" });
  });
  it("getView of a still-searching order (no case) previews the amount", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 20, sort_order: 2, no_driver_compensation: "100" }]);
    expect(await svc.getView({ id: 500, rid: 0, order_status: 0, allowed_delivery_types: "[20]" })).toEqual({ state: "none", amount: 100, deadline_at: null });
  });
  it("getView never throws", async () => {
    prisma.booking_guarantee_case.findUnique.mockRejectedValue(new Error("table missing"));
    expect(await svc.getView({ id: 500 })).toEqual({ state: "none", amount: 0, deadline_at: null });
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeService.test.js`
Expected: FAIL — `Cannot find module '../bookingGuaranteeService'`.

- [ ] **Step 5: Implement the service**

Create `backend/src/services/bookingGuaranteeService.js`:

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const adminSocket = require("../sockets/adminSocket");
const walletNotifier = require("./walletNotifier");
const pushNotifier = require("./pushNotifier");
const walletPrepayment = require("./walletPrepaymentRefund");
const { refundReferralPointsForOrder } = require("./referralPointsRefund");
const rules = require("./bookingGuaranteeRules");
const settings = require("./bookingGuaranteeSettings");

// Booking Guarantee (spec 2026-10-07). dispatchManager requires this module, so it is required lazily
// here (same reason dispatchManager lazy-requires freeBookingService).
const dispatchManager = () => require("./dispatchManager");

const STATUS = { OPEN: "open", ASSIGNED: "resolved_assigned", EXPIRED: "expired_compensated", CANCELLED: "cancelled" };
const ALERT_MESSAGE = "BOOKING GUARANTEE – MANUAL DRIVER ASSIGNMENT REQUIRED";
const PACKAGE_SELECT = { id: true, sort_order: true, no_driver_compensation: true };
const BATCH = 50;
const REPAIR_AFTER_MS = 60 * 1000;

const toIds = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

async function writeAudit(client, caseRow, event, { adminId = null, meta = null } = {}) {
  await client.booking_guarantee_audit.create({
    data: { case_id: caseRow.id, order_id: caseRow.order_id, event, admin_id: adminId, meta: meta ? JSON.stringify(meta) : null },
  });
}

/**
 * Called when the dispatch cascade is exhausted for an unassigned order. true = the order is being held
 * for the admin window (the caller must NOT cancel it); false = no guarantee applies, cancel as before.
 */
async function openForExhaustedOrder(order, selectedIds) {
  const existing = await prisma.booking_guarantee_case.findUnique({ where: { order_id: order.id } });
  if (existing) return existing.status === STATUS.OPEN;

  const ids = toIds(selectedIds);
  const packages = ids.length ? await prisma.tbl_package.findMany({ where: { id: { in: ids } }, select: PACKAGE_SELECT }) : [];
  const { packageId, amount } = rules.computeGuaranteeCompensation(packages);
  const minutes = await settings.getAssignWindowMinutes();
  const deadline = new Date(Date.now() + minutes * 60 * 1000);

  let row;
  try {
    row = await prisma.booking_guarantee_case.create({
      data: {
        order_id: order.id, uid: order.uid, status: STATUS.OPEN, selected_package_ids: JSON.stringify(ids),
        compensation_package_id: packageId, compensation_amount: amount, deadline_at: deadline,
      },
    });
  } catch (err) {
    if (err && err.code === "P2002") return true; // another worker opened it first
    throw err;
  }
  await writeAudit(prisma, row, "opened", { meta: { amount, packageId, minutes, selected: ids } });

  try {
    adminSocket.notifyDispatchAlert(order.id, order.city_id, ALERT_MESSAGE, {
      kind: "booking_guarantee", amount, deadline_at: deadline.toISOString(),
    });
    await writeAudit(prisma, row, "admin_alerted");
  } catch (err) {
    logger.error(`bookingGuarantee: admin alert failed for order ${order.id}:`, err);
  }
  try {
    dispatchManager().emitCustomerEvent(order.uid, "order:guarantee_pending", {
      order_id: String(order.id), amount, deadline_at: deadline.toISOString(),
    });
  } catch (err) {
    logger.error(`bookingGuarantee: customer notify failed for order ${order.id}:`, err);
  }
  return true;
}

async function closeWith(orderId, status, event, adminId, extraData = {}) {
  const res = await prisma.booking_guarantee_case.updateMany({
    where: { order_id: Number(orderId), status: STATUS.OPEN },
    data: { status, closed_at: new Date(), ...extraData },
  });
  if (res.count === 0) return false;
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (row) await writeAudit(prisma, row, event, { adminId });
  return true;
}

/** Admin assigned a driver: close as resolved, no compensation. */
const closeOnAssign = (orderId, adminId) =>
  closeWith(orderId, STATUS.ASSIGNED, "admin_assigned", adminId, { resolved_by_admin_id: adminId ?? null });

/** Customer or admin cancelled during the window: close, no compensation. */
const closeOnCancel = (orderId, event, adminId = null) => closeWith(orderId, STATUS.CANCELLED, event, adminId);

/**
 * Phase B of an expiry: the idempotent refunds, then tell the customer. Safe to repeat (every helper it
 * calls is idempotent); refunds_done_at stops the sweeper's repair pass once it has completed.
 */
async function finishExpiry(row) {
  if (row.refunds_done_at) return;
  const order = await prisma.pkg_order.findUnique({ where: { id: row.order_id } });
  if (order) {
    await walletPrepayment.refundIfWalletPaid(order, { note: "no driver found" });
    await refundReferralPointsForOrder(order.id);
  }
  await writeAudit(prisma, row, "refunds_processed");
  await prisma.booking_guarantee_case.update({ where: { id: row.id }, data: { refunds_done_at: new Date() } });

  const paid = row.wallet_history_id ? Number(row.compensation_amount) || 0 : 0;
  dispatchManager().emitCustomerEvent(row.uid, "order:no_driver_found", { order_id: String(row.order_id), compensation_amount: paid });
  try {
    const customer = await prisma.tbl_user.findUnique({ where: { id: row.uid }, select: { fcm_token: true } });
    await pushNotifier.notifyCustomerNoDriverFound(customer?.fcm_token, row.order_id, paid);
  } catch (err) {
    logger.error(`bookingGuarantee: push failed for order ${row.order_id}:`, err);
  }
}

/**
 * Phase A of an expiry — ONE transaction: flip the case (conditional, so only one worker wins), cancel the
 * order, credit the compensation (idempotency key on the wallet row). Phase B (finishExpiry) follows.
 */
async function expireCase(caseId) {
  const claimed = await prisma.$transaction(async (tx) => {
    const flipped = await tx.booking_guarantee_case.updateMany({
      where: { id: caseId, status: STATUS.OPEN },
      data: { status: STATUS.EXPIRED, closed_at: new Date() },
    });
    if (flipped.count === 0) return null;
    const row = await tx.booking_guarantee_case.findUnique({ where: { id: caseId } });

    const cancelled = await tx.pkg_order.updateMany({
      where: { id: row.order_id, rid: 0, order_status: 0 },
      data: { o_status: "Cancelled", cancel_reason: "No driver found", order_status: 4 },
    });
    if (cancelled.count === 0) {
      // Assigned or cancelled by another path in the meantime: nothing to compensate.
      await tx.booking_guarantee_case.update({ where: { id: caseId }, data: { status: STATUS.CANCELLED } });
      await writeAudit(tx, row, "order_already_closed");
      return null;
    }
    await writeAudit(tx, row, "expired");

    const amount = Number(row.compensation_amount) || 0;
    let credit = null;
    let walletHistoryId = row.wallet_history_id;
    if (amount > 0) {
      const key = `booking_guarantee_credit:${row.order_id}`;
      const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
      if (!duplicate) {
        const remark = `Booking Guarantee compensation for order #${row.order_id}`;
        await tx.tbl_user.update({ where: { id: row.uid }, data: { wallet: { increment: amount } } });
        const history = await tx.tbl_wallet_history.create({
          data: { user_id: row.uid, amount, type: "credit", remark, wallet_type: "user", order_id: row.order_id, payment_id: key, created_at: istNow() },
        });
        await tx.booking_guarantee_case.update({ where: { id: caseId }, data: { wallet_history_id: history.id } });
        await writeAudit(tx, row, "wallet_credited", { meta: { amount, wallet_history_id: history.id } });
        walletHistoryId = history.id;
        credit = { amount, remark };
      }
    }
    return { row: { ...row, status: STATUS.EXPIRED, wallet_history_id: walletHistoryId }, credit };
  });
  if (!claimed) return false;

  if (claimed.credit) {
    Promise.resolve(walletNotifier.notifyCustomerWalletTransaction(claimed.row.uid, { type: "credit", amount: claimed.credit.amount, remark: claimed.credit.remark }))
      .catch((err) => logger.error(`bookingGuarantee: wallet notify failed for user ${claimed.row.uid}:`, err));
  }
  await finishExpiry(claimed.row);
  return true;
}

/** Sweeper entry point: expire overdue cases, then finish refunds for expiries that crashed half-way. */
async function expireDue(now = new Date()) {
  const due = await prisma.booking_guarantee_case.findMany({
    where: { status: STATUS.OPEN, deadline_at: { lte: now } }, select: { id: true }, take: BATCH,
  });
  for (const { id } of due) {
    try {
      await expireCase(id);
    } catch (err) {
      logger.error(`bookingGuarantee: expiring case ${id} failed:`, err);
    }
  }
  const repair = await prisma.booking_guarantee_case.findMany({
    where: { status: STATUS.EXPIRED, refunds_done_at: null, closed_at: { lte: new Date(now.getTime() - REPAIR_AFTER_MS) } },
    take: BATCH,
  });
  for (const row of repair) {
    try {
      await finishExpiry(row);
    } catch (err) {
      logger.error(`bookingGuarantee: finishing refunds for case ${row.id} failed:`, err);
    }
  }
}

/** Display amount for a set of package ids (the live "if no driver is found" line). */
async function quote(packageIds) {
  const ids = toIds(packageIds);
  if (!ids.length) return { packageId: null, amount: 0 };
  const packages = await prisma.tbl_package.findMany({ where: { id: { in: ids }, status: 1 }, select: PACKAGE_SELECT });
  return rules.computeGuaranteeCompensation(packages);
}

/** The `guarantee` block of the customer order-details response. Never throws. */
async function getView(order) {
  try {
    const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(order.id) } });
    if (row) {
      return {
        state: rules.guaranteeStateFor(row),
        amount: Number(row.compensation_amount) || 0,
        deadline_at: row.status === STATUS.OPEN ? new Date(row.deadline_at).toISOString() : null,
      };
    }
    let amount = 0;
    if (Number(order.rid) === 0 && Number(order.order_status) === 0 && order.allowed_delivery_types) {
      amount = (await quote(JSON.parse(order.allowed_delivery_types))).amount;
    }
    return { state: "none", amount, deadline_at: null };
  } catch (err) {
    logger.warn(`bookingGuarantee.getView failed for order ${order?.id}: ${err.message}`);
    return { state: "none", amount: 0, deadline_at: null };
  }
}

module.exports = {
  STATUS, ALERT_MESSAGE, openForExhaustedOrder, closeOnAssign, closeOnCancel, expireCase, expireDue, quote, getView,
};
```

- [ ] **Step 6: Run to verify pass**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeService.test.js src/services/__tests__/pushNotifier.test.js`
Expected: PASS (the pushNotifier suite confirms the optional third argument changed nothing for existing callers).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/bookingGuaranteeService.js backend/src/services/__tests__/bookingGuaranteeService.test.js backend/src/sockets/adminSocket.js backend/src/services/pushNotifier.js
git commit -m "feat(booking-guarantee): core service - open, close, expire-once, quote, view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hold the order instead of cancelling (dispatch hook + startup recovery)

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (`checkCascadeTermination` ~L416-453; `reconcileStaleOffersOnStartup` ~L1351-1364)
- Test: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `bookingGuaranteeService.openForExhaustedOrder(order, selectedIds) → Promise<boolean>` (Task 4).

- [ ] **Step 1: Mock the service in the existing dispatch test file**

In `dispatchManager.test.js`, directly after the `jest.mock("../freeBookingService", ...)` block (~L35), add:

```js
jest.mock("../bookingGuaranteeService", () => ({
  openForExhaustedOrder: jest.fn().mockResolvedValue(false),
}));
```

and after `const freeBookingService = require("../freeBookingService");` (~L43) add:

```js
const bookingGuaranteeService = require("../bookingGuaranteeService");
```

(The default `false` keeps every existing test on the unchanged cancel path.)

- [ ] **Step 2: Write the failing tests**

Add after the test `a fallback error is swallowed and the normal 'No driver found' cancel still happens` (ends ~L893):

```js
  it("Booking Guarantee: an exhausted order is HELD (not cancelled, no refund, no no_driver_found) and the case is opened with the selected tiers", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });
    bookingGuaranteeService.openForExhaustedOrder.mockResolvedValueOnce(true);

    await dispatchManager.startDispatch(order);
    await flush();
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS - BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(0);
    await flush();

    expect(bookingGuaranteeService.openForExhaustedOrder).toHaveBeenCalledTimes(1);
    const [openedOrder, tiers] = bookingGuaranteeService.openForExhaustedOrder.mock.calls[0];
    expect(openedOrder.id).toBe(order.id);
    expect(Array.isArray(tiers) && tiers.length > 0).toBe(true);
    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(0);
    expect(prisma.pkg_order.update.mock.calls.some(([args]) => args.data && args.data.o_status === "Cancelled")).toBe(false);
    expect(require("../walletPrepaymentRefund").refundIfWalletPaid).not.toHaveBeenCalled();
    expect(pushNotifier.notifyCustomerNoDriverFound).not.toHaveBeenCalled();
    // the dispatch's in-memory state is released; the case row owns the wait now
    expect([1, 2, 3, 4, 5, 6, 7, 8].every((id) => !lockManager.isLocked(id))).toBe(true);
  });

  it("Booking Guarantee: if opening the case throws, the normal 'No driver found' cancel still happens", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });
    bookingGuaranteeService.openForExhaustedOrder.mockRejectedValueOnce(new Error("table missing"));

    await dispatchManager.startDispatch(order);
    await flush();
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS - BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(BATCH_GAP_MS);
    await flush();
    await jest.advanceTimersByTimeAsync(0);
    await flush();

    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(1);
    expect(prisma.pkg_order.update.mock.calls.some(([args]) => args.data && args.data.o_status === "Cancelled")).toBe(true);
  });

  it("startup reconciliation skips orders that have an open Booking Guarantee case", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(0);

    await dispatchManager.reconcileStaleOffersOnStartup();

    const sqlText = (call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0]));
    const cancelSql = prisma.$executeRaw.mock.calls.map(sqlText).find((s) => s.includes("No driver found (recovered after restart)"));
    const selectSql = prisma.$queryRaw.mock.calls.map(sqlText).find((s) => s.includes("p_method_id = -2"));
    expect(cancelSql).toContain("booking_guarantee_case");
    expect(selectSql).toContain("booking_guarantee_case");
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.test.js -t "Booking Guarantee|startup reconciliation skips"`
Expected: FAIL (held order is still cancelled; SQL lacks `booking_guarantee_case`).

- [ ] **Step 4: Hook the case in `checkCascadeTermination`**

In `dispatchManager.js`, directly after the free-booking `if (continueAsNormal) {...}` block (ends at the `return;` / `}` ~L432) and BEFORE `try { adminSocket.notifyDispatchAlert(...)`, insert:

```js
    // Booking Guarantee (spec 2026-10-07): instead of cancelling, hold the order for the admin
    // assignment window. A failure here falls through to the normal cancel below, so a missing
    // table/outage can never strand an order.
    let heldForGuarantee = false;
    try {
      heldForGuarantee = await require("./bookingGuaranteeService").openForExhaustedOrder(order, state.tiers);
    } catch (err) {
      logger.error(`dispatchManager: booking guarantee open failed for order ${orderId}:`, err);
    }
    if (heldForGuarantee) {
      for (const t of state.timers) clearTimeout(t);
      state.timers.clear();
      activeDispatches.delete(orderId);
      return;
    }
```

The existing `adminSocket.notifyDispatchAlert(orderId, order.city_id)` call below stays untouched (it only runs on the cancel path now; the guarantee path sends its own richer alert).

- [ ] **Step 5: Exclude open cases from startup reconciliation**

In `reconcileStaleOffersOnStartup`, add to BOTH the `staleWalletOrders` SELECT and the `staleOrders` UPDATE one extra condition. Replace the two statements (~L1351-1364) with:

```js
    const staleWalletOrders = await prisma.$queryRaw`
      SELECT id, uid, p_method_id, trans_id FROM pkg_order
      WHERE o_status = 'Pending' AND rid = 0 AND order_status = 0
        AND booking_type NOT IN (2, 3)
        AND odate <= (NOW() - INTERVAL ${STARTUP_RECOVERY_BUFFER_SECONDS} SECOND)
        AND id NOT IN (SELECT order_id FROM booking_guarantee_case WHERE status = 'open')
        AND (p_method_id = -2 OR trans_id LIKE 'wallet%' OR referral_points_used > 0)
    `;
    const staleOrders = await prisma.$executeRaw`
      UPDATE pkg_order
      SET o_status = 'Cancelled', cancel_reason = 'No driver found (recovered after restart)'
      WHERE o_status = 'Pending' AND rid = 0 AND order_status = 0
        AND booking_type NOT IN (2, 3)
        AND odate <= (NOW() - INTERVAL ${STARTUP_RECOVERY_BUFFER_SECONDS} SECOND)
        AND id NOT IN (SELECT order_id FROM booking_guarantee_case WHERE status = 'open')
    `;
```

Also extend the comment block above them (before `const staleWalletOrders`) with one line: `// Orders held by an open Booking Guarantee case are excluded: the guarantee sweeper (not this) closes them, and pays the customer.`

- [ ] **Step 6: Run to verify pass**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS (whole file — existing tests unchanged, three new tests green).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(booking-guarantee): hold exhausted orders for the admin window; protect them from startup recovery

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Close the case when an admin assigns or anyone cancels

**Files:**
- Modify: `backend/src/controllers/adminOrderController.js` (`assignRider` ~L270; `cancel` ~L370-377)
- Modify: `backend/src/services/tripLifecycle.js` (`customerCancel` ~L1263-1267)
- Test: `backend/src/controllers/__tests__/adminOrderController.cancel.test.js`, `backend/src/services/__tests__/tripLifecycle.test.js`, `backend/src/controllers/__tests__/adminOrderController.test.js`, `backend/src/services/__tests__/cancelPaymentMatrix.test.js`

**Interfaces:**
- Consumes: `bookingGuaranteeService.closeOnAssign(orderId, adminId)`, `closeOnCancel(orderId, event, adminId?)` (Task 4). Both are best-effort: wrap in `try/catch` + `logger.error`, never fail the host request.

- [ ] **Step 1: Add the service mock to every test file that loads these modules**

Add this block near the other `jest.mock(...)` calls (before the `require`s) in each of: `adminOrderController.cancel.test.js` (path `../../services/bookingGuaranteeService`), `adminOrderController.test.js` (same path), `tripLifecycle.test.js` (path `../bookingGuaranteeService`), `cancelPaymentMatrix.test.js` (path `../bookingGuaranteeService`):

```js
jest.mock("<path above>", () => ({
  closeOnAssign: jest.fn().mockResolvedValue(true),
  closeOnCancel: jest.fn().mockResolvedValue(true),
}));
```

- [ ] **Step 2: Write the failing tests**

In `adminOrderController.cancel.test.js` add (after the existing `describe`):

```js
const bookingGuarantee = require("../../services/bookingGuaranteeService");

describe("adminOrderController.cancel - Booking Guarantee", () => {
  it("closes an open guarantee case as admin_cancelled (no compensation) when the admin cancels the order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 0, order_status: 0, o_status: "Pending" }));
    await cancel(req({ comment: "customer asked" }), res());
    expect(bookingGuarantee.closeOnCancel).toHaveBeenCalledWith(468, "admin_cancelled", 1);
  });

  it("a guarantee failure never blocks the cancel", async () => {
    bookingGuarantee.closeOnCancel.mockRejectedValueOnce(new Error("boom"));
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 0, order_status: 0, o_status: "Pending" }));
    const r = res();
    await cancel(req(), r);
    expect(r.status).toHaveBeenCalledWith(200);
  });
});
```

In `tripLifecycle.test.js`, inside `describe("tripLifecycle.customerCancel", ...)` after the `"stops dispatch when cancelling an unassigned order"` test add:

```js
  it("closes an open Booking Guarantee case (no compensation) when the customer cancels an unassigned order", async () => {
    const bookingGuarantee = require("../bookingGuaranteeService");
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 297, uid: 7, rid: 0 });
    prisma.$executeRaw.mockResolvedValueOnce(1);

    const result = await tripLifecycle.customerCancel(7, 297, "changed my mind");

    expect(result).toEqual({ success: true });
    expect(bookingGuarantee.closeOnCancel).toHaveBeenCalledWith(297, "customer_cancelled");
  });

  it("a Booking Guarantee failure never blocks a customer cancel", async () => {
    const bookingGuarantee = require("../bookingGuaranteeService");
    bookingGuarantee.closeOnCancel.mockRejectedValueOnce(new Error("boom"));
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 297, uid: 7, rid: 0 });
    prisma.$executeRaw.mockResolvedValueOnce(1);
    expect(await tripLifecycle.customerCancel(7, 297, "x")).toEqual({ success: true });
  });
```

In `adminOrderController.test.js`, inside `describe("adminOrderController.assignRider", ...)` (its `beforeEach` already stubs a successful assign for order 500), add after the existing `it(...)`:

```js
  it("closes an open Booking Guarantee case when the admin assigns a driver", async () => {
    const req = { params: { id: "500" }, body: { rider_id: "2" }, user: { role: "superadmin", id: 1, username: "admin" } };
    await assignRider(req, makeRes());
    expect(require("../../services/bookingGuaranteeService").closeOnAssign).toHaveBeenCalledWith(500, 1);
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx jest src/controllers/__tests__/adminOrderController.cancel.test.js src/controllers/__tests__/adminOrderController.test.js src/services/__tests__/tripLifecycle.test.js src/services/__tests__/cancelPaymentMatrix.test.js`
Expected: the new assertions FAIL (`closeOnCancel`/`closeOnAssign` not called); nothing else fails.

- [ ] **Step 4: Wire `assignRider`**

At the top of `adminOrderController.js` add `const bookingGuarantee = require("../services/bookingGuaranteeService");` with the other service requires. In `assignRider`, directly after `dispatchManager.stopDispatch(orderId, "accepted_by_other");` (~L270) add:

```js
    try {
      await bookingGuarantee.closeOnAssign(orderId, req.user.id);
    } catch (guaranteeErr) {
      logger.error(`assignRider: booking guarantee close failed for order ${orderId}:`, guaranteeErr);
    }
```

- [ ] **Step 5: Wire admin `cancel`**

In `cancel`, directly after the `if (wasUnassigned) { dispatchManager.stopDispatch(...); await walletPrepayment.refundIfWalletPaid(...) } ...` chain's closing brace and before `await refundReferralPointsForOrder(id);` add:

```js
    if (wasUnassigned) {
      try {
        await bookingGuarantee.closeOnCancel(id, "admin_cancelled", req.user.id);
      } catch (guaranteeErr) {
        logger.error(`cancel: booking guarantee close failed for order ${id}:`, guaranteeErr);
      }
    }
```

- [ ] **Step 6: Wire `customerCancel`**

At the top of `tripLifecycle.js` add `const bookingGuarantee = require("./bookingGuaranteeService");` with the other service requires. In `customerCancel`'s `else` branch (the `orderBefore.rid === 0` one, ~L1263-1267) replace

```js
    dispatchManager.stopDispatch(orderId, "cancelled_by_user");
    // Cancelled before any driver accepted: nothing to charge, refund in full.
    await walletPrepayment.refundIfWalletPaid(orderBefore);
```

with

```js
    dispatchManager.stopDispatch(orderId, "cancelled_by_user");
    // Cancelled during a Booking Guarantee admin window: close the case, no compensation.
    try {
      await bookingGuarantee.closeOnCancel(orderId, "customer_cancelled");
    } catch (guaranteeErr) {
      logger.error(`customerCancel: booking guarantee close failed for order ${orderId}:`, guaranteeErr);
    }
    // Cancelled before any driver accepted: nothing to charge, refund in full.
    await walletPrepayment.refundIfWalletPaid(orderBefore);
```

- [ ] **Step 7: Run to verify pass**

Run: `cd backend && npx jest src/controllers/__tests__/adminOrderController.cancel.test.js src/controllers/__tests__/adminOrderController.test.js src/services/__tests__/tripLifecycle.test.js src/services/__tests__/cancelPaymentMatrix.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/adminOrderController.js backend/src/services/tripLifecycle.js backend/src/controllers/__tests__ backend/src/services/__tests__
git commit -m "feat(booking-guarantee): close the case on admin assign and on customer/admin cancel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Expiry sweeper

**Files:**
- Modify: `backend/src/server.js`

**Interfaces:**
- Consumes: `bookingGuaranteeService.expireDue()`; constant `BOOKING_GUARANTEE_SWEEP_INTERVAL_MS` (Task 3).

- [ ] **Step 1: Import the constant**

In `server.js`, in the destructured `require("./config/constants")` list (ends ~L31 with `DAILY_DRIVER_AUTO_ENROLL_SWEEP_INTERVAL_MS,`), add `BOOKING_GUARANTEE_SWEEP_INTERVAL_MS,` on the next line.

- [ ] **Step 2: Add the sweeper and the boot run**

Directly after the `dispatchManager.reconcileStaleOffersOnStartup();` line (~L46) add:

```js
// Booking Guarantee: expire overdue admin-assignment windows (cancel + compensate). The case row and its
// deadline live in the DB, so this is restart-safe; run once at boot (after the startup reconciliation
// above, which deliberately skips orders held by an open case) and then on an interval.
const bookingGuaranteeService = require("./services/bookingGuaranteeService");
const sweepBookingGuarantee = () =>
  bookingGuaranteeService.expireDue().catch((err) => logger.error("bookingGuarantee sweep failed:", err));
setTimeout(sweepBookingGuarantee, 5000);
setInterval(sweepBookingGuarantee, BOOKING_GUARANTEE_SWEEP_INTERVAL_MS);
```

- [ ] **Step 3: Verify the server boots and the sweeper is silent on an empty table**

Run: `cd backend && node -e "require('./src/services/bookingGuaranteeService').expireDue().then(()=>{console.log('sweep ok');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `sweep ok` (requires Task 1 step 6 applied to the dev DB).

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(booking-guarantee): sweeper that expires overdue cases (interval + boot run)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Customer API (quote endpoint, order-details block)

**Files:**
- Create: `backend/src/controllers/bookingGuaranteeController.js`
- Test: `backend/src/controllers/__tests__/bookingGuaranteeController.test.js`
- Modify: `backend/src/routes/orderRoutes.js`
- Modify: `backend/src/controllers/orderController.js` (`getOrderDetails` response, ~L903)

**Interfaces:**
- Consumes: `bookingGuaranteeService.quote(ids)`, `getView(order)`.
- Produces: `POST /api/order/guarantee-quote { package_ids: number[] }` → `{ ResponseCode:"200", Result:"true", amount:number, package_id:number|null }`; `OrderProductList[0].guarantee = { state, amount, deadline_at }`.

- [ ] **Step 1: Write the failing controller test**

```js
jest.mock("../../services/bookingGuaranteeService", () => ({ quote: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const svc = require("../../services/bookingGuaranteeService");
const { quote } = require("../bookingGuaranteeController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("bookingGuaranteeController.quote", () => {
  it("returns the amount for the selected packages", async () => {
    svc.quote.mockResolvedValue({ packageId: 20, amount: 100 });
    const r = res();
    await quote({ body: { package_ids: [10, 20] } }, r);
    expect(svc.quote).toHaveBeenCalledWith([10, 20]);
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", amount: 100, package_id: 20 });
  });
  it.each([undefined, null, [], "10", {}])("rejects package_ids=%p with 400", async (bad) => {
    const r = res();
    await quote({ body: { package_ids: bad } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.quote).not.toHaveBeenCalled();
  });
  it("a service failure is a 500, not a crash", async () => {
    svc.quote.mockRejectedValue(new Error("db"));
    const r = res();
    await quote({ body: { package_ids: [1] } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/controllers/__tests__/bookingGuaranteeController.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

```js
const logger = require("../utils/logger");
const bookingGuarantee = require("../services/bookingGuaranteeService");

/** POST /api/order/guarantee-quote — display-only "if no driver is found you get ₹X" for the toggled models. */
async function quote(req, res) {
  try {
    const ids = req.body?.package_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must be a non-empty array" });
    }
    const q = await bookingGuarantee.quote(ids);
    return res.json({ ResponseCode: "200", Result: "true", amount: q.amount, package_id: q.packageId });
  } catch (err) {
    logger.error("bookingGuarantee.quote failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { quote };
```

- [ ] **Step 4: Register the route**

In `backend/src/routes/orderRoutes.js` add `const bookingGuaranteeController = require("../controllers/bookingGuaranteeController");` after the `freeBookingController` require (L8), and after `router.post("/free-booking/status", ...)` add:

```js
router.post("/guarantee-quote", bookingGuaranteeController.quote);
```

- [ ] **Step 5: Add the `guarantee` block to order details**

In `orderController.js` add `const bookingGuaranteeService = require("../services/bookingGuaranteeService");` with the other service requires. In `getOrderDetails`'s response object, directly after the `receiver_pay: await getReceiverPaySummary(order.id),` line add:

```js
          // Booking Guarantee: none | pending | paid | not_paid, the amount, and the admin-window deadline.
          guarantee: await bookingGuaranteeService.getView(order),
```

- [ ] **Step 6: Run to verify pass and no regression**

Run: `cd backend && npx jest src/controllers/__tests__/bookingGuaranteeController.test.js src/controllers/__tests__/orderController.test.js`
Expected: PASS. If `orderController.test.js` fails because its db mock lacks `booking_guarantee_case`, that is `getView`'s never-throw path logging a warning, not a failure; if it fails for another reason, add `jest.mock("../../services/bookingGuaranteeService", () => ({ getView: jest.fn().mockResolvedValue({ state: "none", amount: 0, deadline_at: null }) }));` to that test file.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/bookingGuaranteeController.js backend/src/controllers/__tests__/bookingGuaranteeController.test.js backend/src/routes/orderRoutes.js backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.test.js
git commit -m "feat(booking-guarantee): customer quote endpoint and guarantee block in order details

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin API (settings, cases, audit) and rate-card field

**Files:**
- Create: `backend/src/controllers/adminBookingGuaranteeController.js`
- Test: `backend/src/controllers/__tests__/adminBookingGuaranteeController.test.js`, `backend/src/controllers/__tests__/rateCardCompensation.test.js`
- Modify: `backend/src/routes/adminRoutes.js`, `backend/src/controllers/rateCardController.js`

**Interfaces:**
- Consumes: `getAssignWindowMinutes`, `setAssignWindowMinutes` (Task 3); `req.scopedCityId` (set by existing `scopeFilter`).
- Produces: `GET/PUT /admin/booking-guarantee/settings` (`{ success, data: { assign_minutes } }`); `GET /admin/booking-guarantee/cases?status=open|all&limit=` (`{ success, data: Case[] }`, each case with `deadline_at`, `compensation_amount`, `status`, `order_id`, `uid`, `opened_at`, `closed_at`, `resolved_by_admin_id`, `wallet_history_id`); `GET /admin/booking-guarantee/cases/:orderId/audit` (`{ success, data: Audit[] }`); rate-card create/update accept `no_driver_compensation`.

- [ ] **Step 1: Write the failing admin-controller tests**

```js
jest.mock("../../config/db", () => ({
  booking_guarantee_case: { findMany: jest.fn() },
  booking_guarantee_audit: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
}));
jest.mock("../../services/bookingGuaranteeSettings", () => ({
  getAssignWindowMinutes: jest.fn().mockResolvedValue(10),
  setAssignWindowMinutes: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../../services/bookingGuaranteeSettings");
const ctrl = require("../adminBookingGuaranteeController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("settings", () => {
  it("getSettings returns the window", async () => {
    const r = res();
    await ctrl.getSettings({}, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { assign_minutes: 10 } });
  });
  it("saveSettings stores and echoes the value", async () => {
    settings.setAssignWindowMinutes.mockResolvedValue(15);
    const r = res();
    await ctrl.saveSettings({ body: { assign_minutes: "15" } }, r);
    expect(settings.setAssignWindowMinutes).toHaveBeenCalledWith("15");
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { assign_minutes: 15 } });
  });
  it("saveSettings turns a validation error into its 400", async () => {
    settings.setAssignWindowMinutes.mockRejectedValue(Object.assign(new Error("bad"), { statusCode: 400 }));
    const r = res();
    await ctrl.saveSettings({ body: { assign_minutes: 0 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "bad" });
  });
});

describe("listCases", () => {
  const row = (id, order_id) => ({ id, order_id, uid: 1, status: "open", compensation_amount: "100", deadline_at: new Date(), opened_at: new Date() });

  it("open filter + limit are applied, newest first", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([row(1, 500)]);
    const r = res();
    await ctrl.listCases({ query: { status: "open", limit: "10" } }, r);
    expect(prisma.booking_guarantee_case.findMany).toHaveBeenCalledWith({ where: { status: "open" }, orderBy: { id: "desc" }, take: 10 });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: [expect.objectContaining({ order_id: 500 })] });
  });
  it("a city-scoped admin only sees cases for orders in their city", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([row(1, 500), row(2, 501)]);
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 501 }]);
    const r = res();
    await ctrl.listCases({ query: {}, scopedCityId: 3 }, r);
    expect(prisma.pkg_order.findMany).toHaveBeenCalledWith({ where: { id: { in: [500, 501] }, city_id: 3 }, select: { id: true } });
    expect(r.json.mock.calls[0][0].data.map((c) => c.order_id)).toEqual([501]);
  });
  it("an absurd limit is clamped", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValue([]);
    await ctrl.listCases({ query: { limit: "99999" } }, res());
    expect(prisma.booking_guarantee_case.findMany.mock.calls[0][0].take).toBe(200);
  });
});

describe("caseAudit", () => {
  it("rejects a non-numeric order id", async () => {
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "abc" }, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  it("returns the events oldest first", async () => {
    prisma.booking_guarantee_audit.findMany.mockResolvedValue([{ id: 1, event: "opened" }]);
    const r = res();
    await ctrl.caseAudit({ params: { orderId: "500" }, query: {} }, r);
    expect(prisma.booking_guarantee_audit.findMany).toHaveBeenCalledWith({ where: { order_id: 500 }, orderBy: { id: "asc" } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/controllers/__tests__/adminBookingGuaranteeController.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the admin controller**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("../services/bookingGuaranteeSettings");

const MAX_LIMIT = 200;
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminBookingGuarantee.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: { assign_minutes: await settings.getAssignWindowMinutes() } });
  } catch (e) {
    return fail(res, e, "getSettings");
  }
}

async function saveSettings(req, res) {
  try {
    const assignMinutes = await settings.setAssignWindowMinutes(req.body?.assign_minutes);
    return res.json({ success: true, data: { assign_minutes: assignMinutes } });
  } catch (e) {
    return fail(res, e, "saveSettings");
  }
}

async function listCases(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 100, 1), MAX_LIMIT);
    const where = req.query?.status === "open" ? { status: "open" } : {};
    let cases = await prisma.booking_guarantee_case.findMany({ where, orderBy: { id: "desc" }, take: limit });
    if (req.scopedCityId && cases.length) {
      const inCity = await prisma.pkg_order.findMany({
        where: { id: { in: cases.map((c) => c.order_id) }, city_id: Number(req.scopedCityId) },
        select: { id: true },
      });
      const allowed = new Set(inCity.map((o) => o.id));
      cases = cases.filter((c) => allowed.has(c.order_id));
    }
    return res.json({ success: true, data: cases });
  } catch (e) {
    return fail(res, e, "listCases");
  }
}

async function caseAudit(req, res) {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, message: "orderId must be a valid id" });
    }
    const events = await prisma.booking_guarantee_audit.findMany({ where: { order_id: orderId }, orderBy: { id: "asc" } });
    return res.json({ success: true, data: events });
  } catch (e) {
    return fail(res, e, "caseAudit");
  }
}

module.exports = { getSettings, saveSettings, listCases, caseAudit };
```

- [ ] **Step 4: Register admin routes**

In `adminRoutes.js`, after the `const adminFreeBookingController = require(...)` line (~L90) add `const adminBookingGuaranteeController = require("../controllers/adminBookingGuaranteeController");`, and after the Free Booking block (after the `/free-booking/users/:userId/unlock` route, ~L115) add:

```js

// Booking Guarantee (spec 2026-10-07)
router.get("/booking-guarantee/settings", auth, authorize(...RIDER_ROLES), adminBookingGuaranteeController.getSettings);
router.put("/booking-guarantee/settings", auth, authorize("superadmin", "admin"), adminBookingGuaranteeController.saveSettings);
router.get("/booking-guarantee/cases", auth, authorize(...RIDER_ROLES), scopeFilter, adminBookingGuaranteeController.listCases);
router.get("/booking-guarantee/cases/:orderId/audit", auth, authorize(...RIDER_ROLES), scopeFilter, adminBookingGuaranteeController.caseAudit);
```

- [ ] **Step 5: Write the failing rate-card test**

Create `rateCardCompensation.test.js`:

```js
jest.mock("../../config/db", () => ({
  tbl_package: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  pkg_category: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const { create, update, _validateCompensation } = require("../rateCardController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("_validateCompensation", () => {
  it.each([undefined, 0, "0", 100, "250.50"])("accepts %p", (v) => expect(_validateCompensation(v)).toBeNull());
  it.each([-1, "-5", "abc", NaN, 1e12])("rejects %p", (v) => expect(typeof _validateCompensation(v)).toBe("string"));
});

describe("rate card endpoints reject a bad no_driver_compensation before touching the DB", () => {
  const body = { title: "Model 2", type: "USER", cat_id: 1, city_id: 1, min_charge: 10, per_km_charge: 5, free_waiting_time: 5, waiting_charge: 1, start_time: "00:00", end_time: "23:59" };

  it("create -> 400", async () => {
    const r = res();
    await create({ body: { ...body, no_driver_compensation: -10 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_package.create).not.toHaveBeenCalled();
  });
  it("update -> 400", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue({ id: 1 });
    const r = res();
    await update({ params: { id: "1" }, body: { no_driver_compensation: "abc" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_package.update).not.toHaveBeenCalled();
  });
  it("update with a valid value passes it through to the DB", async () => {
    prisma.tbl_package.findUnique.mockResolvedValue({ id: 1 });
    prisma.tbl_package.update.mockResolvedValue({ id: 1 });
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 1 });
    await update({ params: { id: "1" }, body: { no_driver_compensation: "500" } }, res());
    expect(prisma.tbl_package.update.mock.calls[0][0].data.no_driver_compensation).toBe("500");
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd backend && npx jest src/controllers/__tests__/rateCardCompensation.test.js`
Expected: FAIL (`_validateCompensation` undefined).

- [ ] **Step 7: Implement in `rateCardController.js`**

(a) After `validateSubtitleLength` (~L33) add:

```js
// tbl_package.no_driver_compensation (Booking Guarantee): a non-negative amount; DECIMAL(10,2) caps it below 1e8.
function validateCompensation(raw) {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (raw === null || raw === "" || !Number.isFinite(n) || n < 0 || n >= 1e8) {
    return "no_driver_compensation must be a non-negative amount";
  }
  return null;
}
```

(b) In `create`, directly after the `if (!PACKAGE_TYPES.includes(b.type)) {...}` check add:

```js
    const compensationError = validateCompensation(b.no_driver_compensation);
    if (compensationError) {
      return res.status(400).json({ success: false, message: compensationError });
    }
```

and in the `prisma.tbl_package.create` data object, after `driver_cancel_user_earning: b.driver_cancel_user_earning ?? 0,` add `no_driver_compensation: b.no_driver_compensation ?? 0,`.

(c) In `update`, directly after the first `if (b.type !== undefined && !PACKAGE_TYPES.includes(b.type)) {...}` check add the same `compensationError` block (using `b.no_driver_compensation`), and add `"no_driver_compensation",` to the `directFields` array after `"driver_cancel_user_earning",`.

(d) Export the helper: in the file's `module.exports = {` add `_validateCompensation: validateCompensation,`.

- [ ] **Step 8: Run to verify pass**

Run: `cd backend && npx jest src/controllers/__tests__/adminBookingGuaranteeController.test.js src/controllers/__tests__/rateCardCompensation.test.js src/controllers/__tests__/rateCardTierInfo.test.js src/controllers/__tests__/rateCardGenerateModels.test.js`
Expected: PASS (the two existing rate-card suites confirm no regression).

- [ ] **Step 9: Commit**

```bash
git add backend/src/controllers/adminBookingGuaranteeController.js backend/src/controllers/rateCardController.js backend/src/controllers/__tests__ backend/src/routes/adminRoutes.js
git commit -m "feat(booking-guarantee): admin settings/cases/audit API and rate-card compensation field

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin panel (rate-card field, Booking Guarantee page, banner, orders countdown)

**Files:**
- Create: `frontend/src/components/orders/GuaranteeCountdown.jsx`, `frontend/src/components/orders/GuaranteeBanner.jsx`, `frontend/src/pages/BookingGuarantee.jsx`
- Modify: `frontend/src/components/ratecards/RateCardFormModal.jsx`, `frontend/src/pages/Orders.jsx`, `frontend/src/components/layout/AppShell.jsx`, `frontend/src/App.jsx`, `frontend/src/config/navigation.js`

**Interfaces:**
- Consumes: the Task 9 endpoints (mounted under the admin `api` base, e.g. `api.get('/booking-guarantee/cases', { params: { status: 'open' } })`); socket event `admin:dispatch_alert` with `{ order_id, message, kind: 'booking_guarantee', amount, deadline_at }`.
- Produces: `<GuaranteeCountdown deadline="ISO" />`.

There is no frontend test runner; verification is lint + production build + manual check (Task 12).

- [ ] **Step 1: Countdown component**

Create `frontend/src/components/orders/GuaranteeCountdown.jsx`:

```jsx
import { useEffect, useState } from 'react'

function format(ms) {
  if (ms <= 0) return 'Expired'
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** Live mm:ss countdown to a Booking Guarantee deadline (ISO string). */
export default function GuaranteeCountdown({ deadline }) {
  const target = new Date(deadline).getTime()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!Number.isFinite(target)) return null
  const left = target - now
  return (
    <span className="font-mono-data" style={{ color: left <= 60000 ? 'var(--danger)' : 'var(--ink)' }}>
      {format(left)}
    </span>
  )
}
```

- [ ] **Step 2: Banner component**

Create `frontend/src/components/orders/GuaranteeBanner.jsx`:

```jsx
import { AlertTriangle, X } from 'lucide-react'
import GuaranteeCountdown from './GuaranteeCountdown'
import { formatCurrency } from '../../utils/format'

/**
 * Persistent, high-priority banners for Booking Guarantee alerts (the plain toast scrolls away; this stays
 * until the admin dismisses it or the window ends). `alerts` = [{ order_id, amount, deadline_at, message }].
 */
export default function GuaranteeBanner({ alerts, onOpen, onDismiss }) {
  if (!alerts.length) return null
  return (
    <div className="fixed left-1/2 top-16 z-[999997] flex w-[min(560px,92vw)] -translate-x-1/2 flex-col gap-2">
      {alerts.map((a) => (
        <div
          key={a.order_id}
          className="flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl"
          style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)', color: 'var(--ink)' }}
        >
          <AlertTriangle size={20} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--danger)' }}>
              {a.message}
            </div>
            <div className="mt-0.5 text-[13px]">
              Order #{a.order_id} · assign a driver within <GuaranteeCountdown deadline={a.deadline_at} />
              {Number(a.amount) > 0 && <> · customer is owed {formatCurrency(a.amount)} if none is assigned</>}
            </div>
            <button
              type="button"
              onClick={() => onOpen(a.order_id)}
              className="mt-2 rounded-lg px-3 py-1 text-[12.5px] font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              Open order &amp; assign
            </button>
          </div>
          <button type="button" onClick={() => onDismiss(a.order_id)} aria-label="Dismiss" style={{ color: 'var(--ink-faint)' }}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Wire the banner into `AppShell.jsx`**

Add imports: `import GuaranteeBanner from '../orders/GuaranteeBanner'`. Add state next to the others: `const [guaranteeAlerts, setGuaranteeAlerts] = useState([])`. Replace `handleDispatchAlert` with:

```js
    function handleDispatchAlert(data) {
      if (data?.kind === 'booking_guarantee') {
        playOrderChime()
        setGuaranteeAlerts((prev) => [
          ...prev.filter((a) => a.order_id !== data.order_id),
          { order_id: data.order_id, amount: data.amount, deadline_at: data.deadline_at, message: data.message },
        ])
        return
      }
      toast.warning(data?.message || `Order #${data?.order_id} needs manual driver assignment!`)
    }
```

and in the JSX, directly after `<div className="flex h-screen" ...>` opens (before the `{incomingOrder && (` block) add:

```jsx
      <GuaranteeBanner
        alerts={guaranteeAlerts}
        onOpen={(orderId) => setActiveOrderDrawerId(orderId)}
        onDismiss={(orderId) => setGuaranteeAlerts((prev) => prev.filter((a) => a.order_id !== orderId))}
      />
```

(`setActiveOrderDrawerId` already exists in this component and opens `OrderDetailDrawer`, which contains the Assign Rider action.)

- [ ] **Step 4: Orders list — badge + live countdown**

In `Orders.jsx` add imports `import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'`. After the `useApiQuery(fetcher)` line add:

```js
  const guaranteeFetcher = useCallback(
    () => api.get('/booking-guarantee/cases', { params: { status: 'open' } }).then((res) => res.data),
    []
  )
  const { data: guaranteeData, refetch: refetchGuarantee } = useApiQuery(guaranteeFetcher)
  const guaranteeByOrder = new Map((guaranteeData?.data ?? []).map((c) => [c.order_id, c]))
```

Change the realtime-sync callback so both lists refresh: replace `refetch` in the `useRealtimeSync([...], refetch)` call with `() => { refetch(); refetchGuarantee() }`. In the Status cell replace

```jsx
                      <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
```

with

```jsx
                      <Badge tone={orderStatusTone(o.o_status)}>{orderStatusLabel(o.o_status)}</Badge>
                      {guaranteeByOrder.has(o.id) && (
                        <div className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--danger)' }}>
                          Guarantee · <GuaranteeCountdown deadline={guaranteeByOrder.get(o.id).deadline_at} />
                        </div>
                      )}
```

- [ ] **Step 5: Rate-card field**

In `RateCardFormModal.jsx`: in `EMPTY_FORM` add `no_driver_compensation: '0',` after `driver_cancel_user_earning: '0',`; in the edit-prefill block add `no_driver_compensation: rateCard.no_driver_compensation ?? '0',` after the `driver_cancel_user_earning: rateCard.driver_cancel_user_earning ?? '0',` line; and add this block in the form directly after the "Customer Cancellation Fee & Split" block's closing `</div>` (the `<div className="space-y-3 rounded-lg border p-3" ...>` ending ~L790):

```jsx
        <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            Booking Guarantee
          </p>
          <div>
            <Label htmlFor="no_driver_compensation">No Driver Found Compensation (₹)</Label>
            <Input
              id="no_driver_compensation"
              type="number"
              min="0"
              value={form.no_driver_compensation}
              onChange={(e) => set('no_driver_compensation', e.target.value)}
              placeholder="0"
            />
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              Paid to the customer when no driver is found and this is the highest model they switched on.
            </p>
          </div>
        </div>
```

(The modal already submits the whole `form`, so the field reaches the Task 9 create/update handlers.)

- [ ] **Step 6: Booking Guarantee page**

Create `frontend/src/pages/BookingGuarantee.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'
import { formatCurrency, formatDateTime } from '../utils/format'

const STATUS_LABEL = {
  open: 'Waiting for admin',
  resolved_assigned: 'Driver assigned',
  expired_compensated: 'Expired',
  cancelled: 'Cancelled',
}
const STATUS_TONE = { open: 'warning', resolved_assigned: 'success', expired_compensated: 'danger', cancelled: 'neutral' }
const EVENT_LABEL = {
  opened: 'Case opened', admin_alerted: 'Admins alerted', admin_assigned: 'Admin assigned a driver',
  customer_cancelled: 'Customer cancelled', admin_cancelled: 'Admin cancelled', expired: 'Window expired',
  wallet_credited: 'Compensation credited', refunds_processed: 'Refunds processed', order_already_closed: 'Order already closed',
}
const errMsg = (err, fallback) => err?.response?.data?.message || fallback

export default function BookingGuarantee() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { hasRole } = useAuth()
  const canWrite = hasRole('superadmin', 'admin')

  const [minutes, setMinutes] = useState('')
  const [saving, setSaving] = useState(false)
  const [auditFor, setAuditFor] = useState(null)
  const [audit, setAudit] = useState([])

  const casesFetcher = useCallback(() => api.get('/booking-guarantee/cases', { params: { limit: 100 } }).then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(casesFetcher)
  const cases = data?.data ?? []
  useRealtimeSync(['admin:dispatch_alert', 'admin:order_status_update'], refetch)

  useEffect(() => {
    api.get('/booking-guarantee/settings')
      .then((res) => setMinutes(String(res.data?.data?.assign_minutes ?? '')))
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load settings')))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await api.put('/booking-guarantee/settings', { assign_minutes: minutes })
      setMinutes(String(res.data?.data?.assign_minutes ?? minutes))
      toastRef.current.success('Admin assignment time saved')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  async function openAudit(orderId) {
    setAuditFor(orderId)
    setAudit([])
    try {
      const res = await api.get(`/booking-guarantee/cases/${orderId}/audit`)
      setAudit(res.data?.data ?? [])
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not load history'))
    }
  }

  return (
    <div>
      <h1 className="flex items-center gap-2 text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        <ShieldCheck size={20} /> Booking Guarantee
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        When no driver is found in any model the customer switched on, the order is held for the time below so you can assign a driver. If none is assigned, the customer is compensated automatically.
      </p>

      <div className="surface-card mt-4 rounded-xl p-4">
        <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="assign_minutes">Admin assignment time (minutes)</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="assign_minutes"
            type="number"
            min="1"
            max="1440"
            value={minutes}
            disabled={!canWrite}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-32 rounded-xl border px-3.5 py-2.5 text-sm outline-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
          {canWrite && (
            <button type="button" onClick={save} disabled={saving} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Applies to new cases only; cases already open keep their own deadline.</p>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order', 'Status', 'Compensation', 'Time left', 'Opened', 'Closed', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: 'var(--ink-faint)' }}>Loading…</td></tr>}
              {!loading && error && <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: 'var(--danger)' }}>{error}</td></tr>}
              {!loading && !error && cases.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--ink-faint)' }}>No guarantee cases yet.</td></tr>}
              {!loading && !error && cases.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink)' }}>#{c.order_id}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[c.status] || 'neutral'}>{STATUS_LABEL[c.status] || c.status}</Badge></td>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink)' }}>{formatCurrency(c.compensation_amount)}</td>
                  <td className="px-4 py-2.5">{c.status === 'open' ? <GuaranteeCountdown deadline={c.deadline_at} /> : '—'}</td>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(c.opened_at)}</td>
                  <td className="font-mono-data px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(c.closed_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => openAudit(c.order_id)} className="text-[12.5px] font-semibold" style={{ color: 'var(--brand)' }}>History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {auditFor && (
        <div className="surface-card mt-4 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>History · Order #{auditFor}</div>
            <button type="button" onClick={() => setAuditFor(null)} className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Close</button>
          </div>
          <ul className="mt-2 space-y-1 text-[13px]" style={{ color: 'var(--ink)' }}>
            {audit.map((e) => (
              <li key={e.id}>
                <span className="font-mono-data" style={{ color: 'var(--ink-faint)' }}>{formatDateTime(e.created_at)}</span>{' '}
                {EVENT_LABEL[e.event] || e.event}{e.admin_id ? ` (admin #${e.admin_id})` : ''}
              </li>
            ))}
            {audit.length === 0 && <li style={{ color: 'var(--ink-faint)' }}>No events.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Route + navigation**

In `App.jsx` add `const BookingGuarantee = lazy(() => import('./pages/BookingGuarantee'))` after the `FreeBookingOffer` lazy import (L57), and `<Route path="/booking-guarantee" element={<BookingGuarantee />} />` after the `/free-booking` route (L98). In `config/navigation.js` add `ShieldCheck` handling: `ShieldCheck` is already imported there, so add after the `/free-booking` entry (L66):

```js
      { to: '/booking-guarantee', label: 'Booking Guarantee', icon: ShieldCheck, roles: ALL_STAFF, built: true },
```

- [ ] **Step 8: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no new lint errors in the touched files; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/src
git commit -m "feat(booking-guarantee): admin panel - compensation field, guarantee page, alert banner, order countdown

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Customer app (booking line, waiting screen, no-driver result)

**Files:**
- Create: `ShifterOnline/lib/utils/booking_guarantee.dart`, `ShifterOnline/lib/services/booking_guarantee_api_service.dart`, `ShifterOnline/test/booking_guarantee_test.dart`
- Modify: `ShifterOnline/lib/Api/config.dart`, `ShifterOnline/lib/utils/node_socket_manager.dart`, `ShifterOnline/lib/screens/home/waiting_screen.dart`, `ShifterOnline/lib/screens/home/select_vehicle.dart`, `ShifterOnline/lib/bottombar.dart`

**Interfaces:**
- Consumes: `POST api/order/guarantee-quote`; socket `order:guarantee_pending {order_id, amount, deadline_at}`; `order:no_driver_found {order_id, compensation_amount}`; order details `OrderProductList[0].guarantee {state, amount, deadline_at}`.
- Produces: `parseGuaranteeAmount(dynamic) → double`, `guaranteeLine(double) → String?` (null when 0), `noDriverMessage(double) → String`, `BookingGuaranteeApiService.quote(List<int>) → Future<double>`.

> **Heads-up for the implementer:** the customer app on disk has a single-select model list (`select_vehicle.dart: _bookingDeliveryTypeIds` sends every model with `sort_order` ≤ the chosen one), not independent ON/OFF switches. The quote is computed from whatever id list the app sends as `delivery_type`, so this plan works unchanged with either UI. Do NOT add a toggle.

- [ ] **Step 1: Write the failing Dart test**

Create `ShifterOnline/test/booking_guarantee_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/booking_guarantee.dart';

void main() {
  test('parseGuaranteeAmount handles numbers, strings and junk', () {
    expect(parseGuaranteeAmount(100), 100.0);
    expect(parseGuaranteeAmount('250.50'), 250.5);
    expect(parseGuaranteeAmount(null), 0.0);
    expect(parseGuaranteeAmount('abc'), 0.0);
    expect(parseGuaranteeAmount(-5), 0.0);
  });

  test('guaranteeLine is hidden at zero and formats whole rupees without decimals', () {
    expect(guaranteeLine(0), isNull);
    expect(guaranteeLine(100), 'If no driver is found, you get ₹100');
    expect(guaranteeLine(100.5), 'If no driver is found, you get ₹100.50');
  });

  test('noDriverMessage mentions the wallet credit only when something was paid', () {
    expect(noDriverMessage(0), 'No driver found. Please try again.');
    expect(noDriverMessage(500), 'No driver found. ₹500 has been added to your wallet.');
  });
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ShifterOnline && flutter test test/booking_guarantee_test.dart`
Expected: FAIL — `booking_guarantee.dart` not found.

- [ ] **Step 3: Implement the helpers**

Create `ShifterOnline/lib/utils/booking_guarantee.dart`:

```dart
/// Booking Guarantee display helpers (backend spec 2026-10-07). Strings go through `.tr` at the call site.

double parseGuaranteeAmount(dynamic raw) {
  final v = raw is num ? raw.toDouble() : double.tryParse(raw?.toString() ?? '');
  return v == null || v.isNaN || v < 0 ? 0.0 : v;
}

String _rupees(double amount) =>
    amount == amount.roundToDouble() ? '₹${amount.toInt()}' : '₹${amount.toStringAsFixed(2)}';

/// "If no driver is found, you get ₹X" — null (hide the line) when nothing is owed.
String? guaranteeLine(double amount) =>
    amount > 0 ? 'If no driver is found, you get ${_rupees(amount)}' : null;

String noDriverMessage(double compensation) => compensation > 0
    ? 'No driver found. ${_rupees(compensation)} has been added to your wallet.'
    : 'No driver found. Please try again.';
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ShifterOnline && flutter test test/booking_guarantee_test.dart`
Expected: PASS.

- [ ] **Step 5: API service + endpoint constant**

In `ShifterOnline/lib/Api/config.dart`, after `static const String nodeOrderDetails = "api/order/details";` (L152) add:

```dart
  static const String nodeGuaranteeQuote = "api/order/guarantee-quote";
```

Create `ShifterOnline/lib/services/booking_guarantee_api_service.dart`:

```dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';
import '../utils/booking_guarantee.dart';

/// Display-only quote for the Booking Guarantee line on the booking screen.
/// Any failure returns 0 so a network problem simply hides the line — it never blocks a booking.
class BookingGuaranteeApiService {
  BookingGuaranteeApiService._();

  static Future<double> quote(List<int> packageIds) async {
    if (packageIds.isEmpty) return 0;
    try {
      final response = await http.post(
        Uri.parse('${Config.nodeBaseUrl}/${Config.nodeGuaranteeQuote}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'package_ids': packageIds}),
      );
      final json = jsonDecode(response.body);
      if (json is Map && (json['Result'] == true || json['Result'] == 'true')) {
        return parseGuaranteeAmount(json['amount']);
      }
    } catch (e) {
      debugPrint('BookingGuarantee quote failed: $e');
    }
    return 0;
  }
}
```

- [ ] **Step 6: Socket manager — add `onGuaranteePending`**

In `node_socket_manager.dart`: add the field `final SocketEventCallback? onGuaranteePending;` after `onSettlementUpdated` in `_SocketListeners`; add `this.onGuaranteePending,` to its constructor; add `SocketEventCallback? onGuaranteePending,` to `addListeners(...)` parameters and `onGuaranteePending: onGuaranteePending,` to the `_SocketListeners(...)` call; and after the `order:no_driver_found` registration (L158) add:

```dart
    _socket!.on('order:guarantee_pending', (data) => _dispatch((l) => l.onGuaranteePending, data));
```

- [ ] **Step 7: Waiting screen**

In `waiting_screen.dart`: add imports `import 'package:goParcel/utils/booking_guarantee.dart';`. Add state fields next to `_recoveringOrder`:

```dart
  double _guaranteeAmount = 0;
  bool _guaranteePending = false;
```

Add this method after `_startTimeout`:

```dart
  /// The order is being held for an admin to assign a driver (Booking Guarantee). The 130 s safety timer
  /// would otherwise dump the customer on Home while their order is still alive, so stop it.
  void _enterGuaranteeWait(double amount) {
    if (_isDisposed) return;
    _timeoutTimer?.cancel();
    _countdownTicker?.cancel();
    clearPersistedWaitingOrder();
    setState(() {
      _guaranteePending = true;
      _guaranteeAmount = amount;
    });
  }
```

In `_listenForAssignment`'s `addListeners(...)` call, add after `onNoDriverFound: (...) {...}` (add a comma after its closing brace):

```dart
    , onGuaranteePending: (data) {
      if (data['order_id']?.toString() != widget.orderId) return;
      _enterGuaranteeWait(parseGuaranteeAmount(data['amount']));
    }
```

Replace the body of the existing `onNoDriverFound` handler's toast line `ApiWrapper.showToastMessage("No driver found. Please try again.".tr);` with:

```dart
      ApiWrapper.showToastMessage(noDriverMessage(parseGuaranteeAmount(data['compensation_amount'])).tr);
```

In `_recoverActiveOrder` (REST recovery after reconnect), after `final flow = ...` / `final riderId = ...` add:

```dart
      final guarantee = order['guarantee'];
      if (guarantee is Map) {
        final g = Map<String, dynamic>.from(guarantee);
        if (g['state'] == 'pending') {
          _enterGuaranteeWait(parseGuaranteeAmount(g['amount']));
          return;
        }
      }
```

placed before the `if (riderId > 0 || ...)` branch; and in the existing `else if (flow == 4)` branch replace the toast line with `ApiWrapper.showToastMessage(noDriverMessage(parseGuaranteeAmount((order['guarantee'] is Map) ? order['guarantee']['amount'] : 0)).tr);` only when `order['guarantee']['state'] == 'paid'`; otherwise keep the existing "No driver found. Please try again." text:

```dart
        final g = order['guarantee'];
        final paid = g is Map && g['state'] == 'paid' ? parseGuaranteeAmount(g['amount']) : 0.0;
        ApiWrapper.showToastMessage(noDriverMessage(paid).tr);
```

In `build`, replace the "Waiting Time Countdown" `Column(...)` block (the one starting `// ── Waiting Time Countdown`) with a conditional so a held order shows the guarantee instead of the auto-closing timer:

```dart
                        if (_guaranteePending) ...[
                          Text(
                            "We're arranging a driver for you. This can take a few minutes.".tr,
                            style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 14, color: Colors.white70),
                            textAlign: TextAlign.center,
                          ),
                          if (guaranteeLine(_guaranteeAmount) != null) ...[
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.18),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: Colors.white.withOpacity(0.35)),
                              ),
                              child: Text(
                                guaranteeLine(_guaranteeAmount)!.tr,
                                style: const TextStyle(fontFamily: 'Gilroy_Bold', fontSize: 15, color: Colors.white),
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ],
                        ] else
                          <the original Column(...) block, unchanged>,
```

(Keep the original countdown `Column` exactly as it was inside the `else` branch.)

- [ ] **Step 8: Background no-driver dialog**

In `bottombar.dart` `onNoDriverFound` (L72-86), replace the dialog `content: Text("None of the available drivers accepted your scheduled order #$orderId. Please try booking again.".tr),` with:

```dart
          content: Text(parseGuaranteeAmount(data['compensation_amount']) > 0
              ? "No driver accepted your scheduled order #$orderId. ${noDriverMessage(parseGuaranteeAmount(data['compensation_amount'])).replaceFirst('No driver found. ', '')}".tr
              : "None of the available drivers accepted your scheduled order #$orderId. Please try booking again.".tr),
```

and add `import 'package:goParcel/utils/booking_guarantee.dart';` to its imports.

- [ ] **Step 9: Booking screen line**

In `select_vehicle.dart` add imports `import 'package:goParcel/services/booking_guarantee_api_service.dart';` and `import 'package:goParcel/utils/booking_guarantee.dart';`. Add a field next to `_selectedModelIndex` (L78):

```dart
  double _guaranteeAmount = 0;
  int _guaranteeRequestSeq = 0;
```

Add this method next to `_bookingDeliveryTypeIds`:

```dart
  /// Refreshes the "if no driver is found, you get ₹X" line for the CURRENT model selection. The quote is
  /// computed server-side from the same id list the order will send; a stale response is ignored.
  Future<void> _refreshGuaranteeQuote() async {
    final model = _selectedModel;
    final seq = ++_guaranteeRequestSeq;
    if (model == null) {
      if (mounted) setState(() => _guaranteeAmount = 0);
      return;
    }
    final amount = await BookingGuaranteeApiService.quote(_bookingDeliveryTypeIds(model));
    if (!mounted || seq != _guaranteeRequestSeq) return;
    setState(() => _guaranteeAmount = amount);
  }
```

Call `_refreshGuaranteeQuote();` in three places:

1. Right after the `setState(() { _loadingModels = true; _modelsError = null; _models = []; _selectedModelIndex = null; });` line at ~L626 of `_loadModelsForSelectedVehicle` (resets the line to hidden while models reload).
2. Right after the `setState(...)` that assigns `_selectedModelIndex = retainedModelIndex >= 0 ? retainedModelIndex : (models.isEmpty ? null : 0);` at ~L653.
3. In the model card's tap handler (~L2025). Replace the exact substring `onTap: () => setState(() => _selectedModelIndex = index),` with:

```dart
onTap: () { setState(() => _selectedModelIndex = index); _refreshGuaranteeQuote(); },
```

Finally render the line in `_bottomCta()`: directly after `mainAxisSize: MainAxisSize.min,` / `children: [` and before `if (_currentBookingType == 2) ...[` add:

```dart
        if (guaranteeLine(_guaranteeAmount) != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(Icons.verified_user_outlined, size: 16, color: linercolor),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    guaranteeLine(_guaranteeAmount)!.tr,
                    style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 12.5),
                  ),
                ),
              ],
            ),
          ),
```

- [ ] **Step 10: Analyze and test**

Run: `cd ShifterOnline && flutter analyze lib/utils lib/services lib/screens/home/waiting_screen.dart lib/screens/home/select_vehicle.dart lib/bottombar.dart && flutter test`
Expected: no new analyzer errors; all tests pass.

- [ ] **Step 11: Commit (app dir is gitignored — force-add exact files only)**

```bash
git add -f ShifterOnline/lib/utils/booking_guarantee.dart ShifterOnline/lib/services/booking_guarantee_api_service.dart ShifterOnline/test/booking_guarantee_test.dart ShifterOnline/lib/Api/config.dart ShifterOnline/lib/utils/node_socket_manager.dart ShifterOnline/lib/screens/home/waiting_screen.dart ShifterOnline/lib/screens/home/select_vehicle.dart ShifterOnline/lib/bottombar.dart
git commit -m "feat(booking-guarantee): customer app - guarantee line, held-order waiting state, compensation result

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end verification and deploy notes

**Files:** none new (verification only; one note appended to `docs/superpowers/specs/2026-10-07-booking-guarantee-design.md`).

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npx jest`
Expected: all suites pass (compare the failing-suite list against `git stash`-free baseline on `main` if anything unrelated fails; report it, do not "fix" unrelated suites).

- [ ] **Step 2: Live smoke test on the dev DB**

With the backend running against the dev DB, using one real unassigned test order id `<ORDER>` and a tiny assignment window:

1. Admin panel → Booking Guarantee → set Admin assignment time to `1`; Rate cards → give the highest package of the test order a non-zero "No Driver Found Compensation".
2. Book a test order with no eligible drivers online. Expected: the customer app shows "We're arranging a driver…" plus the guarantee line (no auto-close at 130 s); the admin panel shows the red banner with a ticking countdown and the order row shows "Guarantee · mm:ss".
3. Do NOT assign. After ~1 minute: order shows Cancelled "No driver found"; customer wallet history has one `Booking Guarantee compensation for order #<ORDER>` credit (verify: `SELECT id, amount, payment_id FROM tbl_wallet_history WHERE order_id=<ORDER> AND payment_id LIKE 'booking_guarantee_credit:%'` returns exactly 1 row); the case page shows `Expired` with History events `opened → admin_alerted → expired → wallet_credited → refunds_processed`.
4. Repeat with an admin assignment inside the window: case `Driver assigned`, no wallet credit, no `expired` event.
5. Repeat and restart the backend during the window: the order must survive the restart, then expire and pay exactly once (Review Focus #1).
6. Repeat and cancel from the customer app during the window: case `Cancelled`, no credit.

Report each outcome faithfully; do not claim a step passed that was not run.

- [ ] **Step 3: Record the prod-deploy requirement**

Append to the spec's "Deployment note" section: the migration file `backend/prisma/migrations/20261007020000_add_booking_guarantee/migration.sql` must be run on PROD before deploying the backend; after deploy, set each package's "No Driver Found Compensation" in Rate Cards (initial intent: lowest model ₹0, then ₹100 / ₹500 / ₹1000 / ₹2000 by `sort_order`) and set the Admin assignment time on the Booking Guarantee page.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-07-booking-guarantee-design.md
git commit -m "docs(booking-guarantee): record prod migration and configuration steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
