# Payment Settlement — Backend Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT.** Implementation record - kept for history. Where it differs from the code, the code and the master document win. Current code-verified description: [Master Document section 5.1](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-completion payment-settlement flow to the Node backend: customer chooses cash/online, driver confirms cash, wallet movements happen on confirmation, disputes and admin resolution are supported — all behind a master switch that is off by default.

**Architecture:** A new `order_settlement` table (one row per completed cash order with an amount due) is the source of truth, driven by a state machine in `services/settlementService.js`. Wallet effects (`none | cash | online`) are applied/reversed by difference, each wallet row idempotent via a unique `payment_id`. `tripLifecycle.updateStatus('complete')` creates the settlement and skips its own commission writes when the feature is on, failing open to today's behaviour if settlement creation errors.

**Tech Stack:** Node.js, Express, Prisma (MySQL), Socket.IO, Jest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-payment-settlement-design.md`

This is **plan 1 of 4**. The admin Settlements page, the customer Flutter app and the driver Android app each get their own plan, written after this one lands (they consume the API contract fixed in Tasks 7 and 10).

## Deviations from the spec (decided while reading the code)

1. **Settings live in the existing `app_settings` key/value table**, not a new `tbl_settlement_setting` table. The admin Settings page already persists arbitrary `flags` into `app_settings` (`settingsController.js`), so no new table or endpoint is needed. Keys: `settlement_enabled`, `settlement_reminder_minutes` (comma list), `settlement_escalate_after_minutes`, `settlement_driver_block_grace_minutes`, `settlement_dispute_window_hours`.
2. **`order_settlement` gets extra columns** the spec's money rules need: `fare`, `commission_amount`, `per_trip_charge`, `prepaid_amount` (snapshot taken at completion), `effect_seq` (idempotency counter), `customer_choice`.
3. **Driver endpoints are mounted at `/api/rider/settlement/*`** (the existing driver router), customer endpoints at `/api/order/settlement/*`, both POST with `uid` / `rider_id` in the body — the convention every other order endpoint uses. Admin endpoints at `/api/v1/admin/settlements`.
4. **Monthly Driver and Daily Driver orders never get a settlement.** Those drivers have their own cash ledger / settlement system (`monthly_driver_ledger`, `dailyDriverSettlementService`); mixing online-payment effects into them is out of scope. They behave exactly as today. **Owner should confirm this default.**
5. Admin roles for settlements are `superadmin` and `admin` only (money action), without city scoping.

## Global Constraints

- New settlement columns (`pending_since`, `confirmed_at`, …) store **real UTC** (`new Date()`), not the IST-shifted values some legacy columns use. `tbl_wallet_history.created_at` keeps using `istNow()` like every other wallet write.
- Customer and driver endpoints always answer **HTTP 200** with `{ ResponseCode, Result, ResponseMsg, ... }` (Flutter `ApiWrapper` discards non-200 bodies). Admin endpoints use `{ success, data | message }` with real status codes.
- Every wallet row written by the settlement service has a unique `payment_id` of the form `settle:<settlementId>:<effect_seq>:<apply|rev>:<n>`; the writer checks for an existing row first (same pattern as `commission_debit:<orderId>`).
- Every state transition runs in one `prisma.$transaction` with `SELECT ... FOR UPDATE` on the settlement row.
- `settlement_enabled` defaults to **off**; a settings read error must behave as **off** (fail closed). With it off, `complete` behaves byte-for-byte as today.
- Settlements are created only when: feature on, `isCashOrder`, `amount_due = cashCollected > 0`, driver is neither Monthly nor Daily-exempt.
- Admin outcomes map to effects: `cash_received → cash`; `paid_online | waived | customer_owes → online`.
- Online effect credit = `fare − commission_amount − per_trip_charge` (floored at 0). Cash effect = today's `netCommissionDue` debit / `advanceRefundDue` credit.
- Production needs the migration SQL applied **before** deploying this backend (known dev/prod schema drift — see `docs/superpowers/specs/2026-09-26…` and the team's drift note).

## Review Focus

1. **Driver double-taps "Received" / the request is retried:** wallet must move exactly once and the second call must succeed as a no-op. Pinned in Task 4.
2. **Razorpay payment for the wrong amount, the wrong Razorpay order, or replayed against a different order:** must be rejected and leave the settlement `pending`. Pinned in Task 5.
3. **Settlement creation throws during `complete`:** the ride must still complete and fall back to today's commission debit — never a completed ride with no money flow. Pinned in Task 6.
4. **Admin resolves, then changes their mind (cash → online → cash):** each change must reverse exactly the previously applied effect, and repeating the same resolve must not move money again. Pinned in Task 4.
5. **Sweep runs twice / overlaps / server restarts:** a reminder threshold must send once, escalation must stamp once. Pinned in Task 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/migrations/20261004010000_add_order_settlement/migration.sql` | Create `order_settlement`, `order_settlement_event` |
| `backend/prisma/schema.prisma` | Add the two models |
| `backend/src/services/settlementSettings.js` | Read/parse admin settings from `app_settings` (fail closed) |
| `backend/src/services/settlementService.js` | State machine, wallet effects, queries used by controllers |
| `backend/src/utils/razorpayOrders.js` | Create a Razorpay order server-side |
| `backend/src/services/settlementSweep.js` | Reminders + escalation sweep |
| `backend/src/controllers/settlementController.js` | Customer + driver endpoints |
| `backend/src/controllers/adminSettlementController.js` | Admin list/detail/resolve |
| `backend/src/services/tripLifecycle.js` | Create settlement on complete, skip legacy commission when created |
| `backend/src/services/dispatchManager.js` | Skip drivers with a stale pending settlement |
| `backend/src/controllers/orderController.js` | Booking block + `settlement` in order details |
| `backend/src/services/pushNotifier.js` | Two reminder push helpers |
| `backend/src/routes/orderRoutes.js`, `riderRoutes.js`, `adminRoutes.js` | Wire endpoints |
| `backend/src/server.js` | Schedule the sweep |

Tests mirror the files under `__tests__/` next to each.

---

### Task 1: Migration and Prisma models

**Files:**
- Create: `backend/prisma/migrations/20261004010000_add_order_settlement/migration.sql`
- Modify: `backend/prisma/schema.prisma` (append two models)

**Interfaces:**
- Produces: Prisma delegates `prisma.order_settlement` and `prisma.order_settlement_event` with the fields below (used by every later task).

- [ ] **Step 1: Write the migration SQL**

```sql
-- Trip payment settlement (spec 2026-10-04). Apply on prod BEFORE deploying the backend.
CREATE TABLE `order_settlement` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `rid` INT NOT NULL,
  `amount_due` DECIMAL(10, 2) NOT NULL,
  `fare` DECIMAL(10, 2) NOT NULL,
  `commission_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `per_trip_charge` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `prepaid_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `method` VARCHAR(10) NULL,
  `wallet_effect` VARCHAR(10) NOT NULL DEFAULT 'none',
  `effect_seq` INT NOT NULL DEFAULT 0,
  `customer_choice` VARCHAR(10) NULL,
  `razorpay_order_id` VARCHAR(64) NULL,
  `razorpay_payment_id` VARCHAR(64) NULL,
  `pending_since` DATETIME(0) NOT NULL,
  `confirmed_at` DATETIME(0) NULL,
  `confirmed_by` VARCHAR(20) NULL,
  `last_reminder_at` DATETIME(0) NULL,
  `reminders_sent` INT NOT NULL DEFAULT 0,
  `escalated_at` DATETIME(0) NULL,
  `dispute_reason` TEXT NULL,
  `dispute_raised_by` VARCHAR(10) NULL,
  `dispute_raised_at` DATETIME(0) NULL,
  `resolved_by` INT NULL,
  `resolved_at` DATETIME(0) NULL,
  `resolve_note` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL,
  `updated_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_settlement_order` (`order_id`),
  INDEX `idx_order_settlement_status` (`status`, `pending_since`),
  INDEX `idx_order_settlement_uid` (`uid`, `status`),
  INDEX `idx_order_settlement_rid` (`rid`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_settlement_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `settlement_id` INT NOT NULL,
  `actor` VARCHAR(10) NOT NULL,
  `actor_id` INT NULL,
  `from_status` VARCHAR(20) NULL,
  `to_status` VARCHAR(20) NULL,
  `note` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_order_settlement_event_settlement` (`settlement_id`),
  CONSTRAINT `fk_order_settlement_event_settlement` FOREIGN KEY (`settlement_id`)
    REFERENCES `order_settlement` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 2: Append the Prisma models to `schema.prisma`**

```prisma
model order_settlement {
  id                  Int       @id @default(autoincrement())
  order_id            Int       @unique(map: "uq_order_settlement_order")
  uid                 Int
  rid                 Int
  amount_due          Decimal   @db.Decimal(10, 2)
  fare                Decimal   @db.Decimal(10, 2)
  commission_amount   Decimal   @default(0.00) @db.Decimal(10, 2)
  per_trip_charge     Decimal   @default(0.00) @db.Decimal(10, 2)
  prepaid_amount      Decimal   @default(0.00) @db.Decimal(10, 2)
  status              String    @default("pending") @db.VarChar(20)
  method              String?   @db.VarChar(10)
  wallet_effect       String    @default("none") @db.VarChar(10)
  effect_seq          Int       @default(0)
  customer_choice     String?   @db.VarChar(10)
  razorpay_order_id   String?   @db.VarChar(64)
  razorpay_payment_id String?   @db.VarChar(64)
  pending_since       DateTime  @db.DateTime(0)
  confirmed_at        DateTime? @db.DateTime(0)
  confirmed_by        String?   @db.VarChar(20)
  last_reminder_at    DateTime? @db.DateTime(0)
  reminders_sent      Int       @default(0)
  escalated_at        DateTime? @db.DateTime(0)
  dispute_reason      String?   @db.Text
  dispute_raised_by   String?   @db.VarChar(10)
  dispute_raised_at   DateTime? @db.DateTime(0)
  resolved_by         Int?
  resolved_at         DateTime? @db.DateTime(0)
  resolve_note        String?   @db.Text
  created_at          DateTime  @db.DateTime(0)
  updated_at          DateTime  @db.DateTime(0)
  events              order_settlement_event[]

  @@index([status, pending_since], map: "idx_order_settlement_status")
  @@index([uid, status], map: "idx_order_settlement_uid")
  @@index([rid, status], map: "idx_order_settlement_rid")
}

model order_settlement_event {
  id            Int              @id @default(autoincrement())
  settlement_id Int
  actor         String           @db.VarChar(10)
  actor_id      Int?
  from_status   String?          @db.VarChar(20)
  to_status     String?          @db.VarChar(20)
  note          String?          @db.Text
  created_at    DateTime         @db.DateTime(0)
  settlement    order_settlement @relation(fields: [settlement_id], references: [id], onDelete: Cascade, onUpdate: Cascade, map: "fk_order_settlement_event_settlement")

  @@index([settlement_id], map: "idx_order_settlement_event_settlement")
}
```

- [ ] **Step 3: Validate and generate**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` and `Generated Prisma Client`. If `generate` fails with an `EPERM` lock on the query engine DLL, stop the running dev server and retry.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/migrations/20261004010000_add_order_settlement backend/prisma/schema.prisma
git commit -m "feat(settlement): add order_settlement tables and models"
```

---

### Task 2: Settlement settings reader

**Files:**
- Create: `backend/src/services/settlementSettings.js`
- Test: `backend/src/services/__tests__/settlementSettings.test.js`

**Interfaces:**
- Produces:
  - `getSettlementSettings(): Promise<{ enabled: boolean, reminderMinutes: number[], escalateAfterMinutes: number, driverBlockGraceMinutes: number, disputeWindowHours: number }>`
  - `isSettlementEnabled(): Promise<boolean>`
  - `KEYS`, `DEFAULTS`

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));
const prisma = require("../../config/db");
const { getSettlementSettings, isSettlementEnabled, DEFAULTS } = require("../settlementSettings");

const rows = (obj) => Object.entries(obj).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

describe("settlementSettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is disabled with default timings when nothing is configured", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await getSettlementSettings()).toEqual({
      enabled: false, reminderMinutes: [10, 30], escalateAfterMinutes: 60,
      driverBlockGraceMinutes: 10, disputeWindowHours: 48,
    });
  });

  it("parses admin values", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      settlement_enabled: "1", settlement_reminder_minutes: "5, 15,45",
      settlement_escalate_after_minutes: "90", settlement_driver_block_grace_minutes: "20",
      settlement_dispute_window_hours: "24",
    }));
    expect(await getSettlementSettings()).toEqual({
      enabled: true, reminderMinutes: [5, 15, 45], escalateAfterMinutes: 90,
      driverBlockGraceMinutes: 20, disputeWindowHours: 24,
    });
  });

  it("treats true/on/yes as enabled and anything else as disabled", async () => {
    for (const [v, expected] of [["true", true], ["on", true], ["yes", true], ["0", false], ["off", false], ["", false]]) {
      prisma.app_settings.findMany.mockResolvedValue(rows({ settlement_enabled: v }));
      expect(await isSettlementEnabled()).toBe(expected);
    }
  });

  it("an explicitly empty reminder list means no reminders; junk entries are dropped, list sorted and de-duplicated", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ settlement_reminder_minutes: "" }));
    expect((await getSettlementSettings()).reminderMinutes).toEqual([]);
    prisma.app_settings.findMany.mockResolvedValue(rows({ settlement_reminder_minutes: "30,abc,-5,10,30,0" }));
    expect((await getSettlementSettings()).reminderMinutes).toEqual([10, 30]);
  });

  it("falls back to defaults for non-positive or non-numeric thresholds", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      settlement_escalate_after_minutes: "0", settlement_driver_block_grace_minutes: "x", settlement_dispute_window_hours: "-1",
    }));
    const s = await getSettlementSettings();
    expect(s.escalateAfterMinutes).toBe(DEFAULTS.escalateAfterMinutes);
    expect(s.driverBlockGraceMinutes).toBe(DEFAULTS.driverBlockGraceMinutes);
    expect(s.disputeWindowHours).toBe(DEFAULTS.disputeWindowHours);
  });

  it("fails closed (disabled) when the settings read throws", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect((await getSettlementSettings()).enabled).toBe(false);
    expect(await isSettlementEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/services/__tests__/settlementSettings.test.js`
Expected: FAIL — `Cannot find module '../settlementSettings'`.

- [ ] **Step 3: Implement**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Admin-editable via the existing Settings page `flags` (settingsController.js
// upserts arbitrary keys into app_settings), so no dedicated settings table.
const KEYS = Object.freeze({
  enabled: "settlement_enabled",
  reminderMinutes: "settlement_reminder_minutes",
  escalateAfterMinutes: "settlement_escalate_after_minutes",
  driverBlockGraceMinutes: "settlement_driver_block_grace_minutes",
  disputeWindowHours: "settlement_dispute_window_hours",
});

const DEFAULTS = Object.freeze({
  enabled: false,
  reminderMinutes: Object.freeze([10, 30]),
  escalateAfterMinutes: 60,
  driverBlockGraceMinutes: 10,
  disputeWindowHours: 48,
});

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());

function toPositive(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toMinuteList(v) {
  const nums = String(v ?? "")
    .split(",")
    .map((p) => parseFloat(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function defaults() {
  return { ...DEFAULTS, reminderMinutes: [...DEFAULTS.reminderMinutes] };
}

async function getSettlementSettings() {
  try {
    const rows = await prisma.app_settings.findMany({
      where: { setting_key: { in: Object.values(KEYS) } },
    });
    const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      enabled: toBool(byKey.get(KEYS.enabled)),
      reminderMinutes: byKey.has(KEYS.reminderMinutes)
        ? toMinuteList(byKey.get(KEYS.reminderMinutes))
        : [...DEFAULTS.reminderMinutes],
      escalateAfterMinutes: toPositive(byKey.get(KEYS.escalateAfterMinutes), DEFAULTS.escalateAfterMinutes),
      driverBlockGraceMinutes: toPositive(byKey.get(KEYS.driverBlockGraceMinutes), DEFAULTS.driverBlockGraceMinutes),
      disputeWindowHours: toPositive(byKey.get(KEYS.disputeWindowHours), DEFAULTS.disputeWindowHours),
    };
  } catch (err) {
    // Fail closed: an unreadable switch must never turn settlement ON.
    logger.error("getSettlementSettings: failed to read settings, treating feature as disabled:", err);
    return defaults();
  }
}

async function isSettlementEnabled() {
  return (await getSettlementSettings()).enabled;
}

module.exports = { KEYS, DEFAULTS, getSettlementSettings, isSettlementEnabled };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npx jest src/services/__tests__/settlementSettings.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/settlementSettings.js backend/src/services/__tests__/settlementSettings.test.js
git commit -m "feat(settlement): admin settings reader backed by app_settings"
```

---

### Task 3: Settlement service core — create, view, wallet effects

**Files:**
- Create: `backend/src/services/settlementService.js`
- Test: `backend/src/services/__tests__/settlementService.test.js`

**Interfaces:**
- Consumes: `settlementSettings.getSettlementSettings`, `walletNotifier.notifyDriverWalletTransaction(riderId, { type, amount, remark })`, `utils/istTime.istNow`.
- Produces (all exported from this file, later tasks add more exports to the same file):
  - `STATUS`, `EFFECT`, `OUTCOME_EFFECT`, `ADMIN_OUTCOMES`, `SettlementError(code, message)` with `.code`
  - `createForCompletedOrder({ orderId, uid, riderId, amountDue, fare, commissionAmount, perTripCharge, prepaidAmount }): Promise<row>` (idempotent per order)
  - `publicView(row)`, `getViewForParty({ orderId, party: 'customer'|'driver', partyId }): Promise<view|null>`, `getPublicViewForOrder(orderId): Promise<view|null>`
  - Internal (also exported for tests/later tasks): `effectOps(effect, row)`, `changeWalletEffect(tx, row, targetEffect)`, `lockByOrderId(tx, orderId)`, `lockById(tx, id)`, `logEvent(tx, row, event)`, `runTransition(work)`, `assertParty(row, party, id)`, `stateMessage(status)`, `emitSettlementUpdated(row)`

- [ ] **Step 1: Write the failing tests**

```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
const mockEmit = jest.fn();
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: mockEmit }) }) }));

const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const svc = require("../settlementService");

const row = (o = {}) => ({
  id: 1, order_id: 50, uid: 7, rid: 9, amount_due: 100, fare: 100,
  commission_amount: 10, per_trip_charge: 0, prepaid_amount: 0,
  status: "pending", method: null, wallet_effect: "none", effect_seq: 0,
  pending_since: new Date("2026-10-04T10:00:00Z"), created_at: new Date(), updated_at: new Date(), ...o,
});

function setup(current) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: current.id }]);
  prisma.order_settlement.findUnique.mockResolvedValue(current);
  prisma.order_settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
}

describe("settlementService.effectOps", () => {
  it("cash: debits commission + per-trip charge net of prepaid", () => {
    expect(svc.effectOps("cash", row({ commission_amount: 10, per_trip_charge: 2, prepaid_amount: 5 })))
      .toEqual([{ type: "debit", amount: 7, remark: "Admin deduction for order #50" }]);
  });
  it("cash: credits the leftover advance when prepaid exceeds commission", () => {
    const ops = svc.effectOps("cash", row({ commission_amount: 10, prepaid_amount: 15 }));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "credit", amount: 5 });
  });
  it("online: credits fare minus commission and per-trip charge", () => {
    expect(svc.effectOps("online", row({ fare: 100, commission_amount: 10, per_trip_charge: 2 })))
      .toEqual([{ type: "credit", amount: 88, remark: "Online payment received for order #50" }]);
  });
  it("online: never credits a negative amount", () => {
    expect(svc.effectOps("online", row({ fare: 5, commission_amount: 10 }))).toEqual([]);
  });
  it("none: no ops", () => expect(svc.effectOps("none", row())).toEqual([]));
});

describe("settlementService.createForCompletedOrder", () => {
  const payload = { orderId: 50, uid: 7, riderId: 9, amountDue: 85, fare: 100, commissionAmount: 10, perTripCharge: 0, prepaidAmount: 15 };

  it("creates a pending settlement with an audit event and notifies the order room", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    prisma.order_settlement.create.mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data }));
    prisma.order_settlement_event.create.mockResolvedValue({});

    const created = await svc.createForCompletedOrder(payload);

    expect(prisma.order_settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: 50, uid: 7, rid: 9, amount_due: 85, fare: 100, commission_amount: 10,
        per_trip_charge: 0, prepaid_amount: 15, status: "pending", wallet_effect: "none",
      }),
    });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ settlement_id: 3, actor: "system", to_status: "pending" }),
    });
    expect(mockEmit).toHaveBeenCalledWith("settlement:updated", expect.objectContaining({ order_id: 50, status: "pending", amount_due: 85 }));
    expect(created.id).toBe(3);
  });

  it("is idempotent: an existing settlement is returned untouched", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(row());
    const result = await svc.createForCompletedOrder(payload);
    expect(prisma.order_settlement.create).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
  });

  it("returns the winner's row when a concurrent create hits the unique index (P2002)", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ id: 8 }));
    prisma.order_settlement.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const result = await svc.createForCompletedOrder(payload);
    expect(result.id).toBe(8);
  });
});

describe("settlementService views", () => {
  it("getViewForParty hides another customer's settlement", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(row({ uid: 7 }));
    await expect(svc.getViewForParty({ orderId: 50, party: "customer", partyId: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await svc.getViewForParty({ orderId: 50, party: "customer", partyId: 7 })).toMatchObject({ order_id: 50, status: "pending", amount_due: 100 });
  });

  it("getViewForParty returns null when the order has no settlement", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    expect(await svc.getViewForParty({ orderId: 50, party: "driver", partyId: 9 })).toBeNull();
  });

  it("getPublicViewForOrder swallows a missing table (schema drift) and returns null", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect(await svc.getPublicViewForOrder(50)).toBeNull();
  });
});

describe("settlementService.changeWalletEffect", () => {
  it("none -> cash applies the commission debit with a unique key and bumps effect_seq", async () => {
    const current = row({ wallet_effect: "none", effect_seq: 0 });
    setup(current);
    const { effectSeq, notifications } = await svc.changeWalletEffect(prisma, current, "cash");
    expect(effectSeq).toBe(1);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 10 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 9, amount: 10, type: "debit", wallet_type: "driver", order_id: 50, payment_id: "settle:1:1:apply:0" }),
    });
    expect(notifications).toEqual([{ riderId: 9, type: "debit", amount: 10, remark: "Admin deduction for order #50" }]);
  });

  it("cash -> online reverses the cash effect first, then applies the online credit", async () => {
    const current = row({ wallet_effect: "cash", effect_seq: 1 });
    setup(current);
    const { effectSeq } = await svc.changeWalletEffect(prisma, current, "online");
    expect(effectSeq).toBe(3);
    const keys = prisma.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["settle:1:2:rev:0", "settle:1:3:apply:0"]);
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ increment: 10 }, { increment: 90 }]);
  });

  it("is a no-op when the effect is unchanged", async () => {
    const current = row({ wallet_effect: "online", effect_seq: 2 });
    setup(current);
    const { effectSeq, notifications } = await svc.changeWalletEffect(prisma, current, "online");
    expect(effectSeq).toBe(2);
    expect(notifications).toEqual([]);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("skips a wallet row whose idempotency key already exists", async () => {
    const current = row({ wallet_effect: "none", effect_seq: 0 });
    setup(current);
    prisma.tbl_wallet_history.findFirst.mockResolvedValue({ id: 1 });
    await svc.changeWalletEffect(prisma, current, "cash");
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/services/__tests__/settlementService.test.js`
Expected: FAIL — `Cannot find module '../settlementService'`.

- [ ] **Step 3: Implement the core**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const walletNotifier = require("./walletNotifier");
const settlementSettings = require("./settlementSettings");

const STATUS = Object.freeze({
  PENDING: "pending",
  CASH_RECEIVED: "cash_received",
  PAID_ONLINE: "paid_online",
  DISPUTED: "disputed",
  WAIVED: "waived",
  CUSTOMER_OWES: "customer_owes",
});
const EFFECT = Object.freeze({ NONE: "none", CASH: "cash", ONLINE: "online" });
// What an admin outcome does to the driver wallet. waived / customer_owes both
// mean the company pays the driver (same as online) without collecting from
// the customer here.
const OUTCOME_EFFECT = Object.freeze({
  cash_received: EFFECT.CASH,
  paid_online: EFFECT.ONLINE,
  waived: EFFECT.ONLINE,
  customer_owes: EFFECT.ONLINE,
});
const ADMIN_OUTCOMES = Object.freeze(Object.keys(OUTCOME_EFFECT));

class SettlementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
  }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function stateMessage(status) {
  if (status === STATUS.DISPUTED) return "Payment is under dispute. Admin will resolve it.";
  if (status === STATUS.CASH_RECEIVED) return "Driver has already confirmed this payment.";
  if (status === STATUS.PAID_ONLINE) return "Payment is already completed.";
  return `Payment is ${status}.`;
}

function publicView(s) {
  return {
    settlement_id: s.id,
    order_id: s.order_id,
    status: s.status,
    amount_due: Number(s.amount_due),
    fare: Number(s.fare),
    method: s.method || null,
    customer_choice: s.customer_choice || null,
    confirmed_by: s.confirmed_by || null,
    confirmed_at: s.confirmed_at || null,
    pending_since: s.pending_since,
    dispute_reason: s.dispute_reason || null,
    dispute_raised_by: s.dispute_raised_by || null,
  };
}

function emitSettlementUpdated(s) {
  try {
    // Lazy require: socketServer pulls in dispatchManager, which would create an import cycle at load time.
    const { getIO } = require("../sockets/socketServer");
    getIO().to(`order_${s.order_id}`).emit("settlement:updated", publicView(s));
  } catch (err) {
    // Sockets not initialised (tests, scripts) or a transient emit error must never fail a money transition.
    logger.warn(`emitSettlementUpdated skipped for order ${s?.order_id}: ${err.message}`);
  }
}

function assertParty(s, party, id) {
  if (!s) throw new SettlementError("NOT_FOUND", "No payment record for this order.");
  if (party === "customer" && Number(s.uid) !== Number(id)) {
    throw new SettlementError("FORBIDDEN", "This order belongs to another customer.");
  }
  if (party === "driver" && Number(s.rid) !== Number(id)) {
    throw new SettlementError("FORBIDDEN", "This order belongs to another driver.");
  }
}

// What each effect does to the driver wallet. Cash replicates what
// tripLifecycle's complete handler did before settlement existed.
function effectOps(effect, s) {
  const fare = Number(s.fare);
  const commission = Number(s.commission_amount);
  const perTrip = Number(s.per_trip_charge);
  const prepaid = Number(s.prepaid_amount);
  if (effect === EFFECT.CASH) {
    const netCommissionDue = round2(Math.max(0, commission + perTrip - prepaid));
    const advanceRefundDue = round2(Math.max(0, prepaid - (commission + perTrip)));
    const ops = [];
    if (netCommissionDue > 0) ops.push({ type: "debit", amount: netCommissionDue, remark: `Admin deduction for order #${s.order_id}` });
    if (advanceRefundDue > 0) {
      ops.push({
        type: "credit",
        amount: advanceRefundDue,
        remark: `Advance payment balance for order #${s.order_id} (cash collected was less than net earning)`,
      });
    }
    return ops;
  }
  if (effect === EFFECT.ONLINE) {
    const credit = round2(Math.max(0, fare - commission - perTrip));
    return credit > 0 ? [{ type: "credit", amount: credit, remark: `Online payment received for order #${s.order_id}` }] : [];
  }
  return [];
}

async function moveWallet(tx, s, ops, tag, notifications) {
  let i = 0;
  for (const op of ops) {
    const key = `settle:${s.id}:${s.effect_seq}:${tag}:${i++}`;
    const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "driver" } });
    if (duplicate) continue;
    await tx.tbl_rider.update({
      where: { id: s.rid },
      data: { wallet_balance: op.type === "debit" ? { decrement: op.amount } : { increment: op.amount } },
    });
    await tx.tbl_wallet_history.create({
      data: {
        user_id: s.rid,
        amount: op.amount,
        type: op.type,
        remark: op.remark,
        wallet_type: "driver",
        order_id: s.order_id,
        payment_id: key,
        created_at: istNow(),
      },
    });
    notifications.push({ riderId: s.rid, type: op.type, amount: op.amount, remark: op.remark });
  }
}

// Moves the driver wallet from the effect currently applied to the target one
// by reversing the old effect, then applying the new. Returns the new
// effect_seq the caller must persist together with wallet_effect.
async function changeWalletEffect(tx, s, target) {
  const notifications = [];
  if (s.wallet_effect === target) return { effectSeq: s.effect_seq, notifications };
  let seq = s.effect_seq;
  if (s.wallet_effect !== EFFECT.NONE) {
    seq += 1;
    const reversal = effectOps(s.wallet_effect, s).map((op) => ({
      type: op.type === "debit" ? "credit" : "debit",
      amount: op.amount,
      remark: `Reversal: ${op.remark}`,
    }));
    await moveWallet(tx, { ...s, effect_seq: seq }, reversal, "rev", notifications);
  }
  if (target !== EFFECT.NONE) {
    seq += 1;
    await moveWallet(tx, { ...s, effect_seq: seq }, effectOps(target, s), "apply", notifications);
  }
  return { effectSeq: seq, notifications };
}

async function lockByOrderId(tx, orderId) {
  const rows = await tx.$queryRaw`SELECT id FROM order_settlement WHERE order_id = ${orderId} FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.order_settlement.findUnique({ where: { id: rows[0].id } });
}

async function lockById(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM order_settlement WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.order_settlement.findUnique({ where: { id: rows[0].id } });
}

function logEvent(tx, s, { actor, actorId = null, from = null, to = null, note = null }) {
  return tx.order_settlement_event.create({
    data: { settlement_id: s.id, actor, actor_id: actorId, from_status: from, to_status: to, note, created_at: new Date() },
  });
}

// Runs `work(tx, notifications)` in a transaction; after commit, pushes the
// wallet notifications and the socket update. `work` returns { settlement, alreadyDone? }.
async function runTransition(work) {
  const notifications = [];
  const result = await prisma.$transaction((tx) => work(tx, notifications));
  for (const n of notifications) {
    Promise.resolve(walletNotifier.notifyDriverWalletTransaction(n.riderId, { type: n.type, amount: n.amount, remark: n.remark }))
      .catch((err) => logger.error(`settlement wallet notify failed for rider ${n.riderId}:`, err));
  }
  if (!result.alreadyDone) emitSettlementUpdated(result.settlement);
  return result;
}

async function createForCompletedOrder({ orderId, uid, riderId, amountDue, fare, commissionAmount, perTripCharge, prepaidAmount }) {
  const existing = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (existing) return existing;
  const now = new Date();
  let created;
  try {
    created = await prisma.order_settlement.create({
      data: {
        order_id: orderId,
        uid,
        rid: riderId,
        amount_due: round2(amountDue),
        fare: round2(fare),
        commission_amount: round2(commissionAmount),
        per_trip_charge: round2(perTripCharge),
        prepaid_amount: round2(prepaidAmount),
        status: STATUS.PENDING,
        wallet_effect: EFFECT.NONE,
        pending_since: now,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") return prisma.order_settlement.findUnique({ where: { order_id: orderId } });
    throw err;
  }
  await prisma.order_settlement_event.create({
    data: { settlement_id: created.id, actor: "system", from_status: null, to_status: STATUS.PENDING, note: "Ride completed; awaiting payment", created_at: now },
  });
  emitSettlementUpdated(created);
  return created;
}

async function getViewForParty({ orderId, party, partyId }) {
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!s) return null;
  assertParty(s, party, partyId);
  return publicView(s);
}

// Used inside order-details payloads: never let a missing table (dev/prod
// schema drift) or a transient error break the order screen.
async function getPublicViewForOrder(orderId) {
  try {
    const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
    return s ? publicView(s) : null;
  } catch (err) {
    logger.error(`getPublicViewForOrder failed for order ${orderId}:`, err);
    return null;
  }
}

module.exports = {
  STATUS, EFFECT, OUTCOME_EFFECT, ADMIN_OUTCOMES, SettlementError,
  round2, stateMessage, publicView, emitSettlementUpdated, assertParty,
  effectOps, changeWalletEffect, lockByOrderId, lockById, logEvent, runTransition,
  createForCompletedOrder, getViewForParty, getPublicViewForOrder,
  settlementSettings,
};
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx jest src/services/__tests__/settlementService.test.js`
Expected: PASS (all tests in this file).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/settlementService.js backend/src/services/__tests__/settlementService.test.js
git commit -m "feat(settlement): settlement service core with idempotent wallet effects"
```

---

### Task 4: Transitions — cash received, customer choice, dispute, admin resolve

**Files:**
- Modify: `backend/src/services/settlementService.js` (add four functions + exports)
- Modify: `backend/src/services/__tests__/settlementService.test.js` (append `describe` blocks)

**Interfaces:**
- Consumes: everything produced in Task 3.
- Produces:
  - `markCashReceived({ orderId, riderId }): Promise<{ settlement, alreadyDone? }>`
  - `chooseDriverPayment({ orderId, uid }): Promise<{ settlement }>`
  - `raiseDispute({ orderId, actor: 'customer'|'driver', actorId, reason }): Promise<{ settlement, alreadyDone? }>`
  - `adminResolve({ settlementId, adminId, outcome, note }): Promise<{ settlement, alreadyDone? }>`
  - Error codes thrown: `NOT_FOUND`, `FORBIDDEN`, `INVALID_STATE`, `REASON_REQUIRED`, `WINDOW_CLOSED`, `NOTE_REQUIRED`, `INVALID_OUTCOME`.

- [ ] **Step 1: Append failing tests to `settlementService.test.js`**

```js
describe("settlementService.markCashReceived", () => {
  it("pending -> cash_received: debits commission once, records who/when, notifies the driver", async () => {
    const current = row();
    setup(current);
    const { settlement } = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(settlement).toMatchObject({ status: "cash_received", method: "cash", wallet_effect: "cash", confirmed_by: "driver", effect_seq: 1 });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 10 } } });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actor: "driver", actor_id: 9, from_status: "pending", to_status: "cash_received" }),
    });
    expect(walletNotifier.notifyDriverWalletTransaction).toHaveBeenCalledWith(9, { type: "debit", amount: 10, remark: "Admin deduction for order #50" });
    expect(mockEmit).toHaveBeenCalledWith("settlement:updated", expect.objectContaining({ status: "cash_received" }));
  });

  it("double tap / retry: a second call is a successful no-op and moves no money", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1 }));
    const result = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(result.alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects a different driver", async () => {
    setup(row({ rid: 9 }));
    await expect(svc.markCashReceived({ orderId: 50, riderId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects while disputed and after an online payment", async () => {
    setup(row({ status: "disputed" }));
    await expect(svc.markCashReceived({ orderId: 50, riderId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    setup(row({ status: "paid_online", wallet_effect: "online" }));
    await expect(svc.markCashReceived({ orderId: 50, riderId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects when the order has no settlement", async () => {
    setup(row());
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(svc.markCashReceived({ orderId: 50, riderId: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("settlementService.chooseDriverPayment", () => {
  it("records the customer's choice without touching status or money", async () => {
    setup(row());
    const { settlement } = await svc.chooseDriverPayment({ orderId: 50, uid: 7 });
    expect(settlement).toMatchObject({ status: "pending", customer_choice: "driver" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("is refused once the payment is no longer pending", async () => {
    setup(row({ status: "cash_received" }));
    await expect(svc.chooseDriverPayment({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("settlementService.raiseDispute", () => {
  const settings = (disputeWindowHours = 48) =>
    jest.spyOn(svc.settlementSettings, "getSettlementSettings").mockResolvedValue({ enabled: true, disputeWindowHours });

  afterEach(() => jest.restoreAllMocks());

  it("customer disputes a pending payment; wallet untouched", async () => {
    setup(row());
    settings();
    const { settlement } = await svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "Driver says I did not pay" });
    expect(settlement).toMatchObject({ status: "disputed", dispute_raised_by: "customer", dispute_reason: "Driver says I did not pay" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("driver may dispute a pending payment", async () => {
    setup(row());
    settings();
    const { settlement } = await svc.raiseDispute({ orderId: 50, actor: "driver", actorId: 9, reason: "Customer refused to pay" });
    expect(settlement.status).toBe("disputed");
  });

  it("requires a real reason", async () => {
    setup(row());
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("customer can dispute a driver-confirmed payment inside the window and keeps the applied wallet effect until admin decides", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1, confirmed_at: new Date(Date.now() - 60 * 60 * 1000) }));
    settings(48);
    const { settlement } = await svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "I never gave cash" });
    expect(settlement).toMatchObject({ status: "disputed", wallet_effect: "cash" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects a customer dispute after the window closed", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", confirmed_at: new Date(Date.now() - 49 * 60 * 60 * 1000) }));
    settings(48);
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "late complaint" })).rejects.toMatchObject({ code: "WINDOW_CLOSED" });
  });

  it("driver cannot dispute after confirming cash; nobody can dispute an online payment", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", confirmed_at: new Date() }));
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "driver", actorId: 9, reason: "changed my mind" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    setup(row({ status: "paid_online", wallet_effect: "online" }));
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "double charged" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("is idempotent when already disputed", async () => {
    setup(row({ status: "disputed" }));
    settings();
    const result = await svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "again" });
    expect(result.alreadyDone).toBe(true);
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });

  it("rejects the wrong party", async () => {
    setup(row());
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 99, reason: "not mine" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("settlementService.adminResolve", () => {
  const resolve = (outcome, note = "Checked with both parties") => svc.adminResolve({ settlementId: 1, adminId: 3, outcome, note });

  it("requires a note and a valid outcome", async () => {
    setup(row({ status: "disputed" }));
    await expect(resolve("cash_received", "  ")).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    await expect(resolve("bogus")).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
  });

  it("disputed (no effect yet) -> cash_received applies the cash effect and records the admin", async () => {
    setup(row({ status: "disputed" }));
    const { settlement } = await resolve("cash_received");
    expect(settlement).toMatchObject({ status: "cash_received", method: "cash", wallet_effect: "cash", confirmed_by: "admin", resolved_by: 3, resolve_note: "Checked with both parties" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 10 } } });
  });

  it("waived credits the driver (company absorbs) with no customer method", async () => {
    setup(row({ status: "disputed" }));
    const { settlement } = await resolve("waived");
    expect(settlement).toMatchObject({ status: "waived", wallet_effect: "online", method: null });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
  });

  it("customer_owes also credits the driver", async () => {
    setup(row({ status: "disputed" }));
    const { settlement } = await resolve("customer_owes");
    expect(settlement).toMatchObject({ status: "customer_owes", wallet_effect: "online" });
  });

  it("changing outcome reverses exactly the previous effect (cash -> paid_online)", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1 }));
    const { settlement } = await resolve("paid_online");
    expect(settlement).toMatchObject({ status: "paid_online", wallet_effect: "online", effect_seq: 3 });
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ increment: 10 }, { increment: 90 }]);
  });

  it("changing back (online -> cash) reverses the credit and re-applies the debit, each with fresh keys", async () => {
    setup(row({ status: "paid_online", wallet_effect: "online", effect_seq: 3 }));
    await resolve("cash_received");
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ decrement: 90 }, { decrement: 10 }]);
    expect(prisma.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id)).toEqual(["settle:1:4:rev:0", "settle:1:5:apply:0"]);
  });

  it("repeating the same resolve moves no money", async () => {
    setup(row({ status: "waived", wallet_effect: "online", effect_seq: 1 }));
    const result = await resolve("waived");
    expect(result.alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("can resolve an escalated pending settlement", async () => {
    setup(row({ status: "pending", escalated_at: new Date() }));
    const { settlement } = await resolve("paid_online");
    expect(settlement.status).toBe("paid_online");
  });

  it("writes an audit event with the admin note", async () => {
    setup(row({ status: "disputed" }));
    await resolve("cash_received", "Driver showed receipt");
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actor: "admin", actor_id: 3, from_status: "disputed", to_status: "cash_received", note: "Driver showed receipt" }),
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/services/__tests__/settlementService.test.js`
Expected: FAIL — `svc.markCashReceived is not a function` (and the other three).

- [ ] **Step 3: Implement the transitions (add above `module.exports` in `settlementService.js`)**

```js
async function markCashReceived({ orderId, riderId }) {
  return runTransition(async (tx, notifications) => {
    const s = await lockByOrderId(tx, orderId);
    assertParty(s, "driver", riderId);
    if (s.status === STATUS.CASH_RECEIVED) return { settlement: s, alreadyDone: true };
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.CASH);
    notifications.push(...n);
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: STATUS.CASH_RECEIVED, method: "cash", wallet_effect: EFFECT.CASH, effect_seq: effectSeq,
        confirmed_by: "driver", confirmed_at: now, updated_at: now,
      },
    });
    await logEvent(tx, s, { actor: "driver", actorId: riderId, from: s.status, to: STATUS.CASH_RECEIVED });
    return { settlement: updated };
  });
}

// Informational: tells the driver screen the customer will pay in person.
// Does not change status or move money.
async function chooseDriverPayment({ orderId, uid }) {
  return runTransition(async (tx) => {
    const s = await lockByOrderId(tx, orderId);
    assertParty(s, "customer", uid);
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    if (s.customer_choice === "driver") return { settlement: s, alreadyDone: true };
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: { customer_choice: "driver", updated_at: new Date() },
    });
    await logEvent(tx, s, { actor: "customer", actorId: uid, from: s.status, to: s.status, note: "Chose to pay the driver directly" });
    return { settlement: updated };
  });
}

async function raiseDispute({ orderId, actor, actorId, reason }) {
  const text = String(reason || "").trim();
  if (text.length < 3) throw new SettlementError("REASON_REQUIRED", "Please describe the problem.");
  const { disputeWindowHours } = await settlementSettings.getSettlementSettings();
  return runTransition(async (tx) => {
    const s = await lockByOrderId(tx, orderId);
    assertParty(s, actor, actorId);
    if (s.status === STATUS.DISPUTED) return { settlement: s, alreadyDone: true };
    const customerOnConfirmedCash = actor === "customer" && s.status === STATUS.CASH_RECEIVED;
    if (s.status !== STATUS.PENDING && !customerOnConfirmedCash) {
      throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    }
    if (customerOnConfirmedCash) {
      const ageMs = Date.now() - new Date(s.confirmed_at).getTime();
      if (ageMs > disputeWindowHours * 60 * 60 * 1000) {
        throw new SettlementError("WINDOW_CLOSED", "The window to report a problem with this payment has closed.");
      }
    }
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: STATUS.DISPUTED, dispute_reason: text, dispute_raised_by: actor, dispute_raised_at: now, updated_at: now,
      },
    });
    await logEvent(tx, s, { actor, actorId, from: s.status, to: STATUS.DISPUTED, note: text });
    return { settlement: updated };
  });
}

async function adminResolve({ settlementId, adminId, outcome, note }) {
  if (!ADMIN_OUTCOMES.includes(outcome)) throw new SettlementError("INVALID_OUTCOME", "Unknown outcome.");
  const text = String(note || "").trim();
  if (!text) throw new SettlementError("NOTE_REQUIRED", "A note is required to resolve a payment.");
  return runTransition(async (tx, notifications) => {
    const s = await lockById(tx, settlementId);
    if (!s) throw new SettlementError("NOT_FOUND", "No payment record found.");
    if (s.status === outcome) return { settlement: s, alreadyDone: true };
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, OUTCOME_EFFECT[outcome]);
    notifications.push(...n);
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: outcome,
        method: outcome === STATUS.CASH_RECEIVED ? "cash" : outcome === STATUS.PAID_ONLINE ? "online" : null,
        wallet_effect: OUTCOME_EFFECT[outcome],
        effect_seq: effectSeq,
        confirmed_by: "admin", confirmed_at: now,
        resolved_by: adminId, resolved_at: now, resolve_note: text, updated_at: now,
      },
    });
    await logEvent(tx, s, { actor: "admin", actorId: adminId, from: s.status, to: outcome, note: text });
    return { settlement: updated };
  });
}
```

And extend `module.exports` with `markCashReceived, chooseDriverPayment, raiseDispute, adminResolve`.

- [ ] **Step 4: Run and watch it pass**

Run: `cd backend && npx jest src/services/__tests__/settlementService.test.js`
Expected: PASS, all tests (Task 3 + Task 4).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/settlementService.js backend/src/services/__tests__/settlementService.test.js
git commit -m "feat(settlement): cash confirmation, dispute and admin resolve transitions"
```

---

### Task 5: Online payment — create Razorpay order and settle

**Files:**
- Create: `backend/src/utils/razorpayOrders.js`
- Modify: `backend/src/services/settlementService.js` (add `createOnlineOrder`, `settleOnline`)
- Test: `backend/src/utils/__tests__/razorpayOrders.test.js`, append to `backend/src/services/__tests__/settlementService.test.js`

**Interfaces:**
- Consumes: `verifyRazorpayPayment({ paymentId, orderId, signature, expectedAmountRupees }) → { ok, payment } | { ok:false, reason }` from `utils/razorpayVerify.js`.
- Produces:
  - `createRazorpayOrder({ amountRupees, receipt }): Promise<{ ok:true, id, amountPaise, currency } | { ok:false, reason }>`
  - `createOnlineOrder({ orderId, uid }): Promise<{ razorpay_order_id, amount_paise, currency, key_id }>`
  - `settleOnline({ orderId, uid, paymentId, razorpayOrderId, signature }): Promise<{ settlement, alreadyDone? }>`
  - Extra error codes: `GATEWAY_ERROR`, `PAYMENT_MISMATCH`, `PAYMENT_VERIFICATION_FAILED`.

- [ ] **Step 1: Write the failing tests**

`backend/src/utils/__tests__/razorpayOrders.test.js`:

```js
const { createRazorpayOrder } = require("../razorpayOrders");

describe("createRazorpayOrder", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; delete global.fetch; });

  it("fails cleanly when keys are not configured", async () => {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    expect(await createRazorpayOrder({ amountRupees: 50, receipt: "r1" })).toEqual({ ok: false, reason: expect.stringContaining("not configured") });
  });

  it("posts the amount in paise and returns the order id", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "order_X", amount: 5050, currency: "INR" }) });
    const result = await createRazorpayOrder({ amountRupees: 50.5, receipt: "settle_9" });
    expect(result).toEqual({ ok: true, id: "order_X", amountPaise: 5050, currency: "INR" });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(JSON.parse(init.body)).toEqual({ amount: 5050, currency: "INR", receipt: "settle_9" });
  });

  it("surfaces Razorpay's own error message", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { description: "Amount too low" } }) });
    expect(await createRazorpayOrder({ amountRupees: 0.5, receipt: "r" })).toEqual({ ok: false, reason: "Amount too low" });
  });
});
```

Append to `settlementService.test.js` — add these two mocks at the top of the file next to the other `jest.mock` calls:

```js
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
```

and these requires next to the others:

```js
const { verifyRazorpayPayment } = require("../../utils/razorpayVerify");
const { createRazorpayOrder } = require("../../utils/razorpayOrders");
```

then append:

```js
describe("settlementService.createOnlineOrder", () => {
  it("creates a Razorpay order for the amount due and remembers it", async () => {
    setup(row({ amount_due: 85 }));
    createRazorpayOrder.mockResolvedValue({ ok: true, id: "order_A", amountPaise: 8500, currency: "INR" });
    process.env.RAZORPAY_KEY_ID = "rzp_key";
    const out = await svc.createOnlineOrder({ orderId: 50, uid: 7 });
    expect(createRazorpayOrder).toHaveBeenCalledWith({ amountRupees: 85, receipt: "settle_50" });
    expect(out).toEqual({ razorpay_order_id: "order_A", amount_paise: 8500, currency: "INR", key_id: "rzp_key" });
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: expect.objectContaining({ razorpay_order_id: "order_A", customer_choice: "online" }),
    });
  });

  it("reuses the existing Razorpay order instead of creating an orphan", async () => {
    setup(row({ amount_due: 85, razorpay_order_id: "order_A" }));
    process.env.RAZORPAY_KEY_ID = "rzp_key";
    const out = await svc.createOnlineOrder({ orderId: 50, uid: 7 });
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    expect(out).toMatchObject({ razorpay_order_id: "order_A", amount_paise: 8500 });
  });

  it("refuses when not pending or for another customer; reports gateway failure", async () => {
    setup(row({ status: "disputed" }));
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    setup(row());
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    setup(row());
    createRazorpayOrder.mockResolvedValue({ ok: false, reason: "Gateway down" });
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "GATEWAY_ERROR", message: "Gateway down" });
  });
});

describe("settlementService.settleOnline", () => {
  const pay = { orderId: 50, uid: 7, paymentId: "pay_1", razorpayOrderId: "order_A", signature: "sig" };

  it("verifies against the amount due, then settles and credits the driver", async () => {
    setup(row({ amount_due: 85, razorpay_order_id: "order_A" }));
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: {} });
    const { settlement } = await svc.settleOnline(pay);
    expect(verifyRazorpayPayment).toHaveBeenCalledWith({ paymentId: "pay_1", orderId: "order_A", signature: "sig", expectedAmountRupees: 85 });
    expect(settlement).toMatchObject({ status: "paid_online", method: "online", wallet_effect: "online", confirmed_by: "customer_online", razorpay_payment_id: "pay_1" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
  });

  it("rejects a payment made against a different Razorpay order (replay on another settlement)", async () => {
    setup(row({ razorpay_order_id: "order_A" }));
    await expect(svc.settleOnline({ ...pay, razorpayOrderId: "order_OTHER" })).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects when Razorpay verification fails (bad signature or wrong amount) and stays pending", async () => {
    setup(row({ razorpay_order_id: "order_A" }));
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment amount does not match" });
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "PAYMENT_VERIFICATION_FAILED", message: "Payment amount does not match" });
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects when no Razorpay order was created for this settlement", async () => {
    setup(row({ razorpay_order_id: null }));
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
  });

  it("is a no-op for the same payment id after it already settled", async () => {
    setup(row({ status: "paid_online", wallet_effect: "online", effect_seq: 1, razorpay_order_id: "order_A", razorpay_payment_id: "pay_1" }));
    const result = await svc.settleOnline(pay);
    expect(result.alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
  });

  it("refuses to settle a disputed payment online", async () => {
    setup(row({ status: "disputed", razorpay_order_id: "order_A" }));
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rechecks state inside the transaction (payment verified, but driver confirmed cash meanwhile)", async () => {
    const pending = row({ razorpay_order_id: "order_A" });
    setup(pending);
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: {} });
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(pending) // pre-check read
      .mockResolvedValueOnce({ ...pending, status: "cash_received", wallet_effect: "cash" }); // locked read
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run both test files and watch them fail**

Run: `cd backend && npx jest src/utils/__tests__/razorpayOrders.test.js src/services/__tests__/settlementService.test.js`
Expected: FAIL — `Cannot find module '../razorpayOrders'`, then `svc.createOnlineOrder is not a function`.

- [ ] **Step 3: Implement `razorpayOrders.js`**

```js
const logger = require("./logger");

// Server-side Razorpay order creation for flows where the amount must come
// from the DB, never from the client (see customerWalletController.createRazorpayOrder
// for the wallet-topup variant that accepts a client amount).
async function createRazorpayOrder({ amountRupees, receipt }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    logger.error("createRazorpayOrder: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.");
    return { ok: false, reason: "Payment gateway is not configured. Try again later." };
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(Number(amountRupees) * 100), currency: "INR", receipt }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    logger.error("createRazorpayOrder: Razorpay API error:", data);
    return { ok: false, reason: data?.error?.description || "Failed to create payment order" };
  }
  return { ok: true, id: data.id, amountPaise: data.amount, currency: data.currency };
}

module.exports = { createRazorpayOrder };
```

- [ ] **Step 4: Implement the two service functions (add above `module.exports`; add the two requires at the top of `settlementService.js`)**

Top of file, next to the other requires:

```js
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");
const { createRazorpayOrder } = require("../utils/razorpayOrders");
```

Functions:

```js
async function createOnlineOrder({ orderId, uid }) {
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  assertParty(s, "customer", uid);
  if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
  const amountDue = Number(s.amount_due);
  let razorpayOrderId = s.razorpay_order_id;
  let amountPaise = Math.round(amountDue * 100);
  if (!razorpayOrderId) {
    const created = await createRazorpayOrder({ amountRupees: amountDue, receipt: `settle_${orderId}` });
    if (!created.ok) throw new SettlementError("GATEWAY_ERROR", created.reason);
    razorpayOrderId = created.id;
    amountPaise = created.amountPaise;
    await prisma.order_settlement.update({
      where: { id: s.id },
      data: { razorpay_order_id: razorpayOrderId, customer_choice: "online", updated_at: new Date() },
    });
    await prisma.order_settlement_event.create({
      data: { settlement_id: s.id, actor: "customer", actor_id: uid, from_status: s.status, to_status: s.status, note: "Chose to pay online", created_at: new Date() },
    });
  }
  return { razorpay_order_id: razorpayOrderId, amount_paise: amountPaise, currency: "INR", key_id: process.env.RAZORPAY_KEY_ID };
}

async function settleOnline({ orderId, uid, paymentId, razorpayOrderId, signature }) {
  const pre = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  assertParty(pre, "customer", uid);
  if (pre.status === STATUS.PAID_ONLINE && pre.razorpay_payment_id === paymentId) {
    return { settlement: pre, alreadyDone: true };
  }
  if (pre.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(pre.status));
  // The payment must belong to the Razorpay order we created for THIS settlement.
  if (!pre.razorpay_order_id || pre.razorpay_order_id !== razorpayOrderId) {
    throw new SettlementError("PAYMENT_MISMATCH", "This payment does not belong to this order.");
  }
  const verification = await verifyRazorpayPayment({
    paymentId, orderId: razorpayOrderId, signature, expectedAmountRupees: Number(pre.amount_due),
  });
  if (!verification.ok) throw new SettlementError("PAYMENT_VERIFICATION_FAILED", verification.reason);

  return runTransition(async (tx, notifications) => {
    const s = await lockByOrderId(tx, orderId);
    if (s.status === STATUS.PAID_ONLINE && s.razorpay_payment_id === paymentId) return { settlement: s, alreadyDone: true };
    // Re-checked under the lock: the driver may have confirmed cash while the customer was paying.
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.ONLINE);
    notifications.push(...n);
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: STATUS.PAID_ONLINE, method: "online", wallet_effect: EFFECT.ONLINE, effect_seq: effectSeq,
        razorpay_payment_id: paymentId, confirmed_by: "customer_online", confirmed_at: now, updated_at: now,
      },
    });
    await logEvent(tx, s, { actor: "customer", actorId: uid, from: s.status, to: STATUS.PAID_ONLINE, note: `Razorpay payment ${paymentId}` });
    return { settlement: updated };
  });
}
```

Extend `module.exports` with `createOnlineOrder, settleOnline`.

- [ ] **Step 5: Run and watch it pass**

Run: `cd backend && npx jest src/utils/__tests__/razorpayOrders.test.js src/services/__tests__/settlementService.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/razorpayOrders.js backend/src/utils/__tests__/razorpayOrders.test.js backend/src/services/settlementService.js backend/src/services/__tests__/settlementService.test.js
git commit -m "feat(settlement): online payment via server-created Razorpay order"
```

---

### Task 6: Hook into ride completion

**Files:**
- Modify: `backend/src/services/tripLifecycle.js` (top requires; the block after `const cashCollected = …` near line 592; the final `return` of the complete branch near line 817)
- Modify: `backend/src/sockets/orderSocket.js` (the `order:completed` emit near line 169)
- Test: `backend/src/services/__tests__/tripLifecycleSettlement.test.js` (new)

**Interfaces:**
- Consumes: `settlementSettings.isSettlementEnabled()`, `settlementService.createForCompletedOrder({ orderId, uid, riderId, amountDue, fare, commissionAmount, perTripCharge, prepaidAmount })`.
- Produces: `updateStatus(..., 'complete')` returns `{ success, order_status, o_status, settlement_pending: true }` **only when** a settlement was created (the key is absent otherwise, so existing assertions on the exact object keep passing); the socket's `order:completed` payload gains `settlement_pending`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null) },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  pkg_order_interest: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
  tbl_order_requests: { updateMany: jest.fn(), findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn().mockResolvedValue({}) },
  order_status_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  app_settings: { findFirst: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../dispatchManager", () => ({
  stopDispatch: jest.fn(), recordModel1Outcome: jest.fn(), emitCustomerEvent: jest.fn(),
  emitDriverEvent: jest.fn(), startDispatch: jest.fn(), offerToInterestedRiders: jest.fn(),
}));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn(), peekLock: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({
  isWalletPaidOrder: jest.fn(() => false), linkWalletPrepayment: jest.fn(), refundIfWalletPaid: jest.fn().mockResolvedValue(null),
}));
jest.mock("../driverTripService", () => ({ progressTrip: jest.fn().mockResolvedValue({}) }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn(), getPackageById: jest.fn(), getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  commissionAmount: jest.fn((d, p) => Math.round(((Number(d) * Number(p)) / 100) * 100) / 100),
  getFirstTierPricingContext: jest.fn(),
}));
jest.mock("../pushNotifier", () => ({}));
jest.mock("../../utils/pickupRelocateSettings", () => ({ getPickupRelocateSettings: jest.fn().mockResolvedValue({}) }));
jest.mock("../settlementSettings", () => ({ isSettlementEnabled: jest.fn() }));
jest.mock("../settlementService", () => ({ createForCompletedOrder: jest.fn() }));

const prisma = require("../../config/db");
const settlementSettings = require("../settlementSettings");
const settlementService = require("../settlementService");
const tripLifecycle = require("../tripLifecycle");

const order = (o = {}) => ({
  id: 297, uid: 5, rid: 1, city_id: 1, d_charge: 100, total_dcharge: 100, commission: 5,
  trans_id: "cash_payment", free_waiting_time: "0", wating_charge: "0", ...o,
});

describe("tripLifecycle.updateStatus('complete') — payment settlement hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    prisma.pkg_order.update.mockResolvedValue({});
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 0 }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 0 });
    settlementSettings.isSettlementEnabled.mockResolvedValue(true);
    settlementService.createForCompletedOrder.mockResolvedValue({ id: 1 });
  });

  it("creates a settlement and defers the commission debit (regular driver, cash order, feature on)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith({
      orderId: 297, uid: 5, riderId: 1, amountDue: 100, fare: 100, commissionAmount: 5, perTripCharge: 0, prepaidAmount: 0,
    });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed", settlement_pending: true });
  });

  it("nets advance / referral / coupon off the amount due and records them as prepaid", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 10, cou_amt: 5 }));
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 15 }]);
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountDue: 70, prepaidAmount: 30 })
    );
  });

  it("falls back to the legacy commission debit when settlement creation throws (ride must still complete)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    settlementService.createForCompletedOrder.mockRejectedValue(new Error("db down"));
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { wallet_balance: { decrement: 5 } } });
  });

  it("does nothing new when the feature is off", async () => {
    settlementSettings.isSettlementEnabled.mockResolvedValue(false);
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { wallet_balance: { decrement: 5 } } });
  });

  it("creates no settlement when nothing is due in cash (prepaid covers the fare)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 100 }));
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("creates no settlement for a non-cash order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ trans_id: "pay_abc123", p_method_id: 5 }));
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("creates no settlement for a Monthly Driver (own cash ledger)", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycleSettlement.test.js`
Expected: FAIL — `createForCompletedOrder` never called / result lacks `settlement_pending`.

- [ ] **Step 3: Edit `tripLifecycle.js`**

Add next to the other requires at the top:

```js
const settlementSettings = require("./settlementSettings");
const settlementService = require("./settlementService");
```

Immediately after the line `const cashCollected = isCashOrder ? Math.max(0, finalTotal - prepaidTotal) : 0;` insert:

```js
    // Deferred payment settlement (spec 2026-10-04): for a regular driver's
    // cash order, don't claw back commission now - the driver hasn't been
    // confirmed to hold the cash yet. settlementService applies the wallet
    // effect when the driver taps "Received" / the customer pays online / an
    // admin resolves. Monthly and Daily drivers keep their own ledgers. If
    // creating the settlement fails we FALL BACK to the legacy debit below
    // (never a completed ride with no money flow).
    let settlementCreated = false;
    if (!isMonthlyDriver && !isDailyDriverExempt && isCashOrder && cashCollected > 0
        && (await settlementSettings.isSettlementEnabled())) {
      try {
        await settlementService.createForCompletedOrder({
          orderId,
          uid: order.uid,
          riderId,
          amountDue: cashCollected,
          fare: finalTotal,
          commissionAmount: pricingEngine.commissionAmount(finalTotal, effectiveCommissionPercent),
          perTripCharge: driverBenefit?.benefit > 0 ? Number(driverBenefit.perTripCharge) || 0 : 0,
          prepaidAmount: prepaidTotal,
        });
        settlementCreated = true;
      } catch (err) {
        logger.error(`updateStatus: settlement creation failed for order ${orderId}, using legacy commission flow:`, err);
      }
    }
```

Change the third branch of the commission chain from

```js
    } else if (isCashOrder && (effectiveCommissionPercent > 0 || driverBenefit?.perTripCharge > 0 || prepaidTotal > 0)) {
```

to

```js
    } else if (!settlementCreated && isCashOrder && (effectiveCommissionPercent > 0 || driverBenefit?.perTripCharge > 0 || prepaidTotal > 0)) {
```

Change the final return of the complete branch from

```js
    return { success: true, order_status: 5, o_status: "Completed", ...(earlyDrop ? { early_drop: earlyDrop, final_fare: finalTotal } : {}) };
```

to

```js
    return {
      success: true, order_status: 5, o_status: "Completed",
      ...(settlementCreated ? { settlement_pending: true } : {}),
      ...(earlyDrop ? { early_drop: earlyDrop, final_fare: finalTotal } : {}),
    };
```

- [ ] **Step 4: Edit `orderSocket.js`** — in the `order:completed` emit, add one field:

```js
        io.to(room).emit("order:completed", {
          order_id: Number(order_id),
          order_status: result.order_status,
          o_status: result.o_status,
          settlement_pending: result.settlement_pending === true,
          ...(result.early_drop ? { early_drop: true, final_fare: result.final_fare, old_fare: result.early_drop.old_fare, new_fare: result.early_drop.new_fare } : {}),
        });
```

- [ ] **Step 5: Run the new tests and the whole existing tripLifecycle suites**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycleSettlement.test.js src/services/__tests__/tripLifecycle.test.js src/services/__tests__/tripLifecycleTrial.test.js`
Expected: PASS everywhere. (In the existing suites the db mock has no `app_settings.findMany`, so `getSettlementSettings` hits its catch and fails closed → feature off → behaviour unchanged. If any existing test fails, stop and read the failure before changing anything.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/sockets/orderSocket.js backend/src/services/__tests__/tripLifecycleSettlement.test.js
git commit -m "feat(settlement): create settlement on ride completion, fail open to legacy debit"
```

---

### Task 7: Customer and driver endpoints

**Files:**
- Create: `backend/src/controllers/settlementController.js`
- Modify: `backend/src/routes/orderRoutes.js`, `backend/src/routes/riderRoutes.js`
- Modify: `backend/src/controllers/orderController.js` (`getOrderDetails` payload)
- Test: `backend/src/controllers/__tests__/settlementController.test.js`; extend `orderController.test.js`

**Interfaces:**
- Consumes: service functions from Tasks 3–5.
- Produces (HTTP, all POST, always 200 with `{ ResponseCode, Result, ResponseMsg, ... }`; failures: `ResponseCode "401"`, `Result "false"`, plus a machine-readable `code`):
  - Customer (`/api/order/settlement/*`, body `uid`, `order_id`): `state`, `choose-driver`, `pay-online/create`, `pay-online/verify` (+ `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`), `dispute` (+ `reason`)
  - Driver (`/api/rider/settlement/*`, body `rider_id`, `order_id`): `state`, `received`, `dispute` (+ `reason`)
  - Success bodies carry `settlement: <publicView>`; `pay-online/create` returns `razorpay_order_id`, `amount_paise`, `currency`, `key_id`.
  - `getOrderDetails` `OrderProductList[0]` gains `settlement` (view or `null`).

- [ ] **Step 1: Write the failing tests**

```js
jest.mock("../../services/settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return {
    SettlementError,
    getViewForParty: jest.fn(), chooseDriverPayment: jest.fn(), createOnlineOrder: jest.fn(),
    settleOnline: jest.fn(), raiseDispute: jest.fn(), markCashReceived: jest.fn(),
    publicView: jest.fn((s) => ({ order_id: s.order_id, status: s.status })),
  };
});
const svc = require("../../services/settlementService");
const c = require("../settlementController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = (r) => r.json.mock.calls[0][0];

describe("settlementController (customer)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("state: returns the settlement view, or null when none exists", async () => {
    svc.getViewForParty.mockResolvedValue({ order_id: 5, status: "pending" });
    const r = res();
    await c.customerState({ body: { uid: 7, order_id: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ ResponseCode: "200", Result: "true", settlement: { order_id: 5, status: "pending" } });
    expect(svc.getViewForParty).toHaveBeenCalledWith({ orderId: 5, party: "customer", partyId: 7 });
    svc.getViewForParty.mockResolvedValue(null);
    const r2 = res();
    await c.customerState({ body: { uid: 7, order_id: 5 } }, r2);
    expect(body(r2).settlement).toBeNull();
  });

  it("requires uid and order_id", async () => {
    const r = res();
    await c.customerState({ body: {} }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", code: "VALIDATION" });
  });

  it("maps SettlementError to a 200 envelope with ResponseCode 401 and the machine code", async () => {
    svc.raiseDispute.mockRejectedValue(new svc.SettlementError("WINDOW_CLOSED", "closed"));
    const r = res();
    await c.customerDispute({ body: { uid: 7, order_id: 5, reason: "x" } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", ResponseMsg: "closed", code: "WINDOW_CLOSED" });
  });

  it("unexpected errors become ResponseCode 500", async () => {
    svc.chooseDriverPayment.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.customerChooseDriver({ body: { uid: 7, order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "500", Result: "false" });
  });

  it("pay-online/create passes uid/order and returns the gateway payload", async () => {
    svc.createOnlineOrder.mockResolvedValue({ razorpay_order_id: "order_A", amount_paise: 8500, currency: "INR", key_id: "k" });
    const r = res();
    await c.customerPayOnlineCreate({ body: { uid: 7, order_id: 5 } }, r);
    expect(svc.createOnlineOrder).toHaveBeenCalledWith({ orderId: 5, uid: 7 });
    expect(body(r)).toMatchObject({ ResponseCode: "200", razorpay_order_id: "order_A", amount_paise: 8500, key_id: "k" });
  });

  it("pay-online/verify requires all three Razorpay fields", async () => {
    const r = res();
    await c.customerPayOnlineVerify({ body: { uid: 7, order_id: 5, razorpay_payment_id: "p" } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", code: "VALIDATION" });
    expect(svc.settleOnline).not.toHaveBeenCalled();
  });

  it("pay-online/verify settles with the posted fields", async () => {
    svc.settleOnline.mockResolvedValue({ settlement: { order_id: 5, status: "paid_online" } });
    const r = res();
    await c.customerPayOnlineVerify({ body: { uid: 7, order_id: 5, razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(svc.settleOnline).toHaveBeenCalledWith({ orderId: 5, uid: 7, paymentId: "p", razorpayOrderId: "o", signature: "s" });
    expect(body(r).settlement).toMatchObject({ status: "paid_online" });
  });
});

describe("settlementController (driver)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("received: confirms cash for the posted rider and order", async () => {
    svc.markCashReceived.mockResolvedValue({ settlement: { order_id: 5, status: "cash_received" } });
    const r = res();
    await c.driverReceived({ body: { rider_id: 9, order_id: 5 } }, r);
    expect(svc.markCashReceived).toHaveBeenCalledWith({ orderId: 5, riderId: 9 });
    expect(body(r)).toMatchObject({ ResponseCode: "200", settlement: { status: "cash_received" } });
  });

  it("received twice reports success (idempotent)", async () => {
    svc.markCashReceived.mockResolvedValue({ settlement: { order_id: 5, status: "cash_received" }, alreadyDone: true });
    const r = res();
    await c.driverReceived({ body: { rider_id: 9, order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "200", Result: "true" });
  });

  it("dispute uses actor 'driver'", async () => {
    svc.raiseDispute.mockResolvedValue({ settlement: { order_id: 5, status: "disputed" } });
    const r = res();
    await c.driverDispute({ body: { rider_id: 9, order_id: 5, reason: "customer refused" } }, r);
    expect(svc.raiseDispute).toHaveBeenCalledWith({ orderId: 5, actor: "driver", actorId: 9, reason: "customer refused" });
  });

  it("state requires rider_id", async () => {
    const r = res();
    await c.driverState({ body: { order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", code: "VALIDATION" });
  });
});
```

Extend `orderController.test.js`: add `order_settlement: { findUnique: jest.fn().mockResolvedValue(null) }` to the top `jest.mock("../../config/db", …)` factory, then in the `getOrderDetails` describe add:

```js
  it("includes the settlement view (null when the order has none)", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(baseOrder);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.tbl_rider.findUnique.mockResolvedValue(baseRider);
    prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: null } });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getOrderDetails({ body: { uid: 1, order_id: 501 } }, res);
    expect(res.json.mock.calls[0][0].OrderProductList[0].settlement).toBeNull();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd backend && npx jest src/controllers/__tests__/settlementController.test.js src/controllers/__tests__/orderController.test.js`
Expected: FAIL — `Cannot find module '../settlementController'`; the new orderController test fails with `undefined` instead of `null`.

- [ ] **Step 3: Implement the controller**

```js
const settlementService = require("../services/settlementService");
const logger = require("../utils/logger");

const { SettlementError } = settlementService;

// Same convention as every other cust_api/rider_api port: always HTTP 200, the
// logical outcome lives in the body (ApiWrapper ignores non-200 bodies).
const ok = (res, extra = {}, msg = "OK") =>
  res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: msg, ...extra });
const fail = (res, code, msg) =>
  res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: msg, code });

function handleError(res, err, label) {
  if (err instanceof SettlementError) return fail(res, err.code, err.message);
  logger.error(`${label} failed:`, err);
  return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
}

const num = (v) => Number(v);

function customerAction(label, run) {
  return async (req, res) => {
    try {
      const { uid, order_id } = req.body || {};
      if (!uid || !order_id) return fail(res, "VALIDATION", "uid and order_id are required");
      return await run({ req, res, uid: num(uid), orderId: num(order_id) });
    } catch (err) {
      return handleError(res, err, label);
    }
  };
}

function driverAction(label, run) {
  return async (req, res) => {
    try {
      const { rider_id, order_id } = req.body || {};
      if (!rider_id || !order_id) return fail(res, "VALIDATION", "rider_id and order_id are required");
      return await run({ req, res, riderId: num(rider_id), orderId: num(order_id) });
    } catch (err) {
      return handleError(res, err, label);
    }
  };
}

const customerState = customerAction("settlement customerState", async ({ res, uid, orderId }) => {
  const settlement = await settlementService.getViewForParty({ orderId, party: "customer", partyId: uid });
  return ok(res, { settlement });
});

const customerChooseDriver = customerAction("settlement customerChooseDriver", async ({ res, uid, orderId }) => {
  const { settlement } = await settlementService.chooseDriverPayment({ orderId, uid });
  return ok(res, { settlement: settlementService.publicView(settlement) });
});

const customerPayOnlineCreate = customerAction("settlement customerPayOnlineCreate", async ({ res, uid, orderId }) => {
  const order = await settlementService.createOnlineOrder({ orderId, uid });
  return ok(res, order, "Payment order created");
});

const customerPayOnlineVerify = customerAction("settlement customerPayOnlineVerify", async ({ req, res, uid, orderId }) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return fail(res, "VALIDATION", "razorpay_payment_id, razorpay_order_id and razorpay_signature are required");
  }
  const { settlement } = await settlementService.settleOnline({
    orderId, uid, paymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id, signature: razorpay_signature,
  });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Payment received");
});

const customerDispute = customerAction("settlement customerDispute", async ({ req, res, uid, orderId }) => {
  const { settlement } = await settlementService.raiseDispute({ orderId, actor: "customer", actorId: uid, reason: req.body.reason });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Problem reported. Admin will review it.");
});

const driverState = driverAction("settlement driverState", async ({ res, riderId, orderId }) => {
  const settlement = await settlementService.getViewForParty({ orderId, party: "driver", partyId: riderId });
  return ok(res, { settlement });
});

const driverReceived = driverAction("settlement driverReceived", async ({ res, riderId, orderId }) => {
  const { settlement } = await settlementService.markCashReceived({ orderId, riderId });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Payment confirmed");
});

const driverDispute = driverAction("settlement driverDispute", async ({ req, res, riderId, orderId }) => {
  const { settlement } = await settlementService.raiseDispute({ orderId, actor: "driver", actorId: riderId, reason: req.body.reason });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Problem reported. Admin will review it.");
});

module.exports = {
  customerState, customerChooseDriver, customerPayOnlineCreate, customerPayOnlineVerify, customerDispute,
  driverState, driverReceived, driverDispute,
};
```

- [ ] **Step 4: Wire routes**

`orderRoutes.js`, next to the other order routes (before the `router.get("/goods-types", …)` line):

```js
const settlementController = require("../controllers/settlementController");
router.post("/settlement/state", settlementController.customerState);
router.post("/settlement/choose-driver", settlementController.customerChooseDriver);
router.post("/settlement/pay-online/create", settlementController.customerPayOnlineCreate);
router.post("/settlement/pay-online/verify", settlementController.customerPayOnlineVerify);
router.post("/settlement/dispute", settlementController.customerDispute);
```

(Put the `require` with the other requires at the top of the file instead of mid-file.)

`riderRoutes.js`, with the other POST routes:

```js
const settlementController = require("../controllers/settlementController");
router.post("/settlement/state", settlementController.driverState);
router.post("/settlement/received", settlementController.driverReceived);
router.post("/settlement/dispute", settlementController.driverDispute);
```

(Again `require` at the top.)

- [ ] **Step 5: Add `settlement` to `getOrderDetails`** — in `orderController.js` add `const settlementService = require("../services/settlementService");` at the top, and in the `OrderProductList[0]` object, after `trip_progress`/`waiting`:

```js
          // Payment settlement state (null when the order has none / feature off).
          settlement: await settlementService.getPublicViewForOrder(order.id),
```

Also, in `createOrder`'s error mapping (`if (!result.ok && result.code === "PREMIUM_PLAN_REQUIRED")` neighbourhood) add, ahead of the generic fallthrough:

```js
    if (!result.ok && result.code === "SETTLEMENT_PENDING") {
      return res.status(403).json({ ResponseCode: "403", Result: "false", code: "SETTLEMENT_PENDING", ResponseMsg: result.msg });
    }
```

(The code is produced in Task 8; adding the mapping now keeps both edits to this handler in one task's reading.)

- [ ] **Step 6: Run and watch it pass, plus the neighbouring suites**

Run: `cd backend && npx jest src/controllers/__tests__/settlementController.test.js src/controllers/__tests__/orderController.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/settlementController.js backend/src/controllers/__tests__/settlementController.test.js backend/src/controllers/__tests__/orderController.test.js backend/src/controllers/orderController.js backend/src/routes/orderRoutes.js backend/src/routes/riderRoutes.js
git commit -m "feat(settlement): customer and driver settlement endpoints"
```

---

### Task 8: Booking block and driver dispatch block

**Files:**
- Modify: `backend/src/services/settlementService.js` (add `findBlockingSettlement`)
- Modify: `backend/src/controllers/orderController.js` (`createOrderCore` start)
- Modify: `backend/src/services/dispatchManager.js` (`selectEligibleDrivers`)
- Test: append to `settlementService.test.js`, `orderController.test.js`, `dispatchManager.test.js`

**Interfaces:**
- Consumes: `settlementSettings.getSettlementSettings()`.
- Produces: `findBlockingSettlement(uid): Promise<{ order_id, amount_due, status } | null>`; `createOrderCore` returns `{ ok:false, code:"SETTLEMENT_PENDING", msg }`; dispatch skips riders with a `pending` settlement older than `driverBlockGraceMinutes`.

- [ ] **Step 1: Write the failing tests**

Append to `settlementService.test.js`:

```js
describe("settlementService.findBlockingSettlement", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns null without querying when the feature is off", async () => {
    jest.clearAllMocks();
    jest.spyOn(svc.settlementSettings, "isSettlementEnabled").mockResolvedValue(false);
    expect(await svc.findBlockingSettlement(7)).toBeNull();
    expect(prisma.order_settlement.findFirst).not.toHaveBeenCalled();
  });

  it("blocks on a pending or customer_owes settlement for this customer only", async () => {
    jest.clearAllMocks();
    jest.spyOn(svc.settlementSettings, "isSettlementEnabled").mockResolvedValue(true);
    prisma.order_settlement.findFirst.mockResolvedValue({ order_id: 50, amount_due: 85, status: "pending" });
    expect(await svc.findBlockingSettlement(7)).toEqual({ order_id: 50, amount_due: 85, status: "pending" });
    expect(prisma.order_settlement.findFirst).toHaveBeenCalledWith({
      where: { uid: 7, status: { in: ["pending", "customer_owes"] } },
      select: { order_id: true, amount_due: true, status: true },
    });
  });
});
```

Append to `orderController.test.js` (in the file's `createOrderCore` area; `baseInput` already exists there — see the `referral-points` describe):

```js
describe("createOrderCore — pending payment settlement block", () => {
  it("refuses a new booking while an earlier ride's payment is unsettled", async () => {
    const settlementService = require("../../services/settlementService");
    jest.spyOn(settlementService, "findBlockingSettlement").mockResolvedValue({ order_id: 50, amount_due: 85, status: "pending" });
    const result = await createOrderCore({ ...baseInput });
    expect(result).toMatchObject({ ok: false, code: "SETTLEMENT_PENDING" });
    expect(result.msg).toContain("₹85");
    expect(result.msg).toContain("#50");
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
    settlementService.findBlockingSettlement.mockRestore();
  });
});
```

> `baseInput` is declared inside the first `describe("orderController.createOrderCore")` block of `orderController.test.js`. If it is not in scope at the file's top level, place this new `describe` inside that block next to the `referral-points ride discount` describe.

Append to `dispatchManager.test.js`'s `selectEligibleDrivers wallet-balance gate` describe:

```js
  it("skips drivers with a stale pending payment settlement only when the feature is on", async () => {
    const settlementSettings = require("../settlementSettings");
    const order = { id: 901, uid: 7, plat: "28.7", plong: "77.1", category: "Bike" };

    jest.spyOn(settlementSettings, "getSettlementSettings").mockResolvedValue({ enabled: true, driverBlockGraceMinutes: 10 });
    await selectEligibleDrivers(order, 6, []);
    let [, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(JSON.stringify(values)).toContain("order_settlement");

    prisma.$queryRaw.mockClear();
    settlementSettings.getSettlementSettings.mockResolvedValue({ enabled: false, driverBlockGraceMinutes: 10 });
    await selectEligibleDrivers(order, 6, []);
    [, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(JSON.stringify(values)).not.toContain("order_settlement");

    settlementSettings.getSettlementSettings.mockRestore();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd backend && npx jest src/services/__tests__/settlementService.test.js src/controllers/__tests__/orderController.test.js src/services/__tests__/dispatchManager.test.js`
Expected: FAIL — `findBlockingSettlement is not a function`; booking not blocked; SQL lacks `order_settlement`.

- [ ] **Step 3: Implement `findBlockingSettlement` (service, above `module.exports`; add to exports)**

```js
// A customer with an unpaid settlement (pending, or marked owed by an admin)
// cannot book again. Disputed settlements deliberately do NOT block.
async function findBlockingSettlement(uid) {
  if (!(await settlementSettings.isSettlementEnabled())) return null;
  return prisma.order_settlement.findFirst({
    where: { uid: Number(uid), status: { in: [STATUS.PENDING, STATUS.CUSTOMER_OWES] } },
    select: { order_id: true, amount_due: true, status: true },
  });
}
```

- [ ] **Step 4: Block booking in `createOrderCore`** — add `const settlementService = require("../services/settlementService");` if Task 7 hasn't already, then right after the first `if ( !uid || !category … ) { return { ok:false, code:"VALIDATION", … }; }` guard:

```js
  const blockingSettlement = await settlementService.findBlockingSettlement(uid);
  if (blockingSettlement) {
    return {
      ok: false,
      code: "SETTLEMENT_PENDING",
      msg: `Please settle the pending payment of ₹${Number(blockingSettlement.amount_due)} for order #${blockingSettlement.order_id} before booking a new ride.`,
    };
  }
```

- [ ] **Step 5: Block drivers in `selectEligibleDrivers`** — add near the other requires at the top of `dispatchManager.js`:

```js
const settlementSettings = require("./settlementSettings");
```

Right after `const freshSince = …;` add:

```js
  // A driver whose last ride's payment has been pending past the admin grace
  // window gets no new offers (spec 2026-10-04). Only built when the feature
  // is on, so a DB without the order_settlement table is never queried.
  const settlement = await settlementSettings.getSettlementSettings();
  const settlementBlock = settlement.enabled
    ? Prisma.sql`AND r.id NOT IN (
        SELECT rid FROM order_settlement
        WHERE status = 'pending'
          AND pending_since <= ${new Date(Date.now() - settlement.driverBlockGraceMinutes * 60 * 1000)}
      )`
    : Prisma.empty;
```

and in the SQL, immediately after the existing

```sql
      AND r.id NOT IN (
        SELECT rid FROM pkg_order
        WHERE rid > 0
          AND o_status NOT IN ('Completed', 'Cancelled')
      )
```

block add the line:

```sql
      ${settlementBlock}
```

- [ ] **Step 6: Run and watch them pass (full affected suites)**

Run: `cd backend && npx jest src/services/__tests__/settlementService.test.js src/controllers/__tests__/orderController.test.js src/services/__tests__/dispatchManager.test.js`
Expected: PASS. (In `dispatchManager.test.js` the other tests do not mock settings: the db mock has no `app_settings.findMany`, so settings fail closed → `Prisma.empty`, SQL unchanged.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/settlementService.js backend/src/services/__tests__/settlementService.test.js backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.test.js backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(settlement): block booking and dispatch while a payment is unsettled"
```

---

### Task 9: Reminder and escalation sweep

**Files:**
- Modify: `backend/src/services/pushNotifier.js` (two helpers + exports)
- Create: `backend/src/services/settlementSweep.js`
- Modify: `backend/src/server.js`
- Test: `backend/src/services/__tests__/settlementSweep.test.js`

**Interfaces:**
- Consumes: `getSettlementSettings`, `pushNotifier.notifyCustomerSettlementReminder(fcmToken, orderId, amount)`, `pushNotifier.notifyDriverSettlementReminder(fcmToken, orderId, amount)`.
- Produces: `sweepSettlements(now = new Date()): Promise<{ reminded: number, escalated: number }>`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  order_settlement: { findMany: jest.fn(), updateMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../settlementSettings", () => ({ getSettlementSettings: jest.fn() }));
jest.mock("../pushNotifier", () => ({
  notifyCustomerSettlementReminder: jest.fn().mockResolvedValue({ sent: true }),
  notifyDriverSettlementReminder: jest.fn().mockResolvedValue({ sent: true }),
}));

const prisma = require("../../config/db");
const { getSettlementSettings } = require("../settlementSettings");
const pushNotifier = require("../pushNotifier");
const { sweepSettlements } = require("../settlementSweep");

const NOW = new Date("2026-10-04T12:00:00Z");
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000);
const pending = (o = {}) => ({ id: 1, order_id: 50, uid: 7, rid: 9, amount_due: 85, status: "pending", reminders_sent: 0, escalated_at: null, pending_since: minsAgo(0), ...o });

describe("sweepSettlements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSettlementSettings.mockResolvedValue({ enabled: true, reminderMinutes: [10, 30], escalateAfterMinutes: 60 });
    prisma.order_settlement.updateMany.mockResolvedValue({ count: 1 });
    prisma.order_settlement_event.create.mockResolvedValue({});
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-token" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "drv-token" });
  });

  it("does nothing when the feature is off", async () => {
    getSettlementSettings.mockResolvedValue({ enabled: false, reminderMinutes: [10], escalateAfterMinutes: 60 });
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(prisma.order_settlement.findMany).not.toHaveBeenCalled();
  });

  it("sends nothing before the first threshold", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(5) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
  });

  it("sends one reminder to both parties at the first threshold and stamps the counter", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 0 });
    expect(prisma.order_settlement.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: "pending", reminders_sent: 0 },
      data: { reminders_sent: 1, last_reminder_at: NOW, updated_at: NOW },
    });
    expect(pushNotifier.notifyCustomerSettlementReminder).toHaveBeenCalledWith("cust-token", 50, 85);
    expect(pushNotifier.notifyDriverSettlementReminder).toHaveBeenCalledWith("drv-token", 50, 85);
  });

  it("does not resend a threshold that was already sent (restart / overlapping run)", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11), reminders_sent: 1 })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
  });

  it("skips the push when another sweep already claimed this reminder (updateMany matched 0 rows)", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11) })]);
    prisma.order_settlement.updateMany.mockResolvedValue({ count: 0 });
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
  });

  it("sends one catch-up reminder (not two) when two thresholds passed while the server was down", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(45) })]);
    expect((await sweepSettlements(NOW)).reminded).toBe(1);
    expect(prisma.order_settlement.updateMany.mock.calls[0][0].data.reminders_sent).toBe(2);
    expect(pushNotifier.notifyCustomerSettlementReminder).toHaveBeenCalledTimes(1);
  });

  it("escalates once at the escalation threshold, with an audit event", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(61), reminders_sent: 2 })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 1 });
    expect(prisma.order_settlement.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: "pending", escalated_at: null },
      data: { escalated_at: NOW, updated_at: NOW },
    });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ settlement_id: 1, actor: "system", from_status: "pending", to_status: "pending" }),
    });
  });

  it("does not re-escalate an already escalated settlement", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(90), reminders_sent: 2, escalated_at: minsAgo(30) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 0 });
    expect(prisma.order_settlement.updateMany).not.toHaveBeenCalled();
  });

  it("an empty reminder list means no reminders but escalation still happens", async () => {
    getSettlementSettings.mockResolvedValue({ enabled: true, reminderMinutes: [], escalateAfterMinutes: 60 });
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(70) })]);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 0, escalated: 1 });
  });

  it("a missing push token never blocks the sweep", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([pending({ pending_since: minsAgo(11) })]);
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: null });
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    expect(await sweepSettlements(NOW)).toEqual({ reminded: 1, escalated: 0 });
    expect(pushNotifier.notifyCustomerSettlementReminder).not.toHaveBeenCalled();
    expect(pushNotifier.notifyDriverSettlementReminder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/services/__tests__/settlementSweep.test.js`
Expected: FAIL — `Cannot find module '../settlementSweep'`.

- [ ] **Step 3: Add the push helpers to `pushNotifier.js`** (next to the other `notifyCustomer…`/`notifyDriver…` functions, and add both names to `module.exports`)

```js
/** See settlementSweep — the customer still owes the payment for a completed ride. */
async function notifyCustomerSettlementReminder(fcmToken, orderId, amount) {
  return sendCustomerPush(
    fcmToken,
    "Payment pending",
    `Please pay ₹${amount} for order #${orderId}. Pay your driver directly or pay online in the app.`,
    { type: "settlement_pending", order_id: String(orderId), amount: String(amount) }
  );
}

