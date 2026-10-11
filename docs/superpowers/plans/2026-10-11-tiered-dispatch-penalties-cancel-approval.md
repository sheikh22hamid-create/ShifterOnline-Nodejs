# Tiered Dispatch, Penalties and Cancel Approval - Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer every order to drivers in the order Free -> Daily -> Normal (Free Booking orders) or Daily -> Normal (all other orders), with the popup going to up to 4 drivers of a stage at the same time (first accept wins), charge escalating percentage penalties to Free/Daily drivers who reject or skip (never to a driver whose offer someone else took), and require admin approval before a Free/Daily driver can cancel an accepted order.

**Architecture:** A per-order `stage` (stored in `order_dispatch_stage` and mirrored on the in-memory dispatch state) restricts `selectEligibleDrivers` to the stage's driver set. When a stage's cascade is exhausted, `checkCascadeTermination` restarts dispatch at the next stage (the same mechanism the Free Booking fallback already uses). Penalties are percentage-of-order-fare rows in `driver_tier_penalty`, collected from the driver wallet at once, or (for a punched-in Daily Driver) deferred and netted at Daily settlement. Everything is behind the `tiered_dispatch_enabled` app setting, default OFF.

**Tech Stack:** Node.js/Express, Prisma (MySQL), Jest. Backend only (`backend/`). Driver-app popup, customer-app popup, admin React pages and the Driver Performance report are Plans 2 and 3.

**Spec:** `docs/superpowers/specs/2026-10-11-tiered-dispatch-free-daily-design.md` (sections 3, 3.1, 4, 5.1, 8). Spec deltas decided while planning: (1) settings live in `app_settings` keys (like `settlementSettings.js`), not a `driver_tier_penalty_setting` table; (2) penalties are recorded in a new `driver_tier_penalty` table (needed for waive and Daily netting), in addition to `driver_order_event`; (3) the "not offered again" exclusion applies to the daily stage too, not only normal; (4) manager addendum 2026-10-11: popups inside a stage go to up to `MAX_DRIVERS_PER_BATCH` (= 4, verified in `backend/src/config/constants.js`) drivers at once with first-accept-wins (this is how the existing batch cascade already works, so no new dispatch code is needed beyond the stage), an empty stage hands over at once, an offer that someone else took is never penalised or counted (new `superseded` event), and the Free-order refund stays the full invoice that `tryCredit` credits today.

## Global Constraints

- All new/changed backend code is CommonJS, 2-space indent, double quotes, matching `backend/src/services/*.js`.
- Tiered dispatch OFF (default) must leave today's dispatch byte-for-byte unchanged: `state.stage` is `null` and `selectEligibleDrivers` takes its existing free-booking pool path.
- Reading a setting must fail closed: any DB error means "tiered dispatch OFF, penalties OFF".
- Money: penalty amount = `round2(pkg_order.total_dcharge * pct / 100)`. Ladder default `[5,10,20,50,100]`, the 5th and every later miss use the last value. The counter is lifetime, per rider and per tier (free, daily), never reset automatically.
- At most one `kind="miss"` penalty per (order, rider): the first event (skip or reject) wins.
- A miss only counts while the order is still open (`rid = 0`, `order_status = 0`, not cancelled). If someone else already accepted it, or the customer cancelled, the driver gets no penalty, the ladder counter does not move, and a `superseded` event is logged instead of `skipped`/`rejected`.
- Popups: at most `MAX_DRIVERS_PER_BATCH` (4) drivers hold a popup of one batch at once, in every stage; the first accept wins through the existing atomic claim. Normal stage behaviour is unchanged.
- Cancel request is only possible while `pkg_order.o_status = 'Processing'` (before pickup). After pickup a Free/Daily driver cannot cancel at all.
- Event/penalty log writes are best-effort: a failure must never break dispatch, accept, reject, or completion.
- `tbl_wallet_history.created_at` uses `istNow()` from `backend/src/utils/istTime.js`.
- Penalties and events use the string tiers `"free"`, `"daily"`, `"normal"`.
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run tests from `backend/` with `npx jest <path-or-pattern>`.

## Review Focus

- Tiered setting OFF or unreadable: the whole existing `dispatchManager.test.js` suite must pass unchanged (pinned in Task 6).
- A reject arriving after the same offer's timeout must not create a second penalty or advance the miss counter twice (pinned in Task 7).
- A driver whose popup was still live when someone else accepted (or the customer cancelled) gets no penalty, no counter increment and a `superseded` event, including when the order is taken between the pre-check and the penalty transaction (pinned in Tasks 6 and 7).
- An admin approving a cancel request after the order state changed (driver already picked up, customer cancelled) must not re-dispatch or penalise (pinned in Task 10).
- A `daily` stage with zero punched-in drivers must hand over to `normal` without waiting for any popup timer (pinned in Task 6).
- Global dispatch settings must be writable only by a superadmin, and a city admin must not see another city's cancel requests or penalties (pinned in Task 11).
- Scheduled (booking_type 2) and next-day (3) orders also pass through `startDispatch`, so they get a stage too; pinned only by the manual check in Task 12 step 5.6.
- Manual check on dev (Task 12): an order whose customer already paid the advance, then goes through an approved cancel and a second accept, must end with a consistent `advance_payment` (not verified by unit tests because `finalizeAcceptedOrder` reprices on accept).

## File Structure

Create:
- `backend/prisma/migrations/20261011010000_add_tiered_dispatch/migration.sql` - five new tables.
- `backend/src/services/tierPenaltyRules.js` - pure: ladder, penalty amount, stage order.
- `backend/src/services/tieredDispatchSettings.js` - reads/writes the four `app_settings` keys (5 s cache).
- `backend/src/services/driverOrderEventService.js` - best-effort `driver_order_event` writer.
- `backend/src/services/orderStageService.js` - stage persistence, start-stage decision, per-stage rider sets.
- `backend/src/services/tierPenaltyService.js` - miss/cancel penalties, counter, wallet/Daily collection, waive, reset, offer preview.
- `backend/src/services/cancelRequestService.js` - gate, create, approve, reject, list.
- `backend/src/controllers/adminTierDispatchController.js` - admin API.
- Tests: `backend/src/services/__tests__/{tierPenaltyRules,tieredDispatchSettings,driverOrderEventService,orderStageService,tierPenaltyService,cancelRequestService,tripLifecycle.tierHooks,dailyDriverSettlementPenalty}.test.js`, `backend/src/controllers/__tests__/adminTierDispatchController.test.js`.

Modify:
- `backend/prisma/schema.prisma` - append five models.
- `backend/src/services/dispatchManager.js` - stage-aware selection, start, advance, payload, events, skip hook.
- `backend/src/services/tripLifecycle.js` - reject hook, accepted/completed events, cancel gate.
- `backend/src/services/dailyDriverSettlementService.js` - collect pending penalties at settlement.
- `backend/src/services/pushNotifier.js` - two driver push helpers.
- `backend/src/controllers/orderController.js` - `driverCancel` response when approval is required.
- `backend/src/routes/adminRoutes.js` - admin routes.
- `backend/src/services/__tests__/dispatchManager.test.js` - mocks for the new modules + new tests.

---

### Task 1: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (append at end of file)
- Create: `backend/prisma/migrations/20261011010000_add_tiered_dispatch/migration.sql`

**Interfaces:**
- Produces: Prisma models `order_dispatch_stage` (pk `order_id`), `driver_order_event`, `driver_tier_penalty_counter` (compound pk `rider_id_tier`), `driver_tier_penalty`, `order_cancel_request`. Later tasks use exactly these names and columns.

- [ ] **Step 1: Append the models to `backend/prisma/schema.prisma`**

```prisma
model order_dispatch_stage {
  order_id   Int      @id
  stage      String   @db.VarChar(10)
  updated_at DateTime @default(now()) @db.DateTime(0)
}

model driver_order_event {
  id             Int      @id @default(autoincrement())
  rider_id       Int
  order_id       Int
  tier           String   @db.VarChar(10)
  event          String   @db.VarChar(24)
  reason         String?  @db.VarChar(255)
  penalty_pct    Decimal? @db.Decimal(5, 2)
  penalty_amount Decimal? @db.Decimal(10, 2)
  miss_no        Int?
  created_at     DateTime @default(now()) @db.DateTime(0)

  @@index([rider_id, created_at], map: "idx_doe_rider_at")
  @@index([tier, created_at], map: "idx_doe_tier_at")
  @@index([order_id], map: "idx_doe_order")
}

model driver_tier_penalty_counter {
  rider_id   Int
  tier       String   @db.VarChar(10)
  misses     Int      @default(0)
  updated_at DateTime @default(now()) @updatedAt @db.DateTime(0)

  @@id([rider_id, tier])
}

model driver_tier_penalty {
  id            Int       @id @default(autoincrement())
  rider_id      Int
  order_id      Int
  tier          String    @db.VarChar(10)
  kind          String    @db.VarChar(10)
  event         String    @db.VarChar(24)
  miss_no       Int?
  pct           Decimal   @db.Decimal(5, 2)
  base_amount   Decimal   @db.Decimal(10, 2)
  amount        Decimal   @db.Decimal(10, 2)
  status        String    @db.VarChar(16)
  enrollment_id Int?
  waived_by     Int?
  created_at    DateTime  @default(now()) @db.DateTime(0)
  collected_at  DateTime? @db.DateTime(0)
  waived_at     DateTime? @db.DateTime(0)

  @@unique([order_id, rider_id, kind], map: "uq_dtp_order_rider_kind")
  @@index([rider_id, tier], map: "idx_dtp_rider_tier")
  @@index([enrollment_id, status], map: "idx_dtp_enrollment_status")
}

model order_cancel_request {
  id         Int       @id @default(autoincrement())
  order_id   Int
  rider_id   Int
  tier       String    @db.VarChar(10)
  reason     String?   @db.Text
  status     String    @db.VarChar(10)
  decided_by Int?
  decided_at DateTime? @db.DateTime(0)
  penalty_id Int?
  created_at DateTime  @default(now()) @db.DateTime(0)

  @@index([status, created_at], map: "idx_ocr_status_created")
  @@index([order_id], map: "idx_ocr_order")
}
```

- [ ] **Step 2: Create the migration SQL**

`backend/prisma/migrations/20261011010000_add_tiered_dispatch/migration.sql`:

