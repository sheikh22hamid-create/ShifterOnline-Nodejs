# Booking Guarantee Executive Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, per-city executive queue to the existing Booking Guarantee: each open guarantee case is automatically given to exactly one eligible executive (capacity-limited, reassignable, escalated, audited), with an executive workspace and a city-admin workload dashboard, without changing the existing deadline, compensation, referral-lock, or expiry behaviour.

**Architecture:** An orthogonal `queue_state` plus ownership tables layered on `booking_guarantee_case`. A new `guaranteeQueueService` (assignment engine, reassignment, action log, sweeper `tick`) and pure `guaranteeQueueRules`, wired into the existing 15 s guarantee sweeper (after `expireDue`) and into three existing call sites (case open, case close, driver assign). Concurrency uses one `SELECT … FOR UPDATE` row lock per executive profile, a compare-and-swap on `owner_admin_id`, and `UNIQUE(case_id, active)` with `active = 1 | NULL`. Feature flag `exec_queue_enabled` defaults to 0 per city.

**Tech Stack:** Node.js + Express, Prisma 6 on MySQL (hand-applied SQL on prod), Jest 30 (`backend`), React + Vite admin panel (`frontend`, no unit-test runner: verified with lint/build + manual smoke).

**Spec:** `docs/superpowers/specs/2026-10-14-guarantee-executive-queue-design.md` (approved 2026-10-14). Read it first; this plan implements it. Where this plan refines the spec, Task 14 amends the spec so they agree (listed in "Spec refinements" below).

## Global Constraints

- `booking_guarantee_case.status` values stay `open | resolved_assigned | expired_compensated | cancelled`. No new code path may `UPDATE` `status`, `deadline_at`, `opened_at`, `compensation_amount` or `compensation_package_id` (only the existing `closeWith`/`expireCase` write `status`).
- `expireCase`, `finishExpiry`, `expireDue`, the wallet idempotency key `booking_guarantee_credit:<order_id>`, `unlockForReferral`, `quote`, `getView` are **not modified** (only `closeWith`, `openForExhaustedOrder` and the post-commit tail of `expireCase` gain one best-effort hook call each).
- Feature OFF by default: `city_order_settings.exec_queue_enabled` default **0**; defaults capacity **5**, reminder **50 %**, escalation **75 %** (all per-city configurable).
- Executives auto-assigned only if `admin.role='executive'`, `admin.status=1`, `admin.city_id = case.city_id`, profile `available=1`, load < capacity. Never city admins or superadmins.
- Capacity is enforced on **every** path: automatic claim, supervisor reassignment, unavailable-owner handover, idle auto-reassign. Supervisors cannot override it.
- Compensation stays fully automatic: no approval step, no second compensation mechanism.
- All new timestamps written from JS `new Date()` (UTC). Never use SQL `NOW()` in new SQL.
- New columns/tables are additive. No migration is applied to production by this work. Prisma migration SQL is applied to the **dev database only**, by hand, only after the user approves that step.
- Server derives actor id and timestamps; client-supplied actor/time is ignored. Cross-city access returns 404 (not 403) on the new endpoints.
- **No `git commit` / `git push` may be run until the user explicitly approves.** Every "Checkpoint" step below lists the exact files to stage and the message; it is executed only after approval. Existing uncommitted changes (`ShifterDriver/.../build.gradle`, `ShifterOnline/pubspec.yaml`, `Shifter_Online_Codebase_Backup.zip`) must never be staged. `frontend/` and `backend/` are normal tracked dirs; `ShifterOnline/` and `ShifterDriver/` are gitignored and untouched here.
- Project test commands: backend `cd backend && npx jest <path>`; real-MySQL tests additionally need `GUARANTEE_TEST_DATABASE_URL` (Task 4). Frontend: `cd frontend && npm run lint && npm run build`.

## Spec refinements made by this plan (applied to the spec in Task 14)

1. `booking_guarantee_case` also gets `city_id INT NULL` (set at open from `order.city_id`) with index `(city_id, status)`. Reason: scoping queries without joining `pkg_order`, and testable without seeding orders. Older cases keep NULL and `queue_state` NULL, so they are untouched.
2. No SQL foreign keys on the new tables, matching the existing guarantee tables (none have FKs); integrity is enforced by the service and the unique key.
3. Capacity re-count (spec 6.4 step 4) is a plain count executed as the first consistent read **after** the profile `FOR UPDATE` lock is acquired, instead of `LOCK IN SHARE MODE` / `FOR UPDATE OF`. Reason: `FOR UPDATE OF <table>` is MySQL 8-only (the host may be MariaDB), and shared locks would widen contention with `closeWith`. In InnoDB's default REPEATABLE READ the snapshot is created at the first non-locking read, which here happens after the lock is held, so every commit by a previous lock holder is visible. Task 4's concurrency tests prove it.
4. Queue settings use their own endpoints (`/booking-guarantee/exec/settings`) and service (`guaranteeQueueSettings.js`) reading/writing the new `city_order_settings` columns, instead of editing `orderSearchRules/orderSearchSettings` (so existing System 2 settings code and tests stay untouched).
5. The ownership restriction also covers `POST /orders/next-day/assign-batch` (it currently allows the `executive` role and calls `closeOnAssign`), not only `assign-rider`.
6. AC-12 (assignment racing expiry) is not re-implemented: it is satisfied by the unchanged atomic `UPDATE pkg_order … WHERE rid=0 AND order_status=0` in both `assignRider` and `expireCase`. It is verified in the dev smoke test (Task 14), since the real-MySQL suite does not seed `pkg_order`.

## Review Focus

Failure modes the spec implies but no obvious task would exercise; each has a test in the named task:

1. An executive is marked unavailable (or deactivated / role changed) while owning cases and no other executive has capacity → case returns to `unassigned`, deadline unchanged, supervisors alerted. (Task 5, Task 8)
2. Admin/superadmin must still be able to assign a driver to an *unassigned* or other-owner case, while an executive is blocked, including through next-day batch assign. (Task 7)
3. A case closes (assign/cancel/expire) while a claim or reassignment is in flight, or a crash leaves an active period on a closed case → no ownership on closed cases; repair closes orphans. (Task 5, Task 8)
4. City flag switched OFF mid-flight: no new assignments/reminders/escalations for that city, but repair still runs and existing owners are untouched. (Task 8)
5. Very short windows: reminder and escalation both already due at first tick (fire once each, in order), and idle auto-reassign is skipped when too little time remains. (Task 8)

---

## File Structure

**Backend – create**
- `backend/prisma/migrations/20261014010000_add_guarantee_executive_queue/migration.sql` – additive DDL (prod SQL = this file).
- `backend/src/services/guaranteeQueueRules.js` – pure: capacity, ranking, reasons, thresholds, settings validation.
- `backend/src/services/guaranteeQueueSettings.js` – per-city queue settings read/write (cached, fail closed).
- `backend/src/services/guaranteeQueueService.js` – engine, reassignment, availability, actions, ownership guard, hooks, `tick`.
- `backend/src/services/guaranteeQueueReports.js` – workload, queue list, report aggregates (read-only SQL).
- `backend/src/controllers/guaranteeQueueController.js` – HTTP layer.
- Tests: `backend/src/services/__tests__/guaranteeQueueRules.test.js`, `guaranteeQueueSettings.test.js`, `guaranteeQueueEngine.mysql.test.js`, `guaranteeQueueReassign.mysql.test.js`, `guaranteeQueueActions.mysql.test.js`, `guaranteeQueueTick.mysql.test.js`, `guaranteeQueueReports.mysql.test.js`, `guaranteeQueueHooks.test.js`; `backend/src/services/__tests__/helpers/mysqlTestDb.js`; `backend/src/controllers/__tests__/guaranteeQueueController.test.js`.

**Backend – modify**
- `backend/prisma/schema.prisma` – new columns/models.
- `backend/src/services/bookingGuaranteeService.js` – `city_id` on create, `onCaseOpened` hook, `onCaseClosed` hooks.
- `backend/src/controllers/adminOrderController.js` – ownership guard + action record in `assignRider`, guard in `assignNextDayBatch`.
- `backend/src/routes/adminRoutes.js` – new routes.
- `backend/src/server.js` – call `guaranteeQueueService.tick()` after `expireDue()`.

**Frontend – create/modify**
- Create `frontend/src/utils/guaranteeQueueAlerts.js`, `frontend/src/pages/ExecutiveWorkspace.jsx`, `frontend/src/pages/GuaranteeWorkload.jsx`.
- Modify `frontend/src/components/layout/AppShell.jsx`, `frontend/src/App.jsx`, `frontend/src/config/navigation.js`.

---

### Task 1: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `booking_guarantee_case` ~L2069, `city_order_settings` ~L2013; append new models after `booking_guarantee_audit` ~L2099)
- Create: `backend/prisma/migrations/20261014010000_add_guarantee_executive_queue/migration.sql`

**Interfaces:**
- Produces Prisma delegates `prisma.guarantee_assignment`, `prisma.guarantee_action`, `prisma.executive_guarantee_profile`; new fields on `booking_guarantee_case` (`city_id, owner_admin_id, owner_assigned_at, queue_state, unassigned_reason, first_action_at, last_action_at, reminded_at, escalated_at, last_alerted_at`) and on `city_order_settings` (`exec_queue_enabled, exec_default_capacity, reminder_pct, escalate_pct, auto_reassign_idle_minutes`).

- [ ] **Step 1: Edit `booking_guarantee_case`** – add these fields before the `@@index` lines and two indexes:

```prisma
  city_id           Int?
  owner_admin_id    Int?
  owner_assigned_at DateTime? @db.DateTime(0)
  queue_state       String?   @db.VarChar(20)
  unassigned_reason String?   @db.VarChar(30)
  first_action_at   DateTime? @db.DateTime(0)
  last_action_at    DateTime? @db.DateTime(0)
  reminded_at       DateTime? @db.DateTime(0)
  escalated_at      DateTime? @db.DateTime(0)
  last_alerted_at   DateTime? @db.DateTime(0)

  @@index([queue_state, deadline_at], map: "idx_bgc_queue_deadline")
  @@index([owner_admin_id, status], map: "idx_bgc_owner_status")
  @@index([city_id, status], map: "idx_bgc_city_status")
```

- [ ] **Step 2: Edit `city_order_settings`** – add before `updated_by`:

```prisma
  exec_queue_enabled          Boolean  @default(false)
  exec_default_capacity       Int      @default(5)
  reminder_pct                Int      @default(50)
  escalate_pct                Int      @default(75)
  auto_reassign_idle_minutes  Int?
```

- [ ] **Step 3: Append the new models** after `booking_guarantee_audit`:

```prisma
// Ownership history of a guarantee case (spec 2026-10-14). `active` is 1 while the period is open and NULL once
// it ends: MySQL unique indexes ignore NULLs, so many ended periods coexist but only one active per case.
// Never write active = 0.
model guarantee_assignment {
  id              Int       @id @default(autoincrement())
  case_id         Int
  admin_id        Int
  assigned_by     Int?
  source          String    @db.VarChar(15)
  started_at      DateTime  @default(now()) @db.DateTime(0)
  ended_at        DateTime? @db.DateTime(0)
  end_reason      String?   @db.VarChar(25)
  reassign_reason String?   @db.VarChar(200)
  active          Int?      @db.TinyInt

  @@unique([case_id, active], map: "uq_ga_one_active")
  @@index([admin_id, active], map: "idx_ga_admin_active")
  @@index([case_id], map: "idx_ga_case")
}

model guarantee_action {
  id         Int      @id @default(autoincrement())
  case_id    Int
  admin_id   Int
  type       String   @db.VarChar(30)
  meaningful Int      @default(0) @db.TinyInt
  result     String?  @db.VarChar(30)
  driver_id  Int?
  meta       String?  @db.Text
  created_at DateTime @default(now()) @db.DateTime(0)

  @@index([case_id, created_at], map: "idx_gact_case_time")
  @@index([admin_id, created_at], map: "idx_gact_admin_time")
}

model executive_guarantee_profile {
  admin_id         Int       @id
  capacity         Int?
  available        Int       @default(1) @db.TinyInt
  last_assigned_at DateTime? @db.DateTime(0)
  updated_by       Int?
  updated_at       DateTime  @default(now()) @db.DateTime(0)
}
```

- [ ] **Step 4: Write the migration SQL** (same style as `20261007020000_add_booking_guarantee`):

```sql
-- Booking Guarantee executive queue (spec 2026-10-14). Additive only; feature is OFF per city by default.
-- Apply by hand on EVERY database BEFORE deploying the backend, then
--   prisma migrate resolve --applied 20261014010000_add_guarantee_executive_queue
-- Prerequisites: 20261007020000_add_booking_guarantee, 20261012010000_add_city_order_settings,
--                20261013020000_add_guarantee_time_window.
ALTER TABLE `booking_guarantee_case`
  ADD COLUMN `city_id` INT NULL,
  ADD COLUMN `owner_admin_id` INT NULL,
  ADD COLUMN `owner_assigned_at` DATETIME(0) NULL,
  ADD COLUMN `queue_state` VARCHAR(20) NULL,
  ADD COLUMN `unassigned_reason` VARCHAR(30) NULL,
  ADD COLUMN `first_action_at` DATETIME(0) NULL,
  ADD COLUMN `last_action_at` DATETIME(0) NULL,
  ADD COLUMN `reminded_at` DATETIME(0) NULL,
  ADD COLUMN `escalated_at` DATETIME(0) NULL,
  ADD COLUMN `last_alerted_at` DATETIME(0) NULL,
  ADD INDEX `idx_bgc_queue_deadline` (`queue_state`, `deadline_at`),
  ADD INDEX `idx_bgc_owner_status` (`owner_admin_id`, `status`),
  ADD INDEX `idx_bgc_city_status` (`city_id`, `status`);

ALTER TABLE `city_order_settings`
  ADD COLUMN `exec_queue_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `exec_default_capacity` INT NOT NULL DEFAULT 5,
  ADD COLUMN `reminder_pct` INT NOT NULL DEFAULT 50,
  ADD COLUMN `escalate_pct` INT NOT NULL DEFAULT 75,
  ADD COLUMN `auto_reassign_idle_minutes` INT NULL;