/** Driver-side counterpart: the customer's payment for a completed ride is still unconfirmed. */
async function notifyDriverSettlementReminder(fcmToken, orderId, amount) {
  return sendPushNotification(
    fcmToken,
    "Collect payment",
    `Order #${orderId}: ₹${amount} is still pending. Tap "Received" once the customer has paid.`,
    { type: "settlement_pending", order_id: String(orderId), amount: String(amount) }
  );
}
```

- [ ] **Step 4: Implement the sweep**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const pushNotifier = require("./pushNotifier");
const { getSettlementSettings } = require("./settlementSettings");

const BATCH = 200;

async function sendReminders(s) {
  const amount = Number(s.amount_due);
  const [customer, rider] = await Promise.all([
    prisma.tbl_user.findUnique({ where: { id: s.uid }, select: { fcm_token: true } }),
    prisma.tbl_rider.findUnique({ where: { id: s.rid }, select: { fcm_token: true } }),
  ]);
  const sends = [];
  if (customer?.fcm_token) sends.push(pushNotifier.notifyCustomerSettlementReminder(customer.fcm_token, s.order_id, amount));
  if (rider?.fcm_token) sends.push(pushNotifier.notifyDriverSettlementReminder(rider.fcm_token, s.order_id, amount));
  await Promise.allSettled(sends);
}

/**
 * Periodic, DB-anchored sweep (same pattern as tripLifecycle.sweepOverduePickups):
 *  - sends the next due reminder to customer and driver,
 *  - flags a long-pending settlement for the admin "Unsettled" queue.
 * Each action is claimed with a conditional updateMany so a restart, an
 * overlapping run or a second instance can never double-send or double-stamp.
 * Never moves money.
 */
async function sweepSettlements(now = new Date()) {
  const settings = await getSettlementSettings();
  if (!settings.enabled) return { reminded: 0, escalated: 0 };

  const rows = await prisma.order_settlement.findMany({
    where: { status: "pending" },
    orderBy: { pending_since: "asc" },
    take: BATCH,
  });

  let reminded = 0;
  let escalated = 0;
  for (const s of rows) {
    try {
      const minutes = (now.getTime() - new Date(s.pending_since).getTime()) / 60000;

      const due = settings.reminderMinutes.filter((m) => minutes >= m).length;
      if (due > s.reminders_sent) {
        const claim = await prisma.order_settlement.updateMany({
          where: { id: s.id, status: "pending", reminders_sent: s.reminders_sent },
          data: { reminders_sent: due, last_reminder_at: now, updated_at: now },
        });
        if (claim.count === 1) {
          await sendReminders(s);
          reminded++;
        }
      }

      if (!s.escalated_at && minutes >= settings.escalateAfterMinutes) {
        const claim = await prisma.order_settlement.updateMany({
          where: { id: s.id, status: "pending", escalated_at: null },
          data: { escalated_at: now, updated_at: now },
        });
        if (claim.count === 1) {
          await prisma.order_settlement_event.create({
            data: {
              settlement_id: s.id, actor: "system", from_status: "pending", to_status: "pending",
              note: `Flagged as unsettled after ${settings.escalateAfterMinutes} minutes`, created_at: now,
            },
          });
          escalated++;
        }
      }
    } catch (err) {
      logger.error(`sweepSettlements: failed for settlement ${s.id}:`, err);
    }
  }
  return { reminded, escalated };
}

module.exports = { sweepSettlements };
```