```sql
-- Tiered dispatch (Free -> Daily -> Normal), penalties and cancel approval (spec 2026-10-11).
-- Apply on every DB BEFORE deploying the backend (hand-applied on dev, then prisma migrate resolve --applied).
CREATE TABLE `order_dispatch_stage` (
  `order_id` INT NOT NULL,
  `stage` VARCHAR(10) NOT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_order_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `event` VARCHAR(24) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `penalty_pct` DECIMAL(5,2) NULL,
  `penalty_amount` DECIMAL(10,2) NULL,
  `miss_no` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_doe_rider_at` (`rider_id`, `created_at`),
  INDEX `idx_doe_tier_at` (`tier`, `created_at`),
  INDEX `idx_doe_order` (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_tier_penalty_counter` (
  `rider_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `misses` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`rider_id`, `tier`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `driver_tier_penalty` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `order_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `event` VARCHAR(24) NOT NULL,
  `miss_no` INT NULL,
  `pct` DECIMAL(5,2) NOT NULL,
  `base_amount` DECIMAL(10,2) NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `enrollment_id` INT NULL,
  `waived_by` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `collected_at` DATETIME(0) NULL,
  `waived_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_dtp_order_rider_kind` (`order_id`, `rider_id`, `kind`),
  INDEX `idx_dtp_rider_tier` (`rider_id`, `tier`),
  INDEX `idx_dtp_enrollment_status` (`enrollment_id`, `status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_cancel_request` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `tier` VARCHAR(10) NOT NULL,
  `reason` TEXT NULL,
  `status` VARCHAR(10) NOT NULL,
  `decided_by` INT NULL,
  `decided_at` DATETIME(0) NULL,
  `penalty_id` INT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_ocr_status_created` (`status`, `created_at`),
  INDEX `idx_ocr_order` (`order_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 3: Validate and generate the client**

Run (from `backend/`): `npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" and "Generated Prisma Client".

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20261011010000_add_tiered_dispatch/migration.sql
git commit -m "feat(tiered-dispatch): schema and migration for stages, penalties, events, cancel requests"
```

---

### Task 2: Pure rules (`tierPenaltyRules.js`)

**Files:**
- Create: `backend/src/services/tierPenaltyRules.js`
- Test: `backend/src/services/__tests__/tierPenaltyRules.test.js`

**Interfaces:**
- Produces: `TIER` (`{FREE:"free",DAILY:"daily",NORMAL:"normal"}`), `STAGE_ORDER`, `DEFAULT_LADDER`, `round2(n)`, `parseLadder(raw) -> number[]`, `pctForMiss(ladder, missNo) -> number`, `penaltyAmount(base, pct) -> number`, `nextStage(stage) -> string|null`, `isPenaltyTier(tier) -> boolean`.

- [ ] **Step 1: Write the failing test**

```js
const rules = require("../tierPenaltyRules");

describe("tierPenaltyRules", () => {
  it("uses the default ladder when the setting is missing or invalid", () => {
    expect(rules.parseLadder(undefined)).toEqual([5, 10, 20, 50, 100]);
    expect(rules.parseLadder("abc,,")).toEqual([5, 10, 20, 50, 100]);
    expect(rules.parseLadder("0,-5,101")).toEqual([5, 10, 20, 50, 100]);
  });

  it("parses a comma list and drops invalid entries", () => {
    expect(rules.parseLadder("5, 10 ,x,25")).toEqual([5, 10, 25]);
  });

  it("maps the nth miss to the ladder and keeps the last value from the 5th miss on", () => {
    const ladder = rules.DEFAULT_LADDER;
    expect([1, 2, 3, 4, 5, 6, 40].map((n) => rules.pctForMiss(ladder, n))).toEqual([5, 10, 20, 50, 100, 100, 100]);
  });

  it("treats a missing or zero miss number as the first miss", () => {
    expect(rules.pctForMiss(rules.DEFAULT_LADDER, 0)).toBe(5);
    expect(rules.pctForMiss(rules.DEFAULT_LADDER, undefined)).toBe(5);
  });

  it("computes the penalty as a rounded percentage of the order total", () => {
    expect(rules.penaltyAmount(500, 5)).toBe(25);
    expect(rules.penaltyAmount(333, 10)).toBe(33.3);
    expect(rules.penaltyAmount(100.555, 100)).toBe(100.56);
  });

  it("is zero for a missing, zero or negative base or pct", () => {
    expect(rules.penaltyAmount(null, 10)).toBe(0);
    expect(rules.penaltyAmount(0, 10)).toBe(0);
    expect(rules.penaltyAmount(100, 0)).toBe(0);
    expect(rules.penaltyAmount(-5, 10)).toBe(0);
  });

  it("walks free -> daily -> normal and stops", () => {
    expect(rules.nextStage("free")).toBe("daily");
    expect(rules.nextStage("daily")).toBe("normal");
    expect(rules.nextStage("normal")).toBeNull();
    expect(rules.nextStage("bogus")).toBeNull();
  });

  it("only free and daily carry penalties", () => {
    expect(rules.isPenaltyTier("free")).toBe(true);
    expect(rules.isPenaltyTier("daily")).toBe(true);
    expect(rules.isPenaltyTier("normal")).toBe(false);
    expect(rules.isPenaltyTier(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/__tests__/tierPenaltyRules.test.js`
Expected: FAIL - "Cannot find module '../tierPenaltyRules'".

- [ ] **Step 3: Implement**

```js
// Pure rules for tiered dispatch penalties (spec 2026-10-11). No I/O here.

const TIER = Object.freeze({ FREE: "free", DAILY: "daily", NORMAL: "normal" });
const STAGE_ORDER = Object.freeze([TIER.FREE, TIER.DAILY, TIER.NORMAL]);
const PENALTY_TIERS = Object.freeze([TIER.FREE, TIER.DAILY]);
const DEFAULT_LADDER = Object.freeze([5, 10, 20, 50, 100]);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** "5,10,20" -> [5,10,20]; entries outside (0,100] are dropped; nothing valid -> the default ladder. */
function parseLadder(raw) {
  const nums = String(raw ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return nums.length > 0 ? nums : [...DEFAULT_LADDER];
}

/** Percentage for the nth miss (1-based); the last ladder value applies from then on. */
function pctForMiss(ladder, missNo) {
  const list = Array.isArray(ladder) && ladder.length > 0 ? ladder : DEFAULT_LADDER;
  const n = Math.max(1, Math.floor(Number(missNo) || 1));
  return list[Math.min(n, list.length) - 1];
}

function penaltyAmount(baseAmount, pct) {
  const base = Number(baseAmount);
  const p = Number(pct);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(p) || p <= 0) return 0;
  return round2((base * p) / 100);
}

function nextStage(stage) {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}

const isPenaltyTier = (tier) => PENALTY_TIERS.includes(tier);

module.exports = { TIER, STAGE_ORDER, PENALTY_TIERS, DEFAULT_LADDER, round2, parseLadder, pctForMiss, penaltyAmount, nextStage, isPenaltyTier };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/services/__tests__/tierPenaltyRules.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tierPenaltyRules.js backend/src/services/__tests__/tierPenaltyRules.test.js
git commit -m "feat(tiered-dispatch): pure penalty ladder and stage rules"
```

---

### Task 3: Settings (`tieredDispatchSettings.js`)

**Files:**
- Create: `backend/src/services/tieredDispatchSettings.js`
- Test: `backend/src/services/__tests__/tieredDispatchSettings.test.js`

**Interfaces:**
- Consumes: `tierPenaltyRules.parseLadder`.
- Produces: `getTierSettings({fresh}) -> {tieredEnabled:boolean, penaltyEnabled:boolean, ladder:number[], cancelPenaltyPct:number}`, `isTieredEnabled() -> Promise<boolean>`, `saveTierSettings(partial) -> Promise<settings>` (throws an Error with `statusCode: 400` on bad input), `_resetCache()` (tests).

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn(), upsert: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");

beforeEach(() => {
  jest.clearAllMocks();
  settings._resetCache();
});

describe("getTierSettings", () => {
  it("defaults everything off with the default ladder and a 100% cancel penalty", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await settings.getTierSettings()).toEqual({
      tieredEnabled: false, penaltyEnabled: false, ladder: [5, 10, 20, 50, 100], cancelPenaltyPct: 100,
    });
  });

  it("reads the four keys", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "tiered_dispatch_enabled", setting_value: "1" },
      { setting_key: "tier_penalty_enabled", setting_value: "true" },
      { setting_key: "tier_penalty_ladder", setting_value: "2,4,8" },
      { setting_key: "tier_cancel_penalty_pct", setting_value: "25" },
    ]);
    expect(await settings.getTierSettings()).toEqual({
      tieredEnabled: true, penaltyEnabled: true, ladder: [2, 4, 8], cancelPenaltyPct: 25,
    });
  });

  it("fails closed (everything off) when the DB read throws", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    const s = await settings.getTierSettings();
    expect(s.tieredEnabled).toBe(false);
    expect(s.penaltyEnabled).toBe(false);
  });

  it("caches for a few seconds so every offer does not hit the DB", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    await settings.getTierSettings();
    await settings.getTierSettings();
    expect(prisma.app_settings.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("saveTierSettings", () => {
  beforeEach(() => {
    prisma.app_settings.upsert.mockResolvedValue({});
    prisma.app_settings.findMany.mockResolvedValue([]);
  });

  it("upserts only the provided keys", async () => {
    await settings.saveTierSettings({ tieredEnabled: true, ladder: "5,10" });
    const keys = prisma.app_settings.upsert.mock.calls.map((c) => c[0].where.setting_key).sort();
    expect(keys).toEqual(["tier_penalty_ladder", "tiered_dispatch_enabled"]);
    const ladderCall = prisma.app_settings.upsert.mock.calls.find((c) => c[0].where.setting_key === "tier_penalty_ladder");
    expect(ladderCall[0].update.setting_value).toBe("5,10");
  });

  it("rejects a ladder with a value outside 1-100 (400)", async () => {
    await expect(settings.saveTierSettings({ ladder: "5,150" })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });

  it("rejects a cancel penalty outside 0-100 (400)", async () => {
    await expect(settings.saveTierSettings({ cancelPenaltyPct: 120 })).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/__tests__/tieredDispatchSettings.test.js`
Expected: FAIL - "Cannot find module '../tieredDispatchSettings'".

- [ ] **Step 3: Implement**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./tierPenaltyRules");

// Stored in app_settings like settlementSettings.js, so no dedicated table.
const KEYS = Object.freeze({
  tieredEnabled: "tiered_dispatch_enabled",
  penaltyEnabled: "tier_penalty_enabled",
  ladder: "tier_penalty_ladder",
  cancelPenaltyPct: "tier_cancel_penalty_pct",
});
const TTL_MS = 5000;
let cache = null; // { at, value }

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const defaults = () => ({ tieredEnabled: false, penaltyEnabled: false, ladder: [...rules.DEFAULT_LADDER], cancelPenaltyPct: 100 });

async function getTierSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: Object.values(KEYS) } } });
    const by = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    const pct = Number(by.get(KEYS.cancelPenaltyPct));
    const value = {
      tieredEnabled: toBool(by.get(KEYS.tieredEnabled)),
      penaltyEnabled: toBool(by.get(KEYS.penaltyEnabled)),
      ladder: rules.parseLadder(by.get(KEYS.ladder)),
      cancelPenaltyPct: by.has(KEYS.cancelPenaltyPct) && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 100,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // Fail closed: an unreadable switch must never turn tiered dispatch or penalties ON.
    logger.error("getTierSettings: failed to read settings, treating tiered dispatch as disabled:", err);
    return defaults();
  }
}

async function isTieredEnabled() {
  return (await getTierSettings()).tieredEnabled;
}

async function saveTierSettings({ tieredEnabled, penaltyEnabled, ladder, cancelPenaltyPct } = {}) {
  const writes = [];
  if (tieredEnabled !== undefined) writes.push([KEYS.tieredEnabled, tieredEnabled ? "1" : "0"]);
  if (penaltyEnabled !== undefined) writes.push([KEYS.penaltyEnabled, penaltyEnabled ? "1" : "0"]);
  if (ladder !== undefined) {
    const list = Array.isArray(ladder) ? ladder.map(Number) : String(ladder).split(",").map((p) => Number(p.trim()));
    if (list.length === 0 || list.some((n) => !Number.isFinite(n) || n <= 0 || n > 100)) {
      throw badRequest("ladder must be percentages between 1 and 100, for example 5,10,20,50,100");
    }
    writes.push([KEYS.ladder, list.join(",")]);
  }
  if (cancelPenaltyPct !== undefined) {
    const n = Number(cancelPenaltyPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest("cancel penalty must be between 0 and 100");
    writes.push([KEYS.cancelPenaltyPct, String(n)]);
  }
  for (const [key, value] of writes) {
    await prisma.app_settings.upsert({
      where: { setting_key: key },
      update: { setting_value: value },
      create: { setting_key: key, setting_value: value },
    });
  }
  cache = null;
  return getTierSettings({ fresh: true });
}

function _resetCache() {
  cache = null;
}

module.exports = { KEYS, getTierSettings, isTieredEnabled, saveTierSettings, _resetCache };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/services/__tests__/tieredDispatchSettings.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tieredDispatchSettings.js backend/src/services/__tests__/tieredDispatchSettings.test.js
git commit -m "feat(tiered-dispatch): fail-closed settings reader/writer"
```

---

### Task 4: Event log (`driverOrderEventService.js`)

**Files:**
- Create: `backend/src/services/driverOrderEventService.js`
- Test: `backend/src/services/__tests__/driverOrderEventService.test.js`

**Interfaces:**
- Produces: `EVENTS` (`OFFERED, ACCEPTED, REJECTED, SKIPPED, SUPERSEDED, COMPLETED, CANCEL_REQUESTED, CANCELLED, CANCEL_REJECTED, PENALTY, PENALTY_WAIVED, COUNTER_RESET` with the matching lowercase string values), `logEvent({riderId, orderId, tier, event, reason, penaltyPct, penaltyAmount, missNo}) -> Promise<row|null>` (never throws; `tier` defaults to `"normal"`).

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({ driver_order_event: { create: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const events = require("../driverOrderEventService");

beforeEach(() => jest.clearAllMocks());

it("writes one row with the tier defaulting to normal", async () => {
  prisma.driver_order_event.create.mockResolvedValue({ id: 1 });
  const row = await events.logEvent({ riderId: 9, orderId: 50, event: events.EVENTS.OFFERED });
  expect(row).toEqual({ id: 1 });
  expect(prisma.driver_order_event.create).toHaveBeenCalledWith({
    data: {
      rider_id: 9, order_id: 50, tier: "normal", event: "offered",
      reason: null, penalty_pct: null, penalty_amount: null, miss_no: null,
    },
  });
});

it("stores penalty details", async () => {
  prisma.driver_order_event.create.mockResolvedValue({ id: 2 });
  await events.logEvent({
    riderId: 9, orderId: 50, tier: "free", event: events.EVENTS.PENALTY, penaltyPct: 20, penaltyAmount: 60, missNo: 3, reason: "skipped",
  });
  const data = prisma.driver_order_event.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ tier: "free", event: "penalty", penalty_pct: 20, penalty_amount: 60, miss_no: 3, reason: "skipped" });
});

it("never throws: a failed write is logged and returns null", async () => {
  prisma.driver_order_event.create.mockRejectedValue(new Error("table missing"));
  await expect(events.logEvent({ riderId: 1, orderId: 2, event: "offered" })).resolves.toBeNull();
  expect(logger.error).toHaveBeenCalled();
});

it("has a superseded event for offers someone else took", () => {
  expect(events.EVENTS.SUPERSEDED).toBe("superseded");
});

it("truncates a long reason to the column size", async () => {
  prisma.driver_order_event.create.mockResolvedValue({ id: 3 });
  await events.logEvent({ riderId: 1, orderId: 2, event: "cancel_requested", reason: "x".repeat(400) });
  expect(prisma.driver_order_event.create.mock.calls[0][0].data.reason).toHaveLength(255);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/__tests__/driverOrderEventService.test.js`
Expected: FAIL - "Cannot find module '../driverOrderEventService'".

- [ ] **Step 3: Implement**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");

const EVENTS = Object.freeze({
  OFFERED: "offered",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  SKIPPED: "skipped",
  SUPERSEDED: "superseded",
  COMPLETED: "completed",
  CANCEL_REQUESTED: "cancel_requested",
  CANCELLED: "cancelled",
  CANCEL_REJECTED: "cancel_rejected",
  PENALTY: "penalty",
  PENALTY_WAIVED: "penalty_waived",
  COUNTER_RESET: "counter_reset",
});

/**
 * Best-effort driver/order event for the Driver Performance report. Never throws: a failed log write
 * must not break dispatch, accept, reject or completion.
 */
async function logEvent({ riderId, orderId, tier = null, event, reason = null, penaltyPct = null, penaltyAmount = null, missNo = null }) {
  try {
    return await prisma.driver_order_event.create({
      data: {
        rider_id: Number(riderId),
        order_id: Number(orderId),
        tier: tier || "normal",
        event,
        reason: reason == null ? null : String(reason).slice(0, 255),
        penalty_pct: penaltyPct,
        penalty_amount: penaltyAmount,
        miss_no: missNo,
      },
    });
  } catch (err) {
    logger.error(`driverOrderEventService.logEvent failed (order ${orderId}, rider ${riderId}, ${event}):`, err);
    return null;
  }
}

module.exports = { EVENTS, logEvent };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/services/__tests__/driverOrderEventService.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverOrderEventService.js backend/src/services/__tests__/driverOrderEventService.test.js
git commit -m "feat(tiered-dispatch): best-effort driver order event log"
```

---

### Task 5: Stage service (`orderStageService.js`)

**Files:**
- Create: `backend/src/services/orderStageService.js`
- Test: `backend/src/services/__tests__/orderStageService.test.js`

**Interfaces:**
- Consumes: `tierPenaltyRules.TIER`, `tieredDispatchSettings.isTieredEnabled`, `freeBookingService.poolRiderIds(cityId) -> Promise<number[]>`.
- Produces:
  - `getStage(orderId) -> Promise<string|null>` (never throws)
  - `setStage(orderId, stage) -> Promise<void>` (never throws)
  - `decideStartStage(order) -> Promise<"free"|"daily"|null>` (`null` = feature off, keep old behaviour)
  - `riderIdsForStage(stage, order) -> Promise<number[]|null>` (`null` = no restriction, i.e. `normal`)
  - `offeredRiderIds(orderId) -> Promise<number[]>`
  - `dailyRiderIds() -> Promise<number[]>`

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  order_dispatch_stage: { findUnique: jest.fn(), upsert: jest.fn() },
  free_booking_order: { findUnique: jest.fn() },
  tbl_order_requests: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tieredDispatchSettings", () => ({ isTieredEnabled: jest.fn() }));
jest.mock("../freeBookingService", () => ({ poolRiderIds: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");
const freeBooking = require("../freeBookingService");
const stage = require("../orderStageService");

beforeEach(() => jest.clearAllMocks());

describe("decideStartStage", () => {
  it("returns null when tiered dispatch is off", async () => {
    settings.isTieredEnabled.mockResolvedValue(false);
    expect(await stage.decideStartStage({ id: 5 })).toBeNull();
  });

  it("starts a confirmed free booking at the free stage", async () => {
    settings.isTieredEnabled.mockResolvedValue(true);
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_CONFIRMED" });
    expect(await stage.decideStartStage({ id: 5 })).toBe("free");
  });

  it("starts every other order at the daily stage", async () => {
    settings.isTieredEnabled.mockResolvedValue(true);
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    expect(await stage.decideStartStage({ id: 5 })).toBe("daily");
  });

  it("a free booking row that is no longer CONFIRMED starts at daily", async () => {
    settings.isTieredEnabled.mockResolvedValue(true);
    prisma.free_booking_order.findUnique.mockResolvedValue({ status: "FREE_BOOKING_NOT_ELIGIBLE" });
    expect(await stage.decideStartStage({ id: 5 })).toBe("daily");
  });
});

describe("riderIdsForStage", () => {
  it("free: the city's pool riders, using the free-booking row's city first", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ city_id: 3 });
    freeBooking.poolRiderIds.mockResolvedValue([11, 12]);
    expect(await stage.riderIdsForStage("free", { id: 5, city_id: 9 })).toEqual([11, 12]);
    expect(freeBooking.poolRiderIds).toHaveBeenCalledWith(3);
  });

  it("free: falls back to the order's city, and to an empty list when there is no city", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue({ city_id: null });
    freeBooking.poolRiderIds.mockResolvedValue([7]);
    expect(await stage.riderIdsForStage("free", { id: 5, city_id: 9 })).toEqual([7]);
    expect(freeBooking.poolRiderIds).toHaveBeenCalledWith(9);
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    expect(await stage.riderIdsForStage("free", { id: 5, city_id: null })).toEqual([]);
  });

  it("daily: riders with an in-progress duty log that has punched in and not out", async () => {
    prisma.$queryRaw.mockResolvedValue([{ rider_id: 21 }, { rider_id: 22 }]);
    expect(await stage.riderIdsForStage("daily", { id: 5 })).toEqual([21, 22]);
  });

  it("normal: null means no restriction", async () => {
    expect(await stage.riderIdsForStage("normal", { id: 5 })).toBeNull();
  });
});

describe("stage persistence", () => {
  it("setStage upserts and swallows DB errors", async () => {
    prisma.order_dispatch_stage.upsert.mockRejectedValue(new Error("boom"));
    await expect(stage.setStage(5, "daily")).resolves.toBeUndefined();
  });

  it("getStage returns the stored stage or null", async () => {
    prisma.order_dispatch_stage.findUnique.mockResolvedValue({ stage: "free" });
    expect(await stage.getStage(5)).toBe("free");
    prisma.order_dispatch_stage.findUnique.mockResolvedValue(null);
    expect(await stage.getStage(5)).toBeNull();
    prisma.order_dispatch_stage.findUnique.mockRejectedValue(new Error("boom"));
    expect(await stage.getStage(5)).toBeNull();
  });
});

describe("offeredRiderIds", () => {
  it("returns the distinct riders this order was ever offered to", async () => {
    prisma.tbl_order_requests.findMany.mockResolvedValue([{ rider_id: 3 }, { rider_id: 4 }]);
    expect(await stage.offeredRiderIds(5)).toEqual([3, 4]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/__tests__/orderStageService.test.js`
Expected: FAIL - "Cannot find module '../orderStageService'".

- [ ] **Step 3: Implement**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("./tieredDispatchSettings");
const { TIER } = require("./tierPenaltyRules");

async function getStage(orderId) {
  try {
    const row = await prisma.order_dispatch_stage.findUnique({ where: { order_id: Number(orderId) }, select: { stage: true } });
    return row?.stage ?? null;
  } catch (err) {
    logger.error(`orderStageService.getStage failed for order ${orderId}:`, err);
    return null;
  }
}

async function setStage(orderId, stage) {
  try {
    await prisma.order_dispatch_stage.upsert({
      where: { order_id: Number(orderId) },
      update: { stage },
      create: { order_id: Number(orderId), stage },
    });
  } catch (err) {
    logger.error(`orderStageService.setStage failed for order ${orderId}:`, err);
  }
}

/** Free for a still-CONFIRMED free booking, daily for everything else; null when tiered dispatch is off. */
async function decideStartStage(order) {
  if (!(await settings.isTieredEnabled())) return null;
  const row = await prisma.free_booking_order
    .findUnique({ where: { order_id: Number(order.id) }, select: { status: true } })
    .catch(() => null);
  return row && row.status === "FREE_BOOKING_CONFIRMED" ? TIER.FREE : TIER.DAILY;
}

/** Daily Drivers on duty: enrolled, punched in and not yet punched out. */
async function dailyRiderIds() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT rider_id FROM daily_driver_duty_log
    WHERE status = 'in_progress' AND punch_in_at IS NOT NULL AND punch_out_at IS NULL
  `;
  return rows.map((r) => Number(r.rider_id));
}

async function freePoolRiderIds(order) {
  const row = await prisma.free_booking_order
    .findUnique({ where: { order_id: Number(order.id) }, select: { city_id: true } })
    .catch(() => null);
  const cityId = row?.city_id ?? order.city_id;
  if (!cityId) return [];
  return require("./freeBookingService").poolRiderIds(Number(cityId));
}

/** Candidate rider ids for a stage; null = no restriction (normal). */
async function riderIdsForStage(stage, order) {
  if (stage === TIER.FREE) return freePoolRiderIds(order);
  if (stage === TIER.DAILY) return dailyRiderIds();
  return null;
}

/** Every rider this order was ever offered to (any stage); used so a later stage never re-offers them. */
async function offeredRiderIds(orderId) {
  const rows = await prisma.tbl_order_requests.findMany({
    where: { order_id: Number(orderId) },
    select: { rider_id: true },
    distinct: ["rider_id"],
  });
  return rows.map((r) => Number(r.rider_id)).filter((id) => Number.isFinite(id));
}

module.exports = { getStage, setStage, decideStartStage, riderIdsForStage, dailyRiderIds, offeredRiderIds };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/services/__tests__/orderStageService.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orderStageService.js backend/src/services/__tests__/orderStageService.test.js
git commit -m "feat(tiered-dispatch): per-order stage service"
```

---

### Task 6: Dispatch integration (`dispatchManager.js`)

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (imports ~line 20; `selectEligibleDrivers` ~97-160; `runBatchInner` ~688-693, ~800-830, ~891-893; `scheduleExpiry` ~1062; `checkCascadeTermination` ~409-430; `startDispatch` ~1186)
- Modify: `backend/src/services/__tests__/dispatchManager.test.js` (new module mocks near the existing `jest.mock(...)` block; new tests at the end of the main `describe`)
- Create stubs needed so this task compiles before Task 7: none. `dispatchManager` calls `tierPenalty.previewForOffer` and `tierPenalty.onMiss`, which Task 7 creates; Task 6 mocks them in tests, and the real module is wired in Task 7 (this task adds a minimal `tierPenaltyService.js` exporting the two functions as no-ops so the require resolves - replaced in Task 7).

**Interfaces:**
- Consumes: `orderStageService` (Task 5), `tierPenaltyRules.nextStage` (Task 2), `driverOrderEventService.logEvent/EVENTS` (Task 4), `tierPenaltyService.previewForOffer({riderId, stage, order}) -> {pct, amount}` and `tierPenaltyService.onMiss({orderId, riderId, event, stage, fcmToken})` (Task 7).
- Produces: `stopDispatch(orderId, "accepted_by_other")` also logs a `superseded` event per driver whose popup was still live; `startDispatch(order, tier0Pricing, opts = {stage, earlierStageRiderIds})`; `selectEligibleDrivers(order, packageId, excludeRiderIds, limit, stage = null)`; `order:request` payload gains `tier`, `order_amount`, `penalty_pct`, `penalty_amount` (all strings).

- [ ] **Step 1: Create the temporary no-op `tierPenaltyService.js`**

`backend/src/services/tierPenaltyService.js` (Task 7 overwrites this file):

```js
// Placeholder so dispatchManager can require the module; Task 7 replaces it with the real implementation.
async function previewForOffer() {
  return { pct: 0, amount: 0 };
}
async function onMiss() {
  return { applied: false };
}
module.exports = { previewForOffer, onMiss };
```

- [ ] **Step 2: Add mocks to the existing test file and write the failing tests**

In `backend/src/services/__tests__/dispatchManager.test.js`, directly after the existing `jest.mock("../bookingGuaranteeService", ...)` block add:

```js
jest.mock("../orderStageService", () => ({
  decideStartStage: jest.fn().mockResolvedValue(null), // feature off: the whole existing suite keeps its old behaviour
  setStage: jest.fn().mockResolvedValue(undefined),
  riderIdsForStage: jest.fn().mockResolvedValue(null),
  offeredRiderIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("../tierPenaltyService", () => ({
  previewForOffer: jest.fn().mockResolvedValue({ pct: 0, amount: 0 }),
  onMiss: jest.fn().mockResolvedValue({ applied: false }),
}));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { OFFERED: "offered", SUPERSEDED: "superseded" },
  logEvent: jest.fn().mockResolvedValue(null),
}));
```

and after the existing `const bookingGuaranteeService = require("../bookingGuaranteeService");` line add:

```js
const orderStage = require("../orderStageService");
const tierPenalty = require("../tierPenaltyService");
const driverOrderEvents = require("../driverOrderEventService");
```

The file has three top-level `describe`s. The first one, `describe("dispatchManager overlapping batch cascade", ...)` (it defines `order`, `emitted`, `flush`), ends with a `});` at column 0 just above `describe("dispatchManager.selectEligibleDrivers wallet-balance gate", ...)`. Insert this new describe INSIDE that first describe, directly above that closing `});` (not at the end of the file, where `order` is not defined):

```js
  describe("tiered dispatch stages", () => {
    // jest.clearAllMocks (in the parent beforeEach) keeps implementations, so reset the ones these tests set.
    afterEach(() => {
      orderStage.riderIdsForStage.mockReset().mockResolvedValue(null);
      orderStage.offeredRiderIds.mockReset().mockResolvedValue([]);
      tierPenalty.previewForOffer.mockReset().mockResolvedValue({ pct: 0, amount: 0 });
      tierPenalty.onMiss.mockReset().mockResolvedValue({ applied: false });
    });

    it("with the feature off, offers carry tier=normal and no restriction is passed to the stage service", async () => {
      await dispatchManager.startDispatch(order);
      await flush();

      const request = emitted.find((e) => e.event === "order:request");
      expect(request.payload.tier).toBe("normal");
      expect(orderStage.riderIdsForStage).not.toHaveBeenCalled();
      expect(orderStage.setStage).not.toHaveBeenCalled();
    });

    it("restricts selection to the stage's riders and tags the offer with the stage and the penalty preview", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("daily");
      orderStage.riderIdsForStage.mockResolvedValue([1, 2]);
      tierPenalty.previewForOffer.mockResolvedValue({ pct: 10, amount: 55 });

      await dispatchManager.startDispatch(order);
      await flush();

      expect(orderStage.setStage).toHaveBeenCalledWith(297, "daily");
      expect(orderStage.riderIdsForStage).toHaveBeenCalledWith("daily", expect.objectContaining({ id: 297 }));
      const request = emitted.find((e) => e.event === "order:request");
      expect(request.payload).toMatchObject({ tier: "daily", penalty_pct: "10", penalty_amount: "55" });
      expect(driverOrderEvents.logEvent).toHaveBeenCalledWith(expect.objectContaining({ orderId: 297, tier: "daily", event: "offered" }));
    });

    it("a stage with no eligible driver hands the order on free -> daily -> normal without waiting for any popup timer", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("free");
      orderStage.riderIdsForStage.mockResolvedValue([]); // empty pool / nobody punched in
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);

      await dispatchManager.startDispatch(order);
      // 1 ms, not 0: a setTimeout(fn, 0) scheduled from inside a fake-timer tick fires 1 ms later.
      for (let i = 0; i < 12; i++) {
        await flush();
        await jest.advanceTimersByTimeAsync(1);
      }

      const stages = orderStage.setStage.mock.calls.map((c) => c[1]);
      expect(stages).toEqual(["free", "daily", "normal"]);
      // Nobody was ever offered, so no timer needed to fire: only zero-delay turns ran.
      expect(emitted.filter((e) => e.event === "order:request")).toHaveLength(0);
    });

    it("never re-offers a rider who was offered in an earlier stage", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("free");
      orderStage.riderIdsForStage.mockResolvedValue([]);
      orderStage.offeredRiderIds.mockResolvedValue([1, 2]);
      prisma.$queryRaw.mockReset();
      prisma.$queryRaw.mockResolvedValue([]);

      await dispatchManager.startDispatch(order);
      // 1 ms, not 0: a setTimeout(fn, 0) scheduled from inside a fake-timer tick fires 1 ms later.
      for (let i = 0; i < 12; i++) {
        await flush();
        await jest.advanceTimersByTimeAsync(1);
      }

      // The later stages' selection SQL must carry riders 1 and 2 in its NOT IN list. The list is a
      // Prisma.join(...) Sql object, so unwrap the `.values` of every interpolated value.
      const interpolated = prisma.$queryRaw.mock.calls
        .flatMap((c) => c.slice(1))
        .flatMap((v) => (v && Array.isArray(v.values) ? v.values : [v]));
      expect(interpolated).toEqual(expect.arrayContaining([1, 2]));
    });

    it("a skip (offer timeout) at a stage is reported to the penalty service with that stage", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("daily");
      orderStage.riderIdsForStage.mockResolvedValue([1, 2, 3, 4]);

      await dispatchManager.startDispatch(order);
      await flush();
      await jest.advanceTimersByTimeAsync(POPUP_TIMEOUT_MS);
      await flush();

      expect(tierPenalty.onMiss).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 297, event: "skipped", stage: "daily" })
      );
    });

    it("a Free/Daily stage offers the popup to up to MAX_DRIVERS_PER_BATCH drivers at the same time", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("free");
      orderStage.riderIdsForStage.mockResolvedValue([1, 2, 3, 4, 5, 6]);

      await dispatchManager.startDispatch(order);
      await flush();

      const first = emitted.filter((e) => e.event === "order:request");
      expect(first.map((e) => e.room).sort()).toEqual(["driver_1", "driver_2", "driver_3", "driver_4"]);
      expect(first).toHaveLength(MAX_DRIVERS_PER_BATCH);
      expect(first.every((e) => e.payload.tier === "free")).toBe(true);
    });

    it("when someone else accepts, drivers whose popup was still live get a superseded event and no penalty", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("daily");
      orderStage.riderIdsForStage.mockResolvedValue([1, 2, 3, 4]);

      await dispatchManager.startDispatch(order);
      await flush();

      // Rider 1 won: finalizeAcceptedOrder releases that rider's own lock before it stops the dispatch.
      lockManager.releaseLock(1);
      dispatchManager.stopDispatch(297, "accepted_by_other");
      await flush();

      const superseded = driverOrderEvents.logEvent.mock.calls.map((c) => c[0]).filter((a) => a.event === "superseded");
      expect(superseded.map((a) => a.riderId).sort()).toEqual([2, 3, 4]);
      expect(superseded.every((a) => a.tier === "daily" && a.orderId === 297)).toBe(true);
      expect(tierPenalty.onMiss).not.toHaveBeenCalled();
    });

    it("a customer cancel does not log superseded events", async () => {
      orderStage.decideStartStage.mockResolvedValueOnce("daily");
      orderStage.riderIdsForStage.mockResolvedValue([1, 2, 3, 4]);

      await dispatchManager.startDispatch(order);
      await flush();
      dispatchManager.stopDispatch(297, "cancelled_by_user");
      await flush();

      const superseded = driverOrderEvents.logEvent.mock.calls.map((c) => c[0]).filter((a) => a.event === "superseded");
      expect(superseded).toHaveLength(0);
    });
  });
```

- [ ] **Step 3: Run the dispatch suite to verify the new tests fail and the old ones still pass**

Run: `npx jest src/services/__tests__/dispatchManager.test.js`
Expected: the new tests FAIL (payload has no `tier`, `setStage` never called, no `superseded` event); the 63 pre-existing tests still PASS.

- [ ] **Step 4: Edit `dispatchManager.js` - imports**

After the existing line `const { getModel1MissLimit, getModel1SuspensionHours } = require("./model1SuspensionSettings");` add:

```js
const orderStage = require("./orderStageService");
const tierRules = require("./tierPenaltyRules");
const tierPenalty = require("./tierPenaltyService");
const driverOrderEvents = require("./driverOrderEventService");
```

- [ ] **Step 5: Edit `selectEligibleDrivers` - signature and pool block**

Change the signature line

```js
async function selectEligibleDrivers(order, packageId, excludeRiderIds, limit = MAX_DRIVERS_PER_BATCH + 1) {
```

to

```js
async function selectEligibleDrivers(order, packageId, excludeRiderIds, limit = MAX_DRIVERS_PER_BATCH + 1, stage = null) {
```

and replace

```js
  const poolIds = await require("./freeBookingService").getDispatchPoolFilter(order);
```

with

```js
  // Tiered dispatch: the stage decides the candidate set. Without a stage (feature off) keep today's
  // free-booking pool filter exactly as it was.
  const poolIds = stage
    ? await orderStage.riderIdsForStage(stage, order)
    : await require("./freeBookingService").getDispatchPoolFilter(order);
```

(the existing `poolBlock` below it already turns an empty list into `IN (0)` and `null` into no filter).

- [ ] **Step 6: Edit `startDispatch`**

Replace the head of the function

```js
async function startDispatch(order, tier0Pricing) {
  if (activeDispatches.has(order.id)) {
```

with

```js
async function startDispatch(order, tier0Pricing, opts = {}) {
  // null = tiered dispatch off (old behaviour). Resolved before the duplicate guard so the guard and the
  // map insert below stay adjacent (no await between them).
  const stage = opts.stage !== undefined ? opts.stage : await orderStage.decideStartStage(order);
  if (stage) await orderStage.setStage(order.id, stage);

  if (activeDispatches.has(order.id)) {
```

and inside the `const state = { ... }` object literal add, after `batchInFlight: false,`:

```js
    // Tiered dispatch (spec 2026-10-11): which driver set this cascade offers to; null when the feature is off.
    stage,
    // Riders offered this order in an earlier stage: never offered again.
    earlierStageRiderIds: Array.isArray(opts.earlierStageRiderIds) ? opts.earlierStageRiderIds.map(Number) : [],
```

- [ ] **Step 7: Edit `runBatchInner` - exclusions and stage argument**

Replace

```js
    const excludeRiderIds = [...new Set([...lockManager.getAllLockedRiderIds(), ...rejectedRiderIds, ...consideredThisBatch])];
    const candidates = await selectEligibleDrivers(currentOrder, packageId, excludeRiderIds, MAX_DRIVERS_PER_BATCH + 1);
```

with

```js
    const excludeRiderIds = [...new Set([
      ...lockManager.getAllLockedRiderIds(), ...rejectedRiderIds, ...consideredThisBatch, ...state.earlierStageRiderIds,
    ])];
    const candidates = await selectEligibleDrivers(currentOrder, packageId, excludeRiderIds, MAX_DRIVERS_PER_BATCH + 1, state.stage);
```

Replace

```js
    const excludeIgnoringLocks = [...new Set([
      ...rejectedRiderIds,
      ...consideredThisBatch,
      ...(state.offeredRiderIdsByTier.get(packageId) || []),
    ])];
    const wouldBeCandidates = await selectEligibleDrivers(currentOrder, packageId, excludeIgnoringLocks, 1);
```

with

```js
    const excludeIgnoringLocks = [...new Set([
      ...rejectedRiderIds,
      ...consideredThisBatch,
      ...(state.offeredRiderIdsByTier.get(packageId) || []),
      ...state.earlierStageRiderIds,
    ])];
    const wouldBeCandidates = await selectEligibleDrivers(currentOrder, packageId, excludeIgnoringLocks, 1, state.stage);
```

- [ ] **Step 8: Edit `runBatchInner` - offer payload and offered event**

Immediately after the `const payload = buildOrderRequestPayload(...);` statement (the one that ends with `state.customerStats?.customerOrders\n          );`) add:

```js
          // Tiered dispatch: tell the driver which tier this offer is, and what a reject/skip would cost them now.
          const offerTier = state.stage || tierRules.TIER.NORMAL;
          const penaltyPreview = await tierPenalty.previewForOffer({ riderId, stage: state.stage, order: currentOrder });
          payload.tier = offerTier;
          payload.order_amount = String(Number(currentOrder.total_dcharge) || 0);
          payload.penalty_pct = String(penaltyPreview.pct);
          payload.penalty_amount = String(penaltyPreview.amount);
          driverOrderEvents.logEvent({ riderId, orderId, tier: offerTier, event: driverOrderEvents.EVENTS.OFFERED });
```

- [ ] **Step 9: Edit `scheduleExpiry` - skip hook**

After the line `await recordModel1Outcome(riderId, packageId, "miss");` (inside the `Promise.all` map, before `requireIo().to(...).emit("order:dismiss", ...)`) add:

```js
          // Tiered dispatch: a timed-out offer is a "skip" - logged for the report and, for a Free/Daily
          // stage, penalised. Never throws (see tierPenaltyService.onMiss).
          await tierPenalty.onMiss({ orderId, riderId, event: "skipped", stage: state.stage || null, fcmToken: driver.fcm_token });
```

- [ ] **Step 9b: Edit `stopDispatch` - superseded events**

In `stopDispatch`, directly after the line `const newRequestStatus = reason === "accepted_by_other" ? "auto_rejected" : "timeout";` add:

```js
  // Tiered dispatch: drivers whose popup was still live when someone else took the order are not penalised and
  // are excluded from the Driver Performance rates, so they get a "superseded" event instead of a skip/reject.
  // (The accepting rider's own lock was already released by finalizeAcceptedOrder, so it is not in riderIds.)
  if (reason === "accepted_by_other") {
    const supersededTier = state?.stage || tierRules.TIER.NORMAL;
    for (const riderId of riderIds) {
      driverOrderEvents.logEvent({ riderId, orderId, tier: supersededTier, event: driverOrderEvents.EVENTS.SUPERSEDED });
    }
  }
```

- [ ] **Step 10: Edit `checkCascadeTermination` - advance the stage**

Inside `if (order && order.rid === 0 && order.order_status === 0) {` and BEFORE the `// Free Booking Offer: the pool is exhausted ...` comment, add:

```js
    // Tiered dispatch: a Free/Daily stage that ran out of drivers hands the order to the next stage
    // (the same restart the free-booking fallback below uses). Normal is the last stage, so it falls
    // through to the free-booking / guarantee / no-driver-found handling unchanged.
    if (state.stage && state.stage !== tierRules.TIER.NORMAL) {
      const nextStage = tierRules.nextStage(state.stage);
      if (nextStage) {
        if (state.stage === tierRules.TIER.FREE) {
          // Leaving the free stage ends the free booking (no refund); notifies the customer.
          await require("./freeBookingService")
            .fallbackToNormalDispatch(orderId)
            .catch((err) => logger.error(`dispatchManager: free-booking fallback failed for order ${orderId}:`, err));
        }
        const offeredSoFar = await orderStage.offeredRiderIds(orderId);
        for (const t of state.timers) clearTimeout(t);
        state.timers.clear();
        activeDispatches.delete(orderId);
        await startDispatch(order, null, { stage: nextStage, earlierStageRiderIds: offeredSoFar });
        return;
      }
    }
```

- [ ] **Step 11: Run the dispatch suite**

Run: `npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS - all 63 pre-existing tests plus the 8 new ones (71).

Verified while writing this plan: with the edits of steps 4-10 the file ran 68 tests green (63 existing + the first 5 new cases); the batch-size and the two superseded tests were added afterwards together with step 9b, so run the whole file and expect 71 passing. If the "free -> daily -> normal" test shows only two stages, check the loop uses `advanceTimersByTimeAsync(1)`; do not change production code to satisfy a timing guess.

- [ ] **Step 12: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/tierPenaltyService.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(tiered-dispatch): stage-aware dispatch, offer tier/penalty payload, stage advance"
```

---

### Task 7: Penalty service (`tierPenaltyService.js`) and push helper

**Files:**
- Modify: `backend/src/services/pushNotifier.js` (add `notifyDriverTierPenalty`, export it)
- Overwrite: `backend/src/services/tierPenaltyService.js`
- Test: `backend/src/services/__tests__/tierPenaltyService.test.js`

**Interfaces:**
- Consumes: `tierPenaltyRules`, `tieredDispatchSettings.getTierSettings`, `driverOrderEventService`, `walletNotifier.notifyDriverWalletTransaction(riderId,{type,amount,remark})`, `pushNotifier.notifyDriverTierPenalty(fcmToken, {orderId, amount, pct, nextPct, deferred})`.
- Produces:
  - `previewForOffer({riderId, stage, order}) -> {pct, amount}` (never throws; zeros for normal / penalties off)
  - `onMiss({orderId, riderId, event, stage, fcmToken}) -> {applied, duplicate?, ignored?, penalty?, missNo?, pct?, amount?, status?}` (never throws; logs the `rejected`/`skipped` event, or `superseded` and `{applied:false, ignored:true}` when the order is no longer open)
  - `applyCancelPenalty({orderId, riderId, tier}) -> same shape` (kind `"cancel"`, uses `cancelPenaltyPct`, no counter)
  - `waive({penaltyId, adminId}) -> {waived:true}|{alreadyWaived:true}` (throws `Error` with `statusCode` 404 if missing)
  - `resetCounter({riderId, tier, adminId}) -> void`
  - `settlePendingForEnrollment(tx, {enrollmentId, riderId}) -> Promise<number>` total collected

- [ ] **Step 1: Add the push helper to `pushNotifier.js`**

Next to `notifyDriverAdvancePaymentTimeoutCancel`, add:

```js
/** Tiered dispatch: tells a driver a penalty was applied and what their next skip/reject will cost. */
async function notifyDriverTierPenalty(fcmToken, { orderId, amount, pct, nextPct, deferred }) {
  return sendPushNotification(
    fcmToken,
    "Penalty applied",
    `Rs ${amount} (${pct}%) penalty for order #${orderId}${deferred ? ", adjusted against your Daily Driver payout" : ""}. ` +
      `Your next skip or reject will cost ${nextPct}% of the order fare.`,
    { type: "tier_penalty", order_id: String(orderId), pct: String(pct), next_pct: String(nextPct) },
    "order_dismiss_channel_v1"
  );
}

/** Tiered dispatch: tells a driver the admin's decision on their cancel request. */
async function notifyDriverCancelDecision(fcmToken, { orderId, approved }) {
  return sendPushNotification(
    fcmToken,
    approved ? "Cancel request approved" : "Cancel request rejected",
    approved
      ? `Order #${orderId} has been taken off you. A penalty may apply.`
      : `Your cancel request for order #${orderId} was rejected. Please complete the order.`,
    { type: "cancel_decision", order_id: String(orderId), approved: String(Boolean(approved)) },
    "order_dismiss_channel_v1"
  );
}
```

and add `notifyDriverTierPenalty, notifyDriverCancelDecision,` to the file's `module.exports` object.

- [ ] **Step 2: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  driver_tier_penalty_counter: { upsert: jest.fn(), findUnique: jest.fn() },
  driver_tier_penalty: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-11T10:00:00Z") }));
jest.mock("../tieredDispatchSettings", () => ({ getTierSettings: jest.fn() }));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { REJECTED: "rejected", SKIPPED: "skipped", SUPERSEDED: "superseded", PENALTY: "penalty", PENALTY_WAIVED: "penalty_waived", COUNTER_RESET: "counter_reset" },
  logEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../pushNotifier", () => ({ notifyDriverTierPenalty: jest.fn().mockResolvedValue() }));

const { Prisma } = require("@prisma/client");
const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");
const events = require("../driverOrderEventService");
const walletNotifier = require("../walletNotifier");
const pushNotifier = require("../pushNotifier");
const svc = require("../tierPenaltyService");

const ON = { tieredEnabled: true, penaltyEnabled: true, ladder: [5, 10, 20, 50, 100], cancelPenaltyPct: 100 };

function makeTx({ existing = null, misses = 1, total = 500, dutyLog = null, history = null, orderState = {} } = {}) {
  const tx = {
    driver_tier_penalty: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 70, ...data })),
    },
    pkg_order: { findUnique: jest.fn().mockResolvedValue({ total_dcharge: total, rid: 0, order_status: 0, o_status: "Pending", ...orderState }) },
    driver_tier_penalty_counter: { upsert: jest.fn().mockResolvedValue({ misses }) },
    daily_driver_duty_log: { findFirst: jest.fn().mockResolvedValue(dutyLog) },
    tbl_rider: { update: jest.fn().mockResolvedValue({}) },
    tbl_wallet_history: { create: jest.fn().mockResolvedValue({ id: 5 }), findFirst: jest.fn().mockResolvedValue(history) },
  };
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}

beforeEach(() => {
  jest.clearAllMocks();
  settings.getTierSettings.mockResolvedValue(ON);
  prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
  // The order is still open (unassigned, pending) unless a test says otherwise.
  prisma.pkg_order.findUnique.mockResolvedValue({ rid: 0, order_status: 0, o_status: "Pending" });
});

describe("onMiss", () => {
  it("an order someone else already took: no penalty, counter untouched, logged as superseded and not as a skip", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 14, order_status: 1, o_status: "Processing" });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" });
    expect(res).toEqual({ applied: false, ignored: true });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "superseded", tier: "free" }));
    expect(events.logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ event: "skipped" }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("an order the customer cancelled is ignored the same way", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 0, order_status: 4, o_status: "Cancelled" });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "daily" });
    expect(res).toEqual({ applied: false, ignored: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("if the order is taken between the pre-check and the penalty transaction the counter still does not move", async () => {
    const tx = makeTx({ orderState: { rid: 14, order_status: 1, o_status: "Processing" } });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res).toMatchObject({ applied: false, ignored: true });
    expect(tx.driver_tier_penalty_counter.upsert).not.toHaveBeenCalled();
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("normal tier: logs the event, never penalises", async () => {
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: null });
    expect(res.applied).toBe(false);
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ tier: "normal", event: "skipped" }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("penalties switched off: logs, no penalty", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, penaltyEnabled: false });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res.applied).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("free tier, first miss: 5% of the order total debited from the wallet at once", async () => {
    const tx = makeTx({ misses: 1, total: 500 });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" });
    expect(res).toMatchObject({ applied: true, missNo: 1, pct: 5, amount: 25, status: "collected" });
    expect(tx.driver_tier_penalty.create.mock.calls[0][0].data).toMatchObject({
      rider_id: 9, order_id: 50, tier: "free", kind: "miss", event: "skipped", miss_no: 1, pct: 5, base_amount: 500, amount: 25, status: "collected",
    });
    expect(tx.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 25 } } });
    expect(tx.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({
      user_id: 9, amount: 25, type: "debit", wallet_type: "driver", order_id: 50, payment_id: "tier_penalty:50:9:miss",
    });
    expect(walletNotifier.notifyDriverWalletTransaction).toHaveBeenCalled();
    expect(pushNotifier.notifyDriverTierPenalty).toHaveBeenCalledWith("tok", expect.objectContaining({ amount: 25, pct: 5, nextPct: 10, deferred: false }));
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "penalty", penaltyPct: 5, penaltyAmount: 25, missNo: 1 }));
  });

  it("the 5th and later misses are 100%", async () => {
    makeTx({ misses: 5, total: 200 });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res).toMatchObject({ missNo: 5, pct: 100, amount: 200 });
    makeTx({ misses: 9, total: 200 });
    expect((await svc.onMiss({ orderId: 51, riderId: 9, event: "rejected", stage: "free" })).pct).toBe(100);
  });

  it("daily tier with a punched-in enrollment: deferred to settlement, wallet untouched", async () => {
    const tx = makeTx({ misses: 2, total: 400, dutyLog: { enrollment_id: 33 } });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "daily" });
    expect(res).toMatchObject({ applied: true, pct: 10, amount: 40, status: "pending_daily" });
    expect(tx.driver_tier_penalty.create.mock.calls[0][0].data.enrollment_id).toBe(33);
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
    expect(walletNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
    expect(pushNotifier.notifyDriverTierPenalty).toHaveBeenCalledWith("tok", expect.objectContaining({ deferred: true }));
  });

  it("a second event for the same offer (reject after timeout) adds no penalty and does not touch the counter", async () => {
    const tx = makeTx({ existing: { id: 70 } });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res).toMatchObject({ applied: false, duplicate: true });
    expect(tx.driver_tier_penalty_counter.upsert).not.toHaveBeenCalled();
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("a concurrent duplicate (unique violation) is reported as duplicate, not an error", async () => {
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" });
    expect(res).toMatchObject({ applied: false, duplicate: true });
  });

  it("never throws on an unexpected failure", async () => {
    prisma.$transaction.mockRejectedValue(new Error("db down"));
    await expect(svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" })).resolves.toMatchObject({ applied: false, error: true });
  });
});

describe("applyCancelPenalty", () => {
  it("charges the configured cancel percentage and does not use the ladder counter", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, cancelPenaltyPct: 40 });
    const tx = makeTx({ total: 300 });
    const res = await svc.applyCancelPenalty({ orderId: 50, riderId: 9, tier: "free" });
    expect(res).toMatchObject({ applied: true, pct: 40, amount: 120, status: "collected" });
    expect(tx.driver_tier_penalty_counter.upsert).not.toHaveBeenCalled();
    expect(tx.driver_tier_penalty.create.mock.calls[0][0].data).toMatchObject({ kind: "cancel", event: "cancel_approved", miss_no: null });
  });

  it("is skipped when penalties are off", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, penaltyEnabled: false });
    expect(await svc.applyCancelPenalty({ orderId: 50, riderId: 9, tier: "free" })).toMatchObject({ applied: false });
  });
});

describe("previewForOffer", () => {
  it("is zero for the normal tier and when penalties are off", async () => {
    expect(await svc.previewForOffer({ riderId: 9, stage: null, order: { total_dcharge: 500 } })).toEqual({ pct: 0, amount: 0 });
    settings.getTierSettings.mockResolvedValue({ ...ON, penaltyEnabled: false });
    expect(await svc.previewForOffer({ riderId: 9, stage: "free", order: { total_dcharge: 500 } })).toEqual({ pct: 0, amount: 0 });
  });

  it("previews the NEXT miss: counter + 1", async () => {
    prisma.driver_tier_penalty_counter.findUnique.mockResolvedValue({ misses: 2 });
    expect(await svc.previewForOffer({ riderId: 9, stage: "free", order: { total_dcharge: 500 } })).toEqual({ pct: 20, amount: 100 });
    prisma.driver_tier_penalty_counter.findUnique.mockResolvedValue(null);
    expect(await svc.previewForOffer({ riderId: 9, stage: "daily", order: { total_dcharge: 500 } })).toEqual({ pct: 5, amount: 25 });
  });
});

describe("waive", () => {
  it("a collected penalty is credited back to the wallet once", async () => {
    const tx = {
      driver_tier_penalty: { findUnique: jest.fn().mockResolvedValue({ id: 70, rider_id: 9, order_id: 50, status: "collected", amount: 25, tier: "free" }), update: jest.fn().mockResolvedValue({}) },
      tbl_wallet_history: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      tbl_rider: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    expect(await svc.waive({ penaltyId: 70, adminId: 1 })).toEqual({ waived: true });
    expect(tx.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 25 } } });
    expect(tx.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({ type: "credit", payment_id: "tier_penalty_waive:70", amount: 25 });
    expect(tx.driver_tier_penalty.update.mock.calls[0][0].data).toMatchObject({ status: "waived", waived_by: 1 });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "penalty_waived" }));
  });

  it("a pending_daily penalty is just marked waived, no wallet change", async () => {
    const tx = {
      driver_tier_penalty: { findUnique: jest.fn().mockResolvedValue({ id: 71, rider_id: 9, order_id: 50, status: "pending_daily", amount: 40, tier: "daily" }), update: jest.fn().mockResolvedValue({}) },
      tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
      tbl_rider: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    await svc.waive({ penaltyId: 71, adminId: 1 });
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
    expect(tx.driver_tier_penalty.update.mock.calls[0][0].data.status).toBe("waived");
  });

  it("waiving twice is a no-op, a missing penalty is a 404", async () => {
    const tx = { driver_tier_penalty: { findUnique: jest.fn().mockResolvedValue({ id: 70, status: "waived" }) } };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    expect(await svc.waive({ penaltyId: 70, adminId: 1 })).toEqual({ alreadyWaived: true });
    tx.driver_tier_penalty.findUnique.mockResolvedValue(null);
    await expect(svc.waive({ penaltyId: 99, adminId: 1 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("settlePendingForEnrollment", () => {
  it("collects every pending penalty of the enrollment from the wallet in one decrement and ledgers each", async () => {
    const tx = {
      driver_tier_penalty: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, order_id: 50, amount: 40, event: "skipped" },
          { id: 2, order_id: 51, amount: 60, event: "rejected" },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      tbl_rider: { update: jest.fn().mockResolvedValue({}) },
      tbl_wallet_history: { create: jest.fn().mockResolvedValue({}) },
      daily_driver_ledger: { createMany: jest.fn().mockResolvedValue({}) },
    };
    const total = await svc.settlePendingForEnrollment(tx, { enrollmentId: 33, riderId: 9 });
    expect(total).toBe(100);
    expect(tx.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(tx.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 100 } } });
    expect(tx.driver_tier_penalty.update).toHaveBeenCalledTimes(2);
    expect(tx.daily_driver_ledger.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ rider_id: 9, enrollment_id: 33, order_id: 50, entry_type: "PENALTY_DEDUCTION", amount: 40, balance_effect: "DEBIT" }),
      expect.objectContaining({ rider_id: 9, enrollment_id: 33, order_id: 51, entry_type: "PENALTY_DEDUCTION", amount: 60, balance_effect: "DEBIT" }),
    ]);
  });

  it("does nothing when there are no pending penalties", async () => {
    const tx = { driver_tier_penalty: { findMany: jest.fn().mockResolvedValue([]) }, tbl_rider: { update: jest.fn() } };
    expect(await svc.settlePendingForEnrollment(tx, { enrollmentId: 33, riderId: 9 })).toBe(0);
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
  });
});

describe("resetCounter", () => {
  it("zeroes the rider's counter for the tier and logs it", async () => {
    prisma.driver_tier_penalty_counter.upsert.mockResolvedValue({});
    await svc.resetCounter({ riderId: 9, tier: "free", adminId: 1 });
    expect(prisma.driver_tier_penalty_counter.upsert).toHaveBeenCalledWith({
      where: { rider_id_tier: { rider_id: 9, tier: "free" } },
      update: { misses: 0 },
      create: { rider_id: 9, tier: "free", misses: 0 },
    });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "counter_reset", riderId: 9 }));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest src/services/__tests__/tierPenaltyService.test.js`
Expected: FAIL (the placeholder from Task 6 has none of these functions / behaviours).

- [ ] **Step 4: Implement `tierPenaltyService.js`**

```js
const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const rules = require("./tierPenaltyRules");
const settings = require("./tieredDispatchSettings");
const events = require("./driverOrderEventService");
const walletNotifier = require("./walletNotifier");
const pushNotifier = require("./pushNotifier");

const notFound = (message) => Object.assign(new Error(message), { statusCode: 404 });
const missKey = (orderId, riderId) => `tier_penalty:${orderId}:${riderId}:miss`;
const cancelKey = (orderId, riderId) => `tier_penalty:${orderId}:${riderId}:cancel`;

/** What the driver's NEXT reject/skip would cost on this order (shown in the offer popup). Never throws. */
async function previewForOffer({ riderId, stage, order }) {
  if (!rules.isPenaltyTier(stage)) return { pct: 0, amount: 0 };
  try {
    const s = await settings.getTierSettings();
    if (!s.penaltyEnabled) return { pct: 0, amount: 0 };
    const counter = await prisma.driver_tier_penalty_counter.findUnique({
      where: { rider_id_tier: { rider_id: Number(riderId), tier: stage } },
      select: { misses: true },
    });
    const pct = rules.pctForMiss(s.ladder, (counter?.misses || 0) + 1);
    return { pct, amount: rules.penaltyAmount(order?.total_dcharge, pct) };
  } catch (err) {
    logger.error(`tierPenaltyService.previewForOffer failed for rider ${riderId}:`, err);
    return { pct: 0, amount: 0 };
  }
}

/** Still waiting for a driver: unassigned, not accepted, not cancelled. */
const isOpenOrder = (o) => Boolean(o) && Number(o.rid) === 0 && Number(o.order_status) === 0 && o.o_status !== "Cancelled";

async function isOrderOpen(orderId) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { rid: true, order_status: true, o_status: true } });
  return isOpenOrder(order);
}

async function openEnrollmentId(tx, riderId) {
  const log = await tx.daily_driver_duty_log.findFirst({
    where: { rider_id: riderId, status: "in_progress" },
    orderBy: { id: "desc" },
    select: { enrollment_id: true },
  });
  return log ? log.enrollment_id : null;
}

async function debitDriverWallet(tx, { riderId, orderId, amount, key, remark }) {
  await tx.tbl_rider.update({ where: { id: riderId }, data: { wallet_balance: { decrement: amount } } });
  await tx.tbl_wallet_history.create({
    data: { user_id: riderId, amount, type: "debit", remark, wallet_type: "driver", order_id: orderId, payment_id: key, created_at: istNow() },
  });
}

/**
 * Creates one penalty row (idempotent per order+rider+kind) and collects it. A miss also advances the
 * per-tier counter. Daily Drivers with an open enrollment are collected at settlement instead.
 */
async function createPenalty({ orderId, riderId, tier, kind, event, s }) {
  const oid = Number(orderId);
  const rid = Number(riderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.driver_tier_penalty.findFirst({ where: { order_id: oid, rider_id: rid, kind } });
      if (existing) return { applied: false, duplicate: true };

      const order = await tx.pkg_order.findUnique({ where: { id: oid }, select: { total_dcharge: true, rid: true, order_status: true, o_status: true } });
      // Taken by someone else (or cancelled) after the pre-check in onMiss: nothing is charged or counted.
      if (kind === "miss" && !isOpenOrder(order)) return { applied: false, ignored: true };
      const base = rules.round2(order?.total_dcharge || 0);
      let missNo = null;
      let pct;
      if (kind === "miss") {
        const counter = await tx.driver_tier_penalty_counter.upsert({
          where: { rider_id_tier: { rider_id: rid, tier } },
          create: { rider_id: rid, tier, misses: 1 },
          update: { misses: { increment: 1 } },
        });
        missNo = counter.misses;
        pct = rules.pctForMiss(s.ladder, missNo);
      } else {
        pct = s.cancelPenaltyPct;
      }
      const amount = rules.penaltyAmount(base, pct);
      const enrollmentId = tier === rules.TIER.DAILY ? await openEnrollmentId(tx, rid) : null;
      const status = enrollmentId ? "pending_daily" : "collected";

      const row = await tx.driver_tier_penalty.create({
        data: {
          rider_id: rid, order_id: oid, tier, kind, event, miss_no: missNo, pct, base_amount: base, amount, status,
          enrollment_id: enrollmentId, collected_at: status === "collected" ? new Date() : null,
        },
      });
      if (status === "collected" && amount > 0) {
        await debitDriverWallet(tx, {
          riderId: rid, orderId: oid, amount,
          key: kind === "miss" ? missKey(oid, rid) : cancelKey(oid, rid),
          remark: `Penalty for order #${oid} (${event.replace("_", " ")})`,
        });
      }
      return { applied: true, penalty: row, missNo, pct, amount, status, base };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { applied: false, duplicate: true };
    throw err;
  }
}

