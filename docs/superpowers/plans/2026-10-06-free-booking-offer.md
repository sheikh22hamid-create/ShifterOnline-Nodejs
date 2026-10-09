# Free Booking Offer Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT - migrations pending.** Implementation record - kept for history. Where it differs from the code, the code and the master document win. Current code-verified description: [Master Document section 5.4](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A premium customer who books with an offer-pool vehicle gets the full trip invoice credited to their wallet after the trip is completed and paid, once, until a successful referral unlocks the benefit again.

**Architecture:** New Prisma tables (`free_booking_setting`, `free_booking_pool`, `free_booking_order`) and three `tbl_user` columns. Pure rules live in `freeBookingRules.js`; DB logic in `freeBookingService.js`. The service plugs into existing flows at five points: order create, dispatch (pool filter + fallback), driver accept, trip complete/settlement (credit), referral completion (unlock). Admin API plus a React page manage the offer; the Flutter customer app calls a check endpoint before booking.

**Tech Stack:** Node/Express, Prisma 6 (MySQL), Jest, React (Vite) admin panel, Flutter (GetX) customer app.

**Spec:** `docs/superpowers/specs/2026-10-06-free-booking-offer-design.md`

## Global Constraints

- Free booking is **never** a fare discount: `pkg_order` fare fields, invoice and receiver payment are untouched.
- Credit goes to `tbl_user.wallet` with a `tbl_wallet_history` row (`wallet_type: "user"`), idempotency key `free_booking_credit:<order_id>`.
- Pool membership is by `rider_id`; vehicle type matches `tbl_rider.vehicle = pkg_order.category`.
- Free booking is allowed for **instant bookings only** (`booking_type = 1`). (Added to the spec in Task 1; scheduled and next-day orders are not dispatched at booking time, so a pool check then would be meaningless.)
- Admin routes: reads `superadmin|admin|executive`, writes `superadmin|admin`. `admin` is bound to its own `city_id`; `superadmin` passes `city_id` (query or body).
- Statuses stored: `FREE_BOOKING_CONFIRMED`, `FREE_BOOKING_REWARD_PENDING`, `FREE_BOOKING_REWARD_CREDITED`, `FREE_BOOKING_NOT_ELIGIBLE`.
- Dev DB is the `.env` DB. Migrations are hand-written SQL registered with `prisma migrate resolve --applied` (no shadow DB, see Daily Driver notes). Production SQL is run by the user before deploy.
- All new hooks into existing flows are fire-and-forget or wrapped in try/catch: a free-booking failure must never break booking, dispatch, acceptance, completion or settlement.
- Customer routes trust `uid` in the body, same known app-wide gap as every other customer route (not fixed here).
- Windows + Git Bash: run commands from `backend/` unless stated. Commit after every task.

## Review Focus

1. A cancelled free-booking order must not block the user's next free booking (open-booking query ignores cancelled orders). Tested in Task 3.
2. Double credit: `tryCredit` called twice, from completion and from settlement, credits once; two concurrent free orders for one user credit once (second is voided as `locked`). Tested in Task 4.
3. Pool exists but every pool driver is offline/stale/busy: check returns `no_free_vehicle`, never throws. Tested in Task 3.
4. A free booking requested for a scheduled/next-day booking is refused, no row written. Tested in Task 5.
5. Order paid partly with a coupon or referral points: the credit is the full invoice total (per spec), not just the cash paid. Behavior is pinned by a test in Task 4 and flagged to the product owner in the handoff.
6. A referral that completes while the user is NOT locked does nothing; unlock only flips a locked user. Tested in Task 7.

---

### Task 1: Schema, migration, spec amendment

**Files:**
- Modify: `backend/prisma/schema.prisma` (add 3 models, 3 `tbl_user` fields)
- Create: `backend/prisma/migrations/20261006030000_add_free_booking_offer/migration.sql`
- Modify: `docs/superpowers/specs/2026-10-06-free-booking-offer-design.md` (section 3, add rule 6)

**Interfaces:**
- Produces: Prisma models `free_booking_setting`, `free_booking_pool`, `free_booking_order`; `tbl_user.free_booking_locked`, `tbl_user.free_booking_locked_at`, `tbl_user.free_booking_just_unlocked`.

- [ ] **Step 1: Add the models to `schema.prisma`** (append at the end of the file)

```prisma
// Free Booking Offer (spec 2026-10-06). One row per city; no row = offer OFF.
model free_booking_setting {
  city_id     Int       @id
  enabled     Boolean   @default(false)
  offer_start DateTime? @db.DateTime(0)
  offer_end   DateTime? @db.DateTime(0)
  updated_by  Int?
  updated_at  DateTime  @default(now()) @updatedAt @db.DateTime(0)
}

// Vehicles (riders) the admin put in the offer pool, with a validity window.
model free_booking_pool {
  id                 Int      @id @default(autoincrement())
  city_id            Int
  rider_id           Int
  vehicle_details_id Int?
  valid_from         DateTime @db.Date
  valid_to           DateTime @db.Date
  active             Boolean  @default(true)
  added_by           Int?
  created_at         DateTime @default(now()) @db.DateTime(0)
  updated_at         DateTime @default(now()) @updatedAt @db.DateTime(0)

  @@index([city_id, active, valid_from, valid_to], map: "idx_fbp_city_active_dates")
  @@index([rider_id], map: "idx_fbp_rider")
}

// One row per free booking: the audit record and the state machine.
model free_booking_order {
  id                   Int       @id @default(autoincrement())
  order_id             Int       @unique(map: "uq_fbo_order")
  user_id              Int
  city_id              Int?
  status               String    @db.VarChar(40)
  not_eligible_reason  String?   @db.VarChar(60)
  pool_rider_id        Int?
  accepted_in_pool     Boolean   @default(false)
  actual_fare          Decimal?  @db.Decimal(10, 2)
  credit_amount        Decimal?  @db.Decimal(10, 2)
  wallet_history_id    Int?
  search_radius_km     Int?
  premium_plan_id      Int?
  premium_plan_amount  Decimal?  @db.Decimal(10, 2)
  created_at           DateTime  @default(now()) @db.DateTime(0)
  completed_at         DateTime? @db.DateTime(0)
  credited_at          DateTime? @db.DateTime(0)

  @@index([user_id, status], map: "idx_fbo_user_status")
  @@index([city_id, status], map: "idx_fbo_city_status")
}
```

- [ ] **Step 2: Add the three fields to `model tbl_user`** (after `referral_points Int @default(0)`)

```prisma
  free_booking_locked        Boolean   @default(false)
  free_booking_locked_at     DateTime? @db.DateTime(0)
  free_booking_just_unlocked Boolean   @default(false)
```

- [ ] **Step 3: Write the migration SQL**

`backend/prisma/migrations/20261006030000_add_free_booking_offer/migration.sql`:

```sql
-- Free Booking Offer (spec 2026-10-06). Apply on prod BEFORE deploying the backend.
CREATE TABLE `free_booking_setting` (
  `city_id` INT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `offer_start` DATETIME(0) NULL,
  `offer_end` DATETIME(0) NULL,
  `updated_by` INT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`city_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `free_booking_pool` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `city_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `vehicle_details_id` INT NULL,
  `valid_from` DATE NOT NULL,
  `valid_to` DATE NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `added_by` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_fbp_city_active_dates` (`city_id`, `active`, `valid_from`, `valid_to`),
  INDEX `idx_fbp_rider` (`rider_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `free_booking_order` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `city_id` INT NULL,
  `status` VARCHAR(40) NOT NULL,
  `not_eligible_reason` VARCHAR(60) NULL,
  `pool_rider_id` INT NULL,
  `accepted_in_pool` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_fare` DECIMAL(10,2) NULL,
  `credit_amount` DECIMAL(10,2) NULL,
  `wallet_history_id` INT NULL,
  `search_radius_km` INT NULL,
  `premium_plan_id` INT NULL,
  `premium_plan_amount` DECIMAL(10,2) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `completed_at` DATETIME(0) NULL,
  `credited_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_fbo_order` (`order_id`),
  INDEX `idx_fbo_user_status` (`user_id`, `status`),
  INDEX `idx_fbo_city_status` (`city_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tbl_user`
  ADD COLUMN `free_booking_locked` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `free_booking_locked_at` DATETIME(0) NULL,
  ADD COLUMN `free_booking_just_unlocked` TINYINT(1) NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Amend the spec** — in section 3 of the spec, after eligibility item 5, add:

```markdown
6. The booking is an **instant** booking (`booking_type = 1`). Scheduled and next-day bookings are not dispatched at booking time, so a pool check then would be meaningless; they are never free bookings.
```

- [ ] **Step 5: Validate the schema and generate the client**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: "The schema at prisma\schema.prisma is valid" and "Generated Prisma Client". (If generate fails with EPERM on Windows because a node process holds the engine file, stop the dev server and retry.)

- [ ] **Step 6: Apply the SQL to the DEV database and register it**

Create the scratch script `backend/scripts/_apply_free_booking_sql.js` (delete it after the run; do not commit it):

```js
const fs = require("fs");
const path = require("path");
const prisma = require("../src/config/db");

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261006030000_add_free_booking_offer/migration.sql"), "utf8");
  const statements = sql.split(";").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
    console.log("OK:", stmt.slice(0, 60).replace(/\s+/g, " "));
  }
  await prisma.$disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
```

Run: `node scripts/_apply_free_booking_sql.js && npx prisma migrate resolve --applied 20261006030000_add_free_booking_offer && rm scripts/_apply_free_booking_sql.js`
Expected: four `OK:` lines, then "Migration 20261006030000_add_free_booking_offer marked as applied."

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20261006030000_add_free_booking_offer docs/superpowers/specs/2026-10-06-free-booking-offer-design.md
git commit -m "feat(free-booking): schema and migration for the free booking offer"
```

---

### Task 2: Pure rules module

**Files:**
- Create: `backend/src/services/freeBookingRules.js`
- Test: `backend/src/services/__tests__/freeBookingRules.test.js`

**Interfaces:**
- Produces (all exported from `freeBookingRules.js`):
  - `STATUS` (`CONFIRMED`, `REWARD_PENDING`, `REWARD_CREDITED`, `NOT_ELIGIBLE`), `OPEN_STATUSES` (array of the first two)
  - `OUTCOME` (`ELIGIBLE: "eligible"`, `NO_FREE_VEHICLE: "no_free_vehicle"`, `LOCKED: "locked"`, `NOT_PREMIUM: "not_premium"`, `OFFER_OFF: "offer_off"`, `OPEN_BOOKING: "open_booking"`)
  - `REASON` (`CANCELLED`, `VEHICLE_CHANGED`, `LOCKED`, `ZERO_FARE`, `POOL_UNAVAILABLE`, `ADMIN_VOID`)
  - `OUTCOME_MESSAGE` map outcome -> customer text
  - `round2(n)`, `istDateString(now?)` -> `"YYYY-MM-DD"` in IST
  - `isCityOfferOpen(setting, now?)` -> boolean
  - `decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound })` -> OUTCOME value
  - `isPaymentSettled(settlement)` -> boolean (`null` settlement = nothing to collect = settled)
  - `decideCredit({ row, order, userLocked, paymentSettled })` -> `{ action: "skip"|"wait"|"void"|"credit", reason?, amount? }`

- [ ] **Step 1: Write the failing test**

```js
const rules = require("../freeBookingRules");

const { STATUS, OUTCOME, REASON } = rules;

describe("istDateString", () => {
  it("rolls to the next IST day after 18:30 UTC", () => {
    expect(rules.istDateString(new Date("2026-10-06T18:29:00Z"))).toBe("2026-10-06");
    expect(rules.istDateString(new Date("2026-10-06T18:31:00Z"))).toBe("2026-10-07");
  });
});

describe("isCityOfferOpen", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const base = { enabled: true, offer_start: new Date("2026-10-01T00:00:00Z"), offer_end: new Date("2026-10-31T00:00:00Z") };
  it("is open inside the window", () => expect(rules.isCityOfferOpen(base, now)).toBe(true));
  it("is closed when disabled", () => expect(rules.isCityOfferOpen({ ...base, enabled: false }, now)).toBe(false));
  it("is closed with no setting row", () => expect(rules.isCityOfferOpen(null, now)).toBe(false));
  it("is closed before start and after end", () => {
    expect(rules.isCityOfferOpen({ ...base, offer_start: new Date("2026-10-07T00:00:00Z") }, now)).toBe(false);
    expect(rules.isCityOfferOpen({ ...base, offer_end: new Date("2026-10-05T00:00:00Z") }, now)).toBe(false);
  });
  it("is closed when a date is missing", () => {
    expect(rules.isCityOfferOpen({ ...base, offer_end: null }, now)).toBe(false);
    expect(rules.isCityOfferOpen({ ...base, offer_start: null }, now)).toBe(false);
  });
});

describe("decideOutcome", () => {
  const ok = { premium: true, cityOpen: true, locked: false, openBooking: false, poolVehicleFound: true };
  it("eligible when everything holds", () => expect(rules.decideOutcome(ok)).toBe(OUTCOME.ELIGIBLE));
  it("not_premium wins over everything", () => expect(rules.decideOutcome({ ...ok, premium: false, cityOpen: false })).toBe(OUTCOME.NOT_PREMIUM));
  it("offer_off before locked", () => expect(rules.decideOutcome({ ...ok, cityOpen: false, locked: true })).toBe(OUTCOME.OFFER_OFF));
  it("locked before open_booking", () => expect(rules.decideOutcome({ ...ok, locked: true, openBooking: true })).toBe(OUTCOME.LOCKED));
  it("open_booking before pool", () => expect(rules.decideOutcome({ ...ok, openBooking: true, poolVehicleFound: false })).toBe(OUTCOME.OPEN_BOOKING));
  it("no_free_vehicle when the pool has nobody in range", () => expect(rules.decideOutcome({ ...ok, poolVehicleFound: false })).toBe(OUTCOME.NO_FREE_VEHICLE));
});

describe("isPaymentSettled", () => {
  it("no settlement row means nothing to collect", () => expect(rules.isPaymentSettled(null)).toBe(true));
  it("cash_received and paid_online are settled", () => {
    expect(rules.isPaymentSettled({ status: "cash_received" })).toBe(true);
    expect(rules.isPaymentSettled({ status: "paid_online" })).toBe(true);
  });
  it("pending, disputed, waived, customer_owes are not settled", () => {
    for (const status of ["pending", "disputed", "waived", "customer_owes"]) {
      expect(rules.isPaymentSettled({ status })).toBe(false);
    }
  });
});