-- `active` is 1 while a period is open and NULL once ended. UNIQUE ignores NULLs in InnoDB, so any number of
-- ended periods coexist per case while a second active period is rejected. Never write active = 0.
CREATE TABLE `guarantee_assignment` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `admin_id` INT NOT NULL,
  `assigned_by` INT NULL,
  `source` VARCHAR(15) NOT NULL,
  `started_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `ended_at` DATETIME(0) NULL,
  `end_reason` VARCHAR(25) NULL,
  `reassign_reason` VARCHAR(200) NULL,
  `active` TINYINT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_ga_one_active` (`case_id`, `active`),
  INDEX `idx_ga_admin_active` (`admin_id`, `active`),
  INDEX `idx_ga_case` (`case_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `guarantee_action` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `case_id` INT NOT NULL,
  `admin_id` INT NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `meaningful` TINYINT NOT NULL DEFAULT 0,
  `result` VARCHAR(30) NULL,
  `driver_id` INT NULL,
  `meta` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  INDEX `idx_gact_case_time` (`case_id`, `created_at`),
  INDEX `idx_gact_admin_time` (`admin_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `executive_guarantee_profile` (
  `admin_id` INT NOT NULL,
  `capacity` INT NULL,
  `available` TINYINT NOT NULL DEFAULT 1,
  `last_assigned_at` DATETIME(0) NULL,
  `updated_by` INT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`admin_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 5: Validate and generate the client** (no DB connection needed):

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: "The schema … is valid" then "Generated Prisma Client". If `generate` fails with EPERM on Windows because a dev server holds the query-engine DLL, stop the running backend and retry.

- [ ] **Step 6: Existing suite still green (schema change only)**

Run: `cd backend && npx jest src/services/__tests__/bookingGuarantee`
Expected: all existing `bookingGuarantee*` suites PASS.

- [ ] **Step 7: Checkpoint (do not run until the user approves commits).** Stage: `backend/prisma/schema.prisma backend/prisma/migrations/20261014010000_add_guarantee_executive_queue/migration.sql`. Message: `feat(guarantee-queue): schema and migration for executive queue`.

---

### Task 2: Pure rules

**Files:**
- Create: `backend/src/services/guaranteeQueueRules.js`
- Test: `backend/src/services/__tests__/guaranteeQueueRules.test.js`

**Interfaces:**
- Produces (all pure, no I/O):
  - `DEFAULTS`, `LIMITS`
  - `normalizeQueueRow(row) -> { execQueueEnabled, execDefaultCapacity, reminderPct, escalatePct, autoReassignIdleMinutes }`
  - `validateQueueInput(input, current = DEFAULTS) -> partial camelCase object` (throws `Error` with `statusCode: 400`)
  - `effectiveCapacity(candidate, defaultCapacity) -> number`
  - `rankCandidates(candidates, defaultCapacity) -> [{ adminId, load, capacity }]` where candidate = `{ adminId, available, capacity|null, load, lastAssignedAt|null }`
  - `unassignedReason(candidates, defaultCapacity) -> "none_in_city" | "all_unavailable" | "all_at_capacity"`
  - `elapsedPct(c, now) -> 0..100`, `isReminderDue(c, city, now)`, `isEscalationDue(c, city, now)`, `isIdle(c, city, now, minRemainingMs)` where `c = { opened_at, deadline_at, reminded_at, escalated_at, owner_assigned_at, last_action_at }`
  - `MEANINGFUL_TYPES`, `ACTION_TYPES`, `isMeaningful(type, note)`

- [ ] **Step 1: Write the failing test** `guaranteeQueueRules.test.js`:

```js
const r = require("../guaranteeQueueRules");

const cand = (adminId, o = {}) => ({ adminId, available: true, capacity: null, load: 0, lastAssignedAt: null, ...o });
const at = (iso) => new Date(iso);

describe("normalizeQueueRow", () => {
  it("returns the defaults (OFF, 5, 50, 75, no idle reassign) for a missing row", () => {
    expect(r.normalizeQueueRow(null)).toEqual({ execQueueEnabled: false, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
  });
  it("reads a stored row and falls back per field on bad values", () => {
    expect(r.normalizeQueueRow({ exec_queue_enabled: 1, exec_default_capacity: 8, reminder_pct: 40, escalate_pct: 80, auto_reassign_idle_minutes: 7 }))
      .toEqual({ execQueueEnabled: true, execDefaultCapacity: 8, reminderPct: 40, escalatePct: 80, autoReassignIdleMinutes: 7 });
    expect(r.normalizeQueueRow({ exec_queue_enabled: 1, exec_default_capacity: 0, reminder_pct: 90, escalate_pct: 10, auto_reassign_idle_minutes: -3 }))
      .toEqual({ execQueueEnabled: true, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
  });
});

describe("validateQueueInput", () => {
  it("accepts a valid partial update and only returns the keys sent", () => {
    expect(r.validateQueueInput({ execQueueEnabled: "true", execDefaultCapacity: "6" })).toEqual({ execQueueEnabled: true, execDefaultCapacity: 6 });
  });
  it("rejects capacity < 1, non-integers and absurd values with a 400", () => {
    for (const v of [0, -1, 1.5, "x", 201]) {
      expect(() => r.validateQueueInput({ execDefaultCapacity: v })).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });
  it("requires 0 < reminder < escalate < 100, checking against the current values for a partial update", () => {
    expect(() => r.validateQueueInput({ reminderPct: 80 }, { ...r.DEFAULTS, escalatePct: 75 })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => r.validateQueueInput({ escalatePct: 100 })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(r.validateQueueInput({ reminderPct: 30, escalatePct: 60 })).toEqual({ reminderPct: 30, escalatePct: 60 });
  });
  it("allows clearing idle auto-reassign with null/blank and rejects 0", () => {
    expect(r.validateQueueInput({ autoReassignIdleMinutes: "" })).toEqual({ autoReassignIdleMinutes: null });
    expect(() => r.validateQueueInput({ autoReassignIdleMinutes: 0 })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe("rankCandidates", () => {
  it("excludes unavailable executives and those at capacity (default capacity 5, profile capacity wins)", () => {
    const ranked = r.rankCandidates([
      cand(1, { available: false }), cand(2, { load: 5 }), cand(3, { load: 2, capacity: 2 }), cand(4, { load: 1 }),
    ], 5);
    expect(ranked.map((c) => c.adminId)).toEqual([4]);
  });
  it("prefers the lowest load/capacity ratio, then the longest-idle (NULL first), then the lowest id", () => {
    const ranked = r.rankCandidates([
      cand(10, { load: 2, capacity: 4 }),                       // 0.5
      cand(11, { load: 1, capacity: 5, lastAssignedAt: at("2026-10-14T10:00:00Z") }), // 0.2
      cand(12, { load: 1, capacity: 5, lastAssignedAt: at("2026-10-14T09:00:00Z") }), // 0.2, idle longer
      cand(13, { load: 1, capacity: 5, lastAssignedAt: null }),                       // 0.2, never assigned
      cand(9,  { load: 1, capacity: 5, lastAssignedAt: null }),                       // tie with 13 -> lower id
    ], 5);
    expect(ranked.map((c) => c.adminId)).toEqual([9, 13, 12, 11, 10]);
  });
});

describe("unassignedReason", () => {
  it("distinguishes nobody in the city, nobody available, and everyone full", () => {
    expect(r.unassignedReason([], 5)).toBe("none_in_city");
    expect(r.unassignedReason([cand(1, { available: false }), cand(2, { available: false })], 5)).toBe("all_unavailable");
    expect(r.unassignedReason([cand(1, { load: 5 }), cand(2, { available: false })], 5)).toBe("all_at_capacity");
  });
});

describe("SLA thresholds", () => {
  const base = { opened_at: at("2026-10-14T10:00:00Z"), deadline_at: at("2026-10-14T10:10:00Z"), reminded_at: null, escalated_at: null,
    owner_assigned_at: at("2026-10-14T10:00:30Z"), last_action_at: null };
  const city = { reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: 3 };
  it("computes elapsed percent of the original window and clamps it", () => {
    expect(r.elapsedPct(base, at("2026-10-14T10:05:00Z"))).toBe(50);
    expect(r.elapsedPct(base, at("2026-10-14T09:00:00Z"))).toBe(0);
    expect(r.elapsedPct(base, at("2026-10-14T11:00:00Z"))).toBe(100);
  });
  it("fires reminder at 50% and escalation at 75% exactly once (sent flags suppress them)", () => {
    expect(r.isReminderDue(base, city, at("2026-10-14T10:04:59Z"))).toBe(false);
    expect(r.isReminderDue(base, city, at("2026-10-14T10:05:00Z"))).toBe(true);
    expect(r.isReminderDue({ ...base, reminded_at: at("2026-10-14T10:05:01Z") }, city, at("2026-10-14T10:06:00Z"))).toBe(false);
    expect(r.isEscalationDue(base, city, at("2026-10-14T10:07:29Z"))).toBe(false);
    expect(r.isEscalationDue(base, city, at("2026-10-14T10:07:30Z"))).toBe(true);
    expect(r.isEscalationDue({ ...base, escalated_at: at("2026-10-14T10:07:31Z") }, city, at("2026-10-14T10:08:00Z"))).toBe(false);
  });
  it("a zero-length window counts as fully elapsed (both due immediately)", () => {
    const z = { ...base, deadline_at: base.opened_at };
    expect(r.isReminderDue(z, city, at("2026-10-14T10:00:00Z"))).toBe(true);
    expect(r.isEscalationDue(z, city, at("2026-10-14T10:00:00Z"))).toBe(true);
  });
  it("idle = no meaningful action since the later of assignment and last action, and only if enough time remains", () => {
    const now = at("2026-10-14T10:04:00Z"); // 3.5 min after assignment, 6 min remaining
    expect(r.isIdle(base, city, now, 30000)).toBe(true);
    expect(r.isIdle({ ...base, last_action_at: at("2026-10-14T10:02:00Z") }, city, now, 30000)).toBe(false);
    expect(r.isIdle(base, { ...city, autoReassignIdleMinutes: null }, now, 30000)).toBe(false);
    expect(r.isIdle(base, city, at("2026-10-14T10:09:50Z"), 30000)).toBe(false); // only 10 s left
  });
});

describe("action classification", () => {
  it("only operational actions are meaningful; viewing never is; a note must be substantive", () => {
    expect(r.isMeaningful("viewed")).toBe(false);
    expect(r.isMeaningful("search_started")).toBe(true);
    expect(r.isMeaningful("driver_contacted")).toBe(true);
    expect(r.isMeaningful("contact_outcome")).toBe(true);
    expect(r.isMeaningful("note", "ok")).toBe(false);
    expect(r.isMeaningful("note", "Called three drivers in Sector 5, none free")).toBe(true);
    expect(r.ACTION_TYPES).toContain("escalated");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/services/__tests__/guaranteeQueueRules.test.js`
Expected: FAIL – `Cannot find module '../guaranteeQueueRules'`.

- [ ] **Step 3: Implement `guaranteeQueueRules.js`:**

```js
// Pure rules for the Booking Guarantee executive queue (spec 2026-10-14). No I/O: guaranteeQueueService feeds
// these the rows it loaded.

const DEFAULTS = Object.freeze({
  execQueueEnabled: false,
  execDefaultCapacity: 5,
  reminderPct: 50,
  escalatePct: 75,
  autoReassignIdleMinutes: null,
});
const LIMITS = Object.freeze({ capacity: [1, 200], pct: [1, 99], idleMinutes: [1, 1440] });

const ACTION_TYPES = Object.freeze([
  "viewed", "search_started", "driver_contacted", "contact_outcome", "driver_assigned", "escalated", "note", "resolution_attempt",
]);
const MEANINGFUL_TYPES = new Set(["search_started", "driver_contacted", "contact_outcome", "driver_assigned", "escalated", "resolution_attempt"]);
const MIN_NOTE_LENGTH = 10;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const blank = (v) => v === null || v === undefined || v === "";
const inRange = (n, [lo, hi]) => Number.isInteger(n) && n >= lo && n <= hi;
const toBool = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

/** A city_order_settings row (snake_case) as the camelCase queue settings; bad values fall back per field. */
function normalizeQueueRow(row) {
  const d = { ...DEFAULTS };
  if (!row) return d;
  const cap = Number(row.exec_default_capacity);
  const rem = Number(row.reminder_pct);
  const esc = Number(row.escalate_pct);
  const idle = blank(row.auto_reassign_idle_minutes) ? null : Number(row.auto_reassign_idle_minutes);
  const pctsOk = inRange(rem, LIMITS.pct) && inRange(esc, LIMITS.pct) && rem < esc;
  return {
    execQueueEnabled: Boolean(row.exec_queue_enabled),
    execDefaultCapacity: inRange(cap, LIMITS.capacity) ? cap : d.execDefaultCapacity,
    reminderPct: pctsOk ? rem : d.reminderPct,
    escalatePct: pctsOk ? esc : d.escalatePct,
    autoReassignIdleMinutes: idle !== null && inRange(idle, LIMITS.idleMinutes) ? idle : null,
  };
}

/** Validates admin input (camelCase). Returns only the keys that were sent; throws a 400 on the first bad value. */
function validateQueueInput(input = {}, current = DEFAULTS) {
  const out = {};
  if (input.execQueueEnabled !== undefined) out.execQueueEnabled = toBool(input.execQueueEnabled);
  if (input.execDefaultCapacity !== undefined) {
    const n = blank(input.execDefaultCapacity) ? NaN : Number(input.execDefaultCapacity);
    if (!inRange(n, LIMITS.capacity)) throw badRequest("exec_default_capacity must be a whole number between 1 and 200");
    out.execDefaultCapacity = n;
  }
  if (input.reminderPct !== undefined) {
    const n = blank(input.reminderPct) ? NaN : Number(input.reminderPct);
    if (!inRange(n, LIMITS.pct)) throw badRequest("reminder_pct must be a whole number between 1 and 99");
    out.reminderPct = n;
  }
  if (input.escalatePct !== undefined) {
    const n = blank(input.escalatePct) ? NaN : Number(input.escalatePct);
    if (!inRange(n, LIMITS.pct)) throw badRequest("escalate_pct must be a whole number between 1 and 99");
    out.escalatePct = n;
  }
  if (input.autoReassignIdleMinutes !== undefined) {
    if (blank(input.autoReassignIdleMinutes)) out.autoReassignIdleMinutes = null;
    else {
      const n = Number(input.autoReassignIdleMinutes);
      if (!inRange(n, LIMITS.idleMinutes)) throw badRequest("auto_reassign_idle_minutes must be a whole number between 1 and 1440");
      out.autoReassignIdleMinutes = n;
    }
  }
  const reminder = out.reminderPct ?? current.reminderPct;
  const escalate = out.escalatePct ?? current.escalatePct;
  if ((out.reminderPct !== undefined || out.escalatePct !== undefined) && !(reminder < escalate)) {
    throw badRequest("reminder_pct must be lower than escalate_pct");
  }
  return out;
}

const effectiveCapacity = (candidate, defaultCapacity) => (Number.isInteger(candidate.capacity) && candidate.capacity > 0 ? candidate.capacity : defaultCapacity);

/** Eligible candidates (available, below capacity), best first: lowest load/capacity, longest idle (NULL first), lowest id. */
function rankCandidates(candidates, defaultCapacity) {
  return candidates
    .map((c) => ({ ...c, capacity: effectiveCapacity(c, defaultCapacity) }))
    .filter((c) => c.available && c.load < c.capacity)
    .sort((a, b) => {
      const ra = a.load / a.capacity;
      const rb = b.load / b.capacity;
      if (ra !== rb) return ra - rb;
      const ta = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : -Infinity;
      const tb = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : -Infinity;
      if (ta !== tb) return ta - tb;
      return a.adminId - b.adminId;
    })
    .map((c) => ({ adminId: c.adminId, load: c.load, capacity: c.capacity }));
}

function unassignedReason(candidates) {
  if (!candidates.length) return "none_in_city";
  if (!candidates.some((c) => c.available)) return "all_unavailable";
  return "all_at_capacity";
}

const ms = (d) => new Date(d).getTime();

/** Percent (0-100) of the ORIGINAL guarantee window that has elapsed. A zero/negative window counts as fully elapsed. */
function elapsedPct(c, now = new Date()) {
  const total = ms(c.deadline_at) - ms(c.opened_at);
  if (!(total > 0)) return 100;
  return Math.min(100, Math.max(0, ((now.getTime() - ms(c.opened_at)) / total) * 100));
}

const isReminderDue = (c, city, now = new Date()) => !c.reminded_at && elapsedPct(c, now) >= city.reminderPct;
const isEscalationDue = (c, city, now = new Date()) => !c.escalated_at && elapsedPct(c, now) >= city.escalatePct;

/** Owner has done nothing meaningful for autoReassignIdleMinutes AND at least minRemainingMs is left for a handover. */
function isIdle(c, city, now, minRemainingMs) {
  if (!city.autoReassignIdleMinutes || !c.owner_assigned_at) return false;
  if (ms(c.deadline_at) - now.getTime() < minRemainingMs) return false;
  const touched = Math.max(ms(c.owner_assigned_at), c.last_action_at ? ms(c.last_action_at) : 0);
  return now.getTime() - touched >= city.autoReassignIdleMinutes * 60 * 1000;
}

const isMeaningful = (type, note) => {
  if (type === "note") return String(note ?? "").trim().length >= MIN_NOTE_LENGTH;
  return MEANINGFUL_TYPES.has(type);
};

module.exports = {
  DEFAULTS, LIMITS, ACTION_TYPES, MEANINGFUL_TYPES, MIN_NOTE_LENGTH,
  normalizeQueueRow, validateQueueInput, effectiveCapacity, rankCandidates, unassignedReason,
  elapsedPct, isReminderDue, isEscalationDue, isIdle, isMeaningful,
};
```

- [ ] **Step 4: Run and verify pass**

Run: `cd backend && npx jest src/services/__tests__/guaranteeQueueRules.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Checkpoint (after user approval).** Stage the two files; message `feat(guarantee-queue): pure rules for ranking, thresholds and settings`.

---

### Task 3: Per-city queue settings service

**Files:**
- Create: `backend/src/services/guaranteeQueueSettings.js`
- Test: `backend/src/services/__tests__/guaranteeQueueSettings.test.js`

**Interfaces:**
- Consumes: `guaranteeQueueRules.{normalizeQueueRow, validateQueueInput, DEFAULTS}`; Prisma `city_order_settings`, `tbl_city`.
- Produces: `getQueueSettings(cityId, { fresh = false }) -> camelCase settings` (fails closed to `DEFAULTS` = disabled), `saveQueueSettings({ cityId, input, adminId }) -> settings`, `_resetCache()`.

- [ ] **Step 1: Write the failing test:**

```js
jest.mock("../../config/db", () => ({
  city_order_settings: { findUnique: jest.fn(), upsert: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../guaranteeQueueSettings");

beforeEach(() => { jest.clearAllMocks(); settings._resetCache(); });

describe("getQueueSettings", () => {
  it("is OFF with defaults for a missing city or row", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue(null);
    expect((await settings.getQueueSettings(3)).execQueueEnabled).toBe(false);
    expect((await settings.getQueueSettings(null)).execQueueEnabled).toBe(false);
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(1);
  });
  it("fails closed (disabled) on a read error", async () => {
    prisma.city_order_settings.findUnique.mockRejectedValue(new Error("db down"));
    const s = await settings.getQueueSettings(3);
    expect(s).toMatchObject({ execQueueEnabled: false, execDefaultCapacity: 5 });
  });
  it("caches for a few seconds and bypasses the cache with fresh:true", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ exec_queue_enabled: 1, exec_default_capacity: 7, reminder_pct: 50, escalate_pct: 75 });
    expect((await settings.getQueueSettings(3)).execDefaultCapacity).toBe(7);
    await settings.getQueueSettings(3);
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(1);
    await settings.getQueueSettings(3, { fresh: true });
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("saveQueueSettings", () => {
  it("rejects an unknown city with a 400 and writes nothing", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue(null);
    await expect(settings.saveQueueSettings({ cityId: 99, input: { execQueueEnabled: true }, adminId: 1 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.city_order_settings.upsert).not.toHaveBeenCalled();
  });
  it("validates against the CURRENT values (reminder must stay below escalation), then upserts only the sent columns", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.findUnique.mockResolvedValue({ exec_queue_enabled: 0, exec_default_capacity: 5, reminder_pct: 50, escalate_pct: 75 });
    await expect(settings.saveQueueSettings({ cityId: 3, input: { reminderPct: 90 }, adminId: 1 })).rejects.toMatchObject({ statusCode: 400 });

    prisma.city_order_settings.upsert.mockResolvedValue({});
    await settings.saveQueueSettings({ cityId: 3, input: { execQueueEnabled: true, execDefaultCapacity: 6 }, adminId: 12 });
    const arg = prisma.city_order_settings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ city_id: 3 });
    expect(arg.update).toMatchObject({ exec_queue_enabled: true, exec_default_capacity: 6, updated_by: 12 });
    expect(arg.update).not.toHaveProperty("reminder_pct");
    expect(arg.create).toMatchObject({ city_id: 3, exec_queue_enabled: true, exec_default_capacity: 6 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../guaranteeQueueSettings'`):

Run: `cd backend && npx jest src/services/__tests__/guaranteeQueueSettings.test.js`

- [ ] **Step 3: Implement:**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./guaranteeQueueRules");

const TTL_MS = 5000;
const cache = new Map(); // cityId -> { at, value }

const COLUMN = {
  execQueueEnabled: "exec_queue_enabled",
  execDefaultCapacity: "exec_default_capacity",
  reminderPct: "reminder_pct",
  escalatePct: "escalate_pct",
  autoReassignIdleMinutes: "auto_reassign_idle_minutes",
};

/**
 * The city's executive-queue settings. Fail closed: a missing city/row or any read error gives a DISABLED
 * queue, so a settings outage can never change who may assign a guarantee case.
 */
async function getQueueSettings(cityId, { fresh = false } = {}) {
  const id = Number(cityId);
  if (!Number.isInteger(id) || id <= 0) return { ...rules.DEFAULTS };
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const row = await prisma.city_order_settings.findUnique({ where: { city_id: id } });
    const value = rules.normalizeQueueRow(row);
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.warn(`guaranteeQueueSettings.getQueueSettings: city ${id} unreadable, queue treated as OFF: ${err.message}`);
    return { ...rules.DEFAULTS };
  }
}

async function saveQueueSettings({ cityId, input, adminId }) {
  const id = Number(cityId);
  const city = Number.isInteger(id) && id > 0 ? await prisma.tbl_city.findUnique({ where: { id } }) : null;
  if (!city) throw Object.assign(new Error("Unknown city"), { statusCode: 400 });
  const current = await getQueueSettings(id, { fresh: true });
  const clean = rules.validateQueueInput(input, current);

  const data = {};
  for (const [key, value] of Object.entries(clean)) data[COLUMN[key]] = value;
  data.updated_by = adminId ?? null;
  await prisma.city_order_settings.upsert({ where: { city_id: id }, update: data, create: { city_id: id, ...data } });
  cache.delete(id);
  logger.info(`guarantee-queue settings city=${id} admin=${adminId ?? "-"} ${JSON.stringify(clean)}`);
  return getQueueSettings(id, { fresh: true });
}

const _resetCache = () => cache.clear();

module.exports = { getQueueSettings, saveQueueSettings, _resetCache };
```

- [ ] **Step 4: Run, expect PASS:** `cd backend && npx jest src/services/__tests__/guaranteeQueueSettings.test.js`

- [ ] **Step 5: Checkpoint (after approval).** Stage both files; `feat(guarantee-queue): per-city queue settings`.

---

### Task 4: Real-MySQL test harness and the assignment engine (claim + capacity + one owner)

**Files:**
- Create: `backend/src/services/__tests__/helpers/mysqlTestDb.js`
- Create: `backend/src/services/guaranteeQueueService.js` (first part: engine)
- Test: `backend/src/services/__tests__/guaranteeQueueEngine.mysql.test.js`

**Interfaces:**
- Consumes: `guaranteeQueueRules`, `guaranteeQueueSettings`, `adminSocket.notifyDispatchAlert`, Prisma delegates from Task 1.
- Produces from `guaranteeQueueService`:
  - `listCandidates(cityId, client?) -> [{ adminId, available, capacity, load, lastAssignedAt }]`
  - `ensureProfile(adminId)`
  - `tryAssign(caseId, adminId, { cityId, expectedOwnerId = null, source, assignedBy = null, endReason = "reassigned", reason = null }) -> "claimed" | "case_gone" | "at_capacity" | "candidate_unavailable" | "candidate_busy"`
  - `claimCase(caseId, { cityId, source = "auto", assignedBy = null }) -> { claimed: boolean, adminId?, reason? }` where `reason ∈ not_claimable | none_in_city | all_unavailable | all_at_capacity`
  - `markUnassigned(caseRow, cityId, reason)`
  - `endActiveAssignment(caseId, endReason, client?) -> number`
  - `writeAudit(client, caseId, orderId, event, { adminId, meta })`, `notify(kind, caseRow, cityId, extra)`

**Test-database setup (one-time, by the engineer, never against the dev or prod DB):**
```powershell
# 1. In MySQL: CREATE DATABASE shifter_guarantee_test CHARACTER SET utf8mb4;
# 2. From backend/ (PowerShell):
$env:GUARANTEE_TEST_DATABASE_URL = "mysql://USER:PASSWORD@HOST:3306/shifter_guarantee_test?connection_limit=20&pool_timeout=30"
$env:DATABASE_URL = $env:GUARANTEE_TEST_DATABASE_URL
npx prisma db push --skip-generate
```
`db push` builds the schema from `schema.prisma` into the empty disposable database, so it also exercises the Task 1 schema. The harness refuses any database whose name does not end in `_test`. The `connection_limit` raises Prisma's pool so the concurrent-claim tests are not starved of connections.

- [ ] **Step 1: Write the harness `helpers/mysqlTestDb.js`:**

```js
// Real-MySQL test harness for the guarantee executive queue. Tests that use it run only when
// GUARANTEE_TEST_DATABASE_URL points at a disposable database whose name ends in "_test"; otherwise they are
// SKIPPED (jest prints the skip count, so a skipped gate is visible, never silently green).
const url = process.env.GUARANTEE_TEST_DATABASE_URL || "";
const dbName = (url.split("?")[0].split("/").pop() || "").trim();

if (url && !/_test$/.test(dbName)) {
  throw new Error(`Refusing to run: GUARANTEE_TEST_DATABASE_URL database "${dbName}" must end with "_test"`);
}
if (url) process.env.DATABASE_URL = url; // must happen before config/db is first required

const enabled = Boolean(url);
const describeMysql = enabled ? describe : describe.skip;

const TABLES = [
  "guarantee_assignment", "guarantee_action", "executive_guarantee_profile", "booking_guarantee_audit",
  "booking_guarantee_case", "city_order_settings", "admin",
];

async function resetDb(prisma) {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of TABLES) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
}

let seq = 0;
const nextId = () => ++seq;

const makeExec = (prisma, cityId, o = {}) =>
  prisma.admin.create({ data: { username: `exec_${cityId}_${nextId()}_${Date.now()}`, password: "x", role: "executive", city_id: cityId, status: true, ...o } });

const makeAdmin = (prisma, cityId, role = "admin") =>
  prisma.admin.create({ data: { username: `${role}_${cityId}_${nextId()}_${Date.now()}`, password: "x", role, city_id: cityId, status: true } });

/** An open guarantee case, as openForExhaustedOrder + onCaseOpened would leave it for an enabled city. */
const makeCase = (prisma, cityId, o = {}) =>
  prisma.booking_guarantee_case.create({
    data: {
      order_id: 900000 + nextId(), uid: 1, status: "open", selected_package_ids: "[1]", compensation_amount: 100,
      opened_at: new Date(Date.now() - 60 * 1000), deadline_at: new Date(Date.now() + 30 * 60 * 1000),
      city_id: cityId, queue_state: "unassigned", ...o,
    },
  });

const setProfile = (prisma, adminId, data) =>
  prisma.executive_guarantee_profile.upsert({ where: { admin_id: adminId }, update: data, create: { admin_id: adminId, ...data } });

const enableQueue = (prisma, cityId, o = {}) =>
  prisma.city_order_settings.upsert({
    where: { city_id: cityId },
    update: { exec_queue_enabled: true, ...o },
    create: { city_id: cityId, exec_queue_enabled: true, ...o },
  });

const events = async (prisma, caseId) =>
  (await prisma.booking_guarantee_audit.findMany({ where: { case_id: caseId }, orderBy: { id: "asc" } })).map((e) => e.event);

module.exports = { enabled, describeMysql, resetDb, makeExec, makeAdmin, makeCase, setProfile, enableQueue, events };
```

- [ ] **Step 2: Write the failing engine tests `guaranteeQueueEngine.mysql.test.js`:**

```js
const db = require("./helpers/mysqlTestDb"); // sets DATABASE_URL first
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue engine (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 });
  });
  afterAll(() => prisma.$disconnect());

  it("AC-3: many ended periods may coexist for one case, a second ACTIVE period is rejected", async () => {
    const c = await db.makeCase(prisma, CITY);
    const mk = (adminId, active) => prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: adminId, source: "auto", active } });
    await mk(1, 1); await mk(2, null); await mk(3, null);
    await expect(mk(4, 1)).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(3);
  });

  it("assigns an open case to the one eligible executive of its city and records owner, period and audit", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    const res = await svc.claimCase(c.id, { cityId: CITY });
    expect(res).toMatchObject({ claimed: true, adminId: e.id });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: e.id, queue_state: "assigned", unassigned_reason: null });
    expect(row.owner_assigned_at).toBeInstanceOf(Date);
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ admin_id: e.id, active: 1, source: "auto", assigned_by: null });
    expect(await db.events(prisma, c.id)).toContain("exec_auto_assigned");
  });

  it("never selects executives of another city, city admins or superadmins", async () => {
    await db.makeExec(prisma, 2);
    await db.makeAdmin(prisma, CITY, "admin");
    await db.makeAdmin(prisma, CITY, "superadmin");
    const c = await db.makeCase(prisma, CITY);
    const res = await svc.claimCase(c.id, { cityId: CITY });
    expect(res).toEqual({ claimed: false, reason: "none_in_city" });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).queue_state).toBe("unassigned");
  });

  it("skips unavailable and deactivated executives", async () => {
    const off = await db.makeExec(prisma, CITY); await db.setProfile(prisma, off.id, { available: 0 });
    await db.makeExec(prisma, CITY, { status: false });
    const c = await db.makeCase(prisma, CITY);
    const res = await svc.claimCase(c.id, { cityId: CITY });
    expect(res.claimed).toBe(false);
    expect(res.reason).toBe("all_unavailable");
  });

  it("balances by load/capacity: the emptier executive gets the next case", async () => {
    const a = await db.makeExec(prisma, CITY);
    const b = await db.makeExec(prisma, CITY);
    const first = await db.makeCase(prisma, CITY);
    const r1 = await svc.claimCase(first.id, { cityId: CITY });
    const second = await db.makeCase(prisma, CITY);
    const r2 = await svc.claimCase(second.id, { cityId: CITY });
    expect(new Set([r1.adminId, r2.adminId])).toEqual(new Set([a.id, b.id]));
  });

  it("AC-4: with capacity 1 and many concurrent claims for one executive, exactly one succeeds; the rest stay unassigned with a reason", async () => {
    const e = await db.makeExec(prisma, CITY);
    await db.setProfile(prisma, e.id, { capacity: 1 });
    const cases = [];
    for (let i = 0; i < 8; i += 1) cases.push(await db.makeCase(prisma, CITY));
    const results = await Promise.all(cases.map((c) => svc.claimCase(c.id, { cityId: CITY })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: e.id, active: 1 } })).toBe(1);
    const rest = await prisma.booking_guarantee_case.findMany({ where: { city_id: CITY, queue_state: "unassigned" } });
    expect(rest).toHaveLength(7);
    rest.forEach((r) => expect(r.unassigned_reason).toBe("all_at_capacity"));
  });

  it("AC-4b: capacity 3 with 10 concurrent cases and two executives never exceeds either limit", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    await db.setProfile(prisma, a.id, { capacity: 3 }); await db.setProfile(prisma, b.id, { capacity: 3 });
    const cases = [];
    for (let i = 0; i < 10; i += 1) cases.push(await db.makeCase(prisma, CITY));
    await Promise.all(cases.map((c) => svc.claimCase(c.id, { cityId: CITY })));
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: a.id, active: 1 } })).toBeLessThanOrEqual(3);
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: b.id, active: 1 } })).toBeLessThanOrEqual(3);
    expect(await prisma.guarantee_assignment.count({ where: { active: 1 } })).toBe(6);
  });

  it("AC-5: concurrent workers claiming the SAME case produce one owner and one active period", async () => {
    await db.makeExec(prisma, CITY); await db.makeExec(prisma, CITY); await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => svc.claimCase(c.id, { cityId: CITY })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(1);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(1);
  });

  it("does not claim a case that is already closed or already owned", async () => {
    await db.makeExec(prisma, CITY);
    const closed = await db.makeCase(prisma, CITY, { status: "resolved_assigned" });
    expect(await svc.claimCase(closed.id, { cityId: CITY })).toEqual({ claimed: false, reason: "not_claimable" });
    const owned = await db.makeCase(prisma, CITY, { owner_admin_id: 777, queue_state: "assigned" });
    expect(await svc.claimCase(owned.id, { cityId: CITY })).toEqual({ claimed: false, reason: "not_claimable" });
  });

  it("AC-7: no executive available keeps the case visible as unassigned, alerts supervisors once (throttled), never touches the deadline", async () => {
    const c = await db.makeCase(prisma, CITY);
    const before = c.deadline_at.getTime();
    await svc.claimCase(c.id, { cityId: CITY });
    await svc.claimCase(c.id, { cityId: CITY });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ queue_state: "unassigned", unassigned_reason: "none_in_city", owner_admin_id: null });
    expect(row.deadline_at.getTime()).toBe(before);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyDispatchAlert.mock.calls[0][3]).toMatchObject({ kind: "guarantee_unassigned", reason: "none_in_city" });
    expect((await db.events(prisma, c.id)).filter((e) => e === "exec_no_executive_alert")).toHaveLength(1);
  });

  it("a claim never changes deadline, compensation or status of the case (AC-9)", async () => {
    await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await svc.claimCase(c.id, { cityId: CITY });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    expect(Number(row.compensation_amount)).toBe(100);
    expect(row.status).toBe("open");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run (PowerShell, from `backend/`): `$env:GUARANTEE_TEST_DATABASE_URL="mysql://…/shifter_guarantee_test"; npx jest src/services/__tests__/guaranteeQueueEngine.mysql.test.js`
Expected: FAIL – `Cannot find module '../guaranteeQueueService'`. (Without the env var, the suite is reported as skipped; that does **not** count as passing the gate.)

- [ ] **Step 4: Implement the engine part of `guaranteeQueueService.js`:**

```js
const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const adminSocket = require("../sockets/adminSocket");
const rules = require("./guaranteeQueueRules");
const queueSettings = require("./guaranteeQueueSettings");

const MAX_CLAIM_ATTEMPTS = 5;
const ALERT_THROTTLE_MS = 5 * 60 * 1000;
const TX_OPTIONS = { maxWait: 10000, timeout: 15000 };
const END_REASON_FOR_STATUS = { resolved_assigned: "resolved", cancelled: "cancelled", expired_compensated: "expired" };

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const safeJson = (v) => (v == null ? null : JSON.stringify(v));

async function writeAudit(client, caseId, orderId, event, { adminId = null, meta = null } = {}) {
  await client.booking_guarantee_audit.create({
    data: { case_id: caseId, order_id: orderId, event, admin_id: adminId, meta: safeJson(meta) },
  });
}

/** Socket alert (best-effort; never throws). Payload holds ids and codes only, no customer data. */
function notify(kind, caseRow, cityId, extra = {}) {
  const messages = {
    guarantee_assigned: `Booking Guarantee order #${caseRow.order_id} is assigned to you`,
    guarantee_reminder: `Reminder: Booking Guarantee order #${caseRow.order_id} window is running down`,
    guarantee_escalated: `ESCALATION: Booking Guarantee order #${caseRow.order_id} is close to its deadline`,
    guarantee_unassigned: `No executive available for Booking Guarantee order #${caseRow.order_id}`,
  };
  try {
    adminSocket.notifyDispatchAlert(caseRow.order_id, cityId, messages[kind] || kind, {
      kind, deadline_at: new Date(caseRow.deadline_at).toISOString(), owner_admin_id: caseRow.owner_admin_id ?? null, ...extra,
    });
  } catch (err) {
    logger.error(`guaranteeQueue: ${kind} notify failed for order ${caseRow.order_id}:`, err);
  }
}