async function afterPenalty(result, { orderId, riderId, tier, event, s, fcmToken }) {
  await events.logEvent({
    riderId, orderId, tier, event: events.EVENTS.PENALTY, reason: event,
    penaltyPct: result.pct, penaltyAmount: result.amount, missNo: result.missNo,
  });
  if (result.status === "collected" && result.amount > 0) {
    walletNotifier
      .notifyDriverWalletTransaction(riderId, { type: "debit", amount: result.amount, remark: `Penalty for order #${orderId}` })
      .catch((err) => logger.error(`tierPenaltyService: wallet notify failed for rider ${riderId}:`, err));
  }
  let token = fcmToken;
  if (!token) {
    token = (await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { fcm_token: true } }).catch(() => null))?.fcm_token;
  }
  const nextPct = result.missNo != null ? rules.pctForMiss(s.ladder, result.missNo + 1) : result.pct;
  await Promise.resolve(
    pushNotifier.notifyDriverTierPenalty(token, {
      orderId, amount: result.amount, pct: result.pct, nextPct, deferred: result.status === "pending_daily",
    })
  ).catch((err) => logger.error(`tierPenaltyService: push failed for rider ${riderId}:`, err));
}

/**
 * A Free/Daily driver rejected (event "rejected") or let an offer expire (event "skipped"). Always logs
 * the event; penalises only Free/Daily stages and only when penalties are on. Never throws.
 */