describe("decideCredit", () => {
  const row = { status: STATUS.REWARD_PENDING, accepted_in_pool: true, pool_rider_id: 9, actual_fare: "500.00" };
  const order = { o_status: "Completed", rid: 9 };
  const go = (o = {}) => rules.decideCredit({ row, order, userLocked: false, paymentSettled: true, ...o });

  it("credits the full actual fare", () => expect(go()).toEqual({ action: "credit", amount: 500 }));
  it("skips a missing or already-final row", () => {
    expect(go({ row: null }).action).toBe("skip");
    expect(go({ row: { ...row, status: STATUS.REWARD_CREDITED } }).action).toBe("skip");
    expect(go({ row: { ...row, status: STATUS.NOT_ELIGIBLE } }).action).toBe("skip");
  });
  it("voids a cancelled order", () => expect(go({ order: { ...order, o_status: "Cancelled" } })).toEqual({ action: "void", reason: REASON.CANCELLED }));
  it("waits while the order is not completed or the fare is not recorded", () => {
    expect(go({ order: { ...order, o_status: "Processing" } }).action).toBe("wait");
    expect(go({ row: { ...row, actual_fare: null } }).action).toBe("wait");
  });
  it("voids when a different driver finished the trip", () => expect(go({ order: { ...order, rid: 10 } })).toEqual({ action: "void", reason: REASON.VEHICLE_CHANGED }));
  it("voids when the accepting driver was not in the pool", () => expect(go({ row: { ...row, accepted_in_pool: false } }).reason).toBe(REASON.VEHICLE_CHANGED));
  it("waits while payment is not settled", () => expect(go({ paymentSettled: false }).action).toBe("wait"));
  it("voids when the user is locked", () => expect(go({ userLocked: true })).toEqual({ action: "void", reason: REASON.LOCKED }));
  it("voids a zero fare", () => expect(go({ row: { ...row, actual_fare: "0" } })).toEqual({ action: "void", reason: REASON.ZERO_FARE }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/freeBookingRules.test.js`
Expected: FAIL with "Cannot find module '../freeBookingRules'".

- [ ] **Step 3: Implement `freeBookingRules.js`**

```js
// Pure decision rules for the Free Booking Offer (spec 2026-10-06). No I/O here:
// freeBookingService.js feeds these the data it loaded.

const STATUS = Object.freeze({
  CONFIRMED: "FREE_BOOKING_CONFIRMED",
  REWARD_PENDING: "FREE_BOOKING_REWARD_PENDING",
  REWARD_CREDITED: "FREE_BOOKING_REWARD_CREDITED",
  NOT_ELIGIBLE: "FREE_BOOKING_NOT_ELIGIBLE",
});
const OPEN_STATUSES = Object.freeze([STATUS.CONFIRMED, STATUS.REWARD_PENDING]);

const OUTCOME = Object.freeze({
  ELIGIBLE: "eligible",
  NO_FREE_VEHICLE: "no_free_vehicle",
  LOCKED: "locked",
  NOT_PREMIUM: "not_premium",
  OFFER_OFF: "offer_off",
  OPEN_BOOKING: "open_booking",
});

const REASON = Object.freeze({
  CANCELLED: "cancelled",
  VEHICLE_CHANGED: "vehicle_changed",
  LOCKED: "locked",
  ZERO_FARE: "zero_fare",
  POOL_UNAVAILABLE: "pool_unavailable",
  ADMIN_VOID: "admin_void",
});

const OUTCOME_MESSAGE = Object.freeze({
  [OUTCOME.ELIGIBLE]: "Free Booking applied. After the trip is completed and paid, the full trip amount will be credited to your Shifter wallet.",
  [OUTCOME.NO_FREE_VEHICLE]: "No free vehicle is available near your pickup right now. You can continue with a paid vehicle, but you will NOT receive any refund for this trip.",
  [OUTCOME.LOCKED]: "Free Booking is locked. Complete a successful referral to unlock it.",
  [OUTCOME.NOT_PREMIUM]: "Free Booking is only for Premium users.",
  [OUTCOME.OFFER_OFF]: "Free Booking is not available right now.",
  [OUTCOME.OPEN_BOOKING]: "Your earlier Free Booking is still being settled. You can book again once it is credited.",
});

const PAID_SETTLEMENT_STATUSES = Object.freeze(["cash_received", "paid_online"]);
const IST_OFFSET_MS = 330 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function istDateString(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function isCityOfferOpen(setting, now = new Date()) {
  if (!setting || !setting.enabled) return false;
  if (!setting.offer_start || !setting.offer_end) return false;
  const t = now.getTime();
  return t >= new Date(setting.offer_start).getTime() && t <= new Date(setting.offer_end).getTime();
}

function decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound }) {
  if (!premium) return OUTCOME.NOT_PREMIUM;
  if (!cityOpen) return OUTCOME.OFFER_OFF;
  if (locked) return OUTCOME.LOCKED;
  if (openBooking) return OUTCOME.OPEN_BOOKING;
  return poolVehicleFound ? OUTCOME.ELIGIBLE : OUTCOME.NO_FREE_VEHICLE;
}

// No settlement row = nothing was left to collect (prepaid / online / settlement feature off).
function isPaymentSettled(settlement) {
  if (!settlement) return true;
  return PAID_SETTLEMENT_STATUSES.includes(settlement.status);
}

function decideCredit({ row, order, userLocked, paymentSettled }) {
  if (!row || !OPEN_STATUSES.includes(row.status)) return { action: "skip" };
  if (order?.o_status === "Cancelled") return { action: "void", reason: REASON.CANCELLED };
  if (order?.o_status !== "Completed" || row.actual_fare == null) return { action: "wait" };
  if (!row.accepted_in_pool || Number(order.rid) !== Number(row.pool_rider_id)) {
    return { action: "void", reason: REASON.VEHICLE_CHANGED };
  }
  if (!paymentSettled) return { action: "wait" };
  if (userLocked) return { action: "void", reason: REASON.LOCKED };
  const amount = round2(row.actual_fare);
  if (amount <= 0) return { action: "void", reason: REASON.ZERO_FARE };
  return { action: "credit", amount };
}

module.exports = {
  STATUS, OPEN_STATUSES, OUTCOME, REASON, OUTCOME_MESSAGE, PAID_SETTLEMENT_STATUSES,
  round2, istDateString, isCityOfferOpen, decideOutcome, isPaymentSettled, decideCredit,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/freeBookingRules.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/freeBookingRules.js backend/src/services/__tests__/freeBookingRules.test.js
git commit -m "feat(free-booking): pure eligibility and credit rules"
```

---

### Task 3: Service, part 1: eligibility, order row, user status

**Files:**
- Create: `backend/src/services/freeBookingService.js`
- Test: `backend/src/services/__tests__/freeBookingEligibility.test.js`

**Interfaces:**
- Consumes: everything from `freeBookingRules` (Task 2); `pricingEngine.getActiveCustomerPlan(uid)` -> `null | { planId, ... }`.
- Produces from `freeBookingService`:
  - `poolRiderIds(cityId, todayStr)` -> `Promise<number[]>`
  - `checkEligibility({ uid, plat, plong, category, radiusKm, cityId, bookingType })` -> `Promise<{ outcome, cityId, planId, poolRiderId }>`
  - `createForOrder({ order, check, radiusKm })` -> created `free_booking_order` row
  - `getUserStatus(uid)` -> `Promise<{ state, message }>` where `state` is one of `available|unlocked|locked|not_premium|offer_off|open_booking`
  - `getDispatchPoolFilter(order)` -> `Promise<number[] | null>` (`null` = not a free booking, no filter)
  - (Task 4 adds the rest to the same file.)

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_premium_plan: { findUnique: jest.fn() },
  free_booking_setting: { findUnique: jest.fn() },
  free_booking_pool: { findMany: jest.fn() },
  free_booking_order: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
}));
jest.mock("../pricingEngine", () => ({ getActiveCustomerPlan: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../customerInbox", () => ({ saveCustomerNotification: jest.fn().mockResolvedValue() }));

const prisma = require("../../config/db");
const pricingEngine = require("../pricingEngine");
const svc = require("../freeBookingService");

const hour = 3600 * 1000;
const openSetting = () => ({ enabled: true, offer_start: new Date(Date.now() - hour), offer_end: new Date(Date.now() + hour) });
const input = { uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader", radiusKm: 5, cityId: 3, bookingType: 1 };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false });
  pricingEngine.getActiveCustomerPlan.mockResolvedValue({ planId: 11 });
  prisma.free_booking_setting.findUnique.mockResolvedValue(openSetting());
  prisma.$queryRaw.mockResolvedValue([]);
});

describe("checkEligibility", () => {
  it("not_premium when there is no active customer plan", async () => {
    pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
    expect((await svc.checkEligibility(input)).outcome).toBe("not_premium");
  });
  it("offer_off when the city has no setting row", async () => {
    prisma.free_booking_setting.findUnique.mockResolvedValue(null);
    expect((await svc.checkEligibility(input)).outcome).toBe("offer_off");
  });
  it("offer_off when now is outside the admin timeline", async () => {
    prisma.free_booking_setting.findUnique.mockResolvedValue({ ...openSetting(), offer_end: new Date(Date.now() - 1000) });
    expect((await svc.checkEligibility(input)).outcome).toBe("offer_off");
  });
  it("offer_off for scheduled and next-day bookings", async () => {
    expect((await svc.checkEligibility({ ...input, bookingType: 2 })).outcome).toBe("offer_off");
    expect((await svc.checkEligibility({ ...input, bookingType: 3 })).outcome).toBe("offer_off");
  });
  it("locked when the user is locked", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: true });
    expect((await svc.checkEligibility(input)).outcome).toBe("locked");
  });
  it("open_booking when an earlier free booking is still open", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 1 }]);
    expect((await svc.checkEligibility(input)).outcome).toBe("open_booking");
  });
  it("the open-booking query ignores cancelled orders", async () => {
    await svc.checkEligibility(input);
    const sql = prisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain("o.o_status <> 'Cancelled'");
  });
  it("no_free_vehicle when every pool driver is offline, stale or busy (query returns nothing)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await svc.checkEligibility(input);
    expect(out.outcome).toBe("no_free_vehicle");
    expect(out.poolRiderId).toBeNull();
  });
  it("eligible with the nearest pool driver", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ rider_id: 9, distance_km: 1.2 }]);
    const out = await svc.checkEligibility(input);
    expect(out).toMatchObject({ outcome: "eligible", poolRiderId: 9, planId: 11, cityId: 3 });
  });
  it("falls back to the user's own city when the request has none", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ rider_id: 9, distance_km: 1 }]);
    const out = await svc.checkEligibility({ ...input, cityId: undefined });
    expect(out.cityId).toBe(3);
    expect(prisma.free_booking_setting.findUnique).toHaveBeenCalledWith({ where: { city_id: 3 } });
  });
});

describe("createForOrder", () => {
  it("writes a CONFIRMED row with the plan snapshot", async () => {
    prisma.tbl_premium_plan.findUnique.mockResolvedValue({ price: "199.00" });
    prisma.free_booking_order.create.mockResolvedValue({ id: 1 });
    await svc.createForOrder({ order: { id: 50, uid: 7 }, check: { cityId: 3, planId: 11 }, radiusKm: 4.6 });
    expect(prisma.free_booking_order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: 50, user_id: 7, city_id: 3, status: "FREE_BOOKING_CONFIRMED",
        search_radius_km: 5, premium_plan_id: 11, premium_plan_amount: "199.00",
      }),
    });
  });
});

describe("getDispatchPoolFilter", () => {
  it("returns null for a normal order", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toBeNull();
  });
  it("returns null once the row is no longer CONFIRMED", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_NOT_ELIGIBLE", city_id: 3 });
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toBeNull();
  });
  it("returns the pool rider ids for a CONFIRMED order", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_CONFIRMED", city_id: 3 });
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }, { rider_id: 9 }, { rider_id: 12 }]);
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toEqual([9, 12]);
  });
  it("never throws: a DB error means no filter", async () => {
    prisma.free_booking_order.findUnique.mockRejectedValue(new Error("boom"));
    expect(await svc.getDispatchPoolFilter({ id: 50 })).toBeNull();
  });
});

describe("getUserStatus", () => {
  it("available for a premium, unlocked user in an open city", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: false });
    expect((await svc.getUserStatus(7)).state).toBe("available");
  });
  it("unlocked is shown once and the flag is cleared", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: false, free_booking_just_unlocked: true });
    expect((await svc.getUserStatus(7)).state).toBe("unlocked");
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({ where: { id: 7, free_booking_just_unlocked: true }, data: { free_booking_just_unlocked: false } });
  });
  it("locked", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, free_booking_locked: true, free_booking_just_unlocked: false });
    const out = await svc.getUserStatus(7);
    expect(out.state).toBe("locked");
    expect(out.message).toMatch(/referral/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/freeBookingEligibility.test.js`
Expected: FAIL with "Cannot find module '../freeBookingService'".

- [ ] **Step 3: Implement `freeBookingService.js` (part 1)**

```js
const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const pricingEngine = require("./pricingEngine");
const walletNotifier = require("./walletNotifier");
const customerInbox = require("./customerInbox");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const rules = require("./freeBookingRules");

const { STATUS, OUTCOME, REASON, OPEN_STATUSES } = rules;

const asDate = (yyyyMmDd) => new Date(`${yyyyMmDd}T00:00:00.000Z`);

function getCitySetting(cityId) {
  return prisma.free_booking_setting.findUnique({ where: { city_id: Number(cityId) } });
}

/** Riders in the city's pool whose row is active and valid on `todayStr` (IST date). */
async function poolRiderIds(cityId, todayStr = rules.istDateString()) {
  const rows = await prisma.free_booking_pool.findMany({
    where: {
      city_id: Number(cityId),
      active: true,
      valid_from: { lte: asDate(todayStr) },
      valid_to: { gte: asDate(todayStr) },
    },
    select: { rider_id: true },
  });
  return [...new Set(rows.map((r) => Number(r.rider_id)))];
}

// A free booking is "open" while it is waiting for a driver / trip / payment. A CONFIRMED row
// whose order was cancelled does not count, so a cancelled trip never blocks the next one.
async function findOpenBooking(userId) {
  const rows = await prisma.$queryRaw`
    SELECT f.id
    FROM free_booking_order f
    JOIN pkg_order o ON o.id = f.order_id
    WHERE f.user_id = ${Number(userId)}
      AND (
        f.status = ${STATUS.REWARD_PENDING}
        OR (f.status = ${STATUS.CONFIRMED} AND o.o_status <> 'Cancelled')
      )
    LIMIT 1
  `;
  return rows[0] || null;
}

// Same driver conditions as dispatchManager.selectEligibleDrivers (online, approved, fresh
// location, right vehicle, within the order radius, not on another trip), limited to the pool.
async function findPoolDriver({ uid, cityId, category, plat, plong, radiusKm, todayStr }) {
  const freshSince = new Date(Date.now() - RIDER_LOCATION_FRESHNESS_MS);
  const rows = await prisma.$queryRaw`
    SELECT
      r.id AS rider_id,
      (6371 * ACOS(
        LEAST(1, GREATEST(-1,
          COS(RADIANS(${Number(plat)})) * COS(RADIANS(CAST(r.rlats AS DECIMAL(10,6)))) *
          COS(RADIANS(CAST(r.rlongs AS DECIMAL(10,6))) - RADIANS(${Number(plong)})) +
          SIN(RADIANS(${Number(plat)})) * SIN(RADIANS(CAST(r.rlats AS DECIMAL(10,6))))
        ))
      )) AS distance_km
    FROM tbl_rider r
    JOIN free_booking_pool p ON p.rider_id = r.id
    WHERE p.city_id = ${Number(cityId)}
      AND p.active = 1
      AND p.valid_from <= ${todayStr}
      AND p.valid_to >= ${todayStr}
      AND r.a_status = 1
      AND r.status = 1
      AND r.vehicle = ${category}
      AND r.rlats IS NOT NULL AND r.rlats != ''
      AND r.rlongs IS NOT NULL AND r.rlongs != ''
      AND r.rloc_updated_at IS NOT NULL AND r.rloc_updated_at >= ${freshSince}
      AND r.id NOT IN (SELECT rider_id FROM tbl_user_blocked_driver WHERE user_id = ${Number(uid)})
      AND r.id NOT IN (
        SELECT rid FROM pkg_order WHERE rid > 0 AND o_status NOT IN ('Completed', 'Cancelled')
      )
    HAVING distance_km <= ${Number(radiusKm)}
    ORDER BY distance_km ASC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function checkEligibility({ uid, plat, plong, category, radiusKm, cityId, bookingType = 1 }) {
  const userId = Number(uid);
  const user = await prisma.tbl_user.findUnique({
    where: { id: userId },
    select: { city_id: true, free_booking_locked: true },
  });
  const plan = user ? await pricingEngine.getActiveCustomerPlan(userId) : null;
  const city = Number(cityId) || (user?.city_id ? Number(user.city_id) : null);
  const setting = city ? await getCitySetting(city) : null;
  const premium = Boolean(plan);
  // Scheduled / next-day bookings are not dispatched at booking time: never free bookings.
  const instant = Number(bookingType) === 1;
  const cityOpen = rules.isCityOfferOpen(setting, new Date()) && instant;
  const locked = Boolean(user?.free_booking_locked);

  let openBooking = false;
  let pool = null;
  if (premium && cityOpen && !locked) {
    openBooking = Boolean(await findOpenBooking(userId));
    if (!openBooking) {
      pool = await findPoolDriver({
        uid: userId, cityId: city, category, plat, plong, radiusKm, todayStr: rules.istDateString(),
      });
    }
  }

  const outcome = rules.decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound: Boolean(pool) });
  return { outcome, cityId: city, planId: plan?.planId ?? null, poolRiderId: pool ? Number(pool.rider_id) : null };
}

async function createForOrder({ order, check, radiusKm }) {
  let planAmount = null;
  if (check.planId) {
    const plan = await prisma.tbl_premium_plan
      .findUnique({ where: { id: check.planId }, select: { price: true } })
      .catch(() => null);
    planAmount = plan?.price ?? null;
  }
  return prisma.free_booking_order.create({
    data: {
      order_id: Number(order.id),
      user_id: Number(order.uid),
      city_id: check.cityId ?? null,
      status: STATUS.CONFIRMED,
      search_radius_km: Math.round(Number(radiusKm)) || null,
      premium_plan_id: check.planId ?? null,
      premium_plan_amount: planAmount,
    },
  });
}

/** Pool rider ids a free-booking order may be offered to; null = normal order, no filter. Never throws. */
async function getDispatchPoolFilter(order) {
  try {
    const row = await prisma.free_booking_order.findUnique({
      where: { order_id: Number(order.id) },
      select: { status: true, city_id: true },
    });
    if (!row || row.status !== STATUS.CONFIRMED) return null;
    return await poolRiderIds(row.city_id);
  } catch (err) {
    logger.error(`freeBookingService.getDispatchPoolFilter failed for order ${order?.id}:`, err);
    return null;
  }
}

async function getUserStatus(uid) {
  const userId = Number(uid);
  const user = await prisma.tbl_user.findUnique({
    where: { id: userId },
    select: { city_id: true, free_booking_locked: true, free_booking_just_unlocked: true },
  });
  const plan = user ? await pricingEngine.getActiveCustomerPlan(userId) : null;
  const setting = user?.city_id ? await getCitySetting(user.city_id) : null;
  const premium = Boolean(plan);
  const cityOpen = rules.isCityOfferOpen(setting, new Date());
  const locked = Boolean(user?.free_booking_locked);
  const openBooking = premium && cityOpen && !locked ? Boolean(await findOpenBooking(userId)) : false;

  const outcome = rules.decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound: true });
  if (outcome !== OUTCOME.ELIGIBLE) return { state: outcome, message: rules.OUTCOME_MESSAGE[outcome] };
  if (user.free_booking_just_unlocked) {
    await prisma.tbl_user.updateMany({ where: { id: userId, free_booking_just_unlocked: true }, data: { free_booking_just_unlocked: false } });
    return { state: "unlocked", message: "Free Booking unlocked! Your next trip with a free vehicle can be credited back." };
  }
  return { state: "available", message: "Free Booking available. Book with a free vehicle and get the trip amount back in your wallet." };
}