async function ensureProfile(adminId) {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO executive_guarantee_profile (admin_id, available, updated_at)
    VALUES (${adminId}, 1, ${new Date()})
    ON DUPLICATE KEY UPDATE admin_id = admin_id`);
}

/** Executives of a city with their live load: a COUNT of active periods on OPEN cases, never a stored counter. */
async function listCandidates(cityId, client = prisma) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT a.id AS admin_id, COALESCE(p.available, 1) AS available, p.capacity AS capacity, p.last_assigned_at AS last_assigned_at,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
        WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open') AS load_count
    FROM admin a
    LEFT JOIN executive_guarantee_profile p ON p.admin_id = a.id
    WHERE a.role = 'executive' AND a.status = 1 AND a.city_id = ${Number(cityId)}`);
  return rows.map((r) => ({
    adminId: Number(r.admin_id), available: Number(r.available) === 1, capacity: r.capacity == null ? null : Number(r.capacity),
    load: Number(r.load_count), lastAssignedAt: r.last_assigned_at,
  }));
}

/**
 * Ends the active ownership period of a case (history row is kept; `active` goes NULL so the unique key
 * frees up). Returns how many periods were ended.
 */
async function endActiveAssignment(caseId, endReason, client = prisma, now = new Date()) {
  const res = await client.guarantee_assignment.updateMany({
    where: { case_id: caseId, active: 1 },
    data: { active: null, ended_at: now, end_reason: endReason },
  });
  return res.count;
}

/**
 * One short transaction that gives `caseId` to `adminId`, or a reason it could not. Concurrency:
 *  - the executive's profile row is locked FOR UPDATE, so every claim for that executive serialises (across
 *    all app instances: the lock lives in MySQL);
 *  - the load is counted as the FIRST consistent read after the lock is held, so every commit by a previous
 *    lock holder is visible (REPEATABLE READ takes its snapshot at the first non-locking read);
 *  - the case is taken with a compare-and-swap on owner_admin_id (null for a first claim, the expected current
 *    owner for a reassignment), and UNIQUE(case_id, active) is a second independent guard.
 * deadline_at, status and compensation columns are never written here.
 */
async function tryAssign(caseId, adminId, { cityId, expectedOwnerId = null, source, assignedBy = null, endReason = "reassigned", reason = null }) {
  await ensureProfile(adminId);
  try {
    return await prisma.$transaction(async (tx) => {
      const profile = (await tx.$queryRaw(Prisma.sql`
        SELECT admin_id, available, capacity FROM executive_guarantee_profile WHERE admin_id = ${adminId} FOR UPDATE`))[0];
      if (!profile || Number(profile.available) !== 1) return "candidate_unavailable";
      const admin = (await tx.$queryRaw(Prisma.sql`
        SELECT id FROM admin WHERE id = ${adminId} AND role = 'executive' AND status = 1 AND city_id = ${Number(cityId)}`))[0];
      if (!admin) return "candidate_unavailable";

      const city = await queueSettings.getQueueSettings(cityId);
      const capacity = rules.effectiveCapacity({ capacity: profile.capacity == null ? null : Number(profile.capacity) }, city.execDefaultCapacity);
      const load = Number((await tx.$queryRaw(Prisma.sql`
        SELECT COUNT(*) AS load_count FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
        WHERE ga.admin_id = ${adminId} AND ga.active = 1 AND c.status = 'open'`))[0].load_count);
      if (load >= capacity) return "at_capacity";

      const now = new Date();
      const swapped = await tx.booking_guarantee_case.updateMany({
        where: { id: caseId, status: "open", owner_admin_id: expectedOwnerId },
        data: { owner_admin_id: adminId, owner_assigned_at: now, queue_state: "assigned", unassigned_reason: null },
      });
      if (swapped.count === 0) return "case_gone";

      if (expectedOwnerId !== null) await endActiveAssignment(caseId, endReason, tx, now);
      await tx.guarantee_assignment.create({
        data: { case_id: caseId, admin_id: adminId, assigned_by: assignedBy, source, started_at: now, active: 1, reassign_reason: reason },
      });
      await tx.$executeRaw(Prisma.sql`UPDATE executive_guarantee_profile SET last_assigned_at = ${now} WHERE admin_id = ${adminId}`);
      const row = await tx.booking_guarantee_case.findUnique({ where: { id: caseId }, select: { order_id: true } });
      const event = expectedOwnerId !== null ? "exec_reassigned" : source === "auto" ? "exec_auto_assigned" : "exec_manually_assigned";
      await writeAudit(tx, caseId, row.order_id, event, {
        adminId: assignedBy, meta: { executive: adminId, from: expectedOwnerId, source, reason, load, capacity },
      });
      return "claimed";
    }, TX_OPTIONS);
  } catch (err) {
    if (err && err.code === "P2002") return "case_gone"; // a second active period for this case: someone else won
    if (err && (err.code === "P2034" || err.code === "P2028" || /deadlock|lock wait timeout/i.test(String(err.message)))) return "candidate_busy";
    throw err;
  }
}

/** No executive could take the case: keep it visible as unassigned and alert supervisors (throttled). */
async function markUnassigned(caseRow, cityId, reason) {
  await prisma.booking_guarantee_case.updateMany({
    where: { id: caseRow.id, status: "open", owner_admin_id: null },
    data: { queue_state: "unassigned", unassigned_reason: reason },
  });
  const cutoff = new Date(Date.now() - ALERT_THROTTLE_MS);
  const throttled = await prisma.booking_guarantee_case.updateMany({
    where: { id: caseRow.id, status: "open", owner_admin_id: null, OR: [{ last_alerted_at: null }, { last_alerted_at: { lt: cutoff } }] },
    data: { last_alerted_at: new Date() },
  });
  if (throttled.count !== 1) return;
  await writeAudit(prisma, caseRow.id, caseRow.order_id, "exec_no_executive_alert", { meta: { reason } });
  notify("guarantee_unassigned", { ...caseRow, owner_admin_id: null }, cityId, { reason });
}

/**
 * Automatic assignment of an unowned open case. Tries the ranked executives (max MAX_CLAIM_ATTEMPTS); a lost
 * race moves on to the next one. If nobody can take it the case stays/returns to the unassigned queue with a reason.
 */
async function claimCase(caseId, { cityId, source = "auto", assignedBy = null } = {}) {
  const row = await prisma.booking_guarantee_case.findUnique({ where: { id: caseId } });
  if (!row || row.status !== "open" || row.owner_admin_id) return { claimed: false, reason: "not_claimable" };

  const city = await queueSettings.getQueueSettings(cityId);
  const candidates = await listCandidates(cityId);
  const ranked = rules.rankCandidates(candidates, city.execDefaultCapacity);
  if (!ranked.length) {
    const reason = rules.unassignedReason(candidates);
    await markUnassigned(row, cityId, reason);
    return { claimed: false, reason };
  }
  for (const cand of ranked.slice(0, MAX_CLAIM_ATTEMPTS)) {
    const outcome = await tryAssign(caseId, cand.adminId, { cityId, expectedOwnerId: null, source, assignedBy });
    if (outcome === "claimed") {
      notify("guarantee_assigned", { ...row, owner_admin_id: cand.adminId }, cityId);
      return { claimed: true, adminId: cand.adminId };
    }
    if (outcome === "case_gone") return { claimed: false, reason: "not_claimable" };
    // at_capacity / candidate_unavailable / candidate_busy: try the next candidate
  }
  await markUnassigned(row, cityId, "all_at_capacity");
  return { claimed: false, reason: "all_at_capacity" };
}

module.exports = {
  END_REASON_FOR_STATUS, TX_OPTIONS, httpError,
  writeAudit, notify, ensureProfile, listCandidates, endActiveAssignment, tryAssign, markUnassigned, claimCase,
};
```

- [ ] **Step 5: Run the engine tests against the disposable DB**

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="mysql://…/shifter_guarantee_test"; npx jest src/services/__tests__/guaranteeQueueEngine.mysql.test.js --runInBand`
Expected: PASS, all 10 tests. If AC-4 shows more than one claim, STOP: the locking assumption (refinement 3) is wrong on this MySQL/MariaDB version; do not "fix" the test. Investigate the isolation level (`SELECT @@transaction_isolation`) and report before changing the design.

- [ ] **Step 6: Checkpoint (after approval).** Stage `backend/src/services/guaranteeQueueService.js backend/src/services/__tests__/helpers/mysqlTestDb.js backend/src/services/__tests__/guaranteeQueueEngine.mysql.test.js`; message `feat(guarantee-queue): workload-aware claim engine with real-MySQL concurrency tests`.

---

### Task 5: Reassignment, release to unassigned, availability handover, open/close hooks

**Files:**
- Modify: `backend/src/services/guaranteeQueueService.js` (append)
- Test: `backend/src/services/__tests__/guaranteeQueueReassign.mysql.test.js`

**Interfaces:**
- Consumes: Task 4 exports.
- Produces:
  - `releaseToUnassigned(caseRow, cityId, { endReason, reason = null, assignedBy = null }) -> boolean`
  - `reassignAuto(caseRow, { cityId, endReason = "reassigned", source = "auto", assignedBy = null, reason = null }) -> { claimed: boolean, adminId?, queueState }`
  - `reassignCase({ orderId, targetAdminId = null, actor: { id, role, cityId }, reason }) -> { queueState, ownerAdminId }` (throws `httpError` 400/404/409)
  - `setAvailability(adminId, available, actor) -> { handedOver: number }`
  - `setCapacity(adminId, capacity|null, actor)`
  - `onCaseOpened(caseRow, cityId) -> { queued: boolean }`, `onCaseClosed(caseRow, status)`
  - `assertCityAccess(actor, cityId)`

- [ ] **Step 1: Write the failing tests `guaranteeQueueReassign.mysql.test.js`:**

```js
const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue reassignment (real MySQL)", () => {
  const prisma = require("../../config/db");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  let sup;
  const actor = () => ({ id: sup.id, role: "admin", cityId: CITY });
  const claimed = async (caseRow, exec) => {
    // give `caseRow` to `exec` deterministically via the manual path
    await svc.reassignCase({ orderId: caseRow.order_id, targetAdminId: exec.id, actor: actor(), reason: "seed" });
  };

  beforeEach(async () => {
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 });
    sup = await db.makeAdmin(prisma, CITY, "admin");
  });
  afterAll(() => prisma.$disconnect());

  it("a supervisor can assign an unassigned case to a named executive (manual source)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await claimed(c, e);
    const p = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ admin_id: e.id, active: 1, source: "manual", assigned_by: sup.id });
    expect(await db.events(prisma, c.id)).toContain("exec_manually_assigned");
  });

  it("AC-6/AC-10: reassigning keeps every period (old one ended, new one active) and never moves the deadline", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await claimed(c, a);
    await svc.reassignCase({ orderId: c.order_id, targetAdminId: b.id, actor: actor(), reason: "A is overloaded" });
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id }, orderBy: { id: "asc" } });
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ admin_id: a.id, active: null, end_reason: "reassigned" });
    expect(periods[0].ended_at).toBeInstanceOf(Date);
    expect(periods[1]).toMatchObject({ admin_id: b.id, active: 1, source: "manual", reassign_reason: "A is overloaded" });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: b.id, queue_state: "assigned" });
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    expect(row.opened_at.getTime()).toBe(c.opened_at.getTime());
  });

  it("AC-6: two supervisors reassigning the same case at once: exactly one wins, the other gets 409", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY); const d = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await claimed(c, a);
    const settled = await Promise.allSettled([
      svc.reassignCase({ orderId: c.order_id, targetAdminId: b.id, actor: actor(), reason: "x1" }),
      svc.reassignCase({ orderId: c.order_id, targetAdminId: d.id, actor: actor(), reason: "x2" }),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((s) => s.status === "rejected");
    expect(lost.reason).toMatchObject({ statusCode: 409 });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(1);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(2);
  });

  it("capacity holds for supervisor reassignment: a full target is refused with 409 and the owner is unchanged", async () => {
    const a = await db.makeExec(prisma, CITY); const full = await db.makeExec(prisma, CITY);
    await db.setProfile(prisma, full.id, { capacity: 1 });
    const c1 = await db.makeCase(prisma, CITY); await claimed(c1, full);
    const c2 = await db.makeCase(prisma, CITY); await claimed(c2, a);
    await expect(svc.reassignCase({ orderId: c2.order_id, targetAdminId: full.id, actor: actor(), reason: "try" }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c2.id } })).owner_admin_id).toBe(a.id);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c2.id, active: 1 } })).toBe(1);
  });

  it("refuses an unavailable target, a target in another city, a non-executive target and reassigning to the current owner", async () => {
    const a = await db.makeExec(prisma, CITY);
    const off = await db.makeExec(prisma, CITY); await db.setProfile(prisma, off.id, { available: 0 });
    const other = await db.makeExec(prisma, 2);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    for (const target of [off.id, other.id, sup.id, a.id]) {
      await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: target, actor: actor(), reason: "x" })).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it("a city admin cannot touch another city's case (404, not 403); a superadmin can", async () => {
    const e = await db.makeExec(prisma, 2);
    const c = await db.makeCase(prisma, 2);
    await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: e.id, actor: actor(), reason: "x" })).rejects.toMatchObject({ statusCode: 404 });
    const su = await db.makeAdmin(prisma, null, "superadmin");
    await svc.reassignCase({ orderId: c.order_id, targetAdminId: e.id, actor: { id: su.id, role: "superadmin", cityId: null }, reason: "ok" });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).owner_admin_id).toBe(e.id);
  });

  it("refuses to reassign a closed case (409) and requires a reason (400)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const closed = await db.makeCase(prisma, CITY, { status: "resolved_assigned" });
    await expect(svc.reassignCase({ orderId: closed.order_id, targetAdminId: e.id, actor: actor(), reason: "x" })).rejects.toMatchObject({ statusCode: 409 });
    const open = await db.makeCase(prisma, CITY);
    await expect(svc.reassignCase({ orderId: open.order_id, targetAdminId: e.id, actor: actor(), reason: "  " })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("auto-reassign (target null) picks the best OTHER executive; if none has capacity the case returns to unassigned and the old period is ended", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    const r1 = await svc.reassignCase({ orderId: c.order_id, targetAdminId: null, actor: actor(), reason: "rebalance" });
    expect(r1).toMatchObject({ queueState: "assigned", ownerAdminId: b.id });
    await db.setProfile(prisma, a.id, { available: 0 });
    const r2 = await svc.reassignCase({ orderId: c.order_id, targetAdminId: null, actor: actor(), reason: "nobody left" });
    expect(r2).toMatchObject({ queueState: "unassigned", ownerAdminId: null });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: null, queue_state: "unassigned" });
    expect(row.unassigned_reason).toBeTruthy();
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(0);
  });

  it("Review Focus 1: marking the owner unavailable hands cases over, or releases them to unassigned when nobody has capacity, deadline unchanged", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c1 = await db.makeCase(prisma, CITY); await claimed(c1, a);
    const c2 = await db.makeCase(prisma, CITY); await claimed(c2, a);
    await db.setProfile(prisma, b.id, { capacity: 1 });
    const res = await svc.setAvailability(a.id, false, actor());
    expect(res.handedOver).toBe(2);
    const rows = await prisma.booking_guarantee_case.findMany({ where: { id: { in: [c1.id, c2.id] } }, orderBy: { id: "asc" } });
    // b has capacity 1: one case moves to b, the other returns to the unassigned queue
    expect(rows.filter((r) => r.owner_admin_id === b.id)).toHaveLength(1);
    expect(rows.filter((r) => r.queue_state === "unassigned")).toHaveLength(1);
    rows.forEach((r) => expect(r.deadline_at.getTime()).toBe(c1.deadline_at.getTime()));
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: a.id, active: 1 } })).toBe(0);
    expect((await prisma.guarantee_assignment.findMany({ where: { admin_id: a.id } })).every((p) => p.end_reason === "unavailable")).toBe(true);
  });

  it("setCapacity validates the executive belongs to the supervisor's city and the value is a positive integer", async () => {
    const other = await db.makeExec(prisma, 2);
    await expect(svc.setCapacity(other.id, 3, actor())).rejects.toMatchObject({ statusCode: 404 });
    const e = await db.makeExec(prisma, CITY);
    await expect(svc.setCapacity(e.id, 0, actor())).rejects.toMatchObject({ statusCode: 400 });
    await svc.setCapacity(e.id, 7, actor());
    expect((await prisma.executive_guarantee_profile.findUnique({ where: { admin_id: e.id } })).capacity).toBe(7);
    await svc.setCapacity(e.id, null, actor());
    expect((await prisma.executive_guarantee_profile.findUnique({ where: { admin_id: e.id } })).capacity).toBeNull();
  });

  it("onCaseOpened queues and auto-assigns only when the city flag is on; OFF leaves the case untouched (AC-1)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const on = await db.makeCase(prisma, CITY, { queue_state: null });
    expect(await svc.onCaseOpened(on, CITY)).toMatchObject({ queued: true });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: on.id } })).owner_admin_id).toBe(e.id);
    expect(await db.events(prisma, on.id)).toEqual(expect.arrayContaining(["exec_queue_unassigned", "exec_auto_assigned"]));

    const offCity = 9;
    await db.makeExec(prisma, offCity);
    const off = await db.makeCase(prisma, offCity, { queue_state: null });
    expect(await svc.onCaseOpened(off, offCity)).toEqual({ queued: false });
    expect(await prisma.booking_guarantee_case.findUnique({ where: { id: off.id } })).toMatchObject({ queue_state: null, owner_admin_id: null });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: off.id } })).toBe(0);
  });

  it("Review Focus 3: onCaseClosed ends the active period with the matching reason; a closed case is never claimed or reassigned afterwards", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { status: "expired_compensated", closed_at: new Date() } });
    await svc.onCaseClosed({ id: c.id }, "expired_compensated");
    const p = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(p[0]).toMatchObject({ active: null, end_reason: "expired" });
    await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: b.id, actor: actor(), reason: "late" })).rejects.toMatchObject({ statusCode: 409 });
    expect(await svc.claimCase(c.id, { cityId: CITY })).toMatchObject({ claimed: false });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`svc.reassignCase is not a function` / `claimed is not defined` style errors):

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueueReassign.mysql.test.js --runInBand`