async function onMiss({ orderId, riderId, event, stage = null, fcmToken = null }) {
  const tier = stage || rules.TIER.NORMAL;
  try {
    // Someone else took the order, or the customer cancelled, while this driver still had the popup: the offer
    // does not count (no penalty, counter untouched, excluded from the report rates).
    if (!(await isOrderOpen(orderId))) {
      await events.logEvent({ riderId, orderId, tier, event: events.EVENTS.SUPERSEDED });
      return { applied: false, ignored: true };
    }
    await events.logEvent({ riderId, orderId, tier, event });
    if (!rules.isPenaltyTier(tier)) return { applied: false };
    const s = await settings.getTierSettings();
    if (!s.penaltyEnabled) return { applied: false };
    const result = await createPenalty({ orderId, riderId, tier, kind: "miss", event, s });
    if (result.applied) await afterPenalty(result, { orderId, riderId, tier, event, s, fcmToken });
    return result;
  } catch (err) {
    logger.error(`tierPenaltyService.onMiss failed (order ${orderId}, rider ${riderId}):`, err);
    return { applied: false, error: true };
  }
}

/** Penalty for an admin-approved cancel request (kind "cancel"; not on the ladder). Never throws. */
async function applyCancelPenalty({ orderId, riderId, tier }) {
  try {
    const s = await settings.getTierSettings();
    if (!s.penaltyEnabled) return { applied: false };
    const result = await createPenalty({ orderId, riderId, tier, kind: "cancel", event: "cancel_approved", s });
    if (result.applied) await afterPenalty(result, { orderId, riderId, tier, event: "cancel_approved", s, fcmToken: null });
    return result;
  } catch (err) {
    logger.error(`tierPenaltyService.applyCancelPenalty failed (order ${orderId}, rider ${riderId}):`, err);
    return { applied: false, error: true };
  }
}