module.exports = {
  getCitySetting, poolRiderIds, findOpenBooking, findPoolDriver,
  checkEligibility, createForOrder, getDispatchPoolFilter, getUserStatus,
};
```

Note: the three `require`s for `walletNotifier`, `customerInbox`, `istNow`, `REASON`, `OPEN_STATUSES` are used by Task 4's additions to this same file; keep them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/freeBookingEligibility.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/freeBookingService.js backend/src/services/__tests__/freeBookingEligibility.test.js
git commit -m "feat(free-booking): eligibility check, order row and user status"
```

---

### Task 4: Service, part 2: acceptance, completion, credit, lock/unlock

**Files:**
- Modify: `backend/src/services/freeBookingService.js` (append functions, extend `module.exports`)
- Test: `backend/src/services/__tests__/freeBookingCredit.test.js`

**Interfaces:**
- Consumes: Task 3 `poolRiderIds`; rules from Task 2.
- Produces (added to `freeBookingService`):
  - `recordAcceptance(orderId, riderId)` -> `Promise<void>`
  - `markCompleted({ orderId, finalTotal })` -> `Promise<{ credited: boolean }>`
  - `tryCredit(orderId)` -> `Promise<{ credited: boolean, action?: string }>` (never throws)
  - `fallbackToNormalDispatch(orderId)` -> `Promise<boolean>`
  - `unlockForReferral(userId)` -> `Promise<boolean>` (true if a locked user was unlocked)
  - `setUserLock(userId, locked)` -> `Promise<void>`
  - `voidOrder(freeBookingOrderId, reason)` -> `Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  free_booking_pool: { findMany: jest.fn() },
  free_booking_order: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
}));
jest.mock("../pricingEngine", () => ({ getActiveCustomerPlan: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../customerInbox", () => ({ saveCustomerNotification: jest.fn().mockResolvedValue() }));
jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-06T10:00:00Z") }));

const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const customerInbox = require("../customerInbox");
const svc = require("../freeBookingService");

function makeTx({ row, locked = false, order = { o_status: "Completed", rid: 9 }, settlement = null, duplicate = null } = {}) {
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce(row ? [{ id: row.id, user_id: row.user_id }] : [])
      .mockResolvedValueOnce([{ free_booking_locked: locked ? 1 : 0 }]),
    free_booking_order: { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
    pkg_order: { findUnique: jest.fn().mockResolvedValue(order) },
    order_settlement: { findUnique: jest.fn().mockResolvedValue(settlement) },
    tbl_wallet_history: { findFirst: jest.fn().mockResolvedValue(duplicate), create: jest.fn().mockResolvedValue({ id: 77 }) },
    tbl_user: { update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}
const pendingRow = (o = {}) => ({
  id: 5, order_id: 50, user_id: 7, status: "FREE_BOOKING_REWARD_PENDING",
  accepted_in_pool: true, pool_rider_id: 9, actual_fare: "500.00", ...o,
});

beforeEach(() => jest.resetAllMocks());

describe("tryCredit", () => {
  it("credits the full fare, locks the user and records the history id", async () => {
    const tx = makeTx({ row: pendingRow() });
    const out = await svc.tryCredit(50);
    expect(out).toEqual({ credited: true, action: "credit" });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ wallet: { increment: 500 }, free_booking_locked: true, free_booking_just_unlocked: false }),
    });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 7, amount: 500, type: "credit", wallet_type: "user", order_id: 50, payment_id: "free_booking_credit:50" }),
    });
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: "FREE_BOOKING_REWARD_CREDITED", credit_amount: 500, wallet_history_id: 77 }),
    });
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 500 }));
  });

  it("credits the full invoice even when a coupon or points paid part of it (spec: actual fare)", async () => {
    const tx = makeTx({ row: pendingRow({ actual_fare: "320.50" }) });
    await svc.tryCredit(50);
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ wallet: { increment: 320.5 } }) });
  });

  it("credits when a settlement exists and is cash_received / paid_online", async () => {
    const tx = makeTx({ row: pendingRow(), settlement: { status: "paid_online" } });
    expect((await svc.tryCredit(50)).credited).toBe(true);
    expect(tx.tbl_user.update).toHaveBeenCalled();
  });

  it("is idempotent: an existing history row means no second credit", async () => {
    const tx = makeTx({ row: pendingRow(), duplicate: { id: 1 } });
    const out = await svc.tryCredit(50);
    expect(out.credited).toBe(false);
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("waits while the settlement is pending: nothing is written", async () => {
    const tx = makeTx({ row: pendingRow(), settlement: { status: "pending" } });
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "wait" });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.free_booking_order.update).not.toHaveBeenCalled();
  });

  it("voids as vehicle_changed when another driver finished the trip", async () => {
    const tx = makeTx({ row: pendingRow(), order: { o_status: "Completed", rid: 10 } });
    expect((await svc.tryCredit(50)).action).toBe("void");
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "vehicle_changed" },
    });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });

  it("voids as cancelled", async () => {
    const tx = makeTx({ row: pendingRow({ status: "FREE_BOOKING_CONFIRMED", actual_fare: null }), order: { o_status: "Cancelled", rid: 9 } });
    await svc.tryCredit(50);
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "cancelled" },
    });
  });

  it("a second concurrent free order for a user locked in between is voided as locked, not credited", async () => {
    const tx = makeTx({ row: pendingRow(), locked: true });
    await svc.tryCredit(50);
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "locked" },
    });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });

  it("skips an order that is not a free booking", async () => {
    makeTx({ row: null });
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "skip" });
  });

  it("never throws: a DB error is logged and reported as not credited", async () => {
    prisma.$transaction.mockRejectedValue(new Error("deadlock"));
    expect((await svc.tryCredit(50)).credited).toBe(false);
  });
});

describe("markCompleted", () => {
  it("moves CONFIRMED to REWARD_PENDING with the fare, then tries the credit", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    makeTx({ row: pendingRow() });
    const out = await svc.markCompleted({ orderId: 50, finalTotal: 500.004 });
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "FREE_BOOKING_CONFIRMED" },
      data: expect.objectContaining({ status: "FREE_BOOKING_REWARD_PENDING", actual_fare: 500 }),
    });
    expect(out.credited).toBe(true);
  });
  it("does nothing for an order that is not a CONFIRMED free booking", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.markCompleted({ orderId: 50, finalTotal: 500 })).toEqual({ credited: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("recordAcceptance", () => {
  const confirmed = { id: 5, user_id: 7, city_id: 3, status: "FREE_BOOKING_CONFIRMED" };
  it("stores the pool rider who accepted", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(confirmed);
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }]);
    await svc.recordAcceptance(50, 9);
    expect(prisma.free_booking_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { pool_rider_id: 9, accepted_in_pool: true } });
  });
  it("voids the booking and tells the customer when a non-pool driver accepted", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(confirmed);
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }]);
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    await svc.recordAcceptance(50, 99);
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: { in: ["FREE_BOOKING_CONFIRMED", "FREE_BOOKING_REWARD_PENDING"] } },
      data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "vehicle_changed" },
    });
    expect(customerInbox.saveCustomerNotification).toHaveBeenCalledWith(7, expect.any(String), expect.any(String));
  });
  it("ignores orders that are not CONFIRMED free bookings", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    await svc.recordAcceptance(50, 9);
    expect(prisma.free_booking_order.update).not.toHaveBeenCalled();
  });
});

describe("fallbackToNormalDispatch", () => {
  it("flips CONFIRMED to NOT_ELIGIBLE (pool_unavailable) atomically and notifies", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.free_booking_order.findUnique.mockResolvedValue({ user_id: 7 });
    expect(await svc.fallbackToNormalDispatch(50)).toBe(true);
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "FREE_BOOKING_CONFIRMED" },
      data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "pool_unavailable" },
    });
    expect(customerInbox.saveCustomerNotification).toHaveBeenCalled();
  });
  it("returns false for a normal order", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.fallbackToNormalDispatch(50)).toBe(false);
  });
});

describe("lock and unlock", () => {
  it("unlockForReferral only flips a locked user", async () => {
    prisma.tbl_user.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.unlockForReferral(7)).toBe(true);
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({
      where: { id: 7, free_booking_locked: true },
      data: { free_booking_locked: false, free_booking_just_unlocked: true },
    });
  });
  it("unlockForReferral is a no-op for a user who is not locked", async () => {
    prisma.tbl_user.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.unlockForReferral(7)).toBe(false);
  });
  it("setUserLock(true) stamps locked_at; setUserLock(false) clears both flags", async () => {
    await svc.setUserLock(7, true);
    expect(prisma.tbl_user.update).toHaveBeenLastCalledWith({
      where: { id: 7 }, data: expect.objectContaining({ free_booking_locked: true, free_booking_just_unlocked: false, free_booking_locked_at: expect.any(Date) }),
    });
    await svc.setUserLock(7, false);
    expect(prisma.tbl_user.update).toHaveBeenLastCalledWith({
      where: { id: 7 }, data: { free_booking_locked: false, free_booking_just_unlocked: false },
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/freeBookingCredit.test.js`
Expected: FAIL (`svc.tryCredit is not a function` and similar).

- [ ] **Step 3: Append the implementation to `freeBookingService.js`** (above `module.exports`, then replace `module.exports`)

```js
const notifyUser = (userId, title, description) =>
  customerInbox.saveCustomerNotification(userId, title, description);

// Atomic: only an open row flips, so a race between two callers voids once.
async function voidRow(rowId, reason) {
  const res = await prisma.free_booking_order.updateMany({
    where: { id: rowId, status: { in: OPEN_STATUSES } },
    data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: reason },
  });
  return res.count === 1;
}

async function voidOrder(freeBookingOrderId, reason = REASON.ADMIN_VOID) {
  return voidRow(Number(freeBookingOrderId), reason);
}

/** A driver accepted the order: remember who, and void the booking if they are not a pool driver. */
async function recordAcceptance(orderId, riderId) {
  const row = await prisma.free_booking_order.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.status !== STATUS.CONFIRMED) return;
  const ids = await poolRiderIds(row.city_id);
  if (ids.includes(Number(riderId))) {
    await prisma.free_booking_order.update({ where: { id: row.id }, data: { pool_rider_id: Number(riderId), accepted_in_pool: true } });
    return;
  }
  if (await voidRow(row.id, REASON.VEHICLE_CHANGED)) {
    await notifyUser(
      row.user_id,
      "Free Booking not applicable",
      "A paid vehicle accepted your booking, so Free Booking will not apply to this trip and no wallet refund will be given."
    );
  }
}

/** Dispatch ran out of pool drivers: continue as a normal booking. True if this call flipped the row. */
async function fallbackToNormalDispatch(orderId) {
  const res = await prisma.free_booking_order.updateMany({
    where: { order_id: Number(orderId), status: STATUS.CONFIRMED },
    data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: REASON.POOL_UNAVAILABLE },
  });
  if (res.count !== 1) return false;
  const row = await prisma.free_booking_order.findUnique({ where: { order_id: Number(orderId) }, select: { user_id: true } });
  if (row) {
    await notifyUser(
      row.user_id,
      "Free Booking not available",
      "No free vehicle could take your booking, so it continues as a normal booking. No wallet refund will be given for this trip."
    );
  }
  return true;
}

/**
 * Credits the booker once the trip is completed and its payment is settled. Safe to call from any
 * trigger (completion, every settlement transition): it is idempotent, takes the order and user
 * locks, and never throws.
 */
async function tryCredit(orderId) {
  const id = Number(orderId);
  const notifications = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT id, user_id FROM free_booking_order WHERE order_id = ${id} FOR UPDATE`;
      if (!locked[0]) return { credited: false, action: "skip" };
      const row = await tx.free_booking_order.findUnique({ where: { id: locked[0].id } });
      if (!row || !OPEN_STATUSES.includes(row.status)) return { credited: false, action: "skip" };

      const userRows = await tx.$queryRaw`SELECT free_booking_locked FROM tbl_user WHERE id = ${row.user_id} FOR UPDATE`;
      const userLocked = Boolean(Number(userRows[0]?.free_booking_locked));
      const order = await tx.pkg_order.findUnique({ where: { id }, select: { o_status: true, rid: true } });
      // order_settlement may not exist on a database that has not run the settlement migration.
      let settlement = null;
      try {
        settlement = await tx.order_settlement.findUnique({ where: { order_id: id }, select: { status: true } });
      } catch (err) {
        logger.warn(`freeBookingService.tryCredit: settlement lookup failed for order ${id}: ${err.message}`);
      }

      const decision = rules.decideCredit({ row, order, userLocked, paymentSettled: rules.isPaymentSettled(settlement) });
      if (decision.action === "skip" || decision.action === "wait") return { credited: false, action: decision.action };
      if (decision.action === "void") {
        await tx.free_booking_order.update({
          where: { id: row.id },
          data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: decision.reason },
        });
        return { credited: false, action: "void" };
      }

      const key = `free_booking_credit:${id}`;
      const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
      if (duplicate) return { credited: false, action: "duplicate" };

      const remark = `Free Booking refund for order #${id}`;
      await tx.tbl_user.update({
        where: { id: row.user_id },
        data: {
          wallet: { increment: decision.amount },
          free_booking_locked: true,
          free_booking_locked_at: new Date(),
          free_booking_just_unlocked: false,
        },
      });
      const history = await tx.tbl_wallet_history.create({
        data: {
          user_id: row.user_id, amount: decision.amount, type: "credit", remark,
          wallet_type: "user", order_id: id, payment_id: key, created_at: istNow(),
        },
      });
      await tx.free_booking_order.update({
        where: { id: row.id },
        data: {
          status: STATUS.REWARD_CREDITED, credit_amount: decision.amount,
          wallet_history_id: history.id, credited_at: new Date(),
        },
      });
      notifications.push({ userId: row.user_id, amount: decision.amount, remark });
      return { credited: true, action: "credit" };
    });

    for (const n of notifications) {
      Promise.resolve(walletNotifier.notifyCustomerWalletTransaction(n.userId, { type: "credit", amount: n.amount, remark: n.remark }))
        .catch((err) => logger.error(`freeBookingService: wallet notify failed for user ${n.userId}:`, err));
    }
    return result;
  } catch (err) {
    logger.error(`freeBookingService.tryCredit failed for order ${id}:`, err);
    return { credited: false, action: "error" };
  }
}