- [ ] **Step 5: Schedule it in `server.js`** — after the `sweepExpiredAdvancePayments` interval:

```js
// Payment-settlement reminders + "Unsettled" flagging — see settlementSweep.
setInterval(() => {
  require("./services/settlementSweep").sweepSettlements().catch((err) =>
    logger.error("sweepSettlements interval failed:", err)
  );
}, 60 * 1000);
```

- [ ] **Step 6: Run and watch it pass**

Run: `cd backend && npx jest src/services/__tests__/settlementSweep.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/pushNotifier.js backend/src/services/settlementSweep.js backend/src/services/__tests__/settlementSweep.test.js backend/src/server.js
git commit -m "feat(settlement): reminder and escalation sweep"
```

---

### Task 10: Admin API

**Files:**
- Create: `backend/src/controllers/adminSettlementController.js`
- Modify: `backend/src/routes/adminRoutes.js`
- Test: `backend/src/controllers/__tests__/adminSettlementController.test.js`

**Interfaces:**
- Consumes: `settlementService.adminResolve`, `SettlementError`, `ADMIN_OUTCOMES`.
- Produces (all under `/api/v1/admin`, JWT `auth`, roles `superadmin`/`admin`):
  - `GET /settlements?status=pending|unsettled|disputed|resolved|all&page=&limit=&rider_id=&user_id=` → `{ success:true, data:[{ id, order_id, status, amount_due, fare, method, customer_name, customer_mobile, rider_name, rider_mobile, pending_since, minutes_pending, escalated, dispute_reason, dispute_raised_by }], pagination:{ page, limit, total } }`
  - `GET /settlements/:id` → `{ success:true, data:{ settlement, events:[…oldest first], order:{ id, paddress, daddress, d_charge, total_dcharge, commission, advance_payment? } } }` (`advance_payment` omitted — it is an unmapped column; the snapshot `prepaid_amount` is on `settlement`)
  - `POST /settlements/:id/resolve` body `{ outcome, note }` → `{ success:true, data:{ settlement } }`; `SettlementError` → 400 `{ success:false, code, message }`; 404 for `NOT_FOUND`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  order_settlement: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  order_settlement_event: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../services/settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return { SettlementError, adminResolve: jest.fn(), publicView: jest.fn((s) => s) };
});