async function waive({ penaltyId, adminId }) {
  let notify = null;
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.driver_tier_penalty.findUnique({ where: { id: Number(penaltyId) } });
    if (!row) throw notFound("Penalty not found");
    if (row.status === "waived") return { alreadyWaived: true };

    const amount = Number(row.amount);
    if (row.status === "collected" && amount > 0) {
      const key = `tier_penalty_waive:${row.id}`;
      const dup = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "driver" } });
      if (!dup) {
        await tx.tbl_rider.update({ where: { id: row.rider_id }, data: { wallet_balance: { increment: amount } } });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: row.rider_id, amount, type: "credit", remark: `Penalty waived for order #${row.order_id}`,
            wallet_type: "driver", order_id: row.order_id, payment_id: key, created_at: istNow(),
          },
        });
        notify = { riderId: row.rider_id, amount, orderId: row.order_id };
      }
    }
    await tx.driver_tier_penalty.update({ where: { id: row.id }, data: { status: "waived", waived_by: adminId ?? null, waived_at: new Date() } });
    await events.logEvent({ riderId: row.rider_id, orderId: row.order_id, tier: row.tier, event: events.EVENTS.PENALTY_WAIVED, penaltyAmount: amount });
    return { waived: true };
  });
  if (notify) {
    walletNotifier
      .notifyDriverWalletTransaction(notify.riderId, { type: "credit", amount: notify.amount, remark: `Penalty waived for order #${notify.orderId}` })
      .catch((err) => logger.error(`tierPenaltyService.waive: wallet notify failed for rider ${notify.riderId}:`, err));
  }
  return result;
}

async function resetCounter({ riderId, tier, adminId }) {
  await prisma.driver_tier_penalty_counter.upsert({
    where: { rider_id_tier: { rider_id: Number(riderId), tier } },
    update: { misses: 0 },
    create: { rider_id: Number(riderId), tier, misses: 0 },
  });
  await events.logEvent({ riderId, orderId: 0, tier, event: events.EVENTS.COUNTER_RESET, reason: `reset by admin ${adminId ?? "?"}` });
}

/**
 * Called inside dailyDriverSettlementService.settleEnrollment's transaction: collects every penalty that
 * was deferred to this enrollment. The settlement has already credited the company payout to the wallet,
 * so decrementing here nets the penalty against what the company owed; any excess leaves the wallet
 * negative (a due), exactly as the manager decided.
 */
async function settlePendingForEnrollment(tx, { enrollmentId, riderId }) {
  const rows = await tx.driver_tier_penalty.findMany({ where: { enrollment_id: Number(enrollmentId), status: "pending_daily" } });
  if (rows.length === 0) return 0;
  const total = rules.round2(rows.reduce((sum, r) => sum + Number(r.amount), 0));
  const rid = Number(riderId);
  const now = new Date();
  for (const r of rows) {
    await tx.driver_tier_penalty.update({ where: { id: r.id }, data: { status: "collected", collected_at: now } });
    if (Number(r.amount) > 0) {
      await tx.tbl_wallet_history.create({
        data: {
          user_id: rid, amount: Number(r.amount), type: "debit",
          remark: `Penalty for order #${r.order_id} (${r.event}) adjusted against Daily Driver settlement`,
          wallet_type: "driver", order_id: r.order_id, payment_id: missKey(r.order_id, rid), created_at: istNow(),
        },
      });
    }
  }
  if (total > 0) await tx.tbl_rider.update({ where: { id: rid }, data: { wallet_balance: { decrement: total } } });
  await tx.daily_driver_ledger.createMany({
    data: rows.map((r) => ({
      rider_id: rid, enrollment_id: Number(enrollmentId), order_id: r.order_id, entry_type: "PENALTY_DEDUCTION",
      amount: Number(r.amount), balance_effect: "DEBIT", notes: `Penalty (${r.event}) for order #${r.order_id}`, created_at: istNow(),
    })),
  });
  return total;
}