/** Trip completed: record the final invoice total and try to credit straight away. */
async function markCompleted({ orderId, finalTotal }) {
  const res = await prisma.free_booking_order.updateMany({
    where: { order_id: Number(orderId), status: STATUS.CONFIRMED },
    data: { status: STATUS.REWARD_PENDING, actual_fare: rules.round2(finalTotal), completed_at: new Date() },
  });
  if (res.count !== 1) return { credited: false };
  return tryCredit(orderId);
}

/** A referral by this user just became successful. True if a locked user was unlocked. */
async function unlockForReferral(userId) {
  const res = await prisma.tbl_user.updateMany({
    where: { id: Number(userId), free_booking_locked: true },
    data: { free_booking_locked: false, free_booking_just_unlocked: true },
  });
  return res.count === 1;
}

async function setUserLock(userId, locked) {
  await prisma.tbl_user.update({
    where: { id: Number(userId) },
    data: locked
      ? { free_booking_locked: true, free_booking_locked_at: new Date(), free_booking_just_unlocked: false }
      : { free_booking_locked: false, free_booking_just_unlocked: false },
  });
}

module.exports = {
  getCitySetting, poolRiderIds, findOpenBooking, findPoolDriver,
  checkEligibility, createForOrder, getDispatchPoolFilter, getUserStatus,
  recordAcceptance, markCompleted, tryCredit, fallbackToNormalDispatch,
  unlockForReferral, setUserLock, voidOrder,
};
```

Remove the earlier `module.exports = {...}` from Task 3 (there must be exactly one at the end of the file).

- [ ] **Step 4: Run both service tests**

Run: `cd backend && npx jest src/services/__tests__/freeBookingCredit.test.js src/services/__tests__/freeBookingEligibility.test.js src/services/__tests__/freeBookingRules.test.js`
Expected: PASS, all three files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/freeBookingService.js backend/src/services/__tests__/freeBookingCredit.test.js
git commit -m "feat(free-booking): credit engine, acceptance, lock and unlock"
```

---

### Task 5: Customer endpoints and order-create integration

**Files:**
- Create: `backend/src/controllers/freeBookingController.js`
- Modify: `backend/src/routes/orderRoutes.js` (two routes)
- Modify: `backend/src/controllers/orderController.js` (`createOrderCore`, `createOrder`)
- Test: `backend/src/controllers/__tests__/freeBookingController.test.js`
- Test: `backend/src/controllers/__tests__/orderController.freeBooking.test.js`

**Interfaces:**
- Consumes: `freeBookingService.checkEligibility`, `createForOrder`, `getUserStatus`; `freeBookingRules.OUTCOME_MESSAGE`.
- Produces:
  - `POST /api/order/free-booking/check` body `{ uid, plat, plong, category, radius_km, city_id?, booking_type? }` -> `{ ResponseCode:"200", Result:"true", outcome, message }`
  - `POST /api/order/free-booking/status` body `{ uid }` -> `{ ResponseCode:"200", Result:"true", state, message }`
  - `createOrderCore({... freeBooking })` returns `{ ok:false, code:"FREE_BOOKING_UNAVAILABLE", outcome, msg }` when the re-check fails; sets `order.free_booking` (boolean) on success.
  - `POST /api/order/create` accepts `free_booking`; answers HTTP 409 `{ code:"FREE_BOOKING_UNAVAILABLE", outcome }`; success body gains `free_booking`.

- [ ] **Step 1: Write the failing controller test** `freeBookingController.test.js`

```js
jest.mock("../../services/freeBookingService", () => ({ checkEligibility: jest.fn(), getUserStatus: jest.fn() }));
const svc = require("../../services/freeBookingService");
const controller = require("../freeBookingController");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => jest.resetAllMocks());

describe("check", () => {
  const body = { uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader", radius_km: 5, city_id: 3, booking_type: 1 };
  it("400 when required fields are missing", async () => {
    const res = mockRes();
    await controller.check({ body: { uid: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("returns the outcome and its customer message", async () => {
    svc.checkEligibility.mockResolvedValue({ outcome: "no_free_vehicle", cityId: 3, planId: 1, poolRiderId: null });
    const res = mockRes();
    await controller.check({ body }, res);
    expect(svc.checkEligibility).toHaveBeenCalledWith({ uid: 7, plat: 22.7, plong: 75.8, category: "E-Loader", radiusKm: 5, cityId: 3, bookingType: 1 });
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ ResponseCode: "200", Result: "true", outcome: "no_free_vehicle" });
    expect(payload.message).toMatch(/NOT receive any refund/);
  });
  it("500 on an unexpected error", async () => {
    svc.checkEligibility.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await controller.check({ body }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("status", () => {
  it("400 without uid", async () => {
    const res = mockRes();
    await controller.status({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("returns the state", async () => {
    svc.getUserStatus.mockResolvedValue({ state: "locked", message: "m" });
    const res = mockRes();
    await controller.status({ body: { uid: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: "true", state: "locked", message: "m" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/freeBookingController.test.js`
Expected: FAIL, "Cannot find module '../freeBookingController'".

- [ ] **Step 3: Implement the controller**

`backend/src/controllers/freeBookingController.js`:

```js
const logger = require("../utils/logger");
const freeBookingService = require("../services/freeBookingService");
const { OUTCOME_MESSAGE } = require("../services/freeBookingRules");

const isFiniteNumber = (v) => v !== null && v !== "" && Number.isFinite(Number(v));

async function check(req, res) {
  try {
    const { uid, plat, plong, category, radius_km, city_id, booking_type } = req.body || {};
    if (!uid || !category || !isFiniteNumber(plat) || !isFiniteNumber(plong)) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "uid, category, plat and plong are required" });
    }
    const result = await freeBookingService.checkEligibility({
      uid: Number(uid), plat: Number(plat), plong: Number(plong), category,
      radiusKm: Number(radius_km) || 4, cityId: city_id ? Number(city_id) : undefined,
      bookingType: booking_type ? Number(booking_type) : 1,
    });
    return res.json({ ResponseCode: "200", Result: "true", outcome: result.outcome, message: OUTCOME_MESSAGE[result.outcome] });
  } catch (err) {
    logger.error("freeBooking.check failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function status(req, res) {
  try {
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "uid is required" });
    const out = await freeBookingService.getUserStatus(Number(uid));
    return res.json({ ResponseCode: "200", Result: "true", state: out.state, message: out.message });
  } catch (err) {
    logger.error("freeBooking.status failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { check, status };
```

`radius_km` default 4 matches the app's `_selectedRadiusKm = 4`.

- [ ] **Step 4: Add the routes** in `backend/src/routes/orderRoutes.js`, with the other requires and routes:

```js
const freeBookingController = require("../controllers/freeBookingController");
```

```js
router.post("/free-booking/check", freeBookingController.check);
router.post("/free-booking/status", freeBookingController.status);
```

- [ ] **Step 5: Run the controller test**

Run: `cd backend && npx jest src/controllers/__tests__/freeBookingController.test.js`
Expected: PASS.

- [ ] **Step 6: Write the failing createOrder test** `backend/src/controllers/__tests__/orderController.freeBooking.test.js`

This is modeled on `orderController.receiverPay.test.js` (same mocks and `input` fixture):

```js
jest.mock("../../config/db", () => ({
  pkg_order_wait_timer: { findUnique: jest.fn().mockResolvedValue(null) },
  driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null) },
  order_settlement: { findUnique: jest.fn().mockResolvedValue(null) },
  tbl_package: { findMany: jest.fn() },
  tbl_goods_type: { findFirst: jest.fn() },
  tbl_user: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("../../services/pricingEngine", () => ({
  priceForPackage: jest.fn(),
  getActivePlanDiscount: jest.fn().mockResolvedValue(null),
  getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  getSlabPricingConfig: jest.fn().mockResolvedValue({ slabRates: {}, modelMultipliers: null }),
  findVehicleSlabConfig: jest.fn().mockReturnValue(null),
  getBodyTypeCharge: jest.fn().mockResolvedValue(0),
  getCoveredBodyCharge: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyNewOrder: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn() }));
jest.mock("../../services/orderDestinationService", () => ({ previewDestinationChange: jest.fn(), confirmDestinationChange: jest.fn() }));
jest.mock("../../services/orderPickupService", () => ({ previewPickupChange: jest.fn(), confirmPickupChange: jest.fn() }));
jest.mock("../../services/orderStopsService", () => ({ previewAddStop: jest.fn(), confirmAddStop: jest.fn() }));
jest.mock("../../services/receiverPayService", () => ({ validateBooking: jest.fn(), createForOrder: jest.fn() }));
jest.mock("../../services/freeBookingService", () => ({ checkEligibility: jest.fn(), createForOrder: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const receiverPayService = require("../../services/receiverPayService");
const freeBookingService = require("../../services/freeBookingService");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { createOrderCore, createOrder } = require("../orderController");

const input = {
  uid: 1, category: "Bike", deliveryTypeIds: [6], bookingType: 1, plat: 28.7, plong: 77.1,
  paddress: "A", pickName: "P", pmobile: "999", pickType: "", dlat: 28.8, dlong: 77.2, daddress: "B",
  dropName: "Ramesh", dmobile: "9876543210", dropType: "", packageWeight: "2 Kg", packageCost: 100,
  description: "", pMethodId: 2, transactionId: "", extraMileCharge: 0, couId: 0, couAmt: 0,
  radiusKm: 10, cityId: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10, sort_order: 1 }]);
  prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
  pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
  prisma.pkg_order.create.mockResolvedValue({ id: 777, booking_type: 1 });
  receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: null });
  freeBookingService.createForOrder.mockResolvedValue({ id: 1 });
});

describe("createOrderCore - free booking", () => {
  it("refuses with FREE_BOOKING_UNAVAILABLE when the re-check is not eligible, and creates no order", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "no_free_vehicle", cityId: 2, planId: 1, poolRiderId: null });
    const result = await createOrderCore({ ...input, freeBooking: true });
    expect(result).toMatchObject({ ok: false, code: "FREE_BOOKING_UNAVAILABLE", outcome: "no_free_vehicle" });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
    expect(freeBookingService.createForOrder).not.toHaveBeenCalled();
  });

  it("refuses a free booking for a scheduled booking (booking_type 2): the service is told the booking type", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "offer_off", cityId: 2, planId: 1, poolRiderId: null });
    const result = await createOrderCore({ ...input, bookingType: 2, freeBooking: true });
    expect(result.code).toBe("FREE_BOOKING_UNAVAILABLE");
    expect(freeBookingService.checkEligibility).toHaveBeenCalledWith(expect.objectContaining({ bookingType: 2, uid: 1, category: "Bike" }));
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("creates the order and the free-booking row when eligible", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    const result = await createOrderCore({ ...input, freeBooking: true });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(true);
    expect(freeBookingService.createForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ order: expect.objectContaining({ id: 777 }), check: expect.objectContaining({ outcome: "eligible" }) })
    );
  });

  it("a failing free-booking row write never fails the booking", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    freeBookingService.createForOrder.mockRejectedValue(new Error("db down"));
    const result = await createOrderCore({ ...input, freeBooking: true });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(false);
  });

  it("never touches the free-booking service for a normal booking", async () => {
    const result = await createOrderCore({ ...input });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(false);
    expect(freeBookingService.checkEligibility).not.toHaveBeenCalled();
  });
});

describe("createOrder HTTP handler - free booking", () => {
  const body = {
    uid: 1, category: "Bike", delivery_type: [6], booking_type: 1, plat: 28.7, plong: 77.1, paddress: "A",
    pick_name: "P", pmobile: "999", pick_type: "", dlat: 28.8, dlong: 77.2, daddress: "B", drop_name: "Ramesh",
    dmobile: "9876543210", drop_type: "", package_weight: "2 Kg", package_cost: 100, description: "",
    p_method_id: 2, transaction_id: "", extra_mile_charge: 0, cou_id: 0, cou_amt: 0, radius_km: 10, city_id: 2,
  };
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  it("maps FREE_BOOKING_UNAVAILABLE to HTTP 409 with the outcome", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "no_free_vehicle", cityId: 2, planId: 1, poolRiderId: null });
    const r = res();
    await createOrder({ body: { ...body, free_booking: true } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "FREE_BOOKING_UNAVAILABLE", outcome: "no_free_vehicle" }));
  });

  it("accepts free_booking as the string 'true' and reports free_booking in the response", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    const r = res();
    await createOrder({ body: { ...body, free_booking: "true" } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 777, free_booking: true }));
  });
});
```


- [ ] **Step 7: Run it to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/orderController.freeBooking.test.js`
Expected: FAIL (`freeBooking` argument ignored, `order.free_booking` undefined).

- [ ] **Step 8: Wire `createOrderCore`**

In `orderController.js`, add near the other service requires (line ~21):

```js
const freeBookingService = require("../services/freeBookingService");
```

Add `freeBooking = false,` to the destructured parameters (after `receiverPays = false, receiverCommissionPercent,`).

Immediately after the `resolvedRadiusKm` definition (the `Math.min(Math.max(resolveSearchRadiusKm(...), 1), 100)` statement), insert:

```js
  // Free Booking Offer: the client's request is never trusted, so re-run the same check here.
  let freeBookingCheck = null;
  if (freeBooking) {
    freeBookingCheck = await freeBookingService.checkEligibility({
      uid, plat, plong, category, radiusKm: resolvedRadiusKm, cityId: resolvedCityId, bookingType,
    });
    if (freeBookingCheck.outcome !== "eligible") {
      return {
        ok: false,
        code: "FREE_BOOKING_UNAVAILABLE",
        outcome: freeBookingCheck.outcome,
        msg: "Free Booking is no longer available for this booking.",
      };
    }
  }
```

After the receiver-pay block (the `if (receiverPayCheck.value) {...}` that ends just before the wallet-prepayment block) insert:

```js
  // Free-booking audit row. Like receiver-pay above, never allowed to fail an already-created
  // booking: without it the ride is simply a normal booking.
  order.free_booking = false;
  if (freeBookingCheck) {
    try {
      await freeBookingService.createForOrder({ order, check: freeBookingCheck, radiusKm: resolvedRadiusKm });
      order.free_booking = true;
    } catch (err) {
      logger.error(`createOrderCore: free-booking row failed for order ${order.id}:`, err);
    }
  }