const prisma = require("../../config/db");
const svc = require("../../services/settlementService");
const c = require("../adminSettlementController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const json = (r) => r.json.mock.calls[0][0];
const NOW = Date.now();

describe("adminSettlementController.list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order_settlement.count.mockResolvedValue(1);
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 7, name: "Asha", mobile: 9876543210 }]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, full_name: "Ravi K", first_name: "Ravi", last_name: "K", fmobile: "8888800000" }]);
    prisma.order_settlement.findMany.mockResolvedValue([{
      id: 1, order_id: 50, uid: 7, rid: 9, status: "pending", amount_due: 85, fare: 100, method: null,
      pending_since: new Date(NOW - 20 * 60000), escalated_at: null, dispute_reason: null, dispute_raised_by: null,
    }]);
  });

  it("maps filters to where clauses", async () => {
    for (const [status, where] of [
      ["pending", { status: "pending" }],
      ["unsettled", { status: "pending", escalated_at: { not: null } }],
      ["disputed", { status: "disputed" }],
      ["resolved", { status: { in: ["cash_received", "paid_online", "waived", "customer_owes"] } }],
      ["all", {}],
    ]) {
      prisma.order_settlement.findMany.mockClear();
      await c.list({ query: { status } }, res());
      expect(prisma.order_settlement.findMany.mock.calls[0][0].where).toEqual(where);
    }
  });

  it("filters by rider and customer and paginates", async () => {
    await c.list({ query: { status: "pending", rider_id: "9", user_id: "7", page: "2", limit: "10" } }, res());
    const args = prisma.order_settlement.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: "pending", rid: 9, uid: 7 });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it("returns names, minutes pending and the escalated flag", async () => {
    const r = res();
    await c.list({ query: { status: "pending" } }, r);
    expect(json(r)).toMatchObject({
      success: true,
      pagination: { page: 1, limit: 25, total: 1 },
      data: [{ id: 1, order_id: 50, status: "pending", amount_due: 85, customer_name: "Asha", rider_name: "Ravi K", escalated: false }],
    });
    expect(json(r).data[0].minutes_pending).toBeGreaterThanOrEqual(20);
  });
});