- [ ] **Step 3: Append to `guaranteeQueueService.js`** (before `module.exports`, then extend the exports):

```js
function assertCityAccess(actor, cityId) {
  if (actor.role === "superadmin") return;
  if (!Number.isInteger(Number(actor.cityId)) || Number(actor.cityId) !== Number(cityId)) throw httpError(404, "Not found");
}

/** Case leaves its owner and returns to the unassigned queue; the owner's period is ended with `endReason`. */
async function releaseToUnassigned(caseRow, cityId, { endReason, reason = null, assignedBy = null }) {
  const released = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const swapped = await tx.booking_guarantee_case.updateMany({
      where: { id: caseRow.id, status: "open", owner_admin_id: caseRow.owner_admin_id },
      data: { owner_admin_id: null, owner_assigned_at: null, queue_state: "unassigned" },
    });
    if (swapped.count === 0) return false;
    await endActiveAssignment(caseRow.id, endReason, tx, now);
    await writeAudit(tx, caseRow.id, caseRow.order_id, "exec_owner_released", { adminId: assignedBy, meta: { from: caseRow.owner_admin_id, endReason, reason } });
    return true;
  }, TX_OPTIONS);
  if (!released) return false;
  const candidates = await listCandidates(cityId);
  await markUnassigned({ ...caseRow, owner_admin_id: null }, cityId, rules.unassignedReason(candidates));
  return true;
}

/** Hand an owned case to the best OTHER executive; if nobody has capacity it returns to the unassigned queue. */
async function reassignAuto(caseRow, { cityId, endReason = "reassigned", source = "auto", assignedBy = null, reason = null }) {
  const city = await queueSettings.getQueueSettings(cityId);
  const candidates = (await listCandidates(cityId)).filter((c) => c.adminId !== caseRow.owner_admin_id);
  const ranked = rules.rankCandidates(candidates, city.execDefaultCapacity);
  for (const cand of ranked.slice(0, MAX_CLAIM_ATTEMPTS)) {
    const outcome = await tryAssign(caseRow.id, cand.adminId, {
      cityId, expectedOwnerId: caseRow.owner_admin_id, source, assignedBy, endReason, reason,
    });
    if (outcome === "claimed") {
      notify("guarantee_assigned", { ...caseRow, owner_admin_id: cand.adminId }, cityId);
      return { claimed: true, adminId: cand.adminId, queueState: "assigned" };
    }
    if (outcome === "case_gone") return { claimed: false, queueState: "unchanged" }; // someone else changed the owner
  }
  const done = await releaseToUnassigned(caseRow, cityId, { endReason, reason, assignedBy });
  return { claimed: false, queueState: done ? "unassigned" : "unchanged" };
}

/**
 * Supervisor reassignment. targetAdminId given: that executive must be active, available, in the case's city and
 * below capacity, else 409 and nothing changes. targetAdminId null: automatic (see reassignAuto). deadline_at is never touched.
 */
async function reassignCase({ orderId, targetAdminId = null, actor, reason }) {
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) throw httpError(400, "A reason is required");
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.city_id == null) throw httpError(404, "Not found");
  assertCityAccess(actor, row.city_id);
  if (row.status !== "open") throw httpError(409, "This guarantee case is already closed");
  if (!row.queue_state) throw httpError(409, "The executive queue is not active for this case");

  const cityId = row.city_id;
  if (targetAdminId == null) {
    const res = await reassignAuto(row, { cityId, source: "manual", assignedBy: actor.id, reason: why });
    if (res.queueState === "unchanged") throw httpError(409, "Case ownership changed. Refresh and retry");
    return { queueState: res.queueState, ownerAdminId: res.adminId ?? null };
  }
  const target = Number(targetAdminId);
  if (!Number.isInteger(target) || target <= 0) throw httpError(400, "target_admin_id must be a valid id");
  if (target === row.owner_admin_id) throw httpError(409, "That executive already owns this case");
  const outcome = await tryAssign(row.id, target, {
    cityId, expectedOwnerId: row.owner_admin_id, source: "manual", assignedBy: actor.id, endReason: "reassigned", reason: why,
  });
  if (outcome === "claimed") {
    notify("guarantee_assigned", { ...row, owner_admin_id: target }, cityId);
    return { queueState: "assigned", ownerAdminId: target };
  }
  const messages = {
    at_capacity: "That executive is at capacity",
    candidate_unavailable: "That executive is unavailable, inactive or not in this city",
    candidate_busy: "That executive is busy. Retry",
    case_gone: "Case ownership changed. Refresh and retry",
  };
  throw httpError(409, messages[outcome] || "Could not reassign");
}

async function loadExecutive(adminId, actor) {
  const a = await prisma.admin.findUnique({ where: { id: Number(adminId) }, select: { id: true, role: true, city_id: true } });
  if (!a || a.role !== "executive") throw httpError(404, "Not found");
  assertCityAccess(actor, a.city_id);
  return a;
}

async function handoverOwnedCases(adminId, cityId, assignedBy) {
  const owned = await prisma.booking_guarantee_case.findMany({ where: { status: "open", owner_admin_id: adminId } });
  let n = 0;
  for (const c of owned) {
    const res = await reassignAuto(c, { cityId: c.city_id ?? cityId, endReason: "unavailable", source: "auto", assignedBy, reason: "owner unavailable" });
    if (res.queueState !== "unchanged") n += 1;
  }
  return n;
}

async function setAvailability(adminId, available, actor) {
  const exec = await loadExecutive(adminId, actor);
  await ensureProfile(exec.id);
  await prisma.executive_guarantee_profile.update({ where: { admin_id: exec.id }, data: { available: available ? 1 : 0, updated_by: actor.id, updated_at: new Date() } });
  if (available) return { handedOver: 0 };
  return { handedOver: await handoverOwnedCases(exec.id, exec.city_id, actor.id) };
}

async function setCapacity(adminId, capacity, actor) {
  const exec = await loadExecutive(adminId, actor);
  let value = null;
  if (capacity !== null && capacity !== undefined && capacity !== "") {
    value = Number(capacity);
    if (!Number.isInteger(value) || value < rules.LIMITS.capacity[0] || value > rules.LIMITS.capacity[1]) throw httpError(400, "capacity must be a whole number between 1 and 200");
  }
  await ensureProfile(exec.id);
  await prisma.executive_guarantee_profile.update({ where: { admin_id: exec.id }, data: { capacity: value, updated_by: actor.id, updated_at: new Date() } });
  return { capacity: value };
}

/** Called from openForExhaustedOrder (best-effort). A city with the queue OFF is left exactly as before. */
async function onCaseOpened(caseRow, cityId) {
  const city = await queueSettings.getQueueSettings(cityId);
  if (!city.execQueueEnabled) return { queued: false };
  const set = await prisma.booking_guarantee_case.updateMany({
    where: { id: caseRow.id, status: "open", queue_state: null }, data: { queue_state: "unassigned" },
  });
  if (set.count === 0) return { queued: false };
  await writeAudit(prisma, caseRow.id, caseRow.order_id, "exec_queue_unassigned");
  await claimCase(caseRow.id, { cityId });
  return { queued: true };
}

/** Called after a case closes (assign / cancel / expire). Best-effort: the repair pass covers a failure here. */
async function onCaseClosed(caseRow, status) {
  return endActiveAssignment(caseRow.id, END_REASON_FOR_STATUS[status] || "resolved");
}
```
Extend `module.exports` with: `assertCityAccess, releaseToUnassigned, reassignAuto, reassignCase, setAvailability, setCapacity, onCaseOpened, onCaseClosed`.

- [ ] **Step 4: Run, expect PASS**

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueueReassign.mysql.test.js src/services/__tests__/guaranteeQueueEngine.mysql.test.js --runInBand`
Expected: PASS for both suites.

- [ ] **Step 5: Checkpoint (after approval).** Stage the service and the new test; message `feat(guarantee-queue): reassignment, availability handover, open/close hooks`.

---

### Task 6: Action log, ownership guard, case views

**Files:**
- Modify: `backend/src/services/guaranteeQueueService.js` (append)
- Test: `backend/src/services/__tests__/guaranteeQueueActions.mysql.test.js`

**Interfaces:**
- Produces:
  - `recordAction({ orderId, actor: { id, role, cityId }, type, result = null, driverId = null, meta = null }) -> { id, meaningful }` (throws `httpError`)
  - `recordAssignmentAction({ orderId, adminId, riderId })` (best-effort, never throws; used by `assignRider`)
  - `assertExecutiveMayAssign(user, orderId)` (throws `httpError(403)`; no-op for non-executives)
  - `getCaseDetail(orderId, actor) -> { case, assignments, actions, audit }`
  - `listMyCases(adminId) -> { active: [...], recent: [...], reassigned: [...] }`
- Rules enforced: executives act only on cases they own (open case for meaningful actions); admins/superadmins may only record `note`, `escalated`, `viewed`; `viewed` is logged but never meaningful; actor id/time are server-derived; metadata whitelisted to `note` (≤500 chars), `outcome`, `reason`.

- [ ] **Step 1: Write the failing tests `guaranteeQueueActions.mysql.test.js`:**

```js
const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue actions (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  let exec; let other; let sup; let c;
  const as = (a, role) => ({ id: a.id, role, cityId: a.city_id });

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY);
    exec = await db.makeExec(prisma, CITY);
    other = await db.makeExec(prisma, CITY);
    sup = await db.makeAdmin(prisma, CITY, "admin");
    c = await db.makeCase(prisma, CITY);
    await svc.claimCase(c.id, { cityId: CITY });
    // claimCase picked one of the two; make the owner deterministic
    await prisma.guarantee_assignment.updateMany({ where: { case_id: c.id, active: 1 }, data: { admin_id: exec.id } });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: exec.id } });
  });
  afterAll(() => prisma.$disconnect());

  it("AC-16: viewing is logged but never counts as progress", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "viewed" });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ queue_state: "assigned", first_action_at: null, last_action_at: null });
    const a = await prisma.guarantee_action.findFirst({ where: { case_id: c.id } });
    expect(a).toMatchObject({ type: "viewed", meaningful: 0, admin_id: exec.id });
  });

  it("the first meaningful action moves assigned -> in_progress and stamps first/last action times (server clock)", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" });
    let row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("in_progress");
    expect(row.first_action_at).toBeInstanceOf(Date);
    const first = row.first_action_at.getTime();
    await new Promise((r) => setTimeout(r, 1100));
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "driver_contacted", driverId: 55 });
    row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.first_action_at.getTime()).toBe(first);
    expect(row.last_action_at.getTime()).toBeGreaterThan(first);
  });

  it("AC-17: a client-supplied actor id or timestamp is ignored; metadata is whitelisted and truncated", async () => {
    await svc.recordAction({
      orderId: c.order_id, actor: as(exec, "executive"), type: "contact_outcome", result: "declined", driverId: 12,
      meta: { outcome: "declined", note: "x".repeat(900), admin_id: 9999, created_at: "2001-01-01", phone: "9999999999", token: "secret" },
    });
    const a = await prisma.guarantee_action.findFirst({ where: { case_id: c.id } });
    expect(a.admin_id).toBe(exec.id);
    expect(a.created_at.getFullYear()).toBeGreaterThan(2020);
    const meta = JSON.parse(a.meta);
    expect(Object.keys(meta).sort()).toEqual(["note", "outcome"]);
    expect(meta.note.length).toBe(500);
  });

  it("AC-14: an executive cannot act on, or view, a case they do not own", async () => {
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(other, "executive"), type: "search_started" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.getCaseDetail(c.order_id, as(other, "executive"))).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.guarantee_action.count({ where: { case_id: c.id } })).toBe(0);
  });

  it("a supervisor of another city cannot see the case (404); the same city supervisor may only add notes/escalations", async () => {
    const foreign = await db.makeAdmin(prisma, 2, "admin");
    await expect(svc.getCaseDetail(c.order_id, as(foreign, "admin"))).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(sup, "admin"), type: "driver_contacted" })).rejects.toMatchObject({ statusCode: 403 });
    await svc.recordAction({ orderId: c.order_id, actor: as(sup, "admin"), type: "note", meta: { note: "Called the executive, they are on it" } });
    expect(await prisma.guarantee_action.count({ where: { case_id: c.id, admin_id: sup.id } })).toBe(1);
  });

  it("rejects unknown action types (400) and meaningful actions on a closed case (409)", async () => {
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "teleport" })).rejects.toMatchObject({ statusCode: 400 });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { status: "resolved_assigned", closed_at: new Date() } });
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("an executive escalation marks the case escalated once, audits it and alerts supervisors", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "escalated", meta: { reason: "no drivers online" } });
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "escalated", meta: { reason: "again" } });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("escalated");
    expect(row.escalated_at).toBeInstanceOf(Date);
    expect((await db.events(prisma, c.id)).filter((e) => e === "exec_escalated")).toHaveLength(1);
    expect(adminSocket.notifyDispatchAlert.mock.calls.filter((x) => x[3]?.kind === "guarantee_escalated")).toHaveLength(1);
  });

  it("assertExecutiveMayAssign: owner passes, a different executive is blocked, admins/superadmins always pass, queue OFF passes", async () => {
    await expect(svc.assertExecutiveMayAssign({ id: exec.id, role: "executive", city_id: CITY }, c.order_id)).resolves.toBeUndefined();
    await expect(svc.assertExecutiveMayAssign({ id: other.id, role: "executive", city_id: CITY }, c.order_id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertExecutiveMayAssign({ id: sup.id, role: "admin", city_id: CITY }, c.order_id)).resolves.toBeUndefined();
    // Review Focus 2: an UNASSIGNED case is not assignable by an executive either (only admins), but an order with no case is unaffected
    const un = await db.makeCase(prisma, CITY);
    await expect(svc.assertExecutiveMayAssign({ id: exec.id, role: "executive", city_id: CITY }, un.order_id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertExecutiveMayAssign({ id: exec.id, role: "executive", city_id: CITY }, 123456789)).resolves.toBeUndefined();
    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_queue_enabled: false } });
    settings._resetCache();
    await expect(svc.assertExecutiveMayAssign({ id: other.id, role: "executive", city_id: CITY }, c.order_id)).resolves.toBeUndefined();
  });

  it("recordAssignmentAction logs a meaningful driver_assigned for the acting admin and never throws", async () => {
    await svc.recordAssignmentAction({ orderId: c.order_id, adminId: exec.id, riderId: 31 });
    const a = await prisma.guarantee_action.findFirst({ where: { case_id: c.id, type: "driver_assigned" } });
    expect(a).toMatchObject({ meaningful: 1, driver_id: 31, admin_id: exec.id });
    await expect(svc.recordAssignmentAction({ orderId: 424242, adminId: 1, riderId: 1 })).resolves.toBeUndefined();
  });

  it("listMyCases returns my active cases, my recent closed ones, and ones taken away from me", async () => {
    const c2 = await db.makeCase(prisma, CITY, { status: "resolved_assigned", closed_at: new Date(), owner_admin_id: exec.id });
    await prisma.guarantee_assignment.create({ data: { case_id: c2.id, admin_id: exec.id, source: "auto", active: null, ended_at: new Date(), end_reason: "resolved" } });
    const c3 = await db.makeCase(prisma, CITY, { owner_admin_id: other.id, queue_state: "assigned" });
    await prisma.guarantee_assignment.create({ data: { case_id: c3.id, admin_id: exec.id, source: "auto", active: null, ended_at: new Date(), end_reason: "reassigned" } });
    const res = await svc.listMyCases(exec.id);
    expect(res.active.map((r) => r.order_id)).toEqual([c.order_id]);
    expect(res.recent.map((r) => r.order_id)).toEqual([c2.order_id]);
    expect(res.reassigned.map((r) => r.order_id)).toEqual([c3.order_id]);
  });

  it("getCaseDetail returns ownership history, actions and audit for the owner", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" });
    const d = await svc.getCaseDetail(c.order_id, as(exec, "executive"));
    expect(d.case).toMatchObject({ order_id: c.order_id, queue_state: "in_progress" });
    expect(d.assignments).toHaveLength(1);
    expect(d.actions.map((a) => a.type)).toEqual(expect.arrayContaining(["search_started", "viewed"]));
    expect(d.audit.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`svc.recordAction is not a function`):

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueueActions.mysql.test.js --runInBand`

- [ ] **Step 3: Append to `guaranteeQueueService.js`:**

```js
const SAFE_META_KEYS = ["note", "outcome", "reason"];
const SUPERVISOR_ACTIONS = new Set(["note", "escalated", "viewed"]);

function cleanMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  for (const key of SAFE_META_KEYS) {
    if (meta[key] === undefined || meta[key] === null) continue;
    out[key] = String(meta[key]).slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

/** Loads the case for an actor, enforcing city scope (404) and, for executives, current ownership (404). */
async function loadCaseFor(orderId, actor) {
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.city_id == null) throw httpError(404, "Not found");
  assertCityAccess(actor, row.city_id);
  if (actor.role === "executive" && row.owner_admin_id !== actor.id) throw httpError(404, "Not found");
  return row;
}

async function recordAction({ orderId, actor, type, result = null, driverId = null, meta = null }) {
  if (!rules.ACTION_TYPES.includes(type)) throw httpError(400, "Unknown action type");
  const row = await loadCaseFor(orderId, actor);
  if (actor.role !== "executive" && !SUPERVISOR_ACTIONS.has(type)) throw httpError(403, "Only the owning executive can record this action");
  const safe = cleanMeta(meta);
  const meaningful = rules.isMeaningful(type, safe?.note) ? 1 : 0;
  if (meaningful && row.status !== "open") throw httpError(409, "This guarantee case is already closed");

  const now = new Date();
  const created = await prisma.guarantee_action.create({
    data: {
      case_id: row.id, admin_id: actor.id, type, meaningful, result: result ? String(result).slice(0, 30) : null,
      driver_id: Number.isInteger(Number(driverId)) && Number(driverId) > 0 ? Number(driverId) : null, meta: safeJson(safe), created_at: now,
    },
  });
  // Only the owning executive's meaningful actions count as the case making progress.
  if (meaningful && actor.role === "executive") {
    await prisma.booking_guarantee_case.updateMany({ where: { id: row.id, first_action_at: null }, data: { first_action_at: now } });
    await prisma.booking_guarantee_case.update({ where: { id: row.id }, data: { last_action_at: now } });
    await prisma.booking_guarantee_case.updateMany({ where: { id: row.id, status: "open", queue_state: "assigned" }, data: { queue_state: "in_progress" } });
  }
  if (type === "escalated" && row.status === "open") {
    const esc = await prisma.booking_guarantee_case.updateMany({
      where: { id: row.id, status: "open", escalated_at: null },
      data: { escalated_at: now, ...(row.owner_admin_id ? { queue_state: "escalated" } : {}) },
    });
    if (esc.count === 1) {
      await writeAudit(prisma, row.id, row.order_id, "exec_escalated", { adminId: actor.id, meta: safe });
      notify("guarantee_escalated", row, row.city_id, { by: actor.id });
    }
  }
  return { id: created.id, meaningful: Boolean(meaningful) };
}

/** assignRider hook: the assigning admin's driver assignment is a meaningful action. Never throws. */
async function recordAssignmentAction({ orderId, adminId, riderId }) {
  try {
    const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
    if (!row || !row.queue_state) return;
    const now = new Date();
    await prisma.guarantee_action.create({
      data: { case_id: row.id, admin_id: Number(adminId), type: "driver_assigned", meaningful: 1, driver_id: Number(riderId) || null, created_at: now },
    });
    await prisma.booking_guarantee_case.updateMany({ where: { id: row.id, first_action_at: null }, data: { first_action_at: now } });
    await prisma.booking_guarantee_case.update({ where: { id: row.id }, data: { last_action_at: now } });
  } catch (err) {
    logger.error(`guaranteeQueue: recording driver_assigned for order ${orderId} failed:`, err);
  }
}

/**
 * Server-side ownership rule: while a city's queue is ON, an executive may assign a driver only to a guarantee
 * case they currently own. Admins and superadmins are unaffected, as is any order without an open queued case
 * and any city with the queue OFF (so turning the flag off restores today's behaviour).
 */
async function assertExecutiveMayAssign(user, orderId) {
  if (!user || user.role !== "executive") return;
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.status !== "open" || !row.queue_state || row.city_id == null) return;
  const city = await queueSettings.getQueueSettings(row.city_id);
  if (!city.execQueueEnabled) return;
  if (row.owner_admin_id !== user.id) throw httpError(403, "This Booking Guarantee case is owned by another executive");
}