```

In `createOrder` (the HTTP handler): add `free_booking` to the destructured `req.body`, pass `freeBooking: free_booking === true || free_booking === "true" || free_booking === 1 || free_booking === "1",` into `createOrderCore`, add this branch next to the other `result.code` branches:

```js
    if (!result.ok && result.code === "FREE_BOOKING_UNAVAILABLE") {
      return res.status(409).json({ ResponseCode: "409", Result: "false", code: "FREE_BOOKING_UNAVAILABLE", outcome: result.outcome, ResponseMsg: result.msg });
    }
```

and add `free_booking: Boolean(order.free_booking),` to the success JSON next to `receiver_pay`.

- [ ] **Step 9: Run the tests, then the whole orderController suite**

Run: `cd backend && npx jest src/controllers/__tests__/orderController`
Expected: PASS, including the pre-existing `orderController.test.js` and `orderController.receiverPay.test.js`. If a pre-existing test fails because `../services/freeBookingService` loads the real module against a mocked `prisma`, add `jest.mock("../../services/freeBookingService", () => ({ checkEligibility: jest.fn(), createForOrder: jest.fn() }));` to that test file's header.

- [ ] **Step 10: Commit**

```bash
git add backend/src/controllers/freeBookingController.js backend/src/routes/orderRoutes.js backend/src/controllers/orderController.js backend/src/controllers/__tests__
git commit -m "feat(free-booking): customer check/status endpoints and order-create integration"
```

---

### Task 6: Dispatch: pool filter and fallback

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (`selectEligibleDrivers`, `checkCascadeTermination`)
- Modify test: `backend/src/services/__tests__/dispatchManager.test.js` (new mock at the top, two new tests inside the existing describe, one new describe at the end)

**Interfaces:**
- Consumes: `freeBookingService.getDispatchPoolFilter(order)` -> `number[] | null`, `freeBookingService.fallbackToNormalDispatch(orderId)` -> boolean.
- Produces: free-booking orders are only offered to pool riders; when the cascade is exhausted, the order restarts as a normal booking instead of being cancelled "No driver found".

- [ ] **Step 1: Write the failing test**

All of this goes into the existing `backend/src/services/__tests__/dispatchManager.test.js`, which already mocks prisma, pricingEngine, settlementSettings, pushNotifier and walletPrepaymentRefund and defines `makeRiderRow` and `flush`.

(a) Add this mock next to the other `jest.mock(...)` calls at the top (above `const prisma = require(...)`), and the require next to the other requires:

```js
jest.mock("../freeBookingService", () => ({
  getDispatchPoolFilter: jest.fn().mockResolvedValue(null),
  fallbackToNormalDispatch: jest.fn().mockResolvedValue(false),
}));
```

```js
const freeBookingService = require("../freeBookingService");
```

Because `dispatchManager` loads the service lazily with `require("./freeBookingService")`, this one mock covers every existing test too (all of them see a normal order and no fallback).

(b) Inside the existing `describe("dispatchManager overlapping batch cascade", ...)`, directly after the test named `"all tiers exhausted with no acceptance still reaches the existing no_driver_found flow"`, add these two tests. They reuse that test's exact timer arrangement:

```js
  it("a free-booking order whose pool is exhausted restarts as a normal booking instead of being cancelled", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });
    freeBookingService.fallbackToNormalDispatch.mockResolvedValueOnce(true);

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

    expect(freeBookingService.fallbackToNormalDispatch).toHaveBeenCalledWith(order.id);
    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(0);
    const cancelled = prisma.pkg_order.update.mock.calls.some(([args]) => args.data && args.data.o_status === "Cancelled");
    expect(cancelled).toBe(false);
  });

  it("a fallback error is swallowed and the normal 'No driver found' cancel still happens", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });
    freeBookingService.fallbackToNormalDispatch.mockRejectedValueOnce(new Error("boom"));

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
    const cancelled = prisma.pkg_order.update.mock.calls.some(([args]) => args.data && args.data.o_status === "Cancelled");
    expect(cancelled).toBe(true);
  });
```

(The existing test already proves that a normal order is cancelled "No driver found" when the fallback returns its default `false`.)

(c) Append this new top-level `describe` at the very end of the file. `Prisma.sql` fragments reach the `$queryRaw` mock as objects with `strings` and `values`, so the assertions look inside those:

```js
describe("selectEligibleDrivers with a free booking", () => {
  const fbOrder = { id: 50, uid: 7, plat: "22.7", plong: "75.8", category: "E-Loader", radius_range: 5, city_id: 3, body_type: "any" };
  const poolFragment = () =>
    prisma.$queryRaw.mock.calls[0].slice(1)
      .filter((v) => v && Array.isArray(v.strings))
      .find((v) => v.strings.join("").includes("AND r.id IN ("));

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([makeRiderRow(9)]);
  });

  it("adds no pool filter for a normal order", async () => {
    freeBookingService.getDispatchPoolFilter.mockResolvedValueOnce(null);
    await dispatchManager.selectEligibleDrivers(fbOrder, 6, []);
    expect(poolFragment()).toBeUndefined();
  });

  it("restricts a free-booking order to the pool riders", async () => {
    freeBookingService.getDispatchPoolFilter.mockResolvedValueOnce([9, 12]);
    await dispatchManager.selectEligibleDrivers(fbOrder, 6, []);
    expect(poolFragment().values).toEqual([9, 12]);
  });

  it("an empty pool matches nobody (never falls through to everyone)", async () => {
    freeBookingService.getDispatchPoolFilter.mockResolvedValueOnce([]);
    await dispatchManager.selectEligibleDrivers(fbOrder, 6, []);
    expect(poolFragment().values).toEqual([0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.test.js -t "free-booking|free booking"`
Expected: the new tests FAIL (no pool fragment in the SQL; `fallbackToNormalDispatch` never called).

- [ ] **Step 3: Add the pool filter to `selectEligibleDrivers`**

At the top of `dispatchManager.js` there is no `freeBookingService` require (it is required lazily to avoid load-order coupling in the many test files that mock `../config/db`). Inside `selectEligibleDrivers`, directly after the `settlementBlock` definition, add:

```js
  // Free Booking Offer: a CONFIRMED free booking is only offered to the city's pool drivers.
  // getDispatchPoolFilter never throws; null means a normal order (no filter).
  const poolIds = await require("./freeBookingService").getDispatchPoolFilter(order);
  const poolBlock = poolIds
    ? Prisma.sql`AND r.id IN (${Prisma.join(poolIds.length ? poolIds : [0])})`
    : Prisma.empty;
```

and insert `${poolBlock}` in the SQL right after `${settlementBlock}`:

```sql
      ${settlementBlock}
      ${poolBlock}
      AND (
        r.wallet_balance IS NULL
```

- [ ] **Step 4: Add the fallback to `checkCascadeTermination`**

Replace the opening of the `if (order && order.rid === 0 && order.order_status === 0) {` block so the fallback runs first:

```js
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  if (order && order.rid === 0 && order.order_status === 0) {
    // Free Booking Offer: the pool is exhausted, so continue as a normal booking (no refund)
    // instead of cancelling. The audit row is flipped atomically, so this happens once.
    let continueAsNormal = false;
    try {
      continueAsNormal = await require("./freeBookingService").fallbackToNormalDispatch(orderId);
    } catch (err) {
      logger.error(`dispatchManager: free-booking fallback failed for order ${orderId}:`, err);
    }
    if (continueAsNormal) {
      activeDispatches.delete(orderId);
      await startDispatch(order, null);
      return;
    }

    try {
      adminSocket.notifyDispatchAlert(orderId, order.city_id);
```

(the rest of the block, the cancel update, refunds, socket emit and push, stays as is).

- [ ] **Step 5: Run the whole dispatch suite**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS, including every pre-existing dispatch test and the five new ones. Other test files that load `dispatchManager` against a mocked `prisma` are unaffected: `getDispatchPoolFilter` catches its own errors and returns `null`, and the fallback call is wrapped in try/catch.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(free-booking): dispatch free bookings to pool drivers only, fall back to normal"
```

---

### Task 7: Lifecycle hooks: accept, complete, settle, referral unlock

**Files:**
- Modify: `backend/src/services/tripLifecycle.js` (require + `finalizeAcceptedOrder` + `updateStatus` complete)
- Modify: `backend/src/services/settlementService.js` (`runTransition`)
- Modify: `backend/src/services/referralRewardService.js` (`awardReferralReward`)
- Test: `backend/src/services/__tests__/settlementFreeBookingHook.test.js`
- Modify test: `backend/src/services/__tests__/referralRewardService.test.js`

**Interfaces:**
- Consumes: `freeBookingService.recordAcceptance(orderId, riderId)`, `markCompleted({ orderId, finalTotal })`, `tryCredit(orderId)`, `unlockForReferral(userId)`.
- Produces: the credit fires after completion and after every settlement transition that lands in `cash_received` / `paid_online`; a completed referral unlocks its USER referrer.

- [ ] **Step 1: Write the failing settlement hook test**

`settlementFreeBookingHook.test.js`:

```js
// Same mock header as settlementService.test.js, plus the free-booking service.
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/socketServer", () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));
jest.mock("../freeBookingService", () => ({ tryCredit: jest.fn().mockResolvedValue({ credited: false }) }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const freeBookingService = require("../freeBookingService");
const settlementService = require("../settlementService");

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const settlement = (status) => ({ id: 1, order_id: 50, uid: 7, rid: 9, status });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
});

describe("runTransition free-booking hook", () => {
  it.each(["cash_received", "paid_online"])("tries the free-booking credit after a transition to %s", async (status) => {
    await settlementService.runTransition(async () => ({ settlement: settlement(status) }));
    await flush();
    expect(freeBookingService.tryCredit).toHaveBeenCalledWith(50);
  });

  it.each(["pending", "disputed", "waived", "customer_owes"])("does not try the credit for %s", async (status) => {
    await settlementService.runTransition(async () => ({ settlement: settlement(status) }));
    await flush();
    expect(freeBookingService.tryCredit).not.toHaveBeenCalled();
  });

  it("does not retry on an alreadyDone no-op", async () => {
    await settlementService.runTransition(async () => ({ settlement: settlement("paid_online"), alreadyDone: true }));
    await flush();
    expect(freeBookingService.tryCredit).not.toHaveBeenCalled();
  });

  it("a failing credit never breaks the settlement transition", async () => {
    freeBookingService.tryCredit.mockRejectedValueOnce(new Error("boom"));
    const out = await settlementService.runTransition(async () => ({ settlement: settlement("paid_online") }));
    await flush();
    expect(out.settlement.status).toBe("paid_online");
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/settlementFreeBookingHook.test.js`
Expected: FAIL (`tryCredit` never called).

- [ ] **Step 3: Hook `runTransition`** in `settlementService.js`. After the existing `if (!result.alreadyDone) emitSettlementUpdated(result.settlement);` line add:

```js
  // Free Booking Offer: a payment that just settled may release a pending wallet credit.
  // tryCredit is idempotent and never throws; this must never affect the settlement itself.
  if (!result.alreadyDone && result.settlement && ["cash_received", "paid_online"].includes(result.settlement.status)) {
    try {
      Promise.resolve(require("./freeBookingService").tryCredit(result.settlement.order_id))
        .catch((err) => logger.error(`free-booking credit after settlement failed for order ${result.settlement.order_id}:`, err));
    } catch (err) {
      logger.error(`free-booking credit after settlement failed for order ${result.settlement.order_id}:`, err);
    }
  }
```

- [ ] **Step 4: Run it to verify it passes, then the existing settlement suites**

Run: `cd backend && npx jest src/services/__tests__/settlementFreeBookingHook.test.js src/services/__tests__/settlementService.test.js src/services/__tests__/settlementReceiverMode.test.js src/services/__tests__/receiverSettlementService.test.js`
Expected: the new suite PASSES. The existing suites can now FAIL on their `logger.error` / call-count assertions, because the real `tryCredit` runs against their mocked `prisma` (no `free_booking_order`), is caught and logs. Fix each failing suite (here and in Steps 6 and 10) by adding this line to its `jest.mock` header, nothing else:

```js
jest.mock("../freeBookingService", () => ({ tryCredit: jest.fn().mockResolvedValue({ credited: false }) }));
```

(For controller suites under `controllers/__tests__/` the path is `../../services/freeBookingService`.)

- [ ] **Step 5: Hook `tripLifecycle.js`**

Add the require with the other service requires (after `const receiverPayCalc = require("./receiverPayCalc");`):

```js
const freeBookingService = require("./freeBookingService");
```

In `finalizeAcceptedOrder`, as the first statement of the function body (before `await dispatchManager.recordModel1Outcome(...)`):

```js
  // Free Booking Offer: remember which driver took the order and void the booking if they are
  // not a pool driver. Fire-and-forget: it must never delay or break the accept.
  freeBookingService.recordAcceptance(orderId, riderId).catch((err) => {
    logger.error(`recordAcceptance error for order ${orderId}:`, err);
  });
```

In `updateStatus`'s complete branch, directly after the `referralRewardService.processReferralRewardsForCompletedOrder(...)` fire-and-forget (which sits after the settlement creation code), add:

```js
    // Fire-and-forget - records the final invoice total for a Free Booking and credits the
    // booker's wallet once the payment is settled (or immediately if nothing is left to collect).
    freeBookingService.markCompleted({ orderId, finalTotal }).catch((err) => {
      logger.error(`freeBooking.markCompleted error for order ${orderId}:`, err);
    });
```

- [ ] **Step 6: Run the tripLifecycle suites**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycleSettlement.test.js src/services/__tests__/paymentCompletionMatrix.test.js src/services/__tests__/cancelPaymentMatrix.test.js`
Expected: PASS. If a suite fails because the real `freeBookingService` runs against a `prisma` mock without `free_booking_order`, add `jest.mock("../freeBookingService", () => ({ recordAcceptance: jest.fn().mockResolvedValue(), markCompleted: jest.fn().mockResolvedValue({ credited: false }), tryCredit: jest.fn().mockResolvedValue({ credited: false }) }));` to that suite's header.

- [ ] **Step 7: Write the failing referral test** (append to `referralRewardService.test.js`)

At the top of the file, after the `jest.mock("../../config/db", ...)` block add:

```js
jest.mock("../freeBookingService", () => ({ unlockForReferral: jest.fn().mockResolvedValue(true) }));
const freeBookingService = require("../freeBookingService");
```

Append inside the existing `describe("referralRewardService.processReferralRewardsForCompletedOrder", ...)` (it already sets `updateMany` to `{ count: 1 }` and a first-order scenario, copy the arrangement of the first test "credits the referrer when the referred customer's FIRST order just completed"):

```js
  it("unlocks the Free Booking benefit of a USER referrer when the referral becomes successful", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(1);
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(freeBookingService.unlockForReferral).toHaveBeenCalledWith(10);
  });

  it("does not unlock anything for a DRIVER referrer", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral({ referrer_type: "DRIVER" }));
    prisma.pkg_order.count.mockResolvedValue(1);
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(freeBookingService.unlockForReferral).not.toHaveBeenCalled();
  });

  it("does not unlock when the referral was already claimed by another process", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral.updateMany.mockResolvedValue({ count: 0 });
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(freeBookingService.unlockForReferral).not.toHaveBeenCalled();
  });

  it("does not unlock when the referred user has no completed order yet (referral stays pending)", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(0);
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(freeBookingService.unlockForReferral).not.toHaveBeenCalled();
  });
```

- [ ] **Step 8: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/referralRewardService.test.js`
Expected: the first new test FAILS (`unlockForReferral` not called); the other two pass trivially.

- [ ] **Step 9: Hook `awardReferralReward`** in `referralRewardService.js`. Directly after the line `if (claimed.count === 0) return 0; // already claimed by another process` add:

```js
    // Free Booking Offer: a successful referral unlocks the referrer's locked benefit. Only an
    // actual pending->completed transition reaches here, and unlockForReferral only flips a
    // locked user, so a referral that completed before the lock can never unlock it.
    if (referral.referrer_type === "USER") {
      require("./freeBookingService").unlockForReferral(referral.referrer_id).catch((err) => {
        logger.error(`unlockForReferral failed for user ${referral.referrer_id}:`, err);
      });
    }
```

(If the referrer is a USER but the `referral_enabled` setting is off or points are 0, `awardReferralReward` returns before this line, so the benefit stays locked. That matches "referral only counts when the referral system actually pays out".)

- [ ] **Step 10: Run the referral suite, then the full backend suite**

Run: `cd backend && npx jest src/services/__tests__/referralRewardService.test.js && npx jest`
Expected: PASS for the referral suite. The full run: every pre-existing suite green. Fix any regression with the `jest.mock("../freeBookingService", ...)` header line described above, nothing else.

- [ ] **Step 11: Commit**

```bash
git add backend/src/services backend/src/controllers/__tests__
git commit -m "feat(free-booking): accept, complete, settlement and referral hooks"
```

---

### Task 8: Admin API

**Files:**
- Create: `backend/src/services/freeBookingAdminService.js`
- Create: `backend/src/controllers/adminFreeBookingController.js`
- Modify: `backend/src/routes/adminRoutes.js`
- Test: `backend/src/services/__tests__/freeBookingAdminService.test.js`

**Interfaces:**
- Consumes: `freeBookingService.voidOrder`, `setUserLock`, `poolRiderIds`; `freeBookingRules.istDateString`.
- Produces (all under `/api/v1/admin`, response shape `{ success, data|message }`):
  - `GET /free-booking/settings?city_id=` -> `data: { city_id, enabled, offer_start, offer_end }`
  - `PUT /free-booking/settings` body `{ city_id?, enabled, offer_start, offer_end }`
  - `GET /free-booking/pool?city_id=` -> `data: [{ id, rider_id, rider_name, vehicle, reg_num, valid_from, valid_to, active }]`
  - `GET /free-booking/pool/candidates?city_id=&q=` -> `data: [{ id, name, mobile, vehicle, reg_num }]`
  - `POST /free-booking/pool` body `{ city_id?, rider_id, valid_from, valid_to }`
  - `PUT /free-booking/pool/:id` body `{ valid_from?, valid_to?, active? }`
  - `DELETE /free-booking/pool/:id`
  - `GET /free-booking/orders?city_id=&status=` -> `data: rows`
  - `POST /free-booking/orders/:id/void`
  - `POST /free-booking/users/:userId/lock` and `.../unlock`
- `freeBookingAdminService` exports: `resolveCityId(user, query, body)`, `getSettings(cityId)`, `saveSettings({ cityId, enabled, offerStart, offerEnd, adminId })`, `listPool(cityId)`, `listCandidates(cityId, q)`, `addToPool({ cityId, riderId, validFrom, validTo, adminId })`, `updatePool(id, cityId, patch)`, `removeFromPool(id, cityId)`, `listOrders({ cityId, status })`, `assertUserInCity(userId, cityId)`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  free_booking_setting: { findUnique: jest.fn(), upsert: jest.fn() },
  free_booking_pool: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  free_booking_order: { findMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findMany: jest.fn() },
  tbl_vehicle_details: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock("../freeBookingService", () => ({ poolRiderIds: jest.fn().mockResolvedValue([]) }));

const prisma = require("../../config/db");
const svc = require("../freeBookingAdminService");

beforeEach(() => jest.resetAllMocks());

describe("resolveCityId", () => {
  it("an admin is bound to their own city regardless of the request", () => {
    expect(svc.resolveCityId({ role: "admin", city_id: 3 }, { city_id: "9" }, { city_id: 9 })).toBe(3);
  });
  it("a superadmin chooses the city from query or body", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, { city_id: "4" }, {})).toBe(4);
    expect(svc.resolveCityId({ role: "superadmin" }, {}, { city_id: 5 })).toBe(5);
  });
  it("a superadmin with no city gets null", () => {
    expect(svc.resolveCityId({ role: "superadmin" }, {}, {})).toBeNull();
  });
});