module.exports = { previewForOffer, onMiss, applyCancelPenalty, waive, resetCounter, settlePendingForEnrollment };
```

Note: `waive` for a `kind="cancel"` row uses the same path; its original ledger key was `cancelKey`, the waive key is always `tier_penalty_waive:<id>`.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx jest src/services/__tests__/tierPenaltyService.test.js`
Expected: PASS (20 tests). Then run `npx jest src/services/__tests__/dispatchManager.test.js` (still PASS, it mocks this module).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tierPenaltyService.js backend/src/services/pushNotifier.js backend/src/services/__tests__/tierPenaltyService.test.js
git commit -m "feat(tiered-dispatch): escalating penalties, Daily deferral, waive and counter reset"
```

---

### Task 8: Trip lifecycle hooks (reject, accepted, completed)

**Files:**
- Modify: `backend/src/services/tripLifecycle.js` (requires at top of file; `rejectOrder` ~436-438; `finalizeAcceptedOrder` ~201-206; completion ~769)
- Test: `backend/src/services/__tests__/tripLifecycle.tierHooks.test.js`

**Interfaces:**
- Consumes: `orderStageService.getStage`, `tierPenaltyService.onMiss`, `driverOrderEventService.logEvent/EVENTS`.

- [ ] **Step 1: Write the failing test**

```js
// A minimal db mock: the real Prisma client's model delegates cannot be spied on reliably. tripLifecycle only
// touches prisma inside functions, so requiring it with this mock is safe. If requiring it ever fails with
// "Cannot read properties of undefined", add the missing delegate to this object.
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  tbl_order_requests: { updateMany: jest.fn() },
}));
jest.mock("../dispatchManager", () => ({ recordModel1Outcome: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../orderStageService", () => ({ getStage: jest.fn() }));
jest.mock("../tierPenaltyService", () => ({ onMiss: jest.fn().mockResolvedValue({ applied: false }) }));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { ACCEPTED: "accepted", COMPLETED: "completed" },
  logEvent: jest.fn().mockResolvedValue(null),
}));

const prisma = require("../../config/db");
const orderStage = require("../orderStageService");
const tierPenalty = require("../tierPenaltyService");
const tripLifecycle = require("../tripLifecycle");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("rejectOrder -> tier penalty hook", () => {
  it("reports a real reject (row flipped to '10') with the order's stage", async () => {
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
    orderStage.getStage.mockResolvedValue("free");

    await tripLifecycle.rejectOrder(50, 9, 6);

    expect(tierPenalty.onMiss).toHaveBeenCalledWith(expect.objectContaining({ orderId: 50, riderId: 9, event: "rejected", stage: "free" }));
  });

  it("does not report anything when no offer row was affected", async () => {
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 0 });

    await tripLifecycle.rejectOrder(50, 9, 6);

    expect(tierPenalty.onMiss).not.toHaveBeenCalled();
  });

  it("a failing penalty service never fails the reject", async () => {
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
    orderStage.getStage.mockResolvedValue("daily");
    tierPenalty.onMiss.mockRejectedValue(new Error("boom"));

    await expect(tripLifecycle.rejectOrder(50, 9, 6)).resolves.toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/__tests__/tripLifecycle.tierHooks.test.js`
Expected: FAIL - `tierPenalty.onMiss` never called.

- [ ] **Step 3: Edit `tripLifecycle.js` - requires**

Next to the other service requires near the top of the file (for example after the `freeBookingService` require) add:

```js
const orderStage = require("./orderStageService");
const tierPenalty = require("./tierPenaltyService");
const driverOrderEvents = require("./driverOrderEventService");
```

- [ ] **Step 4: Edit `rejectOrder`**

Replace

```js
  if (result.count > 0) {
    await dispatchManager.recordModel1Outcome(riderId, resolvedPackageId, "miss");
  }
```

with

```js
  if (result.count > 0) {
    await dispatchManager.recordModel1Outcome(riderId, resolvedPackageId, "miss");
    // Tiered dispatch: log the reject and penalise it when it happened in a Free/Daily stage. A reject that
    // arrives after the same offer's timeout was already penalised as a skip is a no-op in the penalty service.
    try {
      const stage = await orderStage.getStage(orderId);
      await tierPenalty.onMiss({ orderId, riderId, event: "rejected", stage });
    } catch (err) {
      logger.error(`rejectOrder: tier penalty hook failed for order ${orderId}:`, err);
    }
  }
```

- [ ] **Step 5: Edit `finalizeAcceptedOrder` and the completion path**

At the top of `finalizeAcceptedOrder`, directly before the `await freeBookingService.recordAcceptance(...)` line, add:

```js
  orderStage
    .getStage(orderId)
    .then((stage) => driverOrderEvents.logEvent({ riderId, orderId, tier: stage || "normal", event: driverOrderEvents.EVENTS.ACCEPTED }))
    .catch(() => {});
```

Directly after the existing `freeBookingService.markCompleted({ orderId, finalTotal }).catch(...)` statement in the completion path (inside `updateStatus`, where `riderId` is the function's parameter) add:

```js
    orderStage
      .getStage(orderId)
      .then((stage) => driverOrderEvents.logEvent({ riderId, orderId, tier: stage || "normal", event: driverOrderEvents.EVENTS.COMPLETED }))
      .catch(() => {});
```

- [ ] **Step 6: Run the tests**

Run: `npx jest src/services/__tests__/tripLifecycle.tierHooks.test.js src/services/__tests__/tripLifecycle.test.js src/services/__tests__/tripLifecycleSettlement.test.js src/services/__tests__/tripLifecycleTrial.test.js`
Expected: PASS for all four files.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/services/__tests__/tripLifecycle.tierHooks.test.js
git commit -m "feat(tiered-dispatch): penalise rejects, log accepted/completed events"
```

---

### Task 9: Daily settlement collects pending penalties

**Files:**
- Modify: `backend/src/services/dailyDriverSettlementService.js` (`settleEnrollment`, after the wallet updates and before the enrollment status update)
- Test: `backend/src/services/__tests__/dailyDriverSettlementPenalty.test.js`

**Interfaces:**
- Consumes: `tierPenaltyService.settlePendingForEnrollment(tx, {enrollmentId, riderId}) -> number`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({ $transaction: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tierPenaltyService", () => ({ settlePendingForEnrollment: jest.fn() }));

const prisma = require("../../config/db");
const tierPenalty = require("../tierPenaltyService");
const { settleEnrollment } = require("../dailyDriverSettlementService");

function makeTx() {
  const enrollment = {
    id: 33, rider_id: 9, plan_id: 1, status: "approved", enrollment_date: new Date("2026-10-11T00:00:00Z"),
    plan: {
      plan_name: "Standard", price: 1400, required_duty_hours: 10, free_km: 100, extra_km_rate: 10,
      overtime_hourly_rate: 100, duty_start_time: "08:00:00", duty_end_time: "18:00:00",
    },
    duty_log: { id: 3, total_in_zone_minutes: 600 },
  };
  return {
    daily_driver_enrollment: { findUnique: jest.fn().mockResolvedValue(enrollment), update: jest.fn().mockResolvedValue({}) },
    pkg_order: { findMany: jest.fn().mockResolvedValue([]) },
    daily_driver_duty_log: { update: jest.fn().mockResolvedValue({ id: 3 }) },
    daily_driver_ledger: { findFirst: jest.fn().mockResolvedValue(null), createMany: jest.fn().mockResolvedValue({}) },
    tbl_rider: { update: jest.fn().mockResolvedValue({}) },
  };
}

it("collects the enrollment's pending penalties after crediting the payout, before marking it settled", async () => {
  const tx = makeTx();
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  tierPenalty.settlePendingForEnrollment.mockResolvedValue(300);
  const order = [];
  tx.tbl_rider.update.mockImplementation(async () => { order.push("payout"); return {}; });
  tierPenalty.settlePendingForEnrollment.mockImplementation(async () => { order.push("penalties"); return 300; });
  tx.daily_driver_enrollment.update.mockImplementation(async () => { order.push("settled"); return {}; });

  await settleEnrollment(33);

  expect(tierPenalty.settlePendingForEnrollment).toHaveBeenCalledWith(tx, { enrollmentId: 33, riderId: 9 });
  expect(order).toEqual(["payout", "penalties", "settled"]);
});

it("an already settled enrollment is returned untouched and no penalty is collected twice", async () => {
  const tx = makeTx();
  const settled = { ...(await tx.daily_driver_enrollment.findUnique()), status: "settlement_completed" };
  tx.daily_driver_enrollment.findUnique.mockResolvedValue(settled);
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));

  await settleEnrollment(33);

  expect(tierPenalty.settlePendingForEnrollment).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/__tests__/dailyDriverSettlementPenalty.test.js`
Expected: FAIL - `settlePendingForEnrollment` not called.

- [ ] **Step 3: Edit `settleEnrollment`**

At the top of `dailyDriverSettlementService.js` add `const tierPenalty = require("./tierPenaltyService");` after the existing requires. In `settleEnrollment`, directly before the line `await tx.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "settlement_completed" } });` add:

```js
    // Tiered dispatch: penalties deferred to this enrollment are netted against the payout credited above.
    // A penalty larger than the payout leaves the wallet negative (a due), as the manager decided.
    await tierPenalty.settlePendingForEnrollment(tx, { enrollmentId: enrollment.id, riderId: enrollment.rider_id });
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/services/__tests__/dailyDriverSettlementPenalty.test.js src/services/__tests__/dailyDriverSettlementService.test.js`
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dailyDriverSettlementService.js backend/src/services/__tests__/dailyDriverSettlementPenalty.test.js
git commit -m "feat(tiered-dispatch): net deferred Daily Driver penalties at settlement"
```

---

### Task 10: Cancel approval (`cancelRequestService.js`) and the driver-cancel gate

**Files:**
- Create: `backend/src/services/cancelRequestService.js`
- Modify: `backend/src/services/tripLifecycle.js` (`driverCancel`, top of the function)
- Modify: `backend/src/controllers/orderController.js` (`driverCancel` handler)
- Test: `backend/src/services/__tests__/cancelRequestService.test.js`, add cases to `backend/src/services/__tests__/tripLifecycle.tierHooks.test.js`

**Interfaces:**
- Consumes: `tieredDispatchSettings.getTierSettings`, `orderStageService.getStage/offeredRiderIds`, `tierPenaltyRules.nextStage/isPenaltyTier`, `tierPenaltyService.applyCancelPenalty`, `driverOrderEventService`, `dispatchManager.startDispatch/emitCustomerEvent`, `pushNotifier.notifyDriverCancelDecision`.
- Produces:
  - `gateDriverCancel({orderId, riderId, reason}) -> {mode:"direct"} | {mode:"blocked"} | {mode:"requested", requestId, duplicate?}`
  - `approve({requestId, adminId}) -> {ok:true, nextStage, penalty} | {ok:false, reason:"order_state_changed"}` (throws `statusCode` 404/409)
  - `reject({requestId, adminId}) -> {ok:true}`
  - `listRequests({status, cityId}) -> rows` (`cityId` null = all cities)

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn() },
  order_cancel_request: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  driver_trip_progress: { deleteMany: jest.fn() },
  tbl_order_requests: { updateMany: jest.fn() },
  free_booking_order: { updateMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../tieredDispatchSettings", () => ({ getTierSettings: jest.fn() }));
jest.mock("../orderStageService", () => ({ getStage: jest.fn(), offeredRiderIds: jest.fn() }));
jest.mock("../tierPenaltyService", () => ({ applyCancelPenalty: jest.fn() }));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { CANCEL_REQUESTED: "cancel_requested", CANCELLED: "cancelled", CANCEL_REJECTED: "cancel_rejected" },
  logEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("../dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(), emitCustomerEvent: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyDriverCancelDecision: jest.fn().mockResolvedValue() }));

const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");
const orderStage = require("../orderStageService");
const tierPenalty = require("../tierPenaltyService");
const events = require("../driverOrderEventService");
const dispatchManager = require("../dispatchManager");
const svc = require("../cancelRequestService");

const ON = { tieredEnabled: true, penaltyEnabled: true, ladder: [5, 10, 20, 50, 100], cancelPenaltyPct: 100 };

beforeEach(() => {
  jest.clearAllMocks();
  settings.getTierSettings.mockResolvedValue(ON);
});

describe("gateDriverCancel", () => {
  const order = (o = {}) => ({ rid: 9, uid: 7, o_status: "Processing", ...o });

  it("tiered dispatch off: cancel works as before", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, tieredEnabled: false });
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9, reason: "x" })).toEqual({ mode: "direct" });
  });

  it("an order accepted in the normal stage (or with no stage) cancels directly", async () => {
    orderStage.getStage.mockResolvedValue("normal");
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
    orderStage.getStage.mockResolvedValue(null);
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
  });

  it("a driver who is not the assigned one gets the normal 'not assigned' error path", async () => {
    orderStage.getStage.mockResolvedValue("free");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 4 }));
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
  });

  it("a Free/Daily order before pickup creates a pending request and logs it", async () => {
    orderStage.getStage.mockResolvedValue("free");
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    prisma.order_cancel_request.findFirst.mockResolvedValue(null);
    prisma.order_cancel_request.create.mockResolvedValue({ id: 12 });
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9, reason: "breakdown" })).toEqual({ mode: "requested", requestId: 12 });
    expect(prisma.order_cancel_request.create).toHaveBeenCalledWith({
      data: { order_id: 50, rider_id: 9, tier: "free", reason: "breakdown", status: "pending" },
    });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "cancel_requested", tier: "free" }));
  });

  it("asking twice reuses the pending request", async () => {
    orderStage.getStage.mockResolvedValue("daily");
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    prisma.order_cancel_request.findFirst.mockResolvedValue({ id: 12 });
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "requested", requestId: 12, duplicate: true });
    expect(prisma.order_cancel_request.create).not.toHaveBeenCalled();
  });

  it("after pickup a Free/Daily driver cannot cancel at all", async () => {
    orderStage.getStage.mockResolvedValue("free");
    for (const o_status of ["Pickup", "On_Route", "Arrived_Drop"]) {
      prisma.pkg_order.findUnique.mockResolvedValue(order({ o_status }));
      expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "blocked" });
    }
  });

  it("an already cancelled or completed order falls through to the normal idempotent handling", async () => {
    orderStage.getStage.mockResolvedValue("free");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ o_status: "Cancelled" }));
    expect(await svc.gateDriverCancel({ orderId: 50, riderId: 9 })).toEqual({ mode: "direct" });
  });
});

describe("approve", () => {
  const request = { id: 12, order_id: 50, rider_id: 9, tier: "free", reason: "breakdown" };

  beforeEach(() => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 1 });
    prisma.order_cancel_request.findUnique.mockResolvedValue(request);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.driver_trip_progress.deleteMany.mockResolvedValue({});
    prisma.tbl_order_requests.updateMany.mockResolvedValue({});
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, rid: 0, order_status: 0, allowed_delivery_types: "[6]" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
    orderStage.offeredRiderIds.mockResolvedValue([9, 10]);
    tierPenalty.applyCancelPenalty.mockResolvedValue({ applied: true, penalty: { id: 70 }, amount: 100 });
    prisma.order_cancel_request.update.mockResolvedValue({});
  });

  it("takes the order off the driver, penalises, and restarts dispatch at the NEXT stage excluding earlier riders", async () => {
    const res = await svc.approve({ requestId: 12, adminId: 1 });
    expect(res).toMatchObject({ ok: true, nextStage: "daily" });
    expect(prisma.order_cancel_request.updateMany).toHaveBeenCalledWith({
      where: { id: 12, status: "pending" }, data: expect.objectContaining({ status: "approved", decided_by: 1 }),
    });
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, rider_id: 9, status: "accepted" }, data: { status: "10" },
    });
    expect(tierPenalty.applyCancelPenalty).toHaveBeenCalledWith({ orderId: 50, riderId: 9, tier: "free" });
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:driver_unassigned", { order_id: "50" });
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 50 }), null, { stage: "daily", earlierStageRiderIds: [9, 10] }
    );
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "cancelled", tier: "free" }));
  });

  it("a Daily driver's approved cancel goes on to the normal stage", async () => {
    prisma.order_cancel_request.findUnique.mockResolvedValue({ ...request, tier: "daily" });
    const res = await svc.approve({ requestId: 12, adminId: 1 });
    expect(res.nextStage).toBe("normal");
    expect(prisma.free_booking_order.updateMany).not.toHaveBeenCalled();
  });

  it("if the order state changed (driver already picked up / customer cancelled) nothing is re-dispatched or penalised", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    const res = await svc.approve({ requestId: 12, adminId: 1 });
    expect(res).toEqual({ ok: false, reason: "order_state_changed" });
    expect(tierPenalty.applyCancelPenalty).not.toHaveBeenCalled();
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
    expect(prisma.order_cancel_request.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { status: "stale" } });
  });

  it("deciding a request twice is a 409", async () => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.approve({ requestId: 12, adminId: 1 })).rejects.toMatchObject({ statusCode: 409 });
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });
});