const CASE_FIELDS = {
  id: true, order_id: true, city_id: true, status: true, queue_state: true, unassigned_reason: true, opened_at: true, deadline_at: true,
  owner_admin_id: true, owner_assigned_at: true, first_action_at: true, last_action_at: true, reminded_at: true, escalated_at: true,
  closed_at: true, compensation_amount: true, selected_package_ids: true,
};

async function getCaseDetail(orderId, actor) {
  const row = await loadCaseFor(orderId, actor);
  if (actor.role === "executive") await recordAction({ orderId, actor, type: "viewed" });
  const [full, assignments, actions, audit] = await Promise.all([
    prisma.booking_guarantee_case.findUnique({ where: { id: row.id }, select: CASE_FIELDS }),
    prisma.guarantee_assignment.findMany({ where: { case_id: row.id }, orderBy: { id: "asc" } }),
    prisma.guarantee_action.findMany({ where: { case_id: row.id }, orderBy: { id: "desc" }, take: 100 }),
    prisma.booking_guarantee_audit.findMany({ where: { case_id: row.id }, orderBy: { id: "asc" } }),
  ]);
  return { case: full, assignments, actions, audit };
}

async function listMyCases(adminId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [active, recent, away] = await Promise.all([
    prisma.booking_guarantee_case.findMany({ where: { owner_admin_id: adminId, status: "open" }, orderBy: { deadline_at: "asc" }, select: CASE_FIELDS }),
    prisma.booking_guarantee_case.findMany({ where: { owner_admin_id: adminId, status: { not: "open" }, closed_at: { gte: since } }, orderBy: { closed_at: "desc" }, take: 50, select: CASE_FIELDS }),
    prisma.guarantee_assignment.findMany({
      where: { admin_id: adminId, end_reason: { in: ["reassigned", "unavailable", "idle_auto_reassign"] }, ended_at: { gte: since } },
      orderBy: { ended_at: "desc" }, take: 50,
    }),
  ]);
  const awayCases = away.length
    ? await prisma.booking_guarantee_case.findMany({ where: { id: { in: away.map((a) => a.case_id) } }, select: CASE_FIELDS })
    : [];
  return { active, recent, reassigned: awayCases };
}
```
Extend `module.exports` with `recordAction, recordAssignmentAction, assertExecutiveMayAssign, getCaseDetail, listMyCases`.

- [ ] **Step 4: Run, expect PASS**

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueueActions.mysql.test.js --runInBand`
Expected: PASS (10 tests).

- [ ] **Step 5: Checkpoint (after approval).** Stage service + test; message `feat(guarantee-queue): action log, ownership guard and case views`.

---

### Task 7: Hooks into existing code (open, close, driver assign, next-day batch)

**Files:**
- Modify: `backend/src/services/bookingGuaranteeService.js` (`openForExhaustedOrder` ~L43-80, `closeWith` ~L83-91, `expireCase` post-commit ~L195-205)
- Modify: `backend/src/controllers/adminOrderController.js` (`assignRider` after the scope check ~L199 and after rider validation/`closeOnAssign` ~L274; `assignNextDayBatch` start ~L700)
- Test: `backend/src/services/__tests__/guaranteeQueueHooks.test.js` (mocked); plus the existing suites

**Interfaces:**
- Consumes: `guaranteeQueueService.{onCaseOpened, onCaseClosed, assertExecutiveMayAssign, recordAssignmentAction}`.
- Produces: no new exports. Behaviour: every hook is best-effort and a no-op when `queue_state` is null/queue off.

- [ ] **Step 1: Read the exact current code before editing** (line numbers drift):

Run: `cd backend && grep -n "booking_guarantee_case.create\|async function closeWith\|finishExpiry(claimed.row)\|async function assignNextDayBatch\|async function assignRider" src/services/bookingGuaranteeService.js src/controllers/adminOrderController.js`

- [ ] **Step 2: Write the failing hook test `guaranteeQueueHooks.test.js`:**

```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn().mockResolvedValue({}) },
  tbl_package: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), updateMany: jest.fn() },
  order_status_history: { create: jest.fn().mockResolvedValue({}) },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock("../bookingGuaranteeSettings", () => ({ getAssignWindowMinutes: jest.fn().mockResolvedValue(15) }));
jest.mock("../orderSearchSettings", () => ({
  getCitySettings: jest.fn().mockResolvedValue({ searchSystem: 1, guaranteeEnabled: true, adminWindowMinutes: null, guaranteeReferralsRequired: 1 }),
}));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null) }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../guaranteeQueueService", () => ({ onCaseOpened: jest.fn().mockResolvedValue({ queued: true }), onCaseClosed: jest.fn().mockResolvedValue(1) }));

const prisma = require("../../config/db");
const queue = require("../guaranteeQueueService");
const svc = require("../bookingGuaranteeService");

const order = { id: 500, uid: 7, city_id: 3, rid: 0, order_status: 0 };
beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
});

describe("open hook", () => {
  it("stores the order's city on the case and calls onCaseOpened once, after the case exists", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    await svc.openForExhaustedOrder(order, [10]);
    expect(prisma.booking_guarantee_case.create.mock.calls[0][0].data.city_id).toBe(3);
    expect(queue.onCaseOpened).toHaveBeenCalledTimes(1);
    expect(queue.onCaseOpened.mock.calls[0][1]).toBe(3);
  });
  it("a failing queue hook never stops the case from being held", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    queue.onCaseOpened.mockRejectedValueOnce(new Error("queue down"));
    await expect(svc.openForExhaustedOrder(order, [10])).resolves.toBe(true);
  });
  it("does not call the queue when the guarantee does not apply (city off)", async () => {
    require("../orderSearchSettings").getCitySettings.mockResolvedValueOnce({ guaranteeEnabled: false });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(false);
    expect(queue.onCaseOpened).not.toHaveBeenCalled();
  });
});

describe("close hooks", () => {
  it("closeOnAssign ends ownership only for queued cases and never blocks the close", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 1, order_id: 500, queue_state: "assigned", status: "resolved_assigned" });
    expect(await svc.closeOnAssign(500, 9)).toBe(true);
    expect(queue.onCaseClosed).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "resolved_assigned");

    queue.onCaseClosed.mockClear();
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 2, order_id: 501, queue_state: null, status: "resolved_assigned" });
    expect(await svc.closeOnAssign(501, 9)).toBe(true);
    expect(queue.onCaseClosed).not.toHaveBeenCalled();

    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 3, order_id: 502, queue_state: "assigned", status: "cancelled" });
    queue.onCaseClosed.mockRejectedValueOnce(new Error("boom"));
    expect(await svc.closeOnCancel(502, "admin_cancelled", 9)).toBe(true);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (`city_id` undefined; `onCaseOpened` not called):

Run: `cd backend && npx jest src/services/__tests__/guaranteeQueueHooks.test.js`

- [ ] **Step 4: Edit `bookingGuaranteeService.js`:**

(a) top of file, after the other requires:
```js
const guaranteeQueue = require("./guaranteeQueueService");
```
(`guaranteeQueueService` requires neither `bookingGuaranteeService` nor `dispatchManager`, so there is no cycle.)

(b) in `openForExhaustedOrder`, add `city_id: order.city_id,` to the `booking_guarantee_case.create` `data` object, and after the customer-notify `try/catch` and immediately before `return true;` add:
```js
  try {
    await guaranteeQueue.onCaseOpened(row, order.city_id);
  } catch (err) {
    logger.error(`bookingGuarantee: executive queue hook failed for order ${order.id}:`, err);
  }
```
(c) add the helper above `closeWith`:
```js
// Ends the executive's ownership period for a queued case. Best-effort: a failure leaves an orphan period that the
// queue sweeper's repair pass closes; it can never block closing a case or paying compensation.
async function endOwnership(row, status) {
  if (!row || !row.queue_state) return;
  try {
    await guaranteeQueue.onCaseClosed(row, status);
  } catch (err) {
    logger.error(`bookingGuarantee: ending ownership for case ${row.id} failed:`, err);
  }
}
```
(d) in `closeWith`, change the tail to:
```js
  const row = await prisma.booking_guarantee_case.findUnique({ where: { order_id: Number(orderId) } });
  if (row) {
    await writeAudit(prisma, row, event, { adminId });
    await endOwnership(row, status);
  }
  return true;
```
(e) in `expireCase`, immediately after `if (!claimed) return false;` add:
```js
  await endOwnership(claimed.row, STATUS.EXPIRED);
```
Do **not** touch anything else in `expireCase`.

- [ ] **Step 5: Edit `adminOrderController.js`:**

Add near the other requires: `const guaranteeQueue = require("../services/guaranteeQueueService");`

In `assignRider`, right after the `isScopedOut` 403 block (before the `order.rid !== 0` check), add:
```js
    try {
      await guaranteeQueue.assertExecutiveMayAssign(req.user, orderId);
    } catch (ownerErr) {
      if (ownerErr.statusCode) return res.status(ownerErr.statusCode).json({ success: false, message: ownerErr.message });
      throw ownerErr;
    }
```
and immediately before the existing `await bookingGuarantee.closeOnAssign(orderId, req.user.id);` call (inside its own `try`, keep that block intact) add a separate best-effort line **above** that `try`:
```js
    await guaranteeQueue.recordAssignmentAction({ orderId, adminId: req.user.id, riderId });
```
(`recordAssignmentAction` never throws.)

In `assignNextDayBatch`, after the request's order ids are parsed and before any order is assigned, add (use the actual variable name for the id list found in Step 1, shown here as `orderIds`):
```js
    for (const id of orderIds) {
      try {
        await guaranteeQueue.assertExecutiveMayAssign(req.user, id);
      } catch (ownerErr) {
        if (ownerErr.statusCode) return res.status(ownerErr.statusCode).json({ success: false, message: ownerErr.message });
        throw ownerErr;
      }
    }
```
so a blocked order rejects the whole batch with nothing assigned.

- [ ] **Step 6: Run the new hook test and ALL existing guarantee/order suites**

Run: `cd backend && npx jest src/services/__tests__/guaranteeQueueHooks.test.js src/services/__tests__/bookingGuarantee src/controllers/__tests__/adminBookingGuarantee src/controllers/__tests__/bookingGuaranteeController.test.js src/controllers/__tests__/adminOrderController`
Expected: PASS. If an **existing** test file now fails only because the new `require("./guaranteeQueueService")` loads real Prisma/queue code through its partial `config/db` mock, make the single additive fix in that test file — add `jest.mock("../guaranteeQueueService", () => ({ onCaseOpened: jest.fn().mockResolvedValue({ queued: false }), onCaseClosed: jest.fn().mockResolvedValue(0), assertExecutiveMayAssign: jest.fn().mockResolvedValue(undefined), recordAssignmentAction: jest.fn().mockResolvedValue(undefined) }));` (adjust the relative path) — and report each file touched. Do not change any existing assertion.

- [ ] **Step 7: Add the controller-level guard test** to `backend/src/controllers/__tests__/adminOrderController.test.js` only if that file already mocks `../../services/bookingGuaranteeService`; otherwise put it in `guaranteeQueueController.test.js` (Task 9). Required assertions (Review Focus 2): executive blocked → 403 and `assignRider` performs no `$executeRaw`; admin passes.

- [ ] **Step 8: Checkpoint (after approval).** Stage `bookingGuaranteeService.js adminOrderController.js` and the new test (+ any additive mock lines); message `feat(guarantee-queue): hook open/close/assign into the existing guarantee flow`.

---

### Task 8: Sweeper tick (assign retries, reminders, escalation, idle/unavailable handover, repair) and server wiring

**Files:**
- Modify: `backend/src/services/guaranteeQueueService.js` (append)
- Modify: `backend/src/server.js` (~L58-65)
- Test: `backend/src/services/__tests__/guaranteeQueueTick.mysql.test.js`

**Interfaces:**
- Produces: `tick(now = new Date()) -> { processed, repaired }`; helpers `processOpenCases(now)`, `repairOrphans(now)`.
- Behaviour: runs AFTER `expireDue` in the same interval; considers only open cases with `deadline_at > now` (expiry owns the rest); skips cities whose queue is OFF (repair still runs); each step wrapped in try/catch.

- [ ] **Step 1: Write the failing tests `guaranteeQueueTick.mysql.test.js`:**

```js
const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);
const min = (n) => n * 60 * 1000;

db.describeMysql("guarantee queue tick (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  // a 10-minute window that opened `elapsedMin` minutes ago
  const windowCase = (elapsedMin, o = {}) => {
    const now = Date.now();
    return db.makeCase(prisma, CITY, { opened_at: new Date(now - min(elapsedMin)), deadline_at: new Date(now + min(10 - elapsedMin)), ...o });
  };
  const own = async (c, exec) => {
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: exec.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(1)) } });
    await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: exec.id, source: "auto", active: 1 } });
  };
  const alerts = (kind) => adminSocket.notifyDispatchAlert.mock.calls.filter((x) => x[3]?.kind === kind);

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 });
  });
  afterAll(() => prisma.$disconnect());

  it("retries unassigned cases each tick, nearest deadline first, once an executive appears", async () => {
    const soon = await windowCase(8); const later = await windowCase(1);
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: soon.id } })).queue_state).toBe("unassigned");
    const e = await db.makeExec(prisma, CITY); await db.setProfile(prisma, e.id, { capacity: 1 });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: soon.id } })).owner_admin_id).toBe(e.id); // nearest deadline wins the only slot
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: later.id } })).queue_state).toBe("unassigned");
  });

  it("AC-8: the reminder fires exactly once even when two ticks run concurrently", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await windowCase(6); await own(c, e); // 60% elapsed
    await Promise.all([svc.tick(), svc.tick(), svc.tick()]);
    await svc.tick();
    expect((await db.events(prisma, c.id)).filter((x) => x === "exec_reminder_sent")).toHaveLength(1);
    expect(alerts("guarantee_reminder")).toHaveLength(1);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).reminded_at).toBeInstanceOf(Date);
  });

  it("AC-8 / Review Focus 5: escalation fires once at 75% and marks an owned case escalated; a window already past both thresholds sends reminder and escalation once each", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await windowCase(9); await own(c, e); // 90% elapsed: both due on the first tick
    await Promise.all([svc.tick(), svc.tick()]);
    await svc.tick();
    const ev = await db.events(prisma, c.id);
    expect(ev.filter((x) => x === "exec_reminder_sent")).toHaveLength(1);
    expect(ev.filter((x) => x === "exec_escalated")).toHaveLength(1);
    expect(alerts("guarantee_escalated")).toHaveLength(1);
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("escalated");
    expect(row.owner_admin_id).toBe(e.id);
  });

  it("escalating an UNASSIGNED case keeps it unassigned (it still has no owner) but alerts supervisors", async () => {
    const c = await windowCase(9);
    await svc.tick();
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.escalated_at).toBeInstanceOf(Date);
    expect(row.queue_state).toBe("unassigned");
  });

  it("idle auto-reassign hands the case to another executive with source escalation and keeps the deadline (only if time remains)", async () => {
    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { auto_reassign_idle_minutes: 2 } });
    settings._resetCache();
    const idle = await db.makeExec(prisma, CITY); const fresh = await db.makeExec(prisma, CITY);
    const c = await windowCase(4);
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: idle.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(3)) } });
    await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: idle.id, source: "auto", active: 1 } });
    await svc.tick();
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.owner_admin_id).toBe(fresh.id);
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id }, orderBy: { id: "asc" } });
    expect(periods[0]).toMatchObject({ admin_id: idle.id, active: null, end_reason: "idle_auto_reassign" });
    expect(periods[1]).toMatchObject({ admin_id: fresh.id, active: 1, source: "escalation" });
    // too little time left: no handover
    const late = await db.makeCase(prisma, CITY, { opened_at: new Date(Date.now() - min(10)), deadline_at: new Date(Date.now() + 5000) });
    await prisma.booking_guarantee_case.update({ where: { id: late.id }, data: { owner_admin_id: idle.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(9)) } });
    await prisma.guarantee_assignment.create({ data: { case_id: late.id, admin_id: idle.id, source: "auto", active: 1 } });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: late.id } })).owner_admin_id).toBe(idle.id);
  });

  it("Review Focus 1: an owner who became unavailable or was deactivated is replaced on the next tick, or the case returns to unassigned", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await windowCase(1); await own(c, a);
    await db.setProfile(prisma, a.id, { available: 0 });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).owner_admin_id).toBe(b.id);

    await prisma.admin.update({ where: { id: b.id }, data: { status: false } });
    await svc.tick();
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: null, queue_state: "unassigned" });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(0);
  });

  it("Review Focus 4: with the city flag OFF mid-flight nothing is assigned, reminded or escalated, but repair still runs", async () => {
    const e = await db.makeExec(prisma, CITY);
    const un = await windowCase(9);
    const owned = await windowCase(9); await own(owned, e);
    const closed = await db.makeCase(prisma, CITY, { status: "cancelled", closed_at: new Date() });
    await prisma.guarantee_assignment.create({ data: { case_id: closed.id, admin_id: e.id, source: "auto", active: 1 } });
    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_queue_enabled: false } });
    settings._resetCache();
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: un.id } })).owner_admin_id).toBeNull();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: owned.id } })).reminded_at).toBeNull();
    expect(alerts("guarantee_reminder")).toHaveLength(0);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: closed.id, active: 1 } })).toBe(0);
  });

  it("AC-15 / Review Focus 3: repair ends active periods of closed cases (mapped end_reason) and reconciles owner/period mismatches, with an audit row", async () => {
    const e = await db.makeExec(prisma, CITY);
    const expired = await db.makeCase(prisma, CITY, { status: "expired_compensated", closed_at: new Date() });
    await prisma.guarantee_assignment.create({ data: { case_id: expired.id, admin_id: e.id, source: "auto", active: 1 } });
    const noPeriod = await windowCase(1);
    await prisma.booking_guarantee_case.update({ where: { id: noPeriod.id }, data: { owner_admin_id: e.id, queue_state: "assigned", owner_assigned_at: new Date() } });
    const noOwner = await windowCase(1);
    await prisma.guarantee_assignment.create({ data: { case_id: noOwner.id, admin_id: e.id, source: "auto", active: 1 } });
    await svc.tick();
    expect((await prisma.guarantee_assignment.findFirst({ where: { case_id: expired.id } }))).toMatchObject({ active: null, end_reason: "expired" });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: noPeriod.id, active: 1 } })).toBe(1);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: noOwner.id } })).owner_admin_id).toBe(e.id);
    expect(await db.events(prisma, expired.id)).toContain("exec_assignment_repaired");
  });

  it("does not touch cases whose deadline has passed (the expiry sweeper owns those) or cases without queue_state", async () => {
    const e = await db.makeExec(prisma, CITY);
    const past = await db.makeCase(prisma, CITY, { opened_at: new Date(Date.now() - min(20)), deadline_at: new Date(Date.now() - min(1)) });
    const legacy = await db.makeCase(prisma, CITY, { queue_state: null });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: past.id } })).owner_admin_id).toBeNull();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: legacy.id } }))).toMatchObject({ owner_admin_id: null, queue_state: null });
    expect(e.id).toBeTruthy();
  });

});
```

- [ ] **Step 2: Run, expect FAIL** (`svc.tick is not a function`):

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueueTick.mysql.test.js --runInBand`

- [ ] **Step 3: Append to `guaranteeQueueService.js`:**

```js
const { BOOKING_GUARANTEE_SWEEP_INTERVAL_MS } = require("../config/constants");
const MIN_HANDOVER_MS = 2 * BOOKING_GUARANTEE_SWEEP_INTERVAL_MS;
const TICK_BATCH = 200;
const REPAIR_BATCH = 200;

async function maybeRemind(c, city, now) {
  if (!rules.isReminderDue(c, city, now)) return;
  const res = await prisma.booking_guarantee_case.updateMany({ where: { id: c.id, status: "open", reminded_at: null }, data: { reminded_at: now } });
  if (res.count !== 1) return; // another tick or instance already sent it
  await writeAudit(prisma, c.id, c.order_id, "exec_reminder_sent", { meta: { owner: c.owner_admin_id ?? null } });
  notify("guarantee_reminder", c, c.city_id, { pct: city.reminderPct });
}

async function maybeEscalate(c, city, now) {
  if (!rules.isEscalationDue(c, city, now)) return;
  const res = await prisma.booking_guarantee_case.updateMany({
    where: { id: c.id, status: "open", escalated_at: null },
    data: { escalated_at: now, ...(c.owner_admin_id ? { queue_state: "escalated" } : {}) }, // an unowned case stays unassigned
  });
  if (res.count !== 1) return;
  await writeAudit(prisma, c.id, c.order_id, "exec_escalated", { meta: { owner: c.owner_admin_id ?? null, pct: city.escalatePct, by: "system" } });
  notify("guarantee_escalated", c, c.city_id, { pct: city.escalatePct });
}

async function ownerStates(ownerIds) {
  if (!ownerIds.length) return new Map();
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT a.id AS admin_id, a.role AS role, a.status AS status, a.city_id AS city_id, COALESCE(p.available, 1) AS available
    FROM admin a LEFT JOIN executive_guarantee_profile p ON p.admin_id = a.id
    WHERE a.id IN (${Prisma.join(ownerIds)})`);
  return new Map(rows.map((r) => [Number(r.admin_id), {
    ok: r.role === "executive" && Number(r.status) === 1 && Number(r.available) === 1, cityId: r.city_id,
  }]));
}