describe("saveSettings", () => {
  it("rejects enabling without both dates", async () => {
    await expect(svc.saveSettings({ cityId: 3, enabled: true, offerStart: null, offerEnd: null, adminId: 1 })).rejects.toThrow(/start and end/i);
  });
  it("rejects an end before the start", async () => {
    await expect(svc.saveSettings({ cityId: 3, enabled: true, offerStart: "2026-10-10T00:00:00Z", offerEnd: "2026-10-09T00:00:00Z", adminId: 1 })).rejects.toThrow(/after/i);
  });
  it("rejects a missing city", async () => {
    await expect(svc.saveSettings({ cityId: null, enabled: false, adminId: 1 })).rejects.toThrow(/city/i);
  });
  it("upserts a valid setting", async () => {
    prisma.free_booking_setting.upsert.mockResolvedValue({ city_id: 3 });
    await svc.saveSettings({ cityId: 3, enabled: true, offerStart: "2026-10-01T00:00:00Z", offerEnd: "2026-10-31T00:00:00Z", adminId: 1 });
    expect(prisma.free_booking_setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { city_id: 3 },
      create: expect.objectContaining({ city_id: 3, enabled: true, updated_by: 1 }),
    }));
  });
  it("allows turning OFF without dates", async () => {
    prisma.free_booking_setting.upsert.mockResolvedValue({});
    await expect(svc.saveSettings({ cityId: 3, enabled: false, adminId: 1 })).resolves.toBeDefined();
  });
});

describe("addToPool", () => {
  it("rejects a rider from another city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 4, a_status: 1, status: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/city/i);
  });
  it("rejects an unapproved rider", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 0, status: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/approved/i);
  });
  it("rejects bad or reversed dates", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 1, status: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "06-10-2026", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/date/i);
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-10", validTo: "2026-10-06", adminId: 1 })).rejects.toThrow(/date/i);
  });
  it("rejects a rider already in the pool for an overlapping period", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 1, status: 1 });
    prisma.free_booking_pool.findFirst.mockResolvedValue({ id: 1 });
    await expect(svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 })).rejects.toThrow(/already/i);
  });
  it("creates the pool row with the rider's approved vehicle", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 9, city_id: 3, a_status: 1, status: 1 });
    prisma.free_booking_pool.findFirst.mockResolvedValue(null);
    prisma.tbl_vehicle_details.findMany.mockResolvedValue([{ id: 31 }]);
    prisma.free_booking_pool.create.mockResolvedValue({ id: 2 });
    await svc.addToPool({ cityId: 3, riderId: 9, validFrom: "2026-10-06", validTo: "2026-10-10", adminId: 1 });
    expect(prisma.free_booking_pool.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ city_id: 3, rider_id: 9, vehicle_details_id: 31, active: true, added_by: 1 }),
    });
  });
});

describe("updatePool and removeFromPool", () => {
  it("refuse a row from another city", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue({ id: 2, city_id: 4 });
    await expect(svc.updatePool(2, 3, { active: false })).rejects.toThrow(/not found/i);
    await expect(svc.removeFromPool(2, 3)).rejects.toThrow(/not found/i);
    expect(prisma.free_booking_pool.update).not.toHaveBeenCalled();
    expect(prisma.free_booking_pool.delete).not.toHaveBeenCalled();
  });
  it("update toggles active", async () => {
    prisma.free_booking_pool.findUnique.mockResolvedValue({ id: 2, city_id: 3, valid_from: new Date("2026-10-06"), valid_to: new Date("2026-10-10") });
    prisma.free_booking_pool.update.mockResolvedValue({ id: 2 });
    await svc.updatePool(2, 3, { active: false });
    expect(prisma.free_booking_pool.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { active: false } });
  });
});

describe("assertUserInCity", () => {
  it("lets a superadmin (null city) through and blocks an admin on another city's user", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    await expect(svc.assertUserInCity(7, null)).resolves.toBeUndefined();
    await expect(svc.assertUserInCity(7, 3)).rejects.toThrow(/city/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/freeBookingAdminService.test.js`
Expected: FAIL, "Cannot find module '../freeBookingAdminService'".

- [ ] **Step 3: Implement `freeBookingAdminService.js`**

```js
const prisma = require("../config/db");
const freeBookingService = require("./freeBookingService");
const rules = require("./freeBookingRules");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (s) => new Date(`${s}T00:00:00.000Z`);
const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400 });

/** admin = bound to own city; superadmin = chosen city (query or body), null if none given. */
function resolveCityId(user, query = {}, body = {}) {
  if (user?.role !== "superadmin") return user?.city_id != null ? Number(user.city_id) : null;
  const raw = query.city_id ?? body.city_id;
  return raw != null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

const requireCity = (cityId) => {
  if (!cityId) throw bad("A city is required");
};

async function getSettings(cityId) {
  requireCity(cityId);
  const row = await freeBookingService.getCitySetting(cityId);
  return {
    city_id: Number(cityId),
    enabled: Boolean(row?.enabled),
    offer_start: row?.offer_start ?? null,
    offer_end: row?.offer_end ?? null,
  };
}

async function saveSettings({ cityId, enabled, offerStart, offerEnd, adminId }) {
  requireCity(cityId);
  const on = Boolean(enabled);
  let start = null;
  let end = null;
  if (offerStart || offerEnd || on) {
    start = offerStart ? new Date(offerStart) : null;
    end = offerEnd ? new Date(offerEnd) : null;
    if (on && (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))) {
      throw bad("Offer start and end are required to turn the offer ON");
    }
    if (start && end && end.getTime() <= start.getTime()) throw bad("Offer end must be after the start");
  }
  const data = { enabled: on, offer_start: start, offer_end: end, updated_by: adminId ?? null };
  return prisma.free_booking_setting.upsert({
    where: { city_id: Number(cityId) },
    create: { city_id: Number(cityId), ...data },
    update: data,
  });
}

const riderName = (r) => r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`;

async function vehiclesByRider(riderIds) {
  if (!riderIds.length) return new Map();
  const rows = await prisma.tbl_vehicle_details.findMany({
    where: { rider_id: { in: riderIds }, status: 1 },
    select: { id: true, rider_id: true, reg_num: true },
  });
  const map = new Map();
  for (const v of rows) if (!map.has(v.rider_id)) map.set(v.rider_id, v);
  return map;
}

async function listPool(cityId) {
  requireCity(cityId);
  const rows = await prisma.free_booking_pool.findMany({ where: { city_id: Number(cityId) }, orderBy: { id: "desc" } });
  const ids = [...new Set(rows.map((r) => r.rider_id))];
  const [riders, vehicles] = await Promise.all([
    ids.length
      ? prisma.tbl_rider.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true, first_name: true, last_name: true, vehicle: true } })
      : [],
    vehiclesByRider(ids),
  ]);
  const byId = new Map(riders.map((r) => [r.id, r]));
  return rows.map((r) => ({
    id: r.id, rider_id: r.rider_id,
    rider_name: byId.get(r.rider_id) ? riderName(byId.get(r.rider_id)) : `Driver #${r.rider_id}`,
    vehicle: byId.get(r.rider_id)?.vehicle ?? null,
    reg_num: vehicles.get(r.rider_id)?.reg_num ?? null,
    valid_from: r.valid_from, valid_to: r.valid_to, active: r.active,
  }));
}

/** Approved, active riders of the city that are not already in the pool today. */
async function listCandidates(cityId, q = "") {
  requireCity(cityId);
  const inPool = await freeBookingService.poolRiderIds(cityId, rules.istDateString());
  const term = String(q || "").trim();
  const riders = await prisma.tbl_rider.findMany({
    where: {
      city_id: Number(cityId), a_status: 1, status: 1,
      id: { notIn: inPool.length ? inPool : [0] },
      ...(term ? { OR: [{ full_name: { contains: term } }, { first_name: { contains: term } }] } : {}),
    },
    select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, vehicle: true },
    orderBy: { id: "desc" },
    take: 100,
  });
  const vehicles = await vehiclesByRider(riders.map((r) => r.id));
  return riders.map((r) => ({
    id: r.id, name: riderName(r), mobile: r.fmobile, vehicle: r.vehicle, reg_num: vehicles.get(r.id)?.reg_num ?? null,
  }));
}

function checkDates(validFrom, validTo) {
  if (!DATE_RE.test(String(validFrom)) || !DATE_RE.test(String(validTo)) || validTo < validFrom) {
    throw bad("Valid dates are required (YYYY-MM-DD), and the end date cannot be before the start date");
  }
}

async function addToPool({ cityId, riderId, validFrom, validTo, adminId }) {
  requireCity(cityId);
  checkDates(validFrom, validTo);
  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { id: true, city_id: true, a_status: true, status: true } });
  if (!rider) throw bad("Driver not found");
  if (Number(rider.city_id) !== Number(cityId)) throw bad("This driver belongs to another city");
  if (Number(rider.a_status) !== 1 || Number(rider.status) !== 1) throw bad("Only approved, active drivers can join the pool");

  const overlap = await prisma.free_booking_pool.findFirst({
    where: {
      city_id: Number(cityId), rider_id: Number(riderId), active: true,
      valid_from: { lte: asDate(validTo) }, valid_to: { gte: asDate(validFrom) },
    },
  });
  if (overlap) throw bad("This driver is already in the pool for an overlapping period");

  const vehicles = await vehiclesByRider([Number(riderId)]);
  return prisma.free_booking_pool.create({
    data: {
      city_id: Number(cityId), rider_id: Number(riderId),
      vehicle_details_id: vehicles.get(Number(riderId))?.id ?? null,
      valid_from: asDate(validFrom), valid_to: asDate(validTo), active: true, added_by: adminId ?? null,
    },
  });
}

async function ownedPoolRow(id, cityId) {
  const row = await prisma.free_booking_pool.findUnique({ where: { id: Number(id) } });
  if (!row || Number(row.city_id) !== Number(cityId)) throw Object.assign(new Error("Pool entry not found"), { statusCode: 404 });
  return row;
}

async function updatePool(id, cityId, patch = {}) {
  const row = await ownedPoolRow(id, cityId);
  const data = {};
  if (patch.active !== undefined) data.active = Boolean(patch.active);
  if (patch.valid_from !== undefined || patch.valid_to !== undefined) {
    const from = patch.valid_from ?? row.valid_from.toISOString().slice(0, 10);
    const to = patch.valid_to ?? row.valid_to.toISOString().slice(0, 10);
    checkDates(from, to);
    data.valid_from = asDate(from);
    data.valid_to = asDate(to);
  }
  return prisma.free_booking_pool.update({ where: { id: Number(id) }, data });
}

async function removeFromPool(id, cityId) {
  await ownedPoolRow(id, cityId);
  await prisma.free_booking_pool.delete({ where: { id: Number(id) } });
}

async function listOrders({ cityId, status }) {
  return prisma.free_booking_order.findMany({
    where: { ...(cityId ? { city_id: Number(cityId) } : {}), ...(status ? { status } : {}) },
    orderBy: { id: "desc" },
    take: 200,
  });
}

/** A city-bound admin may only lock/unlock customers of their own city (null cityId = superadmin). */
async function assertUserInCity(userId, cityId) {
  if (!cityId) return;
  const user = await prisma.tbl_user.findUnique({ where: { id: Number(userId) }, select: { id: true, city_id: true } });
  if (!user || Number(user.city_id) !== Number(cityId)) throw bad("This customer belongs to another city");
}