describe("adminSettlementController.detail", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns settlement, oldest-first events and the order", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 1, order_id: 50, uid: 7, rid: 9 });
    prisma.order_settlement_event.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, paddress: "A", daddress: "B", d_charge: 100, total_dcharge: 100, commission: 10 });
    const r = res();
    await c.detail({ params: { id: "1" } }, r);
    expect(prisma.order_settlement_event.findMany).toHaveBeenCalledWith({ where: { settlement_id: 1 }, orderBy: { id: "asc" } });
    expect(json(r).data).toMatchObject({ settlement: { id: 1 }, events: [{ id: 1 }, { id: 2 }], order: { id: 50 } });
  });

  it("404s an unknown settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    const r = res();
    await c.detail({ params: { id: "99" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});

describe("adminSettlementController.resolve", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resolves with the logged-in admin's id", async () => {
    svc.adminResolve.mockResolvedValue({ settlement: { id: 1, status: "waived" } });
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "Goodwill" }, user: { id: 3 } }, r);
    expect(svc.adminResolve).toHaveBeenCalledWith({ settlementId: 1, adminId: 3, outcome: "waived", note: "Goodwill" });
    expect(json(r)).toMatchObject({ success: true, data: { settlement: { status: "waived" } } });
  });

  it("maps business errors to 400 (404 for NOT_FOUND)", async () => {
    svc.adminResolve.mockRejectedValue(new svc.SettlementError("NOTE_REQUIRED", "A note is required"));
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived" }, user: { id: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(json(r)).toMatchObject({ success: false, code: "NOTE_REQUIRED" });

    svc.adminResolve.mockRejectedValue(new svc.SettlementError("NOT_FOUND", "none"));
    const r2 = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 } }, r2);
    expect(r2.status).toHaveBeenCalledWith(404);
  });

  it("unexpected errors are 500", async () => {
    svc.adminResolve.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx jest src/controllers/__tests__/adminSettlementController.test.js`
Expected: FAIL — `Cannot find module '../adminSettlementController'`.

- [ ] **Step 3: Implement the controller**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settlementService = require("../services/settlementService");

const { SettlementError } = settlementService;

const RESOLVED = ["cash_received", "paid_online", "waived", "customer_owes"];
const FILTERS = {
  pending: () => ({ status: "pending" }),
  unsettled: () => ({ status: "pending", escalated_at: { not: null } }),
  disputed: () => ({ status: "disputed" }),
  resolved: () => ({ status: { in: RESOLVED } }),
  all: () => ({}),
};

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

const riderName = (r) => r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;

async function list(req, res) {
  try {
    const where = (FILTERS[req.query.status] || FILTERS.all)();
    if (req.query.rider_id) where.rid = Number(req.query.rider_id);
    if (req.query.user_id) where.uid = Number(req.query.user_id);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const [rows, total] = await Promise.all([
      prisma.order_settlement.findMany({ where, orderBy: { pending_since: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.order_settlement.count({ where }),
    ]);

    const [users, riders] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uid))] } } }),
      prisma.tbl_rider.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.rid))] } } }),
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const now = Date.now();
    const data = rows.map((s) => ({
      id: s.id,
      order_id: s.order_id,
      status: s.status,
      amount_due: Number(s.amount_due),
      fare: Number(s.fare),
      method: s.method,
      customer_name: userById[s.uid]?.name || null,
      customer_mobile: userById[s.uid] ? String(userById[s.uid].mobile) : null,
      rider_name: riderById[s.rid] ? riderName(riderById[s.rid]) : null,
      rider_mobile: riderById[s.rid]?.fmobile || null,
      pending_since: s.pending_since,
      minutes_pending: Math.floor((now - new Date(s.pending_since).getTime()) / 60000),
      escalated: !!s.escalated_at,
      dispute_reason: s.dispute_reason,
      dispute_raised_by: s.dispute_raised_by,
    }));
    return res.status(200).json({ success: true, data, pagination: { page, limit, total } });
  } catch (err) {
    return internalError(res, err, "adminSettlement list");
  }
}

async function detail(req, res) {
  try {
    const id = Number(req.params.id);
    const settlement = await prisma.order_settlement.findUnique({ where: { id } });
    if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found" });
    const [events, order] = await Promise.all([
      prisma.order_settlement_event.findMany({ where: { settlement_id: id }, orderBy: { id: "asc" } }),
      prisma.pkg_order.findUnique({ where: { id: settlement.order_id } }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        settlement,
        events,
        order: order && {
          id: order.id, paddress: order.paddress, daddress: order.daddress, d_charge: order.d_charge,
          total_dcharge: order.total_dcharge, commission: order.commission, o_status: order.o_status,
        },
      },
    });
  } catch (err) {
    return internalError(res, err, "adminSettlement detail");
  }
}

async function resolve(req, res) {
  try {
    const { settlement } = await settlementService.adminResolve({
      settlementId: Number(req.params.id),
      adminId: req.user?.id,
      outcome: req.body?.outcome,
      note: req.body?.note,
    });
    return res.status(200).json({ success: true, data: { settlement } });
  } catch (err) {
    if (err instanceof SettlementError) {
      return res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ success: false, code: err.code, message: err.message });
    }
    return internalError(res, err, "adminSettlement resolve");
  }
}

module.exports = { list, detail, resolve };
```

- [ ] **Step 4: Wire routes** in `adminRoutes.js` (require at the top with the other controllers; routes next to the `/payouts` routes):

```js
const adminSettlementController = require("../controllers/adminSettlementController");
router.get("/settlements", auth, authorize("superadmin", "admin"), adminSettlementController.list);
router.get("/settlements/:id", auth, authorize("superadmin", "admin"), adminSettlementController.detail);
router.post("/settlements/:id/resolve", auth, authorize("superadmin", "admin"), adminSettlementController.resolve);
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd backend && npx jest src/controllers/__tests__/adminSettlementController.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminSettlementController.js backend/src/controllers/__tests__/adminSettlementController.test.js backend/src/routes/adminRoutes.js
git commit -m "feat(settlement): admin settlements list, detail and resolve API"
```

---

### Task 11: Full verification and rollout notes

**Files:**
- Create: `docs/superpowers/plans/2026-10-04-payment-settlement-rollout.md`

- [ ] **Step 1: Run the whole backend suite**

Run: `cd backend && npx jest`
Expected: everything passes except the two pre-existing, unrelated failures in `src/utils/__tests__/aadharPdfVerify.test.js`. Any other failure must be fixed before continuing.

- [ ] **Step 2: Load-check the app wiring**

Run: `cd backend && node -e "require('./src/routes/orderRoutes'); require('./src/routes/riderRoutes'); require('./src/routes/adminRoutes'); require('./src/services/settlementSweep'); console.log('routes + sweep load ok')"`
Expected: `routes + sweep load ok` (no exceptions about missing exports or cycles).

- [ ] **Step 3: Write the rollout note**

```markdown
# Payment settlement — backend rollout

1. Apply `backend/prisma/migrations/20261004010000_add_order_settlement/migration.sql` on the target DB
   (dev, then prod). The backend does not need the tables while `settlement_enabled` is off,
   except `getPublicViewForOrder`, which tolerates a missing table.
2. Deploy the backend. Behaviour is unchanged (feature off).
3. Ship the new customer and driver app builds (separate plans), and the admin Settlements page.
4. Enable: set `settlement_enabled` = `1` on the admin Settings page (stored in `app_settings`).
   Tune `settlement_reminder_minutes` (e.g. `10,30`), `settlement_escalate_after_minutes` (60),
   `settlement_driver_block_grace_minutes` (10), `settlement_dispute_window_hours` (48).
5. Rollback: set `settlement_enabled` = `0`. Orders already in a settlement keep working
   (endpoints and the admin page do not check the flag); new completions use the legacy flow.
   Customers/drivers blocked by a pending settlement are unblocked as soon as the flag is off.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-10-04-payment-settlement-rollout.md
git commit -m "docs(settlement): backend rollout notes"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| State machine, rules (online final, disputed blocks cash/online, `amount_due>0`) | 3, 4, 5, 6 |
| Money rules, difference-based reversal, unique keys, skip legacy writes | 3, 4, 6 |
| Data model (`order_settlement`, `order_settlement_event`) | 1 |
| Admin settings (5 keys, fail-closed) | 2 (via `app_settings`, see Deviation 1) |
| Customer/driver/admin APIs | 7, 10 |
| Razorpay verify + amount match | 5 |
| Socket `settlement:updated` | 3 (`emitSettlementUpdated`), 6 (`order:completed.settlement_pending`) |
| Reminders and escalation | 9 |
| Customer booking block / driver dispatch block | 8 |
| Rollout flag, prod SQL first | 1, 11 |
| Customer app, driver app, admin panel UI | **Separate plans (2–4)** — API contract fixed here |

Gaps: none inside the backend scope. The driver "10 min grace" is `driver_block_grace_minutes`; the customer dispute window is enforced in Task 4.

**Placeholder scan:** none — every code step is complete; the only "mirror" instruction (Task 8's `baseInput` scope note) names the exact file and fallback location.

**Type consistency:** `createForCompletedOrder` payload keys (`orderId, uid, riderId, amountDue, fare, commissionAmount, perTripCharge, prepaidAmount`) are identical in Tasks 3 and 6; error codes thrown in Tasks 3–5 match those asserted in Tasks 4, 5, 7 and 10; `settlement.status` vocabulary matches the SQL default and `FILTERS`/`RESOLVED`; `findBlockingSettlement` shape matches Task 8's `createOrderCore` use; sweep claims use the column names from Task 1.

**Review Focus coverage:** (1) Task 4 "double tap / retry"; (2) Task 5 mismatch/verification/replay tests; (3) Task 6 "falls back to the legacy commission debit when settlement creation throws"; (4) Task 4 "changing outcome reverses…" + "repeating the same resolve"; (5) Task 9 "does not resend…", "claimed by another sweep", "catch-up".