describe("reject", () => {
  it("keeps the order with the driver, logs it and tells the driver", async () => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 1 });
    prisma.order_cancel_request.findUnique.mockResolvedValue({ id: 12, order_id: 50, rider_id: 9, tier: "free" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
    expect(await svc.reject({ requestId: 12, adminId: 1 })).toEqual({ ok: true });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "cancel_rejected" }));
    expect(require("../pushNotifier").notifyDriverCancelDecision).toHaveBeenCalledWith("tok", { orderId: 50, approved: false });
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  it("deciding twice is a 409", async () => {
    prisma.order_cancel_request.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.reject({ requestId: 12, adminId: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("listRequests", () => {
  it("scopes by city when one is given", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 12 }]);
    expect(await svc.listRequests({ status: "pending", cityId: 3 })).toEqual([{ id: 12 }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
```

Add to `tripLifecycle.tierHooks.test.js` (same file as Task 8; add the extra mock at the top of that file next to the others):

```js
jest.mock("../cancelRequestService", () => ({ gateDriverCancel: jest.fn() }));
```

and append:

```js
describe("driverCancel -> approval gate", () => {
  const cancelRequestService = require("../cancelRequestService");

  it("returns a requested marker and cancels nothing when approval is required", async () => {
    cancelRequestService.gateDriverCancel.mockResolvedValue({ mode: "requested", requestId: 12 });
    const res = await tripLifecycle.driverCancel(50, 9, "breakdown");
    expect(res).toMatchObject({ requires_admin_approval: true, cancel_request_id: 12, refund_status: "cancel_requested" });
  });

  it("throws ORDER_NOT_CANCELLABLE after pickup for a Free/Daily driver", async () => {
    cancelRequestService.gateDriverCancel.mockResolvedValue({ mode: "blocked" });
    await expect(tripLifecycle.driverCancel(50, 9, "x")).rejects.toThrow("ORDER_NOT_CANCELLABLE");
  });

  it("automated system cancels (requireOrderStatus) never go through the gate", async () => {
    cancelRequestService.gateDriverCancel.mockClear();
    prisma.$transaction.mockRejectedValue(new Error("reached DB")); // the first DB call driverCancel makes
    await expect(tripLifecycle.driverCancel(50, 9, "timeout", { requireOrderStatus: 1 })).rejects.toThrow("reached DB");
    expect(cancelRequestService.gateDriverCancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/services/__tests__/cancelRequestService.test.js src/services/__tests__/tripLifecycle.tierHooks.test.js`
Expected: FAIL - module `../cancelRequestService` not found / gate not called.

- [ ] **Step 3: Implement `cancelRequestService.js`**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./tierPenaltyRules");
const settings = require("./tieredDispatchSettings");
const orderStage = require("./orderStageService");
const tierPenalty = require("./tierPenaltyService");
const events = require("./driverOrderEventService");
const pushNotifier = require("./pushNotifier");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/**
 * Decides what a driver-initiated cancel does (spec 3.1). "direct" = existing behaviour; "blocked" = after
 * pickup a Free/Daily driver cannot cancel; "requested" = a pending request was created (or already exists).
 */
async function gateDriverCancel({ orderId, riderId, reason }) {
  const s = await settings.getTierSettings();
  if (!s.tieredEnabled) return { mode: "direct" };

  const stage = await orderStage.getStage(orderId);
  if (!rules.isPenaltyTier(stage)) return { mode: "direct" };

  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { rid: true, uid: true, o_status: true } });
  // Not this driver's order, or already finished: let driverCancel produce its normal error / idempotent answer.
  if (!order || Number(order.rid) !== Number(riderId)) return { mode: "direct" };
  if (order.o_status === "Cancelled" || order.o_status === "Completed") return { mode: "direct" };
  if (order.o_status !== "Processing") return { mode: "blocked" };

  const pending = await prisma.order_cancel_request.findFirst({
    where: { order_id: Number(orderId), rider_id: Number(riderId), status: "pending" },
    select: { id: true },
  });
  if (pending) return { mode: "requested", requestId: pending.id, duplicate: true };

  const row = await prisma.order_cancel_request.create({
    data: { order_id: Number(orderId), rider_id: Number(riderId), tier: stage, reason: reason || null, status: "pending" },
  });
  await events.logEvent({ riderId, orderId, tier: stage, event: events.EVENTS.CANCEL_REQUESTED, reason });
  return { mode: "requested", requestId: row.id };
}

async function fcmTokenOf(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { fcm_token: true } }).catch(() => null);
  return rider?.fcm_token ?? null;
}

/** Admin approves: take the order off the driver, penalise, and re-dispatch from the next stage. */
async function approve({ requestId, adminId }) {
  const claimed = await prisma.order_cancel_request.updateMany({
    where: { id: Number(requestId), status: "pending" },
    data: { status: "approved", decided_by: adminId ?? null, decided_at: new Date() },
  });
  if (claimed.count !== 1) throw httpError(409, "This cancel request was already decided");

  const request = await prisma.order_cancel_request.findUnique({ where: { id: Number(requestId) } });
  if (!request) throw httpError(404, "Cancel request not found");
  const orderId = Number(request.order_id);
  const riderId = Number(request.rider_id);

  // Undo the accept: only while still assigned to this driver and before pickup.
  const affected = await prisma.$executeRaw`
    UPDATE pkg_order
    SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL
    WHERE id = ${orderId} AND rid = ${riderId} AND o_status = 'Processing'
  `;
  if (affected === 0) {
    await prisma.order_cancel_request.update({ where: { id: Number(requestId) }, data: { status: "stale" } });
    return { ok: false, reason: "order_state_changed" };
  }

  await prisma.driver_trip_progress.deleteMany({ where: { order_id: orderId } });
  // Marked as a reject so the cascade never offers this order to the same driver again.
  await prisma.tbl_order_requests.updateMany({ where: { order_id: orderId, rider_id: riderId, status: "accepted" }, data: { status: "10" } });

  const penalty = await tierPenalty.applyCancelPenalty({ orderId, riderId, tier: request.tier });
  if (penalty?.penalty?.id) {
    await prisma.order_cancel_request.update({ where: { id: Number(requestId) }, data: { penalty_id: penalty.penalty.id } });
  }

  if (request.tier === rules.TIER.FREE) {
    // The free vehicle did not take the trip: no refund.
    await prisma.free_booking_order.updateMany({
      where: { order_id: orderId, status: "FREE_BOOKING_CONFIRMED" },
      data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "vehicle_changed", accepted_in_pool: false, pool_rider_id: null },
    });
  }
  await events.logEvent({ riderId, orderId, tier: request.tier, event: events.EVENTS.CANCELLED, reason: "admin approved cancel request" });

  const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
  const dispatchManager = require("./dispatchManager");
  dispatchManager.emitCustomerEvent(order?.uid, "order:driver_unassigned", { order_id: String(orderId) });

  const nextStage = rules.nextStage(request.tier);
  const earlierStageRiderIds = await orderStage.offeredRiderIds(orderId);
  await dispatchManager.startDispatch(order, null, { stage: nextStage, earlierStageRiderIds });

  const token = await fcmTokenOf(riderId);
  Promise.resolve(pushNotifier.notifyDriverCancelDecision(token, { orderId, approved: true })).catch((err) =>
    logger.error(`cancelRequestService.approve: push failed for rider ${riderId}:`, err)
  );
  return { ok: true, nextStage, penalty };
}

async function reject({ requestId, adminId }) {
  const claimed = await prisma.order_cancel_request.updateMany({
    where: { id: Number(requestId), status: "pending" },
    data: { status: "rejected", decided_by: adminId ?? null, decided_at: new Date() },
  });
  if (claimed.count !== 1) throw httpError(409, "This cancel request was already decided");
  const request = await prisma.order_cancel_request.findUnique({ where: { id: Number(requestId) } });
  if (request) {
    await events.logEvent({ riderId: request.rider_id, orderId: request.order_id, tier: request.tier, event: events.EVENTS.CANCEL_REJECTED });
    const token = await fcmTokenOf(request.rider_id);
    Promise.resolve(pushNotifier.notifyDriverCancelDecision(token, { orderId: request.order_id, approved: false })).catch((err) =>
      logger.error(`cancelRequestService.reject: push failed for rider ${request.rider_id}:`, err)
    );
  }
  return { ok: true };
}

/** Admin list; cityId null = every city (superadmin). */
async function listRequests({ status = "pending", cityId = null }) {
  if (cityId == null) {
    return prisma.$queryRaw`
      SELECT r.id, r.order_id, r.rider_id, r.tier, r.reason, r.status, r.created_at, r.decided_at, r.penalty_id,
             rd.full_name AS rider_name, o.city_id
      FROM order_cancel_request r
      JOIN pkg_order o ON o.id = r.order_id
      LEFT JOIN tbl_rider rd ON rd.id = r.rider_id
      WHERE r.status = ${status}
      ORDER BY r.id DESC LIMIT 200`;
  }
  return prisma.$queryRaw`
    SELECT r.id, r.order_id, r.rider_id, r.tier, r.reason, r.status, r.created_at, r.decided_at, r.penalty_id,
           rd.full_name AS rider_name, o.city_id
    FROM order_cancel_request r
    JOIN pkg_order o ON o.id = r.order_id
    LEFT JOIN tbl_rider rd ON rd.id = r.rider_id
    WHERE r.status = ${status} AND o.city_id = ${Number(cityId)}
    ORDER BY r.id DESC LIMIT 200`;
}

module.exports = { gateDriverCancel, approve, reject, listRequests };
```

- [ ] **Step 4: Edit `tripLifecycle.driverCancel`**

At the very top of `async function driverCancel(orderId, riderId, reason, opts = {}) {`, before `let cancelledOrder = null;`, add:

```js
  // Tiered dispatch (spec 3.1): a Free/Daily driver cannot cancel on their own. Automated system cancels
  // (opts.requireOrderStatus) and the admin-approval path itself never come through here.
  if (opts.requireOrderStatus == null) {
    const gate = await require("./cancelRequestService").gateDriverCancel({ orderId, riderId, reason });
    if (gate.mode === "blocked") throw new Error("ORDER_NOT_CANCELLABLE");
    if (gate.mode === "requested") {
      return { refund_amount: 0, refund_status: "cancel_requested", requires_admin_approval: true, cancel_request_id: gate.requestId };
    }
  }
```

- [ ] **Step 5: Edit the `driverCancel` controller response**

In `backend/src/controllers/orderController.js` `driverCancel`, replace the success `return res.status(200).json({ ... })` block with:

```js
    if (result.requires_admin_approval) {
      return res.status(200).json({
        success: true,
        message: "Cancel request sent to the admin for approval. Please complete the order until it is approved.",
        data: { order_id: Number(order_id), requires_admin_approval: true, cancel_request_id: result.cancel_request_id },
      });
    }
    return res.status(200).json({
      success: true,
      message: "Ride cancelled and advance refunded where applicable",
      data: {
        order_id: Number(order_id),
        refund_amount: result.refund_amount,
        refund_status: result.refund_status,
      },
    });
```

- [ ] **Step 6: Run the tests**

Run: `npx jest src/services/__tests__/cancelRequestService.test.js src/services/__tests__/tripLifecycle.tierHooks.test.js src/services/__tests__/tripLifecycle.test.js`
Expected: PASS for both files.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/cancelRequestService.js backend/src/services/tripLifecycle.js backend/src/controllers/orderController.js backend/src/services/__tests__/cancelRequestService.test.js backend/src/services/__tests__/tripLifecycle.tierHooks.test.js
git commit -m "feat(tiered-dispatch): admin-approved cancel for Free/Daily orders, block cancel after pickup"
```

---

### Task 11: Admin API (controller and routes)

**Files:**
- Create: `backend/src/controllers/adminTierDispatchController.js`
- Modify: `backend/src/routes/adminRoutes.js` (after the free-booking routes, ~line 117)
- Test: `backend/src/controllers/__tests__/adminTierDispatchController.test.js`

**Interfaces:**
- Consumes: `tieredDispatchSettings.getTierSettings/saveTierSettings`, `tierPenaltyService.waive/resetCounter`, `cancelRequestService.listRequests/approve/reject`.
- Produces (HTTP): 
  - `GET /api/admin/tier-dispatch/settings` (RIDER_ROLES), `PUT /api/admin/tier-dispatch/settings` (superadmin only)
  - `GET /api/admin/tier-dispatch/penalties?rider_id=&tier=&status=` (city-scoped)
  - `POST /api/admin/tier-dispatch/penalties/:id/waive` (superadmin, admin)
  - `POST /api/admin/tier-dispatch/counters/reset` body `{rider_id, tier}` (superadmin, admin)
  - `GET /api/admin/tier-dispatch/cancel-requests?status=` (city-scoped), `POST .../cancel-requests/:id/approve`, `POST .../cancel-requests/:id/reject` (superadmin, admin)

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../config/db", () => ({ $queryRaw: jest.fn() }));
jest.mock("../../services/tieredDispatchSettings", () => ({ getTierSettings: jest.fn(), saveTierSettings: jest.fn() }));
jest.mock("../../services/tierPenaltyService", () => ({ waive: jest.fn(), resetCounter: jest.fn() }));
jest.mock("../../services/cancelRequestService", () => ({ listRequests: jest.fn(), approve: jest.fn(), reject: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../../services/tieredDispatchSettings");
const penalty = require("../../services/tierPenaltyService");
const cancels = require("../../services/cancelRequestService");
const ctrl = require("../adminTierDispatchController");

const mkRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const mkReq = (user, extra = {}) => ({ user, query: {}, body: {}, params: {}, ...extra });
const superadmin = { id: 1, role: "superadmin", city_id: null };
const cityAdmin = { id: 2, role: "admin", city_id: 3 };
const cityless = { id: 3, role: "admin", city_id: null };

beforeEach(() => jest.clearAllMocks());

describe("settings", () => {
  it("only a superadmin may change the global dispatch settings", async () => {
    const res = mkRes();
    await ctrl.saveSettings(mkReq(cityAdmin, { body: { tiered_dispatch_enabled: true } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(settings.saveTierSettings).not.toHaveBeenCalled();
  });

  it("a superadmin saves and gets the new settings back", async () => {
    settings.saveTierSettings.mockResolvedValue({ tieredEnabled: true });
    const res = mkRes();
    await ctrl.saveSettings(mkReq(superadmin, { body: { tiered_dispatch_enabled: true, penalty_enabled: false, ladder: "5,10", cancel_penalty_pct: 50 } }), res);
    expect(settings.saveTierSettings).toHaveBeenCalledWith({ tieredEnabled: true, penaltyEnabled: false, ladder: "5,10", cancelPenaltyPct: 50 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { tieredEnabled: true } }));
  });

  it("a validation error from the service is a 400", async () => {
    settings.saveTierSettings.mockRejectedValue(Object.assign(new Error("bad ladder"), { statusCode: 400 }));
    const res = mkRes();
    await ctrl.saveSettings(mkReq(superadmin, { body: { ladder: "500" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("city scoping", () => {
  it("a city-less admin is refused on every scoped list", async () => {
    for (const fn of [ctrl.listPenalties, ctrl.listCancelRequests]) {
      const res = mkRes();
      await fn(mkReq(cityless), res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  it("a city admin only gets their own city's cancel requests", async () => {
    cancels.listRequests.mockResolvedValue([]);
    await ctrl.listCancelRequests(mkReq(cityAdmin, { query: { city_id: "9" } }), mkRes());
    expect(cancels.listRequests).toHaveBeenCalledWith({ status: "pending", cityId: 3 });
  });

  it("a superadmin sees all cities unless a city_id filter is given", async () => {
    cancels.listRequests.mockResolvedValue([]);
    await ctrl.listCancelRequests(mkReq(superadmin), mkRes());
    expect(cancels.listRequests).toHaveBeenCalledWith({ status: "pending", cityId: null });
    await ctrl.listCancelRequests(mkReq(superadmin, { query: { city_id: "2" } }), mkRes());
    expect(cancels.listRequests).toHaveBeenLastCalledWith({ status: "pending", cityId: 2 });
  });

  it("penalties are listed through a city-filtered query for a city admin", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
    const res = mkRes();
    await ctrl.listPenalties(mkReq(cityAdmin, { query: { tier: "free" } }), res);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1 }] });
  });
});

describe("actions", () => {
  // The ownership check asks which city the row belongs to; for these tests it is the admin's own city.
  beforeEach(() => prisma.$queryRaw.mockResolvedValue([{ city_id: 3 }]));

  it("waive passes the admin id and rejects a non-numeric id with 400", async () => {
    penalty.waive.mockResolvedValue({ waived: true });
    const res = mkRes();
    await ctrl.waivePenalty(mkReq(cityAdmin, { params: { id: "70" } }), res);
    expect(penalty.waive).toHaveBeenCalledWith({ penaltyId: 70, adminId: 2 });
    const bad = mkRes();
    await ctrl.waivePenalty(mkReq(cityAdmin, { params: { id: "abc" } }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);
  });

  it("reset counter validates the tier", async () => {
    const res = mkRes();
    await ctrl.resetCounter(mkReq(cityAdmin, { body: { rider_id: 9, tier: "normal" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    penalty.resetCounter.mockResolvedValue();
    const ok = mkRes();
    await ctrl.resetCounter(mkReq(cityAdmin, { body: { rider_id: 9, tier: "free" } }), ok);
    expect(penalty.resetCounter).toHaveBeenCalledWith({ riderId: 9, tier: "free", adminId: 2 });
  });

  it("approve returns the service result; a 409 from the service is forwarded", async () => {
    cancels.approve.mockResolvedValue({ ok: true, nextStage: "daily" });
    const res = mkRes();
    await ctrl.approveCancel(mkReq(cityAdmin, { params: { id: "12" } }), res);
    expect(cancels.approve).toHaveBeenCalledWith({ requestId: 12, adminId: 2 });
    cancels.approve.mockRejectedValue(Object.assign(new Error("already decided"), { statusCode: 409 }));
    const dup = mkRes();
    await ctrl.approveCancel(mkReq(cityAdmin, { params: { id: "12" } }), dup);
    expect(dup.status).toHaveBeenCalledWith(409);
  });
});
```

A city admin acting on a request/penalty of another city must be refused (Step 3's `assertCancelRequestInCity` / `assertPenaltyInCity` query the row's city). Add these tests at the end of the file:

```js
describe("cross-city actions", () => {
  it("a city admin cannot approve a cancel request that belongs to another city", async () => {
    prisma.$queryRaw.mockResolvedValue([{ city_id: 9 }]);
    const res = mkRes();
    await ctrl.approveCancel(mkReq(cityAdmin, { params: { id: "12" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(cancels.approve).not.toHaveBeenCalled();
  });

  it("a city admin cannot waive a penalty of a rider in another city", async () => {
    prisma.$queryRaw.mockResolvedValue([{ city_id: 9 }]);
    const res = mkRes();
    await ctrl.waivePenalty(mkReq(cityAdmin, { params: { id: "70" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(penalty.waive).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/controllers/__tests__/adminTierDispatchController.test.js`
Expected: FAIL - module `../adminTierDispatchController` not found.

- [ ] **Step 3: Implement the controller**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settingsService = require("../services/tieredDispatchSettings");
const penaltyService = require("../services/tierPenaltyService");
const cancelService = require("../services/cancelRequestService");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminTierDispatch.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// Superadmin sees every city (optionally narrowed by ?city_id); everyone else is bound to their own city.
const cityScope = (req) => {
  if (req.user.role === "superadmin") {
    const raw = req.query.city_id;
    return raw != null && raw !== "" ? Number(raw) : null;
  }
  const cityId = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isFinite(cityId)) throw httpError(403, "Your account is not assigned to a city");
  return cityId;
};
const requireId = (v, label) => {
  if (!/^\d+$/.test(String(v ?? "").trim()) || Number(v) <= 0) throw httpError(400, `${label} must be a valid id`);
  return Number(v);
};
const TIERS = ["free", "daily"];

// A city admin may only act on rows of their own city; the superadmin is unrestricted.
async function assertCancelRequestInCity(req, requestId) {
  if (req.user.role === "superadmin") return;
  const cityId = cityScope(req);
  const rows = await prisma.$queryRaw`
    SELECT o.city_id FROM order_cancel_request r JOIN pkg_order o ON o.id = r.order_id WHERE r.id = ${requestId} LIMIT 1`;
  if (!rows[0] || Number(rows[0].city_id) !== cityId) throw httpError(403, "This request belongs to another city");
}
async function assertPenaltyInCity(req, penaltyId) {
  if (req.user.role === "superadmin") return;
  const cityId = cityScope(req);
  const rows = await prisma.$queryRaw`
    SELECT rd.city_id FROM driver_tier_penalty p JOIN tbl_rider rd ON rd.id = p.rider_id WHERE p.id = ${penaltyId} LIMIT 1`;
  if (!rows[0] || Number(rows[0].city_id) !== cityId) throw httpError(403, "This penalty belongs to another city");
}

const getSettings = async (req, res) => {
  try {
    return res.json({ success: true, data: await settingsService.getTierSettings({ fresh: true }) });
  } catch (e) { return fail(res, e, "getSettings"); }
};

// Global dispatch behaviour: only a superadmin may change it (a city admin would change every city).
const saveSettings = async (req, res) => {
  try {
    if (req.user.role !== "superadmin") throw httpError(403, "Only a superadmin can change dispatch settings");
    const b = req.body || {};
    const data = await settingsService.saveTierSettings({
      tieredEnabled: b.tiered_dispatch_enabled,
      penaltyEnabled: b.penalty_enabled,
      ladder: b.ladder,
      cancelPenaltyPct: b.cancel_penalty_pct,
    });
    return res.json({ success: true, message: "Dispatch settings saved", data });
  } catch (e) { return fail(res, e, "saveSettings"); }
};

const listPenalties = async (req, res) => {
  try {
    const cityId = cityScope(req);
    const tier = TIERS.includes(req.query.tier) ? req.query.tier : null;
    const status = ["pending_daily", "collected", "waived"].includes(req.query.status) ? req.query.status : null;
    const riderId = req.query.rider_id ? requireId(req.query.rider_id, "rider_id") : null;
    const rows = await prisma.$queryRaw`
      SELECT p.id, p.rider_id, rd.full_name AS rider_name, p.order_id, p.tier, p.kind, p.event, p.miss_no, p.pct,
             p.base_amount, p.amount, p.status, p.created_at, p.collected_at, p.waived_at
      FROM driver_tier_penalty p
      JOIN tbl_rider rd ON rd.id = p.rider_id
      WHERE (${cityId} IS NULL OR rd.city_id = ${cityId})
        AND (${tier} IS NULL OR p.tier = ${tier})
        AND (${status} IS NULL OR p.status = ${status})
        AND (${riderId} IS NULL OR p.rider_id = ${riderId})
      ORDER BY p.id DESC LIMIT 200`;
    return res.json({ success: true, data: rows });
  } catch (e) { return fail(res, e, "listPenalties"); }
};

const waivePenalty = async (req, res) => {
  try {
    const id = requireId(req.params.id, "penalty id");
    await assertPenaltyInCity(req, id);
    const data = await penaltyService.waive({ penaltyId: id, adminId: req.user.id });
    return res.json({ success: true, message: data.alreadyWaived ? "Already waived" : "Penalty waived", data });
  } catch (e) { return fail(res, e, "waivePenalty"); }
};

const resetCounter = async (req, res) => {
  try {
    const riderId = requireId(req.body?.rider_id, "rider_id");
    if (!TIERS.includes(req.body?.tier)) throw httpError(400, "tier must be free or daily");
    await penaltyService.resetCounter({ riderId, tier: req.body.tier, adminId: req.user.id });
    return res.json({ success: true, message: "Penalty counter reset" });
  } catch (e) { return fail(res, e, "resetCounter"); }
};

const listCancelRequests = async (req, res) => {
  try {
    const cityId = cityScope(req);
    const status = ["pending", "approved", "rejected", "stale"].includes(req.query.status) ? req.query.status : "pending";
    return res.json({ success: true, data: await cancelService.listRequests({ status, cityId }) });
  } catch (e) { return fail(res, e, "listCancelRequests"); }
};

const approveCancel = async (req, res) => {
  try {
    const id = requireId(req.params.id, "request id");
    await assertCancelRequestInCity(req, id);
    const data = await cancelService.approve({ requestId: id, adminId: req.user.id });
    return res.json({ success: data.ok, message: data.ok ? "Cancel approved; order sent to the next driver tier" : "The order changed state, nothing was re-dispatched", data });
  } catch (e) { return fail(res, e, "approveCancel"); }
};

const rejectCancel = async (req, res) => {
  try {
    const id = requireId(req.params.id, "request id");
    await assertCancelRequestInCity(req, id);
    await cancelService.reject({ requestId: id, adminId: req.user.id });
    return res.json({ success: true, message: "Cancel request rejected" });
  } catch (e) { return fail(res, e, "rejectCancel"); }
};

module.exports = { getSettings, saveSettings, listPenalties, waivePenalty, resetCounter, listCancelRequests, approveCancel, rejectCancel };
```

- [ ] **Step 4: Register the routes**

In `backend/src/routes/adminRoutes.js`, add `const tierDispatch = require("../controllers/adminTierDispatchController");` with the other controller requires, and after the last `free-booking` route add:

```js
router.get("/tier-dispatch/settings", auth, authorize(...RIDER_ROLES), tierDispatch.getSettings);
router.put("/tier-dispatch/settings", auth, authorize("superadmin"), tierDispatch.saveSettings);
router.get("/tier-dispatch/penalties", auth, authorize(...RIDER_ROLES), tierDispatch.listPenalties);
router.post("/tier-dispatch/penalties/:id/waive", auth, authorize("superadmin", "admin"), tierDispatch.waivePenalty);
router.post("/tier-dispatch/counters/reset", auth, authorize("superadmin", "admin"), tierDispatch.resetCounter);
router.get("/tier-dispatch/cancel-requests", auth, authorize(...RIDER_ROLES), tierDispatch.listCancelRequests);
router.post("/tier-dispatch/cancel-requests/:id/approve", auth, authorize("superadmin", "admin"), tierDispatch.approveCancel);
router.post("/tier-dispatch/cancel-requests/:id/reject", auth, authorize("superadmin", "admin"), tierDispatch.rejectCancel);
```

- [ ] **Step 5: Run the tests**

Run: `npx jest src/controllers/__tests__/adminTierDispatchController.test.js`
Expected: PASS. Then `node --check src/routes/adminRoutes.js` (no output = OK).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminTierDispatchController.js backend/src/routes/adminRoutes.js backend/src/controllers/__tests__/adminTierDispatchController.test.js
git commit -m "feat(tiered-dispatch): admin API for settings, penalties, counters and cancel requests"
```

---

### Task 12: Full verification and dev rollout (flag stays OFF)

**Files:** none (verification and operations).

- [ ] **Step 1: Run the whole backend suite**

Run (from `backend/`): `npx jest`
Expected: every suite this plan touches or adds PASSES. `src/utils/__tests__/aadharPdfVerify.test.js` already fails on `main` (2 tests, unrelated); any other failing suite must be investigated, not skipped.

- [ ] **Step 2: Syntax-check the touched files**

Run:

```bash
for f in src/services/dispatchManager.js src/services/tripLifecycle.js src/services/cancelRequestService.js src/services/tierPenaltyService.js src/services/orderStageService.js src/controllers/adminTierDispatchController.js src/controllers/orderController.js src/routes/adminRoutes.js src/services/dailyDriverSettlementService.js; do node --check "$f" && echo "ok $f"; done
```

Expected: `ok` for every file.

- [ ] **Step 3: Apply the migration on the dev DB (before deploying code)**

Run the SQL from `backend/prisma/migrations/20261011010000_add_tiered_dispatch/migration.sql` on the dev database (the dev DB has no shadow-DB permission, so apply the SQL directly through the MySQL client or a one-off Node script that runs each statement), then register it:

```bash
cd backend && node node_modules/prisma/build/index.js migrate resolve --applied 20261011010000_add_tiered_dispatch
```

Expected: "Migration 20261011010000_add_tiered_dispatch marked as applied."

- [ ] **Step 4: Deploy to the dev server with the flags OFF and smoke-test**

Commit and push, pull on the dev server, restart `shifter-backend-dev` (same procedure used for the earlier trial-driver deploy). With `tiered_dispatch_enabled` unset (OFF):
- create an order from the customer app: it must dispatch exactly as before (offers carry `tier: "normal"`, no `order_dispatch_stage` row is created);
- `GET /api/admin/tier-dispatch/settings` returns `tieredEnabled: false, penaltyEnabled: false`;
- `pm2 logs shifter-backend-dev --err --lines 50` shows no new errors.

- [ ] **Step 5: Switch ON for dev and walk the three flows (manual)**

As a superadmin call `PUT /api/admin/tier-dispatch/settings` with `{"tiered_dispatch_enabled": true, "penalty_enabled": true}`. Then, with two test drivers (one punched-in Daily Driver, one normal) and one pool driver:
1. A normal order is offered to the Daily Driver first; letting the popup time out writes one `driver_tier_penalty` (`pending_daily`) and the order then goes to the normal driver.
2. A Free Booking order is offered to the pool driver first; reject it; confirm a 5% `collected` penalty, a wallet debit row, a `driver_order_event` row of type `rejected` and `penalty`, and the order moving to the Daily Driver.
3. Accept an order as the Daily Driver, then tap cancel in the driver app: the response says "Cancel request sent to the admin"; `GET .../cancel-requests` lists it; approve it; the order returns to the pool and goes to the normal driver; the driver gets the cancel penalty.
4. Run the Daily settlement for that enrollment and confirm the deferred penalty reduced the wallet and a `PENALTY_DEDUCTION` ledger row exists.
5. Check an order whose customer already paid the advance (the Review Focus item): after an approved cancel and a second accept the order's `advance_payment` and `payment_status` must still make sense in the customer app.
6. Place a scheduled and a next-day order (they also run through `startDispatch`): each gets a stage row and reaches a driver, with no stuck or duplicated offers. If either flow breaks, restrict `decideStartStage` to `booking_type = 1` and note it in the spec.

Then set `tiered_dispatch_enabled` back to `false` unless the team wants it on.

- [ ] **Step 6: Update the spec and memory**

Edit `docs/superpowers/specs/2026-10-11-tiered-dispatch-free-daily-design.md`: replace the `driver_tier_penalty_setting` table in section 4 with the four `app_settings` keys, add the `driver_tier_penalty` table, and change "not offered again in the normal stage" to "in any later stage". Commit the doc and record the rollout state in the project memory (`free_booking_offer` and a new tiered-dispatch note).

```bash
git add docs/superpowers/specs/2026-10-11-tiered-dispatch-free-daily-design.md
git commit -m "docs(spec): tiered dispatch settings live in app_settings; penalty table added"
```

---

## Self-Review Notes

- **Spec coverage:** stages and advance (Task 5, 6), Free/Daily eligibility (Task 5), exclusion of earlier-offered riders (Task 6), reject/skip penalty ladder, lifetime per-tier counter, wallet/Daily-deferred collection, waive, reset (Tasks 2, 7, 9), warning in the offer payload and after each penalty (Tasks 6, 7), cancel needs admin approval, blocked after pickup, penalty on approved cancel, re-dispatch to the next stage, refund void for a failed Free order (Task 10), event log writes for offered/accepted/rejected/skipped/completed/cancel_* /penalty (Tasks 6, 7, 8, 10), settings + admin API (Tasks 3, 11), flags default OFF and fail-closed (Tasks 3, 6, 12). Not in this plan (Plans 2 and 3): driver-app popup/ringing/badge UI and the request-cancel button, customer-app handling of `order:driver_unassigned`, the Free-driver refund formula (net spend) and refund popup, the Driver Performance report page and score, and the admin React pages.
- **Types:** `getStage` returns a string or null; `riderIdsForStage` returns `number[]|null`; the stage strings are `"free"|"daily"|"normal"` everywhere; `onMiss` event values are `"rejected"|"skipped"`; the penalty `kind` is `"miss"|"cancel"` and its `event` is `"rejected"|"skipped"|"cancel_approved"`; the compound counter key is `rider_id_tier`.