module.exports = {
  resolveCityId, getSettings, saveSettings, listPool, listCandidates,
  addToPool, updatePool, removeFromPool, listOrders, assertUserInCity,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/freeBookingAdminService.test.js`
Expected: PASS.

- [ ] **Step 5: Implement the controller** `backend/src/controllers/adminFreeBookingController.js`

```js
const logger = require("../utils/logger");
const admin = require("../services/freeBookingAdminService");
const freeBookingService = require("../services/freeBookingService");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminFreeBooking.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
const cityOf = (req) => admin.resolveCityId(req.user, req.query, req.body);
// A city-bound admin always has a city; a superadmin has one only if they picked it.
const scopeCity = (req) => (req.user.role === "superadmin" ? null : cityOf(req));

const getSettings = async (req, res) => {
  try { return res.json({ success: true, data: await admin.getSettings(cityOf(req)) }); } catch (e) { return fail(res, e, "getSettings"); }
};
const saveSettings = async (req, res) => {
  try {
    await admin.saveSettings({
      cityId: cityOf(req), enabled: req.body.enabled, offerStart: req.body.offer_start, offerEnd: req.body.offer_end, adminId: req.user?.id,
    });
    return res.json({ success: true, message: "Free Booking settings saved", data: await admin.getSettings(cityOf(req)) });
  } catch (e) { return fail(res, e, "saveSettings"); }
};
const listPool = async (req, res) => {
  try { return res.json({ success: true, data: await admin.listPool(cityOf(req)) }); } catch (e) { return fail(res, e, "listPool"); }
};
const listCandidates = async (req, res) => {
  try { return res.json({ success: true, data: await admin.listCandidates(cityOf(req), req.query.q) }); } catch (e) { return fail(res, e, "listCandidates"); }
};
const addToPool = async (req, res) => {
  try {
    const row = await admin.addToPool({
      cityId: cityOf(req), riderId: req.body.rider_id, validFrom: req.body.valid_from, validTo: req.body.valid_to, adminId: req.user?.id,
    });
    return res.status(201).json({ success: true, message: "Driver added to the offer pool", data: row });
  } catch (e) { return fail(res, e, "addToPool"); }
};
const updatePool = async (req, res) => {
  try {
    const row = await admin.updatePool(req.params.id, cityOf(req), req.body);
    return res.json({ success: true, message: "Pool entry updated", data: row });
  } catch (e) { return fail(res, e, "updatePool"); }
};
const removeFromPool = async (req, res) => {
  try { await admin.removeFromPool(req.params.id, cityOf(req)); return res.json({ success: true, message: "Removed from the offer pool" }); } catch (e) { return fail(res, e, "removeFromPool"); }
};
const listOrders = async (req, res) => {
  try { return res.json({ success: true, data: await admin.listOrders({ cityId: cityOf(req), status: req.query.status }) }); } catch (e) { return fail(res, e, "listOrders"); }
};
const voidOrder = async (req, res) => {
  try {
    const ok = await freeBookingService.voidOrder(req.params.id);
    if (!ok) return res.status(409).json({ success: false, message: "This booking is no longer open" });
    return res.json({ success: true, message: "Free booking voided" });
  } catch (e) { return fail(res, e, "voidOrder"); }
};
const setLock = (locked) => async (req, res) => {
  try {
    await admin.assertUserInCity(req.params.userId, scopeCity(req));
    await freeBookingService.setUserLock(req.params.userId, locked);
    return res.json({ success: true, message: locked ? "Free Booking locked for this customer" : "Free Booking unlocked for this customer" });
  } catch (e) { return fail(res, e, locked ? "lock" : "unlock"); }
};

module.exports = {
  getSettings, saveSettings, listPool, listCandidates, addToPool, updatePool, removeFromPool,
  listOrders, voidOrder, lockUser: setLock(true), unlockUser: setLock(false),
};
```

`orders/:id/void` for a city-bound admin: scope the order to the admin's city inside `voidOrder` handler by loading the row first. Add before `freeBookingService.voidOrder`:

```js
    const scope = scopeCity(req);
    if (scope) {
      const rows = await admin.listOrders({ cityId: scope });
      if (!rows.some((r) => String(r.id) === String(req.params.id))) return res.status(404).json({ success: false, message: "Booking not found" });
    }
```

- [ ] **Step 6: Register the routes** in `adminRoutes.js`. With the other requires:

```js
const adminFreeBookingController = require("../controllers/adminFreeBookingController");
```

Directly after the `daily-driver` routes (after the `force-assign` line):

```js
// Free Booking Offer (spec 2026-10-06)
router.get("/free-booking/settings", auth, authorize(...RIDER_ROLES), adminFreeBookingController.getSettings);
router.put("/free-booking/settings", auth, authorize("superadmin", "admin"), adminFreeBookingController.saveSettings);
router.get("/free-booking/pool", auth, authorize(...RIDER_ROLES), adminFreeBookingController.listPool);
router.get("/free-booking/pool/candidates", auth, authorize(...RIDER_ROLES), adminFreeBookingController.listCandidates);
router.post("/free-booking/pool", auth, authorize("superadmin", "admin"), adminFreeBookingController.addToPool);
router.put("/free-booking/pool/:id", auth, authorize("superadmin", "admin"), adminFreeBookingController.updatePool);
router.delete("/free-booking/pool/:id", auth, authorize("superadmin", "admin"), adminFreeBookingController.removeFromPool);
router.get("/free-booking/orders", auth, authorize(...RIDER_ROLES), adminFreeBookingController.listOrders);
router.post("/free-booking/orders/:id/void", auth, authorize("superadmin", "admin"), adminFreeBookingController.voidOrder);
router.post("/free-booking/users/:userId/lock", auth, authorize("superadmin", "admin"), adminFreeBookingController.lockUser);
router.post("/free-booking/users/:userId/unlock", auth, authorize("superadmin", "admin"), adminFreeBookingController.unlockUser);
```

Because `/free-booking/pool/candidates` is registered after `/free-booking/pool` (a different path) and before `/pool/:id` (PUT/DELETE only), there is no GET conflict.

- [ ] **Step 7: Smoke-load the app and run the suites**

Run: `cd backend && node -e "require('./src/routes/adminRoutes'); console.log('routes load ok')" && npx jest src/services/__tests__/freeBookingAdminService.test.js`
Expected: "routes load ok", tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/freeBookingAdminService.js backend/src/controllers/adminFreeBookingController.js backend/src/routes/adminRoutes.js backend/src/services/__tests__/freeBookingAdminService.test.js
git commit -m "feat(free-booking): admin API for city settings, offer pool and lock override"
```

---

### Task 9: Admin panel page

**Files:**
- Create: `frontend/src/pages/FreeBookingOffer.jsx`
- Modify: `frontend/src/App.jsx` (lazy import + route)
- Modify: `frontend/src/config/navigation.js` (icon import + nav item)

**Interfaces:**
- Consumes: the Task 8 endpoints through `api` (`baseURL` already `/api/v1/admin`), `useAuth().hasRole`, `useToast()`.
- Produces: page at `/free-booking`, visible to all staff, write controls only for `superadmin|admin`.

- [ ] **Step 1: Create the page** `frontend/src/pages/FreeBookingOffer.jsx`

```jsx
import { useCallback, useEffect, useState } from 'react'
import { Gift, Plus, Trash2, Lock, Unlock, Ban } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const TABS = [
  { id: 'settings', label: 'Settings' },
  { id: 'pool', label: 'Offer Pool' },
  { id: 'bookings', label: 'Bookings & Users' },
]

const inputClass = 'mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const cardStyle = { background: 'var(--surface)', borderColor: 'var(--border)' }

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{label}</label>
      {children}
    </div>
  )
}

// <input type="datetime-local"> works in the browser's local time; the API stores UTC.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)
const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '')
const errMsg = (err, fallback) => err?.response?.data?.message || fallback

export default function FreeBookingOffer() {
  const toast = useToast()
  const { user, hasRole } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const canWrite = hasRole('superadmin', 'admin')

  const [tab, setTab] = useState('settings')
  const [cities, setCities] = useState([])
  const [cityId, setCityId] = useState(isSuper ? '' : String(user?.city_id ?? ''))

  const [settings, setSettings] = useState({ enabled: false, offer_start: '', offer_end: '' })
  const [pool, setPool] = useState([])
  const [candidates, setCandidates] = useState([])
  const [orders, setOrders] = useState([])
  const [addForm, setAddForm] = useState({ rider_id: '', valid_from: '', valid_to: '' })
  const [lockUserId, setLockUserId] = useState('')

  const params = useCallback(() => (isSuper ? { city_id: cityId } : {}), [isSuper, cityId])
  const ready = Boolean(cityId)

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities').then((res) => setCities(res.data?.data || res.data || [])).catch(() => {})
  }, [isSuper])

  const loadSettings = useCallback(() => {
    if (!ready) return
    api.get('/free-booking/settings', { params: params() })
      .then((res) => {
        const d = res.data.data
        setSettings({ enabled: d.enabled, offer_start: toLocalInput(d.offer_start), offer_end: toLocalInput(d.offer_end) })
      })
      .catch((err) => toast.error?.(errMsg(err, 'Could not load settings')))
  }, [ready, params, toast])

  const loadPool = useCallback(() => {
    if (!ready) return
    api.get('/free-booking/pool', { params: params() }).then((res) => setPool(res.data.data || [])).catch(() => {})
    api.get('/free-booking/pool/candidates', { params: params() }).then((res) => setCandidates(res.data.data || [])).catch(() => {})
  }, [ready, params])

  const loadOrders = useCallback(() => {
    if (!ready) return
    api.get('/free-booking/orders', { params: params() }).then((res) => setOrders(res.data.data || [])).catch(() => {})
  }, [ready, params])

  useEffect(() => {
    if (tab === 'settings') loadSettings()
    if (tab === 'pool') loadPool()
    if (tab === 'bookings') loadOrders()
  }, [tab, loadSettings, loadPool, loadOrders])

  async function saveSettings(e) {
    e.preventDefault()
    try {
      await api.put('/free-booking/settings', {
        ...params(),
        enabled: settings.enabled,
        offer_start: fromLocalInput(settings.offer_start),
        offer_end: fromLocalInput(settings.offer_end),
      })
      toast.success?.('Free Booking settings saved')
      loadSettings()
    } catch (err) {
      toast.error?.(errMsg(err, 'Could not save settings'))
    }
  }

  async function addToPool(e) {
    e.preventDefault()
    try {
      await api.post('/free-booking/pool', { ...params(), ...addForm })
      toast.success?.('Driver added to the offer pool')
      setAddForm({ rider_id: '', valid_from: '', valid_to: '' })
      loadPool()
    } catch (err) {
      toast.error?.(errMsg(err, 'Could not add driver'))
    }
  }

  async function togglePool(row) {
    try {
      await api.put(`/free-booking/pool/${row.id}`, { ...params(), active: !row.active })
      loadPool()
    } catch (err) {
      toast.error?.(errMsg(err, 'Could not update'))
    }
  }

  async function removePool(row) {
    try {
      await api.delete(`/free-booking/pool/${row.id}`, { params: params() })
      toast.success?.('Removed from the offer pool')
      loadPool()
    } catch (err) {
      toast.error?.(errMsg(err, 'Could not remove'))
    }
  }

  async function voidBooking(row) {
    try {
      await api.post(`/free-booking/orders/${row.id}/void`, { ...params() })
      toast.success?.('Free booking voided')
      loadOrders()
    } catch (err) {
      toast.error?.(errMsg(err, 'Could not void'))
    }
  }

  async function setLock(locked) {
    if (!lockUserId) return
    try {
      await api.post(`/free-booking/users/${lockUserId}/${locked ? 'lock' : 'unlock'}`, { ...params() })
      toast.success?.(locked ? 'Locked' : 'Unlocked')
    } catch (err) {
      toast.error?.(errMsg(err, 'Could not change the lock'))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift size={22} style={{ color: 'var(--ink)' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>Free Booking Offer</h1>
        </div>
        {isSuper && (
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass} style={{ ...inputStyle, width: 220, marginTop: 0 }}>
            <option value="">Select a city…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ ...cardStyle, color: 'var(--ink)', opacity: tab === t.id ? 1 : 0.6 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!ready && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Select a city to manage the offer.</p>}

      {ready && tab === 'settings' && (
        <form onSubmit={saveSettings} className="rounded-2xl border p-5 space-y-4 max-w-xl" style={cardStyle}>
          <label className="flex items-center gap-3 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" disabled={!canWrite} checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
            Free Booking Offer is {settings.enabled ? 'ON' : 'OFF'} for this city
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Offer starts">
              <input type="datetime-local" disabled={!canWrite} value={settings.offer_start} onChange={(e) => setSettings({ ...settings, offer_start: e.target.value })} className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Offer ends">
              <input type="datetime-local" disabled={!canWrite} value={settings.offer_end} onChange={(e) => setSettings({ ...settings, offer_end: e.target.value })} className={inputClass} style={inputStyle} />
            </Field>
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>The offer only applies between these two times, and only while it is ON.</p>
          {canWrite && <button type="submit" className="rounded-xl px-4 py-2 text-sm font-semibold text-white bg-emerald-600">Save</button>}
        </form>
      )}

      {ready && tab === 'pool' && (
        <div className="space-y-4">
          {canWrite && (
            <form onSubmit={addToPool} className="rounded-2xl border p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end" style={cardStyle}>
              <Field label="Driver / vehicle">
                <select required value={addForm.rider_id} onChange={(e) => setAddForm({ ...addForm, rider_id: e.target.value })} className={inputClass} style={inputStyle}>
                  <option value="">Select…</option>
                  {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.vehicle}{c.reg_num ? ` · ${c.reg_num}` : ''}</option>)}
                </select>
              </Field>
              <Field label="Valid from">
                <input type="date" required value={addForm.valid_from} onChange={(e) => setAddForm({ ...addForm, valid_from: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Valid to">
                <input type="date" required value={addForm.valid_to} onChange={(e) => setAddForm({ ...addForm, valid_to: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
              <button type="submit" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 flex items-center justify-center gap-1"><Plus size={16} /> Add to pool</button>
            </form>
          )}
          <div className="rounded-2xl border overflow-x-auto" style={cardStyle}>
            <table className="w-full text-sm" style={{ color: 'var(--ink)' }}>
              <thead><tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                <th className="p-3">Driver</th><th className="p-3">Vehicle</th><th className="p-3">Valid</th><th className="p-3">Active</th><th className="p-3" />
              </tr></thead>
              <tbody>
                {pool.length === 0 && <tr><td className="p-3" colSpan={5}>No vehicles in the pool yet.</td></tr>}
                {pool.map((row) => (
                  <tr key={row.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3">{row.rider_name}</td>
                    <td className="p-3">{row.vehicle}{row.reg_num ? ` · ${row.reg_num}` : ''}</td>
                    <td className="p-3">{dateOnly(row.valid_from)} → {dateOnly(row.valid_to)}</td>
                    <td className="p-3"><input type="checkbox" disabled={!canWrite} checked={row.active} onChange={() => togglePool(row)} /></td>
                    <td className="p-3 text-right">{canWrite && <button onClick={() => removePool(row)} title="Remove from pool"><Trash2 size={16} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ready && tab === 'bookings' && (
        <div className="space-y-4">
          {canWrite && (
            <div className="rounded-2xl border p-5 flex flex-wrap items-end gap-3" style={cardStyle}>
              <Field label="Customer ID (manual lock / unlock)">
                <input type="number" value={lockUserId} onChange={(e) => setLockUserId(e.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <button onClick={() => setLock(true)} className="rounded-xl px-4 py-2.5 text-sm font-semibold border flex items-center gap-1" style={{ color: 'var(--ink)', borderColor: 'var(--border)' }}><Lock size={16} /> Lock</button>
              <button onClick={() => setLock(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 flex items-center gap-1"><Unlock size={16} /> Unlock</button>
            </div>
          )}
          <div className="rounded-2xl border overflow-x-auto" style={cardStyle}>
            <table className="w-full text-sm" style={{ color: 'var(--ink)' }}>
              <thead><tr className="text-left text-xs" style={{ color: 'var(--ink-muted)' }}>
                <th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Status</th><th className="p-3">Fare</th><th className="p-3">Credit</th><th className="p-3">Reason</th><th className="p-3" />
              </tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td className="p-3" colSpan={7}>No free bookings yet.</td></tr>}
                {orders.map((o) => (
                  <tr key={o.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="p-3">#{o.order_id}</td>
                    <td className="p-3">#{o.user_id}</td>
                    <td className="p-3">{o.status.replace('FREE_BOOKING_', '')}</td>
                    <td className="p-3">{o.actual_fare ?? '-'}</td>
                    <td className="p-3">{o.credit_amount ?? '-'}</td>
                    <td className="p-3">{o.not_eligible_reason ?? ''}</td>
                    <td className="p-3 text-right">
                      {canWrite && ['FREE_BOOKING_CONFIRMED', 'FREE_BOOKING_REWARD_PENDING'].includes(o.status) && (
                        <button onClick={() => voidBooking(o)} title="Void this free booking"><Ban size={16} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the route** in `frontend/src/App.jsx`. With the other lazy imports (after `const DailyDrivers = ...`):

```jsx
const FreeBookingOffer = lazy(() => import('./pages/FreeBookingOffer'))
```

and after `<Route path="/daily-drivers" element={<DailyDrivers />} />`:

```jsx
            <Route path="/free-booking" element={<FreeBookingOffer />} />
```

- [ ] **Step 3: Add the nav item** in `frontend/src/config/navigation.js`: add `Gift,` to the `lucide-react` import list, and after the `Daily Drivers` line:

```js
      { to: '/free-booking', label: 'Free Booking Offer', icon: Gift, roles: ALL_STAFF, built: true },
```

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npx eslint src/pages/FreeBookingOffer.jsx src/App.jsx src/config/navigation.js && npm run build`
Expected: no lint errors, build succeeds. (`toast.error?.`/`toast.success?.` guard against the toast API shape; open `frontend/src/context/ToastContext.jsx` and use its actual method names if they differ, and keep the optional calls.)

- [ ] **Step 5: Manual check in the browser**

Run: `cd frontend && npm run dev`, open the printed URL, log in as superadmin, open "Free Booking Offer": pick a city, save settings with dates, add a driver to the pool, toggle and remove it. Log in as a city admin and confirm the city picker is hidden and only their city shows.
Expected: all actions succeed with toasts; the admin sees no city picker.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/FreeBookingOffer.jsx frontend/src/App.jsx frontend/src/config/navigation.js
git commit -m "feat(free-booking): admin panel page for city settings, offer pool and bookings"
```

---

### Task 10: Customer app (Flutter)

**Files:**
- Create: `ShifterOnline/lib/services/free_booking_api_service.dart`
- Create: `ShifterOnline/lib/screens/home/free_booking_dialogs.dart`
- Create: `ShifterOnline/lib/screens/profile/free_booking_status_card.dart`
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (`_bookSelected`, `_submitOrder`)
- Modify: `ShifterOnline/lib/screens/profile/premium_plans_screen.dart` (show the status card)

`ShifterOnline/` is partly gitignored: commit with `git add -f` and the exact file paths only.

**Interfaces:**
- Consumes: `POST api/order/free-booking/check` -> `{ outcome, message }`; `POST api/order/free-booking/status` -> `{ state, message }`; `POST api/order/create` accepts `free_booking: true` and answers `code: "FREE_BOOKING_UNAVAILABLE"` (HTTP 409).
- Produces: `FreeBookingApiService.check(...)`, `FreeBookingApiService.status(uid)`, `showFreeBookingAppliedDialog()`, `showNoFreeVehicleDialog()` (both `Future<bool>`: true = continue), `FreeBookingStatusCard`.

- [ ] **Step 1: Create the API service** `lib/services/free_booking_api_service.dart`

```dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';

/// Free Booking Offer calls (backend: /api/order/free-booking/*).
/// Like the other customer endpoints these trust the posted `uid` (known app-wide gap).
class FreeBookingApiService {
  FreeBookingApiService._();

  static Future<Map<String, dynamic>> _post(String endpoint, Map<String, dynamic> body) async {
    try {
      final response = await http.post(
        Uri.parse('${Config.nodeBaseUrl}/$endpoint'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
      final json = jsonDecode(response.body);
      if (json is Map<String, dynamic>) return json;
    } catch (e) {
      debugPrint('FreeBooking $endpoint failed: $e');
    }
    return {'Result': 'false'};
  }

  /// outcome: eligible | no_free_vehicle | locked | not_premium | offer_off | open_booking.
  /// Any failure returns 'offer_off', so a network problem never blocks a normal booking.
  static Future<Map<String, dynamic>> check({
    required int uid,
    required double plat,
    required double plong,
    required String category,
    required int radiusKm,
    required int bookingType,
  }) async {
    final json = await _post('api/order/free-booking/check', {
      'uid': uid, 'plat': plat, 'plong': plong, 'category': category,
      'radius_km': radiusKm, 'booking_type': bookingType,
    });
    final ok = json['Result'] == true || json['Result'] == 'true';
    return {
      'outcome': ok ? (json['outcome']?.toString() ?? 'offer_off') : 'offer_off',
      'message': json['message']?.toString() ?? '',
    };
  }

  /// state: available | unlocked | locked | not_premium | offer_off | open_booking.
  static Future<Map<String, dynamic>> status(int uid) async {
    final json = await _post('api/order/free-booking/status', {'uid': uid});
    final ok = json['Result'] == true || json['Result'] == 'true';
    return {
      'state': ok ? (json['state']?.toString() ?? 'offer_off') : 'offer_off',
      'message': json['message']?.toString() ?? '',
    };
  }
}
```

- [ ] **Step 2: Create the dialogs** `lib/screens/home/free_booking_dialogs.dart`

```dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';

Future<bool> _confirmDialog({
  required IconData icon,
  required Color color,
  required String title,
  required String message,
  required String continueLabel,
  required String cancelLabel,
}) async {
  final result = await Get.dialog<bool>(
    Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle),
              child: Icon(icon, color: color, size: 36),
            ),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, height: 1.4)),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(child: OutlinedButton(onPressed: () => Get.back(result: false), child: Text(cancelLabel))),
                const SizedBox(width: 12),
                Expanded(child: ElevatedButton(onPressed: () => Get.back(result: true), child: Text(continueLabel))),
              ],
            ),
          ],
        ),
      ),
    ),
    barrierDismissible: false,
  );
  return result ?? false;
}