/** Assign unowned cases, hand over cases whose owner is no longer eligible, send reminders/escalations, idle-reassign. */
async function processOpenCases(now) {
  const cases = await prisma.booking_guarantee_case.findMany({
    where: { status: "open", queue_state: { not: null }, deadline_at: { gt: now } }, orderBy: { deadline_at: "asc" }, take: TICK_BATCH,
  });
  const owners = await ownerStates([...new Set(cases.map((c) => c.owner_admin_id).filter(Boolean))]);
  let processed = 0;
  for (const c of cases) {
    if (c.city_id == null) continue;
    try {
      const city = await queueSettings.getQueueSettings(c.city_id);
      if (!city.execQueueEnabled) continue;
      processed += 1;
      if (!c.owner_admin_id) {
        await claimCase(c.id, { cityId: c.city_id });
      } else {
        const owner = owners.get(c.owner_admin_id);
        if (!owner || !owner.ok || Number(owner.cityId) !== Number(c.city_id)) {
          await reassignAuto(c, { cityId: c.city_id, endReason: "unavailable", source: "auto", reason: "owner no longer eligible" });
          continue;
        }
      }
      await maybeRemind(c, city, now);
      await maybeEscalate(c, city, now);
      if (c.owner_admin_id && rules.isIdle(c, city, now, MIN_HANDOVER_MS)) {
        await reassignAuto(c, { cityId: c.city_id, endReason: "idle_auto_reassign", source: "escalation", reason: "owner idle" });
        await writeAudit(prisma, c.id, c.order_id, "exec_auto_reassigned_idle", { meta: { from: c.owner_admin_id } });
      }
    } catch (err) {
      logger.error(`guaranteeQueue: processing case ${c.id} failed:`, err);
    }
  }
  return processed;
}

/** Reconciles ownership with case state. Runs even for cities whose queue is OFF. Idempotent. */
async function repairOrphans(now) {
  let repaired = 0;
  // 1) active period on a closed case
  const stale = await prisma.$queryRaw(Prisma.sql`
    SELECT ga.id AS id, ga.case_id AS case_id, c.order_id AS order_id, c.status AS status
    FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
    WHERE ga.active = 1 AND c.status <> 'open' LIMIT ${REPAIR_BATCH}`);
  for (const s of stale) {
    const res = await prisma.guarantee_assignment.updateMany({
      where: { id: Number(s.id), active: 1 },
      data: { active: null, ended_at: now, end_reason: END_REASON_FOR_STATUS[s.status] || "resolved" },
    });
    if (res.count === 1) {
      repaired += 1;
      await writeAudit(prisma, Number(s.case_id), Number(s.order_id), "exec_assignment_repaired", { meta: { kind: "closed_case_active_period" } });
    }
  }
  // 2) open case with an owner but no active period
  const noPeriod = await prisma.$queryRaw(Prisma.sql`
    SELECT c.id AS id, c.order_id AS order_id, c.owner_admin_id AS owner_admin_id, c.owner_assigned_at AS owner_assigned_at
    FROM booking_guarantee_case c
    WHERE c.status = 'open' AND c.owner_admin_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id AND ga.active = 1) LIMIT ${REPAIR_BATCH}`);
  for (const r of noPeriod) {
    try {
      await prisma.guarantee_assignment.create({
        data: { case_id: Number(r.id), admin_id: Number(r.owner_admin_id), source: "auto", started_at: r.owner_assigned_at || now, active: 1 },
      });
      repaired += 1;
      await writeAudit(prisma, Number(r.id), Number(r.order_id), "exec_assignment_repaired", { meta: { kind: "owner_without_period" } });
    } catch (err) {
      if (!err || err.code !== "P2002") throw err;
    }
  }
  // 3) open case whose active period names a different (or no) owner: the assignment table is authoritative
  const mismatch = await prisma.$queryRaw(Prisma.sql`
    SELECT c.id AS id, c.order_id AS order_id, ga.admin_id AS admin_id
    FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id
    WHERE ga.active = 1 AND c.status = 'open' AND (c.owner_admin_id IS NULL OR c.owner_admin_id <> ga.admin_id) LIMIT ${REPAIR_BATCH}`);
  for (const m of mismatch) {
    const res = await prisma.booking_guarantee_case.updateMany({
      where: { id: Number(m.id), status: "open" },
      data: { owner_admin_id: Number(m.admin_id), queue_state: "assigned", unassigned_reason: null },
    });
    if (res.count === 1) {
      repaired += 1;
      await writeAudit(prisma, Number(m.id), Number(m.order_id), "exec_assignment_repaired", { meta: { kind: "owner_mismatch" } });
    }
  }
  return repaired;
}

/** One sweeper pass; called right after expireDue(). Every step is contained so one failure never stops the others. */
async function tick(now = new Date()) {
  const out = { processed: 0, repaired: 0 };
  try { out.processed = await processOpenCases(now); } catch (err) { logger.error("guaranteeQueue: processOpenCases failed:", err); }
  try { out.repaired = await repairOrphans(now); } catch (err) { logger.error("guaranteeQueue: repairOrphans failed:", err); }
  return out;
}
```
Extend `module.exports` with `tick, processOpenCases, repairOrphans`. (Move the `BOOKING_GUARANTEE_SWEEP_INTERVAL_MS` require to the top of the file with the other requires.)

- [ ] **Step 4: Wire the tick into `server.js`.** Replace the existing sweep arrow (lines ~62-63) with:

```js
const bookingGuaranteeService = require("./services/bookingGuaranteeService");
const guaranteeQueueService = require("./services/guaranteeQueueService");
// expireDue runs FIRST so compensation is always decided before any queue bookkeeping; the queue tick then
// assigns/reminds/escalates/repairs. Both are idempotent and safe across multiple instances.
const sweepBookingGuarantee = () =>
  bookingGuaranteeService.expireDue()
    .catch((err) => logger.error("bookingGuarantee sweep failed:", err))
    .then(() => guaranteeQueueService.tick())
    .catch((err) => logger.error("guaranteeQueue tick failed:", err));
```
(keep the existing `setTimeout(sweepBookingGuarantee, 5000)` and `setInterval(...)` lines and the existing `bookingGuaranteeService` require, removing the duplicate declaration.)

- [ ] **Step 5: Run, expect PASS** (all real-MySQL suites together, plus server smoke import):

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueue --runInBand`
Expected: PASS for Rules, Settings, Engine, Reassign, Actions, Tick, Hooks.
Run: `cd backend && node -e "require('./src/services/guaranteeQueueService'); console.log('module loads')"`
Expected: prints `module loads`.

- [ ] **Step 6: Checkpoint (after approval).** Stage service, `server.js`, test; message `feat(guarantee-queue): sweeper tick for assignment retries, SLA reminders, escalation and repair`.

---

### Task 9: Reports, controller and routes

**Files:**
- Create: `backend/src/services/guaranteeQueueReports.js`
- Create: `backend/src/controllers/guaranteeQueueController.js`
- Modify: `backend/src/routes/adminRoutes.js` (after the existing `/booking-guarantee/cases/:orderId/audit` line ~143)
- Test: `backend/src/services/__tests__/guaranteeQueueReports.mysql.test.js`, `backend/src/controllers/__tests__/guaranteeQueueController.test.js`

**Interfaces:**
- `guaranteeQueueReports`:
  - `queueList({ cityId|null, state = null, limit = 100 }) -> rows` (cases with `queue_state` not null, open first by deadline)
  - `workload({ cityId|null, now = new Date() }) -> [{ admin_id, name, city_id, available, capacity, effective_capacity, active, escalated, reminded, resolved, owned_total, reassigned_away }]`
  - `report({ cityId|null, from, to }) -> { total, auto_assigned, unassigned_now, resolved, expired, cancelled, reassigned_cases, avg_seconds_to_first_action, failure_breakdown: { expired_no_owner, expired_owner_no_action, expired_owner_acted } }`
- Controller handlers (all take `(req, res)`, same `fail` shape as `adminBookingGuaranteeController`): `myCases, caseDetail, recordAction, reassign, queue, workload, report, saveProfile, getSettings, saveSettings`.
- Routes (all under `/booking-guarantee/exec`, all `auth`; `scopeFilter` where city scope is needed):

| Method | Path | Roles |
|---|---|---|
| GET | `/exec/my-cases` | executive |
| GET | `/exec/cases/:orderId` | executive (owner), admin, superadmin |
| POST | `/exec/cases/:orderId/actions` | executive (owner), admin, superadmin (notes/escalation only) |
| POST | `/exec/cases/:orderId/reassign` | admin, superadmin |
| GET | `/exec/queue` | admin, superadmin |
| GET | `/exec/workload` | admin, superadmin |
| GET | `/exec/report` | admin, superadmin |
| PUT | `/exec/profiles/:adminId` | admin, superadmin |
| GET/PUT | `/exec/settings` | admin (own city), superadmin (`city_id` required) |

- [ ] **Step 1: Write the failing report tests `guaranteeQueueReports.mysql.test.js`:**