/// Eligible: the booking will be a Free Booking. True = continue.
Future<bool> showFreeBookingAppliedDialog() => _confirmDialog(
      icon: Icons.card_giftcard_rounded,
      color: Colors.green,
      title: 'Free Booking applied'.tr,
      message: 'After the trip is completed and paid, the full trip amount will be credited to your Shifter wallet.'.tr,
      continueLabel: 'Continue'.tr,
      cancelLabel: 'Cancel'.tr,
    );

/// No pool vehicle in range: the refund will NOT be given. True = proceed with the paid vehicle.
Future<bool> showNoFreeVehicleDialog() => _confirmDialog(
      icon: Icons.warning_amber_rounded,
      color: Colors.orange.shade800,
      title: 'No free vehicle available'.tr,
      message: 'A free vehicle is not available near your pickup right now. If you continue with a paid vehicle you will NOT receive any refund for this trip.'.tr,
      continueLabel: 'Continue (no refund)'.tr,
      cancelLabel: 'Cancel'.tr,
    );
```

- [ ] **Step 3: Create the status card** `lib/screens/profile/free_booking_status_card.dart`

```dart
import 'package:flutter/material.dart';
import 'package:get_storage/get_storage.dart';
import '../../services/free_booking_api_service.dart';

/// Shows the customer's Free Booking state. Hidden for non-premium users and when the offer is off.
class FreeBookingStatusCard extends StatefulWidget {
  const FreeBookingStatusCard({super.key});

  @override
  State<FreeBookingStatusCard> createState() => _FreeBookingStatusCardState();
}

class _FreeBookingStatusCardState extends State<FreeBookingStatusCard> {
  String _state = 'offer_off';
  String _message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final uid = int.tryParse(GetStorage().read('Uid')?.toString() ?? '') ?? 0;
    if (uid == 0) return;
    final result = await FreeBookingApiService.status(uid);
    if (!mounted) return;
    setState(() {
      _state = result['state'] as String;
      _message = result['message'] as String;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_state == 'offer_off' || _state == 'not_premium' || _message.isEmpty) return const SizedBox.shrink();
    final good = _state == 'available' || _state == 'unlocked';
    final color = good ? Colors.green : Colors.orange.shade800;
    final title = switch (_state) {
      'available' => 'Free Booking Available',
      'unlocked' => 'Free Booking Unlocked',
      'locked' => 'Free Booking Locked',
      _ => 'Free Booking',
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(good ? Icons.card_giftcard_rounded : Icons.lock_outline_rounded, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: color)),
                const SizedBox(height: 4),
                Text(_message, style: const TextStyle(fontSize: 13, height: 1.35)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Wire `select_vehicle.dart`**

Add imports with the others:

```dart
import '../../services/free_booking_api_service.dart';
import 'free_booking_dialogs.dart';
```

Add a field next to `_booking`/`_selectedRadiusKm`:

```dart
  bool _freeBookingRequested = false;
```

In `_bookSelected`, immediately after the `maxStops` check block and before `final walletBalance = await _fetchWalletBalance();`:

```dart
    // Free Booking Offer: only instant bookings, and only for premium customers (the server decides).
    _freeBookingRequested = false;
    if (_currentBookingType == 1) {
      final uid = int.tryParse(_storage.read('Uid')?.toString() ?? '') ?? 0;
      final fb = await FreeBookingApiService.check(
        uid: uid, plat: _pickup.latitude, plong: _pickup.longitude,
        category: _text(_categoryOf(selected)['cat_name'] ?? _categoryOf(selected)['name'], _vehicleName(selected)),
        radiusKm: _selectedRadiusKm, bookingType: _currentBookingType,
      );
      if (!mounted) return;
      if (fb['outcome'] == 'eligible') {
        if (!await showFreeBookingAppliedDialog()) return;
        _freeBookingRequested = true;
      } else if (fb['outcome'] == 'no_free_vehicle') {
        if (!await showNoFreeVehicleDialog()) return;
      }
    }
```

In `_submitOrder`'s request body, next to the `receiver_pays` entry:

```dart
      if (_freeBookingRequested) 'free_booking': true,
```

In `_submitOrder`'s failure branch, before the `isSettlementBlock` handling (`final msg = ...` stays above), add:

```dart
      if (response is Map && response['code']?.toString() == 'FREE_BOOKING_UNAVAILABLE') {
        // The pool vehicle went away between the check and the booking: ask again, then book normally.
        _freeBookingRequested = false;
        if (await showNoFreeVehicleDialog()) {
          await _submitOrder(payValue, category, model, fee, receiverPay);
        }
        return;
      }
```

Because `_booking` is reset to `false` just before this branch, the recursive call is allowed to run.

- [ ] **Step 5: Show the status card** in `premium_plans_screen.dart`: add `import '../../screens/profile/free_booking_status_card.dart';` (or the relative `free_booking_status_card.dart` since both files are in `lib/screens/profile/`) and insert `const FreeBookingStatusCard(),` as the first child of the `Column` inside the `SingleChildScrollView` near line 552-555 (open the file and confirm that is the main plan list column before inserting).

- [ ] **Step 6: Analyze**

Run: `cd ShifterOnline && flutter analyze lib/services/free_booking_api_service.dart lib/screens/home/free_booking_dialogs.dart lib/screens/profile/free_booking_status_card.dart lib/screens/home/select_vehicle.dart lib/screens/profile/premium_plans_screen.dart`
Expected: no new errors (pre-existing warnings in the two large files are fine; do not fix them).

- [ ] **Step 7: Manual check against the dev backend**

With the backend running against the dev DB: make a premium test user, turn the city ON in the admin page, add one online E-Loader driver to the pool, then book in the app.
- With the pool driver online and near: the "Free Booking applied" dialog appears; order is created; `free_booking_order` has a CONFIRMED row; only that driver gets the popup.
- With the pool driver offline: the "No free vehicle" dialog appears with the no-refund warning; Continue books normally and no row is written.
- Complete the trip as the pool driver and settle payment: the wallet shows the credit, the premium screen shows "Free Booking Locked".
Expected: all three behaviors as described.

- [ ] **Step 8: Commit**

```bash
git add -f ShifterOnline/lib/services/free_booking_api_service.dart ShifterOnline/lib/screens/home/free_booking_dialogs.dart ShifterOnline/lib/screens/profile/free_booking_status_card.dart ShifterOnline/lib/screens/home/select_vehicle.dart ShifterOnline/lib/screens/profile/premium_plans_screen.dart
git commit -m "feat(free-booking): customer app check, dialogs, order flag and status card"
```

---

### Task 11: Full verification and handoff notes

**Files:**
- Create: `C:\Users\alkvi\.claude\projects\c--Users-alkvi-OneDrive-Desktop-Shifter-Online\memory\free_booking_offer.md` and a pointer line in `MEMORY.md`

- [ ] **Step 1: Run the whole backend suite**

Run: `cd backend && npx jest`
Expected: every suite green (the new `freeBooking*`, `settlementFreeBookingHook`, `orderController.freeBooking` suites and the new `dispatchManager` tests included).

- [ ] **Step 2: End-to-end walk through on the dev DB** (backend running, admin and customer app as in Task 10)

Walk the happy path and each void path, checking `free_booking_order` and `tbl_wallet_history` after each:
1. Eligible booking, pool driver completes, cash received -> `REWARD_CREDITED`, wallet +fare, user locked; booking again shows "locked" (no dialog, normal flow).
2. Eligible booking, user cancels before pickup -> row stays CONFIRMED but does not block a new free booking (open-booking query); on complete of a later order nothing happens to it.
3. Eligible booking, no pool driver accepts until the cascade is exhausted -> `NOT_ELIGIBLE (pool_unavailable)`, order continues as a normal dispatch, customer notified.
4. Complete a referral for the locked user (new user signs up with their code and completes a first ride) -> user unlocked, status shows "Free Booking Unlocked" once.
5. Admin: toggle city OFF -> next check returns `offer_off`; void an open booking; manual lock/unlock.
Expected: each ends in the state listed.

- [ ] **Step 3: Save the project memory** — create `free_booking_offer.md`:

```markdown
---
name: free-booking-offer
description: Free Booking Offer for premium customers — pool vehicles, wallet credit after trip, lock until a successful referral; built 2026-10-06/07
metadata:
  type: project
---

Premium (CUSTOMER_PREMIUM) customers who book an INSTANT trip served by an admin-defined "offer pool" vehicle get the full final invoice credited to `tbl_user.wallet` after the trip is completed and paid; fare/invoice/receiver payment are unchanged. After one credit the user is locked (`tbl_user.free_booking_locked`) until a referral they made becomes `completed` (auto-unlock in `referralRewardService.awardReferralReward`), or an admin unlocks.

Spec/plan: `docs/superpowers/specs/2026-10-06-free-booking-offer-design.md`, `docs/superpowers/plans/2026-10-06-free-booking-offer.md`. Tables: `free_booking_setting` (per city ON/OFF + timeline), `free_booking_pool`, `free_booking_order`. Code: `freeBookingRules.js` (pure), `freeBookingService.js`, `freeBookingAdminService.js`, hooks in `orderController.createOrderCore`, `dispatchManager` (pool filter + fallback in `checkCascadeTermination`), `tripLifecycle` (accept + complete), `settlementService.runTransition`.

**Why:** product wants a premium perk without discounting the fare. **How to apply:** prod needs migration `20261006030000_add_free_booking_offer` run by the user before deploying; the credit is the full invoice even when a coupon/referral points paid part of it (flagged to the user); customer routes trust `uid` like the rest of the app ([[order_dispatch_auth_gap]]).
```

and add `- [Free Booking Offer](free_booking_offer.md) — premium pool-vehicle wallet credit, lock until referral; prod SQL 20261006030000 pending` to `MEMORY.md`.

- [ ] **Step 4: Final commit**

```bash
git status
git add docs
git commit -m "docs: free booking offer plan"
```

(Memory files live outside the repo and are not committed.)