```js
const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue reports (real MySQL)", () => {
  const prisma = require("../../config/db");
  const settings = require("../guaranteeQueueSettings");
  const reports = require("../guaranteeQueueReports");

  beforeEach(async () => { settings._resetCache(); await db.resetDb(prisma); await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 }); });
  afterAll(() => prisma.$disconnect());

  const period = (c, adminId, o = {}) => prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: adminId, source: "auto", active: null, ended_at: new Date(), end_reason: "resolved", ...o } });

  it("workload counts live load from active periods on open cases only and scopes by city", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, 2);
    await db.setProfile(prisma, a.id, { capacity: 3 });
    const open = await db.makeCase(prisma, CITY, { owner_admin_id: a.id, queue_state: "escalated", escalated_at: new Date() });
    await period(open, a.id, { active: 1, ended_at: null, end_reason: null });
    const closed = await db.makeCase(prisma, CITY, { status: "resolved_assigned", owner_admin_id: a.id, resolved_by_admin_id: a.id, closed_at: new Date() });
    await period(closed, a.id);
    const rows = await reports.workload({ cityId: CITY });
    expect(rows.map((r) => r.admin_id)).toEqual([a.id]);
    expect(rows[0]).toMatchObject({ active: 1, escalated: 1, resolved: 1, owned_total: 2, capacity: 3, effective_capacity: 3, available: true });
    expect((await reports.workload({ cityId: null })).map((r) => r.admin_id).sort()).toEqual([a.id, b.id].sort());
  });

  it("report separates 'no executive', 'executive never acted' and 'executive acted' expiries instead of blaming staff for every SLA miss", async () => {
    const e = await db.makeExec(prisma, CITY);
    const base = { status: "expired_compensated", closed_at: new Date() };
    await db.makeCase(prisma, CITY, base);                                                                 // never owned
    const owned = await db.makeCase(prisma, CITY, { ...base, owner_admin_id: e.id }); await period(owned, e.id, { end_reason: "expired" });
    const acted = await db.makeCase(prisma, CITY, { ...base, owner_admin_id: e.id, first_action_at: new Date() }); await period(acted, e.id, { end_reason: "expired" });
    const resolved = await db.makeCase(prisma, CITY, { status: "resolved_assigned", closed_at: new Date(), owner_admin_id: e.id, first_action_at: new Date() });
    await period(resolved, e.id);
    const r = await reports.report({ cityId: CITY, from: new Date(Date.now() - 3600000), to: new Date(Date.now() + 3600000) });
    expect(r).toMatchObject({ total: 4, resolved: 1, expired: 3 });
    expect(r.failure_breakdown).toEqual({ expired_no_owner: 1, expired_owner_no_action: 1, expired_owner_acted: 1 });
    expect(r.auto_assigned).toBe(3);
  });

  it("queueList returns open cases first, nearest deadline first, and honours the state filter", async () => {
    await db.makeExec(prisma, CITY);
    const soon = await db.makeCase(prisma, CITY, { deadline_at: new Date(Date.now() + 60000) });
    await db.makeCase(prisma, CITY, { deadline_at: new Date(Date.now() + 600000), queue_state: "assigned", owner_admin_id: 5 });
    const all = await reports.queueList({ cityId: CITY });
    expect(all[0].order_id).toBe(soon.order_id);
    const un = await reports.queueList({ cityId: CITY, state: "unassigned" });
    expect(un).toHaveLength(1);
    expect(await reports.queueList({ cityId: 2 })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the failing controller tests `guaranteeQueueController.test.js`** (service mocked; asserts roles/scope/validation, AC-14 and "City Admin cannot do superadmin-only things"):

```js
jest.mock("../../services/guaranteeQueueService", () => ({
  listMyCases: jest.fn(), getCaseDetail: jest.fn(), recordAction: jest.fn(), reassignCase: jest.fn(), setAvailability: jest.fn(), setCapacity: jest.fn(),
}));
jest.mock("../../services/guaranteeQueueReports", () => ({ queueList: jest.fn(), workload: jest.fn(), report: jest.fn() }));
jest.mock("../../services/guaranteeQueueSettings", () => ({ getQueueSettings: jest.fn(), saveQueueSettings: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const svc = require("../../services/guaranteeQueueService");
const reports = require("../../services/guaranteeQueueReports");
const settings = require("../../services/guaranteeQueueSettings");
const ctrl = require("../guaranteeQueueController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const exec = { id: 5, role: "executive", city_id: 3 };
const admin = { id: 2, role: "admin", city_id: 3 };
const sup = { id: 1, role: "superadmin", city_id: null };
beforeEach(() => jest.clearAllMocks());

describe("executive endpoints", () => {
  it("myCases uses the authenticated id, never a client-supplied one", async () => {
    svc.listMyCases.mockResolvedValue({ active: [], recent: [], reassigned: [] });
    const r = res();
    await ctrl.myCases({ user: exec, query: { admin_id: "999" } }, r);
    expect(svc.listMyCases).toHaveBeenCalledWith(5);
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { active: [], recent: [], reassigned: [] } });
  });
  it("recordAction passes only the server-derived actor plus whitelisted body fields", async () => {
    svc.recordAction.mockResolvedValue({ id: 1, meaningful: true });
    const r = res();
    await ctrl.recordAction({ user: exec, params: { orderId: "77" }, body: { type: "driver_contacted", result: "agreed", driver_id: 12, admin_id: 999, created_at: "2001-01-01" } }, r);
    expect(svc.recordAction).toHaveBeenCalledWith({ orderId: 77, actor: { id: 5, role: "executive", cityId: 3 }, type: "driver_contacted", result: "agreed", driverId: 12, meta: undefined });
  });
  it("turns a service 404/403/409 into the same status and message", async () => {
    for (const code of [403, 404, 409]) {
      svc.getCaseDetail.mockRejectedValueOnce(Object.assign(new Error("nope"), { statusCode: code }));
      const r = res();
      await ctrl.caseDetail({ user: exec, params: { orderId: "77" } }, r);
      expect(r.status).toHaveBeenCalledWith(code);
      expect(r.json).toHaveBeenCalledWith({ success: false, message: "nope" });
    }
  });
  it("rejects a non-numeric order id with 400 before touching the service", async () => {
    const r = res();
    await ctrl.caseDetail({ user: exec, params: { orderId: "abc" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.getCaseDetail).not.toHaveBeenCalled();
  });
});

describe("supervisor endpoints", () => {
  it("reassign forwards the actor and optional target; a blank target means automatic", async () => {
    svc.reassignCase.mockResolvedValue({ queueState: "assigned", ownerAdminId: 8 });
    const r = res();
    await ctrl.reassign({ user: admin, params: { orderId: "77" }, body: { target_admin_id: "8", reason: "balance" } }, r);
    expect(svc.reassignCase).toHaveBeenCalledWith({ orderId: 77, targetAdminId: 8, actor: { id: 2, role: "admin", cityId: 3 }, reason: "balance" });
    await ctrl.reassign({ user: admin, params: { orderId: "77" }, body: { target_admin_id: null, reason: "auto" } }, res());
    expect(svc.reassignCase.mock.calls[1][0].targetAdminId).toBeNull();
  });
  it("queue/workload/report are scoped to the admin's city and unscoped (or narrowed) for a superadmin", async () => {
    reports.queueList.mockResolvedValue([]); reports.workload.mockResolvedValue([]); reports.report.mockResolvedValue({});
    await ctrl.queue({ user: admin, scopedCityId: 3, query: {} }, res());
    expect(reports.queueList.mock.calls[0][0].cityId).toBe(3);
    await ctrl.workload({ user: sup, scopedCityId: null, query: {} }, res());
    expect(reports.workload.mock.calls[0][0].cityId).toBeNull();
    await ctrl.report({ user: sup, scopedCityId: 4, query: { from: "2026-10-01", to: "2026-10-14" } }, res());
    expect(reports.report.mock.calls[0][0].cityId).toBe(4);
  });
  it("a non-superadmin without a resolved city fails closed (403), never 'all cities'", async () => {
    const r = res();
    await ctrl.workload({ user: admin, scopedCityId: NaN, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(reports.workload).not.toHaveBeenCalled();
  });
  it("saveProfile updates availability and/or capacity through the service with the actor", async () => {
    svc.setAvailability.mockResolvedValue({ handedOver: 2 }); svc.setCapacity.mockResolvedValue({ capacity: 4 });
    const r = res();
    await ctrl.saveProfile({ user: admin, params: { adminId: "9" }, body: { available: false, capacity: 4 } }, r);
    expect(svc.setCapacity).toHaveBeenCalledWith(9, 4, { id: 2, role: "admin", cityId: 3 });
    expect(svc.setAvailability).toHaveBeenCalledWith(9, false, { id: 2, role: "admin", cityId: 3 });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { capacity: 4, available: false, handed_over: 2 } });
  });
});

describe("settings endpoints", () => {
  it("an admin is pinned to their own city; a superadmin must name one", async () => {
    settings.getQueueSettings.mockResolvedValue({ execQueueEnabled: false, execDefaultCapacity: 5, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
    const r = res();
    await ctrl.getSettings({ user: admin, query: { city_id: "99" } }, r);
    expect(settings.getQueueSettings).toHaveBeenCalledWith(3, { fresh: true });
    const r2 = res();
    await ctrl.getSettings({ user: sup, query: {} }, r2);
    expect(r2.status).toHaveBeenCalledWith(400);
  });
  it("saveSettings maps snake_case input, passes the acting admin and returns snake_case", async () => {
    settings.saveQueueSettings.mockResolvedValue({ execQueueEnabled: true, execDefaultCapacity: 6, reminderPct: 50, escalatePct: 75, autoReassignIdleMinutes: null });
    const r = res();
    await ctrl.saveSettings({ user: admin, query: {}, body: { exec_queue_enabled: true, exec_default_capacity: 6 } }, r);
    expect(settings.saveQueueSettings).toHaveBeenCalledWith({
      cityId: 3, adminId: 2,
      input: { execQueueEnabled: true, execDefaultCapacity: 6, reminderPct: undefined, escalatePct: undefined, autoReassignIdleMinutes: undefined },
    });
    expect(r.json.mock.calls[0][0].data).toMatchObject({ exec_queue_enabled: true, exec_default_capacity: 6 });
  });
});
```

- [ ] **Step 3: Run both, expect FAIL** (modules missing).

- [ ] **Step 4: Implement `guaranteeQueueReports.js`:**

```js
const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");

const n = (v) => Number(v ?? 0);
const cityClause = (cityId, col = "c.city_id") => (cityId === null || cityId === undefined ? Prisma.empty : Prisma.sql`AND ${Prisma.raw(col)} = ${Number(cityId)}`);

async function queueList({ cityId = null, state = null, limit = 100 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT c.id, c.order_id, c.city_id, c.status, c.queue_state, c.unassigned_reason, c.opened_at, c.deadline_at, c.owner_admin_id,
           c.first_action_at, c.last_action_at, c.reminded_at, c.escalated_at, a.name AS owner_name, a.username AS owner_username
    FROM booking_guarantee_case c LEFT JOIN admin a ON a.id = c.owner_admin_id
    WHERE c.queue_state IS NOT NULL ${cityClause(cityId)} ${state ? Prisma.sql`AND c.queue_state = ${state}` : Prisma.empty}
    ORDER BY (c.status = 'open') DESC, c.deadline_at ASC LIMIT ${take}`);
  return rows;
}

async function workload({ cityId = null } = {}) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT a.id AS admin_id, COALESCE(a.name, a.username) AS name, a.city_id AS city_id, a.status AS status,
      COALESCE(p.available, 1) AS available, p.capacity AS capacity, ce.exec_default_capacity AS city_capacity,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open') AS active,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open' AND c.escalated_at IS NOT NULL) AS escalated,
      (SELECT COUNT(*) FROM guarantee_assignment ga JOIN booking_guarantee_case c ON c.id = ga.case_id WHERE ga.admin_id = a.id AND ga.active = 1 AND c.status = 'open' AND c.reminded_at IS NOT NULL) AS reminded,
      (SELECT COUNT(*) FROM booking_guarantee_case c WHERE c.resolved_by_admin_id = a.id) AS resolved,
      (SELECT COUNT(DISTINCT ga.case_id) FROM guarantee_assignment ga WHERE ga.admin_id = a.id) AS owned_total,
      (SELECT COUNT(*) FROM guarantee_assignment ga WHERE ga.admin_id = a.id AND ga.end_reason IN ('reassigned','unavailable','idle_auto_reassign')) AS reassigned_away
    FROM admin a
    LEFT JOIN executive_guarantee_profile p ON p.admin_id = a.id
    LEFT JOIN city_order_settings ce ON ce.city_id = a.city_id
    WHERE a.role = 'executive' ${cityId === null || cityId === undefined ? Prisma.empty : Prisma.sql`AND a.city_id = ${Number(cityId)}`}
    ORDER BY a.city_id, name`);
  return rows.map((r) => ({
    admin_id: n(r.admin_id), name: r.name, city_id: r.city_id, active_account: n(r.status) === 1,
    available: n(r.available) === 1, capacity: r.capacity == null ? null : n(r.capacity),
    effective_capacity: r.capacity != null ? n(r.capacity) : n(r.city_capacity) || 5,
    active: n(r.active), escalated: n(r.escalated), reminded: n(r.reminded), resolved: n(r.resolved),
    owned_total: n(r.owned_total), reassigned_away: n(r.reassigned_away),
  }));
}

/**
 * Aggregates for the supervisor dashboard (server-side). Expiries are split by cause so an SLA miss is never
 * read as staff negligence: no executive was ever assigned / an executive never acted / an executive acted.
 */
async function report({ cityId = null, from, to } = {}) {
  const [row] = await prisma.$queryRaw(Prisma.sql`
    SELECT COUNT(*) AS total,
      SUM(c.status = 'resolved_assigned') AS resolved, SUM(c.status = 'expired_compensated') AS expired, SUM(c.status = 'cancelled') AS cancelled,
      SUM(c.status = 'open' AND c.queue_state = 'unassigned') AS unassigned_now,
      SUM(EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id AND ga.source = 'auto')) AS auto_assigned,
      SUM((SELECT COUNT(*) FROM guarantee_assignment ga WHERE ga.case_id = c.id) > 1) AS reassigned_cases,
      AVG(CASE WHEN c.first_action_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, c.opened_at, c.first_action_at) END) AS avg_first_action,
      SUM(c.status = 'expired_compensated' AND NOT EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id)) AS exp_no_owner,
      SUM(c.status = 'expired_compensated' AND EXISTS (SELECT 1 FROM guarantee_assignment ga WHERE ga.case_id = c.id) AND c.first_action_at IS NULL) AS exp_no_action,
      SUM(c.status = 'expired_compensated' AND c.first_action_at IS NOT NULL) AS exp_acted
    FROM booking_guarantee_case c
    WHERE c.queue_state IS NOT NULL AND c.opened_at >= ${new Date(from)} AND c.opened_at <= ${new Date(to)} ${cityClause(cityId)}`);
  return {
    total: n(row.total), resolved: n(row.resolved), expired: n(row.expired), cancelled: n(row.cancelled), unassigned_now: n(row.unassigned_now),
    auto_assigned: n(row.auto_assigned), reassigned_cases: n(row.reassigned_cases),
    avg_seconds_to_first_action: row.avg_first_action == null ? null : Math.round(Number(row.avg_first_action)),
    failure_breakdown: { expired_no_owner: n(row.exp_no_owner), expired_owner_no_action: n(row.exp_no_action), expired_owner_acted: n(row.exp_acted) },
  };
}

module.exports = { queueList, workload, report };
```

- [ ] **Step 5: Implement `guaranteeQueueController.js`:**

```js
const logger = require("../utils/logger");
const queue = require("../services/guaranteeQueueService");
const reports = require("../services/guaranteeQueueReports");
const queueSettings = require("../services/guaranteeQueueSettings");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`guaranteeQueue.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};
const actorOf = (req) => ({ id: req.user.id, role: req.user.role, cityId: req.user.city_id == null ? null : Number(req.user.city_id) });
const idParam = (v, name) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, `${name} must be a valid id`);
  return id;
};

// Fail closed: scopeFilter yields NaN for a non-superadmin without a city; never treat that as unscoped.
function scopeOf(req) {
  if (req.user?.role === "superadmin") return Number.isInteger(req.scopedCityId) ? req.scopedCityId : null;
  if (!Number.isInteger(req.scopedCityId)) throw httpError(403, "Your account is not assigned to a city");
  return req.scopedCityId;
}

// Superadmin names the city; everyone else is pinned to their own.
function cityOf(req) {
  if (req.user.role === "superadmin") {
    const id = Number(req.method === "GET" ? req.query?.city_id : (req.body?.city_id ?? req.query?.city_id));
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, "city_id is required");
    return id;
  }
  const id = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(403, "Your account is not assigned to a city");
  return id;
}

const settingsToApi = (s) => ({
  exec_queue_enabled: s.execQueueEnabled, exec_default_capacity: s.execDefaultCapacity,
  reminder_pct: s.reminderPct, escalate_pct: s.escalatePct, auto_reassign_idle_minutes: s.autoReassignIdleMinutes,
});

async function myCases(req, res) {
  try {
    return res.json({ success: true, data: await queue.listMyCases(req.user.id) });
  } catch (e) { return fail(res, e, "myCases"); }
}

async function caseDetail(req, res) {
  try {
    const orderId = idParam(req.params.orderId, "orderId");
    return res.json({ success: true, data: await queue.getCaseDetail(orderId, actorOf(req)) });
  } catch (e) { return fail(res, e, "caseDetail"); }
}

async function recordAction(req, res) {
  try {
    const orderId = idParam(req.params.orderId, "orderId");
    const b = req.body || {};
    const out = await queue.recordAction({
      orderId, actor: actorOf(req), type: b.type, result: b.result, driverId: b.driver_id == null ? undefined : Number(b.driver_id), meta: b.meta,
    });
    return res.json({ success: true, data: out });
  } catch (e) { return fail(res, e, "recordAction"); }
}

async function reassign(req, res) {
  try {
    const orderId = idParam(req.params.orderId, "orderId");
    const raw = req.body?.target_admin_id;
    const targetAdminId = raw === null || raw === undefined || raw === "" ? null : idParam(raw, "target_admin_id");
    const out = await queue.reassignCase({ orderId, targetAdminId, actor: actorOf(req), reason: req.body?.reason });
    return res.json({ success: true, data: out });
  } catch (e) { return fail(res, e, "reassign"); }
}

async function queueView(req, res) {
  try {
    const cityId = scopeOf(req);
    const state = ["unassigned", "assigned", "in_progress", "escalated"].includes(req.query?.state) ? req.query.state : null;
    return res.json({ success: true, data: await reports.queueList({ cityId, state, limit: req.query?.limit }) });
  } catch (e) { return fail(res, e, "queue"); }
}

async function workload(req, res) {
  try {
    return res.json({ success: true, data: await reports.workload({ cityId: scopeOf(req) }) });
  } catch (e) { return fail(res, e, "workload"); }
}

async function report(req, res) {
  try {
    const cityId = scopeOf(req);
    const to = req.query?.to ? new Date(req.query.to) : new Date();
    const from = req.query?.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw httpError(400, "from/to must be valid dates");
    return res.json({ success: true, data: await reports.report({ cityId, from, to }) });
  } catch (e) { return fail(res, e, "report"); }
}

async function saveProfile(req, res) {
  try {
    const adminId = idParam(req.params.adminId, "adminId");
    const actor = actorOf(req);
    const b = req.body || {};
    const out = {};
    if (b.capacity !== undefined) out.capacity = (await queue.setCapacity(adminId, b.capacity, actor)).capacity;
    if (b.available !== undefined) {
      const r = await queue.setAvailability(adminId, Boolean(b.available), actor);
      out.available = Boolean(b.available);
      out.handed_over = r.handedOver;
    }
    return res.json({ success: true, data: out });
  } catch (e) { return fail(res, e, "saveProfile"); }
}

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: settingsToApi(await queueSettings.getQueueSettings(cityOf(req), { fresh: true })) });
  } catch (e) { return fail(res, e, "getSettings"); }
}

async function saveSettings(req, res) {
  try {
    const b = req.body || {};
    const saved = await queueSettings.saveQueueSettings({
      cityId: cityOf(req), adminId: req.user?.id,
      input: {
        execQueueEnabled: b.exec_queue_enabled, execDefaultCapacity: b.exec_default_capacity, reminderPct: b.reminder_pct,
        escalatePct: b.escalate_pct, autoReassignIdleMinutes: b.auto_reassign_idle_minutes,
      },
    });
    return res.json({ success: true, message: "Executive queue settings saved", data: settingsToApi(saved) });
  } catch (e) { return fail(res, e, "saveSettings"); }
}

module.exports = { myCases, caseDetail, recordAction, reassign, queue: queueView, workload, report, saveProfile, getSettings, saveSettings };
```

- [ ] **Step 6: Add the routes** in `adminRoutes.js` below the existing guarantee routes:

```js
// Booking Guarantee executive queue (spec 2026-10-14). Role checks here are the first gate; city scope and
// executive ownership are enforced again inside the service.
const guaranteeQueueController = require("../controllers/guaranteeQueueController");
router.get("/booking-guarantee/exec/my-cases", auth, authorize("executive"), guaranteeQueueController.myCases);
router.get("/booking-guarantee/exec/cases/:orderId", auth, authorize(...RIDER_ROLES), guaranteeQueueController.caseDetail);
router.post("/booking-guarantee/exec/cases/:orderId/actions", auth, authorize(...RIDER_ROLES), guaranteeQueueController.recordAction);
router.post("/booking-guarantee/exec/cases/:orderId/reassign", auth, authorize("superadmin", "admin"), guaranteeQueueController.reassign);
router.get("/booking-guarantee/exec/queue", auth, authorize("superadmin", "admin"), scopeFilter, guaranteeQueueController.queue);
router.get("/booking-guarantee/exec/workload", auth, authorize("superadmin", "admin"), scopeFilter, guaranteeQueueController.workload);
router.get("/booking-guarantee/exec/report", auth, authorize("superadmin", "admin"), scopeFilter, guaranteeQueueController.report);
router.put("/booking-guarantee/exec/profiles/:adminId", auth, authorize("superadmin", "admin"), guaranteeQueueController.saveProfile);
router.get("/booking-guarantee/exec/settings", auth, authorize("superadmin", "admin"), guaranteeQueueController.getSettings);
router.put("/booking-guarantee/exec/settings", auth, authorize("superadmin", "admin"), guaranteeQueueController.saveSettings);
```
(If `adminRoutes.js` already requires controllers at the top in one block, put the `require` there instead to match the file's style.)

- [ ] **Step 7: Run all, expect PASS**

Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="…"; npx jest src/services/__tests__/guaranteeQueueReports.mysql.test.js src/controllers/__tests__/guaranteeQueueController.test.js --runInBand`
Run: `cd backend && node -e "require('./src/routes/adminRoutes'); console.log('routes load')"`
Expected: PASS; prints `routes load`. (If the route module needs env vars to load, set the same ones the dev server uses; do not print them.)

- [ ] **Step 8: Checkpoint (after approval).** Stage the 3 new backend files, the 2 tests, `adminRoutes.js`; message `feat(guarantee-queue): reports, controller and routes`.

---

### Task 10: Frontend alert routing (no cross-executive noise)

**Files:**
- Create: `frontend/src/utils/guaranteeQueueAlerts.js`
- Modify: `frontend/src/components/layout/AppShell.jsx` (`handleDispatchAlert` ~L47-57, imports ~L1-12)

**Interfaces:**
- Produces: `queueAlertVisibleTo(data, user) -> boolean` and `QUEUE_ALERT_KINDS`.
- Reason: `adminSocket.broadcastToScope` emits to every connected socket, so each client must filter. Payloads contain ids and codes only.

- [ ] **Step 1: Create `guaranteeQueueAlerts.js`:**

```js
export const QUEUE_ALERT_KINDS = ['guarantee_assigned', 'guarantee_reminder', 'guarantee_escalated', 'guarantee_unassigned']

/**
 * The admin socket broadcasts every dispatch alert to every connected admin, so each client decides locally whether
 * an executive-queue alert is for them: an executive only for cases they own; a city admin for their city; a
 * superadmin for every city. Unassigned alerts go to supervisors only.
 */
export function queueAlertVisibleTo(data, user) {
  if (!data || !user || !QUEUE_ALERT_KINDS.includes(data.kind)) return false
  if (user.role === 'superadmin') return true
  if (user.role === 'admin') return Number(data.city_id) === Number(user.city_id)
  if (user.role === 'executive') {
    if (data.kind === 'guarantee_unassigned') return false
    return data.owner_admin_id != null && Number(data.owner_admin_id) === Number(user.id)
  }
  return false
}
```

- [ ] **Step 2: Edit `AppShell.jsx`:** import `useAuth` and the util; read `user`; in `handleDispatchAlert` handle the new kinds before the generic toast, and suppress the existing broadcast banner for executives when the city's queue is on:

```jsx
import { useAuth } from '../../context/AuthContext'
import { queueAlertVisibleTo, QUEUE_ALERT_KINDS } from '../../utils/guaranteeQueueAlerts'
// inside AppShell():
const { user } = useAuth()
// replace handleDispatchAlert with:
function handleDispatchAlert(data) {
  if (QUEUE_ALERT_KINDS.includes(data?.kind)) {
    if (queueAlertVisibleTo(data, user)) {
      playOrderChime()
      toast.warning(data.message)
    }
    return
  }
  if (data?.kind === 'booking_guarantee') {
    // With the executive queue ON the case goes to ONE executive (they get a guarantee_assigned alert); the
    // broadcast banner stays for supervisors only.
    if (data.queue && user?.role === 'executive') return
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
Add `user` to that `useEffect`'s dependency array. In `backend/src/services/bookingGuaranteeService.js` `openForExhaustedOrder`, add `queue: (await queueSettings.getQueueSettings(order.city_id)).execQueueEnabled` to the `notifyDispatchAlert` extra payload: import `const queueSettings = require("./guaranteeQueueSettings");` and compute `const queueOn = (await queueSettings.getQueueSettings(order.city_id)).execQueueEnabled;` just before the alert `try`, passing `queue: queueOn`. (`getQueueSettings` fails closed and never throws.) Re-run `guaranteeQueueHooks.test.js` and the existing `bookingGuaranteeService` tests; if the existing service test's `jest.mock` setup lacks the new module's DB mock, `getQueueSettings` already returns `DEFAULTS` on error, so no existing assertion should change.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint`
Expected: no new errors in the touched files.

- [ ] **Step 4: Checkpoint (after approval).** Stage the util, `AppShell.jsx`, `bookingGuaranteeService.js`; message `feat(guarantee-queue): route executive-queue alerts to the right people`.

---

### Task 11: Executive Workspace page

**Files:**
- Create: `frontend/src/pages/ExecutiveWorkspace.jsx`
- Modify: `frontend/src/App.jsx` (lazy import near L58, route near L102), `frontend/src/config/navigation.js` (entry next to the Booking Guarantee item ~L68)

**Interfaces:**
- Consumes: `GET /booking-guarantee/exec/my-cases`, `GET /booking-guarantee/exec/cases/:orderId`, `POST /booking-guarantee/exec/cases/:orderId/actions`, `GET /riders?status=1&a_status=1` (existing; already city-scoped server-side), `POST /orders/:id/assign-rider` (existing, `{ rider_id }`).
- Existing components: `Badge`, `GuaranteeCountdown`, `useApiQuery`, `useRealtimeSync`, `useToast`, `formatDateTime`.

- [ ] **Step 1: Create the page** `ExecutiveWorkspace.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'
import { formatDateTime } from '../utils/format'

const STATE_LABEL = { unassigned: 'Unassigned', assigned: 'New assignment', in_progress: 'In progress', escalated: 'Escalated' }
const STATE_TONE = { unassigned: 'neutral', assigned: 'info', in_progress: 'brand', escalated: 'danger' }
const CLOSED_LABEL = { resolved_assigned: 'Driver assigned', expired_compensated: 'Window expired', cancelled: 'Cancelled' }
const CLOSED_TONE = { resolved_assigned: 'success', expired_compensated: 'danger', cancelled: 'neutral' }
const ACTIONS = [
  { value: 'search_started', label: 'Started driver search' },
  { value: 'driver_contacted', label: 'Contacted a driver' },
  { value: 'contact_outcome', label: 'Recorded a contact outcome' },
  { value: 'resolution_attempt', label: 'Other resolution attempt' },
  { value: 'note', label: 'Note (min 10 characters)' },
]
const OUTCOMES = [
  { value: 'agreed', label: 'Agreed to take it' }, { value: 'declined', label: 'Declined' },
  { value: 'no_answer', label: 'No answer' }, { value: 'unreachable', label: 'Unreachable' },
]
const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const inputStyle = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }
const inputClass = 'rounded-lg border px-3 py-2 text-[13px]'

function CaseCard({ c, onChanged, readOnly }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [type, setType] = useState('search_started')
  const [outcome, setOutcome] = useState('agreed')
  const [note, setNote] = useState('')
  const [driverId, setDriverId] = useState('')
  const [busy, setBusy] = useState(false)
  const [riders, setRiders] = useState([])
  const [riderQuery, setRiderQuery] = useState('')
  const [confirmRider, setConfirmRider] = useState(null)

  const loadDetail = useCallback(async () => {
    try {
      const res = await api.get(`/booking-guarantee/exec/cases/${c.order_id}`)
      setDetail(res.data?.data)
    } catch (err) {
      toast.error(errMsg(err, 'Could not load the case'))
    }
  }, [c.order_id, toast])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      loadDetail()
      if (!readOnly && riders.length === 0) {
        try {
          const res = await api.get('/riders', { params: { status: 1, a_status: 1 } })
          setRiders(res.data?.data?.riders ?? res.data?.data ?? [])
        } catch (err) {
          toast.error(errMsg(err, 'Could not load drivers'))
        }
      }
    }
  }

  const submitAction = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const body = { type, driver_id: driverId ? Number(driverId) : undefined, meta: { note: note || undefined } }
      if (type === 'contact_outcome') { body.result = outcome; body.meta.outcome = outcome }
      await api.post(`/booking-guarantee/exec/cases/${c.order_id}/actions`, body)
      toast.success('Action recorded')
      setNote('')
      await loadDetail()
      onChanged()
    } catch (err) {
      toast.error(errMsg(err, 'Could not record the action'))
    } finally { setBusy(false) }
  }

  const escalate = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/booking-guarantee/exec/cases/${c.order_id}/actions`, { type: 'escalated', meta: { reason: note || 'Needs supervisor help' } })
      toast.success('Supervisors alerted')
      await loadDetail()
      onChanged()
    } catch (err) { toast.error(errMsg(err, 'Could not escalate')) } finally { setBusy(false) }
  }

  const assign = async () => {
    if (busy || !confirmRider) return
    setBusy(true)
    try {
      await api.post(`/orders/${c.order_id}/assign-rider`, { rider_id: confirmRider.id })
      toast.success(`Driver assigned to order #${c.order_id}`)
      setConfirmRider(null)
      onChanged()
    } catch (err) {
      toast.error(errMsg(err, 'Could not assign the driver'))
    } finally { setBusy(false) }
  }

  const filteredRiders = useMemo(() => {
    const q = riderQuery.trim().toLowerCase()
    const list = q ? riders.filter((r) => `${r.full_name ?? ''} ${r.fmobile ?? ''} ${r.vehicle_no ?? ''}`.toLowerCase().includes(q)) : riders
    return list.slice(0, 8)
  }, [riders, riderQuery])

  const isOpen = c.status === 'open'
  return (
    <div className="rounded-2xl border p-4" style={{ background: 'var(--surface)', borderColor: c.queue_state === 'escalated' ? 'var(--danger)' : 'var(--border)' }}>
      <button type="button" onClick={toggle} className="flex w-full flex-wrap items-center gap-3 text-left">
        <span className="font-mono-data text-[14px] font-bold" style={{ color: 'var(--ink)' }}>Order #{c.order_id}</span>
        {isOpen
          ? <Badge tone={STATE_TONE[c.queue_state] ?? 'neutral'}>{STATE_LABEL[c.queue_state] ?? c.queue_state}</Badge>
          : <Badge tone={CLOSED_TONE[c.status] ?? 'neutral'}>{CLOSED_LABEL[c.status] ?? c.status}</Badge>}
        {isOpen && <span className="ml-auto text-[13px]" style={{ color: 'var(--ink-muted)' }}>Time left <GuaranteeCountdown deadline={c.deadline_at} /></span>}
      </button>
      <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
        Window opened {formatDateTime(c.opened_at)} · deadline {formatDateTime(c.deadline_at)}
        {c.first_action_at ? ` · first action ${formatDateTime(c.first_action_at)}` : ' · no action yet'}
      </div>

      {open && (
        <div className="mt-4 grid gap-4">
          {isOpen && !readOnly && (
            <>
              <form onSubmit={submitAction} className="grid gap-2">
                <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Record what you did</div>
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass} style={inputStyle}>
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                {type === 'contact_outcome' && (
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass} style={inputStyle}>
                    {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {(type === 'driver_contacted' || type === 'contact_outcome') && (
                  <input type="number" min="1" value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="Driver id (optional)" className={inputClass} style={inputStyle} />
                )}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Note (no phone numbers or personal details)" className={inputClass} style={inputStyle} />
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Record</button>
                  <button type="button" disabled={busy} onClick={escalate} className="rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Escalate to supervisor</button>
                </div>
              </form>

              <div className="grid gap-2">
                <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Assign a driver (online, approved, your city)</div>
                <input value={riderQuery} onChange={(e) => setRiderQuery(e.target.value)} placeholder="Search name, mobile or vehicle number" className={inputClass} style={inputStyle} />
                {filteredRiders.map((r) => (
                  <button key={r.id} type="button" onClick={() => setConfirmRider(r)} className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                    <span>{r.full_name} · {r.vehicle_no}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>Select</span>
                  </button>
                ))}
                {confirmRider && (
                  <div className="rounded-lg border p-3 text-[13px]" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)', color: 'var(--ink)' }}>
                    Assign <b>{confirmRider.full_name}</b> to order #{c.order_id}? This takes effect immediately and closes the guarantee case.
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy} onClick={assign} className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Confirm assign</button>
                      <button type="button" disabled={busy} onClick={() => setConfirmRider(null)} className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <div className="mb-1 text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Contact and action history</div>
            {!detail && <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}
            {detail?.actions?.length === 0 && <div className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Nothing recorded yet.</div>}
            {detail?.actions?.filter((a) => a.type !== 'viewed').map((a) => (
              <div key={a.id} className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {formatDateTime(a.created_at)} · {a.type.replace(/_/g, ' ')}{a.result ? ` (${a.result})` : ''}{a.driver_id ? ` · driver #${a.driver_id}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, tone, items, onChanged, readOnly }) {
  if (!items.length) return null
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--ink)' }}>{title} <Badge tone={tone}>{items.length}</Badge></div>
      {items.map((c) => <CaseCard key={c.id} c={c} onChanged={onChanged} readOnly={readOnly} />)}
    </section>
  )
}

export default function ExecutiveWorkspace() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const fetcher = useCallback(() => api.get('/booking-guarantee/exec/my-cases').then((res) => res.data?.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(['admin:dispatch_alert', 'admin:order_status_update'], refetch, { fallbackInterval: 15000 })

  const active = data?.active ?? []
  const fresh = active.filter((c) => c.queue_state === 'assigned')
  const escalated = active.filter((c) => c.queue_state === 'escalated')
  const working = active.filter((c) => c.queue_state === 'in_progress')

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <ClipboardList size={20} style={{ color: 'var(--brand)' }} />
        <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>My Guarantee Cases</h1>
      </div>
      <div className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Find and assign a driver before the countdown ends. The deadline is fixed for the customer's guarantee and does not move when a case is reassigned.
      </div>
      {loading && !data && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}
      {error && <div className="text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}
      {!loading && !error && active.length === 0 && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>No active cases assigned to you.</div>}
      <Section title="Escalated" tone="danger" items={escalated} onChanged={refetch} />
      <Section title="New assignments" tone="info" items={fresh} onChanged={refetch} />
      <Section title="In progress" tone="brand" items={working} onChanged={refetch} />
      <Section title="Taken away from me (last 24 h)" tone="neutral" items={data?.reassigned ?? []} onChanged={refetch} readOnly />
      <Section title="Completed (last 24 h)" tone="success" items={data?.recent ?? []} onChanged={refetch} readOnly />
    </div>
  )
}
```
Note for the engineer: the shape of `GET /riders` is `res.data.data.riders` or an array depending on the controller; Step 2 confirms it before relying on it.

- [ ] **Step 2: Confirm the `/riders` response shape** the page relies on:

Run: `cd backend && grep -n "res.json" src/controllers/adminRiderController.js | head -5`
Expected: shows the `list` response; adjust `res.data?.data?.riders ?? res.data?.data ?? []` in the page to the real shape.

- [ ] **Step 3: Register route and nav.** In `App.jsx` add `const ExecutiveWorkspace = lazy(() => import('./pages/ExecutiveWorkspace'))` beside the other lazy imports and `<Route path="/guarantee/my-cases" element={<ExecutiveWorkspace />} />` below the `/booking-guarantee` route. In `navigation.js`, import a lucide icon (`ClipboardList`) and add `{ to: '/guarantee/my-cases', label: 'My Guarantee Cases', icon: ClipboardList, roles: ['executive'], built: true },` immediately after the `/booking-guarantee` entry.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: lint clean for the new files, build succeeds.

- [ ] **Step 5: Checkpoint (after approval).** Stage `ExecutiveWorkspace.jsx App.jsx navigation.js`; message `feat(guarantee-queue): executive workspace page`.

---

### Task 12: Supervisor Queue & Workload page

**Files:**
- Create: `frontend/src/pages/GuaranteeWorkload.jsx`
- Modify: `frontend/src/App.jsx`, `frontend/src/config/navigation.js`

**Interfaces:**
- Consumes: `GET /booking-guarantee/exec/{report,workload,queue,settings}`, `POST /booking-guarantee/exec/cases/:orderId/reassign`, `PUT /booking-guarantee/exec/profiles/:adminId`, `PUT /booking-guarantee/exec/settings`, `GET /cities` (superadmin picker, same as `OrderSearchSettings.jsx` L55-59).

- [ ] **Step 1: Create `GuaranteeWorkload.jsx`:**

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import GuaranteeCountdown from '../components/orders/GuaranteeCountdown'
import { formatDateTime } from '../utils/format'

const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const inputStyle = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }
const inputClass = 'rounded-lg border px-3 py-2 text-[13px]'
const STATE_TONE = { unassigned: 'warning', assigned: 'info', in_progress: 'brand', escalated: 'danger' }
const REASON = { none_in_city: 'No executive in this city', all_unavailable: 'All executives unavailable', all_at_capacity: 'All executives at capacity' }

function Kpi({ label, value, tone }) {
  return (
    <div className="rounded-2xl border p-3" style={{ background: 'var(--surface)', borderColor: tone === 'danger' && value > 0 ? 'var(--danger)' : 'var(--border)' }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{label}</div>
      <div className="text-[22px] font-bold" style={{ color: 'var(--ink)' }}>{value ?? '–'}</div>
    </div>
  )
}

export default function GuaranteeWorkload() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const [cityId, setCityId] = useState('')
  const [cities, setCities] = useState([])
  const [busy, setBusy] = useState(false)
  const [reassigning, setReassigning] = useState(null) // { order_id }
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities').then((res) => setCities(res.data?.data ?? [])).catch(() => {})
  }, [isSuper])

  const params = useCallback(() => (isSuper && cityId ? { city_id: cityId } : {}), [isSuper, cityId])
  const fetcher = useCallback(async () => {
    const p = { params: params() }
    const [report, workload, queue] = await Promise.all([
      api.get('/booking-guarantee/exec/report', p), api.get('/booking-guarantee/exec/workload', p), api.get('/booking-guarantee/exec/queue', p),
    ])
    return { report: report.data?.data, workload: workload.data?.data ?? [], queue: queue.data?.data ?? [] }
  }, [params])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(['admin:dispatch_alert', 'admin:order_status_update'], refetch, { fallbackInterval: 15000 })

  const settingsCity = isSuper ? cityId : String(user?.city_id ?? '')
  useEffect(() => {
    if (!settingsCity) { setSettings(null); return }
    api.get('/booking-guarantee/exec/settings', { params: isSuper ? { city_id: settingsCity } : {} })
      .then((res) => setSettings(res.data?.data))
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load settings')))
  }, [settingsCity, isSuper])

  const run = async (fn, okMsg) => {
    if (busy) return
    setBusy(true)
    try { await fn(); toast.success(okMsg); await refetch() } catch (err) { toast.error(errMsg(err, 'Action failed')) } finally { setBusy(false) }
  }

  const saveProfile = (row, patch) => run(
    () => api.put(`/booking-guarantee/exec/profiles/${row.admin_id}`, patch), 'Executive updated',
  )
  const submitReassign = () => run(async () => {
    await api.post(`/booking-guarantee/exec/cases/${reassigning.order_id}/reassign`, { target_admin_id: target ? Number(target) : null, reason })
    setReassigning(null); setTarget(''); setReason('')
  }, 'Case reassigned')
  const saveSettings = () => run(
    () => api.put('/booking-guarantee/exec/settings', { ...settings, ...(isSuper ? { city_id: Number(cityId) } : {}) }).then((res) => setSettings(res.data?.data)),
    'Settings saved',
  )

  const r = data?.report
  const exec = data?.workload ?? []
  const queue = data?.queue ?? []
  const setField = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Users size={20} style={{ color: 'var(--brand)' }} />
        <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>Guarantee Queue &amp; Workload</h1>
        {isSuper && (
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass} style={{ ...inputStyle, width: 220 }}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.city_name ?? `City ${c.id}`}</option>)}
          </select>
        )}
      </div>

      {loading && !data && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>Loading…</div>}
      {error && <div className="text-sm" style={{ color: 'var(--danger)' }}>{error}</div>}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Cases (24 h)" value={r.total} />
            <Kpi label="Unassigned now" value={r.unassigned_now} tone="danger" />
            <Kpi label="Resolved" value={r.resolved} />
            <Kpi label="Expired" value={r.expired} tone="danger" />
            <Kpi label="Auto-assigned" value={r.auto_assigned} />
            <Kpi label="Reassigned" value={r.reassigned_cases} />
            <Kpi label="Avg first action (s)" value={r.avg_seconds_to_first_action} />
            <Kpi label="Cancelled" value={r.cancelled} />
          </div>
          <div className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            Expired cases by cause: no executive was ever assigned <b>{r.failure_breakdown.expired_no_owner}</b> · executive never acted <b>{r.failure_breakdown.expired_owner_no_action}</b> · executive acted but no driver was found <b>{r.failure_breakdown.expired_owner_acted}</b>. An expiry alone is not a performance finding.
          </div>
        </>
      )}

      <section className="grid gap-2">
        <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Cases in the queue</div>
        {queue.length === 0 && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>No cases in the executive queue.</div>}
        {queue.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-[13px]" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
            <span className="font-mono-data font-bold">#{c.order_id}</span>
            <Badge tone={c.status === 'open' ? (STATE_TONE[c.queue_state] ?? 'neutral') : 'neutral'}>{c.status === 'open' ? c.queue_state : c.status}</Badge>
            <span style={{ color: 'var(--ink-muted)' }}>{c.owner_admin_id ? `Owner: ${c.owner_name || c.owner_username || c.owner_admin_id}` : (REASON[c.unassigned_reason] ?? 'Unassigned')}</span>
            {c.status === 'open' && <span className="ml-auto">Left <GuaranteeCountdown deadline={c.deadline_at} /></span>}
            <span style={{ color: 'var(--ink-faint)' }}>{c.first_action_at ? `first action ${formatDateTime(c.first_action_at)}` : 'no action yet'}</span>
            {c.status === 'open' && (
              <button type="button" onClick={() => { setReassigning({ order_id: c.order_id }); setTarget(''); setReason('') }} className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: 'var(--border)' }}>Reassign</button>
            )}
          </div>
        ))}
        {reassigning && (
          <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
            <div className="text-[13px]" style={{ color: 'var(--ink)' }}>Reassign order #{reassigning.order_id}. The customer's deadline does not change and the executive's capacity limit applies.</div>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">Automatic (best available executive)</option>
              {exec.filter((x) => x.available && x.active_account).map((x) => <option key={x.admin_id} value={x.admin_id}>{x.name} ({x.active}/{x.effective_capacity})</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason (required)" className={inputClass} style={inputStyle} />
            <div className="flex gap-2">
              <button type="button" disabled={busy || !reason.trim()} onClick={submitReassign} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Confirm reassign</button>
              <button type="button" disabled={busy} onClick={() => setReassigning(null)} className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Executives</div>
        {exec.map((x) => (
          <div key={x.admin_id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-[13px]" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
            <span className="font-semibold">{x.name}</span>
            {!x.active_account && <Badge tone="danger">Inactive account</Badge>}
            <Badge tone={x.available ? 'success' : 'neutral'}>{x.available ? 'Available' : 'Unavailable'}</Badge>
            <span>Load {x.active}/{x.effective_capacity}</span>
            <span style={{ color: 'var(--ink-faint)' }}>escalated {x.escalated} · resolved {x.resolved} · of {x.owned_total} owned · moved away {x.reassigned_away}</span>
            <span className="ml-auto flex items-center gap-2">
              <input type="number" min="1" max="200" defaultValue={x.capacity ?? ''} placeholder={`cap ${x.effective_capacity}`} className={`${inputClass} w-24`} style={inputStyle}
                onBlur={(e) => { const v = e.target.value; if (String(x.capacity ?? '') !== v) saveProfile(x, { capacity: v === '' ? null : Number(v) }) }} />
              <button type="button" disabled={busy} onClick={() => saveProfile(x, { available: !x.available })} className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>
                {x.available ? 'Mark unavailable' : 'Mark available'}
              </button>
            </span>
          </div>
        ))}
        {exec.length === 0 && !loading && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>No executives in scope.</div>}
      </section>

      {settingsCity && settings && (
        <section className="grid gap-2 rounded-2xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="text-[13px] font-bold" style={{ color: 'var(--ink)' }}>Executive queue settings (this city)</div>
          <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={Boolean(settings.exec_queue_enabled)} onChange={setField('exec_queue_enabled')} />
            Executive queue active (OFF keeps today's behaviour: any admin may assign)
          </label>
          {[['exec_default_capacity', 'Default capacity per executive'], ['reminder_pct', 'Reminder at % of window'], ['escalate_pct', 'Escalate at % of window'], ['auto_reassign_idle_minutes', 'Auto-reassign if idle (minutes, blank = off)']].map(([k, label]) => (
            <label key={k} className="grid gap-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{label}
              <input type="number" min="1" value={settings[k] ?? ''} onChange={setField(k)} className={inputClass} style={inputStyle} />
            </label>
          ))}
          <button type="button" disabled={busy} onClick={saveSettings} className="w-fit rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Save settings</button>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register route and nav.** `App.jsx`: lazy import + `<Route path="/guarantee/workload" element={<GuaranteeWorkload />} />`. `navigation.js`: `{ to: '/guarantee/workload', label: 'Guarantee Queue & Workload', icon: Users, roles: MANAGERS, built: true },` after the My Guarantee Cases entry (import `Users` from lucide-react if not already imported; `MANAGERS` already exists).

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: lint clean for new files; build succeeds.

- [ ] **Step 4: Checkpoint (after approval).** Stage `GuaranteeWorkload.jsx App.jsx navigation.js`; message `feat(guarantee-queue): supervisor queue and workload page`.

---

### Task 13: Full regression, dev smoke test, rollout notes

**Files:**
- Create: `docs/superpowers/plans/2026-10-14-guarantee-executive-queue-smoke-results.md` (written only from real command output)
- Modify: `docs/superpowers/specs/2026-10-14-guarantee-executive-queue-design.md` (Task 14 amendments)

Nothing in this task touches production. The feature stays OFF everywhere until the user enables one pilot city.

- [ ] **Step 1: Full backend suite, with and without the real-MySQL gate**

Run: `cd backend && npx jest`
Expected: PASS; the `*.mysql.test.js` suites are reported as **skipped** (note the count; skipped ≠ passed).
Run: `cd backend && $env:GUARANTEE_TEST_DATABASE_URL="mysql://…/shifter_guarantee_test"; npx jest --runInBand`
Expected: PASS including every `*.mysql.test.js`. Record the real totals. Any failure in an **existing** suite is a regression to fix, not to skip.

- [ ] **Step 2: Frontend checks**

Run: `cd frontend && npm run lint && npm run build`
Expected: no new lint errors vs `git stash`-free baseline for touched files; build succeeds.

- [ ] **Step 3: Prerequisite migrations on the DEV database only (user approval required first).** Ask the user to confirm, then apply in order to the **dev** DB (the `.env` DB; never prod): `20261007020000_add_booking_guarantee`, `20261013020000_add_guarantee_time_window` (only if not already present, check with `SHOW TABLES LIKE 'booking_guarantee_case'` and `SHOW COLUMNS FROM city_order_settings LIKE 'guarantee_start_time'`), then `20261014010000_add_guarantee_executive_queue`. Then `cd backend && npx prisma migrate resolve --applied <name>` for each applied one. Report the exact SQL results.

- [ ] **Step 4: Dev smoke test (record the real outcome of each line).** With the dev backend running and two city-1 executives, one city-1 admin and a superadmin, and the queue ON for one dev city only:
  1. Enable the queue for the dev city on the Queue & Workload page; confirm other cities stay OFF.
  2. Place a dev order that exhausts the cascade; confirm the case opens, `queue_state` becomes `assigned`, exactly one executive receives a `guarantee_assigned` alert, no other executive does, and `deadline_at` equals what an OFF city would have produced.
  3. As that executive: record `search_started`; confirm `in_progress` and `first_action_at`. Try to assign a driver to a case owned by the other executive: expect 403. Assign a driver to your own case: case becomes `resolved_assigned`, order proceeds normally, the ownership period ends `resolved`, no compensation credited.
  4. Failure path: second order, no action; at 50 % / 75 % confirm one reminder and one escalation; let it expire; confirm exactly one wallet credit with idempotency key `booking_guarantee_credit:<order_id>`, the case `expired_compensated`, referral lock set as before, ownership period ended `expired`.
  5. Reassign a live case as the city admin to the other executive; confirm two periods in history and an unchanged `deadline_at`. Set capacity 1 on an executive and try to reassign a second case to them: expect 409.
  6. Mark the owning executive unavailable: the case moves to the other executive, or to `unassigned` if the other is full; supervisors are alerted.
  7. **AC-12 race:** hit `POST /orders/:id/assign-rider` and let the deadline pass at the same moment (script two concurrent calls around the deadline); confirm exactly one outcome (driver assigned XOR compensated), never both.
  8. **Two instances:** start a second backend process on another port against the same dev DB; create 6 cases with one executive at capacity 3; confirm no executive exceeds capacity and reminders are not duplicated.
  9. Turn the queue OFF for the dev city; confirm a new case behaves exactly as before the feature (any admin can assign; no queue state).
  Write the results, with the commands used and the observed output, to the smoke-results file. Do not mark any step passed that was not run.

- [ ] **Step 5: Pilot gate.** Report to the user: regression results, real-MySQL results, smoke results. The user decides whether to enable one pilot city. Provide the prod SQL path (`backend/prisma/migrations/20261014010000_add_guarantee_executive_queue/migration.sql`) for the user to run on prod themselves; do not run it.

- [ ] **Step 6: Checkpoint (after approval).** Stage the smoke-results doc; message `docs(guarantee-queue): dev smoke test results`.

---

### Task 14: Align the spec with this plan

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-guarantee-executive-queue-design.md`

- [ ] **Step 1:** Apply the six refinements listed under "Spec refinements" at the top of this plan: add `city_id` + `(city_id, status)` index to 4.1; replace "FK→case" in 4.2 with "no SQL FK, matching the existing guarantee tables"; reword 6.4 step 4 to the first-consistent-read-after-lock explanation; note the separate `/exec/settings` endpoints in 4.5; add `POST /orders/next-day/assign-batch` to the Section 5 ownership rule and to AC-14; amend Section 14 gate 3 and AC-12 to say AC-12 is verified in the dev smoke test.
- [ ] **Step 2:** Re-read the spec for contradictions with the plan (acceptance criteria numbers, event names `exec_owner_released`, `exec_assignment_repaired`, `exec_auto_reassigned_idle`). Fix inline.
- [ ] **Step 3: Checkpoint (after approval).** Stage the spec; message `docs(spec): align executive queue spec with implementation plan`.

---

## Self-Review

**Spec coverage** (section → task): 3 state machine → T4-T8 (`queue_state` transitions: claim T4, in_progress T6, escalated T6/T8, reassign T5, close T5/T7/T8); 4.1-4.5 schema/settings → T1, T3; 4.6 audit events → T4-T8 (`exec_queue_unassigned`, `exec_auto_assigned`, `exec_manually_assigned`, `exec_reassigned`, `exec_owner_released`, `exec_reminder_sent`, `exec_escalated`, `exec_no_executive_alert`, `exec_auto_reassigned_idle`, `exec_assignment_repaired`); 5 permissions → T6 (`recordAction`, `assertExecutiveMayAssign`), T7 (guards in `assignRider`/next-day), T9 (route roles + controller scope), T9 tests; 6 assignment/concurrency/reassignment/unavailable → T4, T5; 7 SLA/escalation → T2 (thresholds), T8; 8 meaningful actions → T2, T6; 9 compensation interaction → T7 (hooks only; `expireCase` untouched, regression run T13); 10-11 failure/recovery → T8 (repair), T5; 12 decisions (driver cancel gap documented, no code) → spec §12, no task by design; 13 UI → T10-T12; 14 rollout gates → T13; 15 acceptance: AC-1 T5/T7/T13, AC-2 T4, AC-3 T4, AC-4 T4, AC-5 T4, AC-6 T5, AC-7 T4, AC-8 T8, AC-9 T4/T5/T8, AC-10 T5/T13, AC-11 T13 (existing code + smoke), AC-12 T13 smoke (refinement 6), AC-13 T7/T5, AC-14 T6/T9, AC-15 T8, AC-16 T6, AC-17 T6, AC-18 T13. Capacity-on-every-path requirement → T4/T5 tests. Gap: no task adds the optional post-assignment-cancellation audit event; intentionally excluded per the user's instruction (documented follow-up).

**Placeholder scan:** no TBD/TODO. Two steps say "adjust to the real shape" (the `/riders` response shape in T11, the `orderIds` variable name in T7) and each has an explicit command that reveals the true value first; the existing-test mock fix in T7 is conditional with the exact line to add.

**Type consistency:** `claimCase(caseId, { cityId, source, assignedBy }) -> { claimed, adminId?, reason? }` (T4) is used identically in T5 `onCaseOpened`, T8 `processOpenCases`. `tryAssign` outcomes (`claimed | case_gone | at_capacity | candidate_unavailable | candidate_busy`) match the mapping in `reassignCase`. `reassignAuto -> { claimed, adminId?, queueState }` consumed by `reassignCase`, `handoverOwnedCases`, T8. `rules.rankCandidates(candidates, defaultCapacity)` takes two args everywhere (the `unassignedReason(candidates)` call sites pass one; its extra test argument `5` is ignored by design). Actor shape `{ id, role, cityId }` is the same in `assertCityAccess`, `loadCaseFor`, `recordAction`, `reassignCase`, `setAvailability`, `setCapacity`, controller `actorOf`. Queue-settings camelCase keys (`execQueueEnabled…`) match `normalizeQueueRow`, `COLUMN`, controller mapping. `END_REASON_FOR_STATUS` values (`resolved`, `cancelled`, `expired`) match the spec's `end_reason` list; `idle_auto_reassign`, `unavailable`, `reassigned` match the workload query's `IN (...)`.

**Review Focus mapping:** 1 → T5 + T8 tests; 2 → T6 `assertExecutiveMayAssign` test + T7 step 7; 3 → T5 `onCaseClosed` test + T8 repair test; 4 → T8 flag-off test; 5 → T8 (both-due and idle-skip tests).

**Known limitations to state at handoff:** frontend has no automated tests (lint/build + manual smoke only); the real-MySQL suite simulates multiple instances with concurrent connections from one process pool, which exercises the same MySQL locks, and the smoke test adds a genuine second process; `adminSocket` broadcasts to all sockets so client-side filtering is a UX filter, not a security boundary (payloads hold ids and codes only; every data fetch is server-authorized).
