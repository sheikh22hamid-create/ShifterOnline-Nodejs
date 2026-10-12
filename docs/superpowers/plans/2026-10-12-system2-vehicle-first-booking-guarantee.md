# System 2 (Vehicle Category First) and city-wise Booking Guarantee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each city choose System 2 (show every registered vehicle category, search for a driver only after the order is confirmed, for an admin-set time), with the Booking Guarantee admin window, compensation and referral lock controlled per city.

**Architecture:** A new per-city settings table (`city_order_settings`) read through a fail-closed service. System 2 orders get `search_system = 2` and a `search_deadline_at` snapshot at creation. `dispatchManager` keeps re-lapping an exhausted cascade until the deadline, then runs one function, `finishSearchWindow`, which opens the existing Booking Guarantee case (if the city enabled it and the user is not locked) or cancels with "Driver is not available". Compensation sets a separate `tbl_user.guarantee_locked`; a completed referral unlocks it.

**Tech Stack:** Node.js, Express, Prisma (MySQL), Jest (backend); React + Vite (admin `frontend/`); Flutter/GetX (customer app `ShifterOnline/`).

**Spec:** `docs/superpowers/specs/2026-10-12-system2-vehicle-first-booking-guarantee-design.md`

## Global Constraints

- City Admin = `admin.role === "admin"` with `admin.city_id`. Superadmin edits any city (must pass `city_id`); `admin` only its own city; `executive` read-only; a non-superadmin with no `city_id` is refused with 403 (fail closed).
- Defaults when a city has no row, or the settings read fails: `search_system = 1`, `guarantee_enabled = false`, `driver_search_seconds = 60`, `search_radius_km = NULL` (means `SEARCH_RADIUS_KM`), `admin_window_minutes = NULL` (means the global setting), `guarantee_referrals_required = 1`.
- Valid ranges: `search_radius_km` 1–30; `driver_search_seconds` whole number 15–600; `admin_window_minutes` whole number 1–1440; `guarantee_referrals_required` whole number >= 1; `search_system` 1 or 2.
- System 2 applies to instant bookings only (`booking_type = 1`). Scheduled (2) and next-day (3) orders behave exactly as today.
- Re-lap pause between laps: `SEARCH_RETRY_MS = 10000`.
- Cancel text for a System 2 order that finds nobody and gets no admin window: `cancel_reason = "Driver is not available"`, `o_status = "Cancelled"` (no new enum value), socket payload `reason: "driver_not_available"`. System 1 keeps `"No driver found"`.
- Compensation amount rule is unchanged (`tbl_package.no_driver_compensation`, highest `sort_order` among the selected models, frozen when the case opens).
- The guarantee lock (`tbl_user.guarantee_locked`) is separate from the Free Booking lock. It is set only when a compensation of amount > 0 is credited.
- A locked user can still book and gets the search window, but at the deadline the order is cancelled with "Driver is not available": no admin window, no compensation.
- Migrations are hand-written SQL applied by hand on every database (dev DB has no shadow DB), then `prisma migrate resolve --applied`. Apply BEFORE deploying code that reads the new columns, otherwise any `pkg_order` or `tbl_user` read without `select` fails with P2022.
- `ShifterOnline/` and `ShifterDriver/` are gitignored: commit changes there with `git add -f <exact files>`.
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Backend test command: `cd backend && npx jest <path>`. The suite `src/utils/__tests__/aadharPdfVerify.test.js` already fails on main (unrelated); everything else must stay green.
- Never push, deploy, run SQL against a database, or touch `.env`. The migration is applied by the owner (Task 13).

## Review Focus

Failure modes the spec implies that no feature test would otherwise exercise, most likely first. Each has a test in the task named in brackets.

1. The settings table is missing or unreadable: every city must behave as System 1 with the guarantee off, never strand an order. [Task 3]
2. A scheduled or next-day order placed in a System 2 city must not get a `search_deadline_at`. [Task 5]
3. The customer cancels, or a driver accepts, while the cascade is between laps: the pending re-lap must do nothing. [Task 6]
4. The server restarts mid-window: a System 2 order must not be cancelled early by startup reconciliation, and one whose deadline already passed must still be finished once. [Task 7]
5. A city admin must not read or change another city's settings or lock another city's customer. [Task 10]
6. A zero-amount guarantee expiry must not lock the customer. [Task 8]
7. Settings values that are blank, negative, fractional or out of range are rejected with 400, not stored. [Task 2]

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/migrations/20261012010000_add_city_order_settings/migration.sql` (create) | new table and three new columns |
| `backend/prisma/schema.prisma` (modify) | model `city_order_settings`; fields on `pkg_order` and `tbl_user` |
| `backend/src/config/constants.js` (modify) | `SEARCH_RETRY_MS` |
| `backend/src/services/orderSearchRules.js` (create) | pure rules: defaults, row normalising, input validation, deadline maths |
| `backend/src/services/orderSearchSettings.js` (create) | fail-closed per-city read with a short cache, validated upsert, order search view |
| `backend/src/controllers/orderAvailabilityController.js` (modify) | System 2 vehicle list |
| `backend/src/controllers/orderController.js` (modify) | snapshot on order create; `search` block in order details |
| `backend/src/services/dispatchManager.js` (modify) | search deadline, re-lap, `finishSearchWindow`, startup resume |
| `backend/src/services/bookingGuaranteeService.js` (modify) | city gating, city window, lock on compensation, unlock, manual lock |
| `backend/src/services/referralRewardService.js` (modify) | call the guarantee unlock |
| `backend/src/controllers/adminOrderSearchController.js` (create) | city-scoped settings API |
| `backend/src/controllers/adminBookingGuaranteeController.js` (modify) | lock / unlock a customer |
| `backend/src/routes/adminRoutes.js` (modify) | new routes; global guarantee setting becomes superadmin-only |
| `frontend/src/pages/OrderSearchSettings.jsx` (create), `frontend/src/App.jsx`, `frontend/src/config/navigation.js`, `frontend/src/pages/BookingGuarantee.jsx` (modify) | admin UI |
| `ShifterOnline/lib/screens/home/waiting_screen.dart`, `ShifterOnline/lib/utils/booking_guarantee.dart` (modify) | search countdown and messages |

---

### Task 1: Schema, migration and constant

**Files:**
- Create: `backend/prisma/migrations/20261012010000_add_city_order_settings/migration.sql`
- Modify: `backend/prisma/schema.prisma` (new model near `free_booking_setting` at ~line 1989; fields in `model pkg_order` at line 241 and in the `tbl_user` model beside `free_booking_locked` at ~line 1226)
- Modify: `backend/src/config/constants.js`

**Interfaces:**
- Produces: Prisma model `city_order_settings` with fields `city_id, search_system, search_radius_km, driver_search_seconds, guarantee_enabled, admin_window_minutes, guarantee_referrals_required, updated_by, updated_at`; `pkg_order.search_system`, `pkg_order.search_deadline_at`; `tbl_user.guarantee_locked`, `tbl_user.guarantee_locked_at`; constant `SEARCH_RETRY_MS`.

- [ ] **Step 1: Write the migration**

```sql
-- System 2 (Vehicle Category First) and city-wise Booking Guarantee (spec 2026-10-12).
-- Apply by hand on EVERY database BEFORE deploying the backend, then `prisma migrate resolve --applied`.
CREATE TABLE `city_order_settings` (
  `city_id` INT NOT NULL,
  `search_system` TINYINT NOT NULL DEFAULT 1,
  `search_radius_km` DECIMAL(5,2) NULL,
  `driver_search_seconds` INT NULL,
  `guarantee_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `admin_window_minutes` INT NULL,
  `guarantee_referrals_required` INT NOT NULL DEFAULT 1,
  `updated_by` INT NULL,
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`city_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pkg_order`
  ADD COLUMN `search_system` TINYINT NULL,
  ADD COLUMN `search_deadline_at` DATETIME(0) NULL,
  ADD INDEX `idx_order_search` (`search_system`, `o_status`, `search_deadline_at`);

ALTER TABLE `tbl_user`
  ADD COLUMN `guarantee_locked` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `guarantee_locked_at` DATETIME(0) NULL;
```

- [ ] **Step 2: Edit `schema.prisma`**

Add the model next to `free_booking_setting`:

```prisma
model city_order_settings {
  city_id                     Int      @id
  search_system               Int      @default(1) @db.TinyInt
  search_radius_km            Decimal? @db.Decimal(5, 2)
  driver_search_seconds       Int?
  guarantee_enabled           Boolean  @default(false)
  admin_window_minutes        Int?
  guarantee_referrals_required Int     @default(1)
  updated_by                  Int?
  updated_at                  DateTime @default(now()) @updatedAt @db.DateTime(0)
}
```

In `model pkg_order`, add after the `city_id` line:

```prisma
  search_system      Int?      @db.TinyInt
  search_deadline_at DateTime? @db.DateTime(0)
```

In the `tbl_user` model, directly under `free_booking_locked_at`, add:

```prisma
  guarantee_locked           Boolean   @default(false)
  guarantee_locked_at        DateTime? @db.DateTime(0)
```

- [ ] **Step 3: Add the constant**

In `backend/src/config/constants.js`, directly under `BOOKING_GUARANTEE_SWEEP_INTERVAL_MS`:

```js
  // System 2 (spec 2026-10-12): pause between two driver-search laps while the city's search window is open.
  SEARCH_RETRY_MS: 10 * 1000,
```

- [ ] **Step 4: Validate and regenerate the client**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma\schema.prisma is valid` and `Generated Prisma Client`. (If `generate` fails with an EPERM on a locked query-engine DLL, stop the running dev server and retry.)

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/migrations/20261012010000_add_city_order_settings backend/prisma/schema.prisma backend/src/config/constants.js
git commit -m "feat(system2): schema and migration for city order settings, search deadline and guarantee lock

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure rules (`orderSearchRules.js`)

**Files:**
- Create: `backend/src/services/orderSearchRules.js`
- Test: `backend/src/services/__tests__/orderSearchRules.test.js`

**Interfaces:**
- Produces:
  - `SYSTEM = { DRIVER_AVAILABILITY: 1, VEHICLE_FIRST: 2 }`, `DEFAULT_SEARCH_SECONDS = 60`
  - `defaultSettings() -> { searchSystem, searchRadiusKm, driverSearchSeconds, guaranteeEnabled, adminWindowMinutes, guaranteeReferralsRequired }`
  - `normalizeRow(row | null) -> same shape` (row uses the snake_case DB columns)
  - `validateSettingsInput(input) -> partial camelCase object`, throws `Error` with `statusCode: 400`
  - `searchDeadline(now: Date, seconds: number) -> Date`
  - `isSystem2Order(order) -> boolean`
  - `hasSearchTimeLeft(order, now = new Date()) -> boolean`
  - `isInstantBookingType(value) -> boolean`

- [ ] **Step 1: Write the failing test**

```js
const rules = require("../orderSearchRules");

describe("defaultSettings / normalizeRow", () => {
  it("a missing row means System 1, guarantee off, 60 s", () => {
    expect(rules.normalizeRow(null)).toEqual({
      searchSystem: 1, searchRadiusKm: null, driverSearchSeconds: 60,
      guaranteeEnabled: false, adminWindowMinutes: null, guaranteeReferralsRequired: 1,
    });
  });

  it("reads a valid row", () => {
    expect(rules.normalizeRow({
      search_system: 2, search_radius_km: "7.50", driver_search_seconds: 120, guarantee_enabled: 1,
      admin_window_minutes: 15, guarantee_referrals_required: 2,
    })).toEqual({
      searchSystem: 2, searchRadiusKm: 7.5, driverSearchSeconds: 120,
      guaranteeEnabled: true, adminWindowMinutes: 15, guaranteeReferralsRequired: 2,
    });
  });

  it("falls back per field when a stored value is out of range", () => {
    const s = rules.normalizeRow({
      search_system: 9, search_radius_km: 99, driver_search_seconds: 5, guarantee_enabled: 0,
      admin_window_minutes: 0, guarantee_referrals_required: 0,
    });
    expect(s.searchSystem).toBe(1);
    expect(s.searchRadiusKm).toBeNull();
    expect(s.driverSearchSeconds).toBe(60);
    expect(s.adminWindowMinutes).toBeNull();
    expect(s.guaranteeReferralsRequired).toBe(1);
  });
});

describe("validateSettingsInput", () => {
  it("returns only the keys that were sent", () => {
    expect(rules.validateSettingsInput({ searchSystem: "2", driverSearchSeconds: "90" })).toEqual({ searchSystem: 2, driverSearchSeconds: 90 });
  });

  it("blank radius and blank admin window clear back to the fallback (null)", () => {
    expect(rules.validateSettingsInput({ searchRadiusKm: "", adminWindowMinutes: null })).toEqual({ searchRadiusKm: null, adminWindowMinutes: null });
  });

  it("parses the guarantee switch", () => {
    expect(rules.validateSettingsInput({ guaranteeEnabled: true }).guaranteeEnabled).toBe(true);
    expect(rules.validateSettingsInput({ guaranteeEnabled: "1" }).guaranteeEnabled).toBe(true);
    expect(rules.validateSettingsInput({ guaranteeEnabled: false }).guaranteeEnabled).toBe(false);
    expect(rules.validateSettingsInput({ guaranteeEnabled: "0" }).guaranteeEnabled).toBe(false);
  });

  it.each([
    [{ searchSystem: 3 }, "search_system"],
    [{ searchSystem: "" }, "search_system"],
    [{ searchRadiusKm: 0.5 }, "search_radius_km"],
    [{ searchRadiusKm: 31 }, "search_radius_km"],
    [{ searchRadiusKm: "abc" }, "search_radius_km"],
    [{ driverSearchSeconds: 14 }, "driver_search_seconds"],
    [{ driverSearchSeconds: 601 }, "driver_search_seconds"],
    [{ driverSearchSeconds: 60.5 }, "driver_search_seconds"],
    [{ driverSearchSeconds: "" }, "driver_search_seconds"],
    [{ driverSearchSeconds: -30 }, "driver_search_seconds"],
    [{ adminWindowMinutes: 0 }, "admin_window_minutes"],
    [{ adminWindowMinutes: 1441 }, "admin_window_minutes"],
    [{ adminWindowMinutes: 2.5 }, "admin_window_minutes"],
    [{ guaranteeReferralsRequired: 0 }, "guarantee_referrals_required"],
    [{ guaranteeReferralsRequired: 1.5 }, "guarantee_referrals_required"],
    [{ guaranteeReferralsRequired: "" }, "guarantee_referrals_required"],
  ])("rejects %j with a 400 naming %s", (input, field) => {
    let err;
    try { rules.validateSettingsInput(input); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain(field);
  });
});

describe("deadline helpers", () => {
  it("searchDeadline adds whole seconds", () => {
    const now = new Date("2026-10-12T10:00:00.000Z");
    expect(rules.searchDeadline(now, 90).toISOString()).toBe("2026-10-12T10:01:30.000Z");
  });

  it("isSystem2Order is true only for search_system 2", () => {
    expect(rules.isSystem2Order({ search_system: 2 })).toBe(true);
    expect(rules.isSystem2Order({ search_system: "2" })).toBe(true);
    expect(rules.isSystem2Order({ search_system: 1 })).toBe(false);
    expect(rules.isSystem2Order({ search_system: null })).toBe(false);
    expect(rules.isSystem2Order(null)).toBe(false);
  });

  it("hasSearchTimeLeft needs System 2 and a future deadline", () => {
    const now = new Date("2026-10-12T10:00:00.000Z");
    expect(rules.hasSearchTimeLeft({ search_system: 2, search_deadline_at: "2026-10-12T10:00:01.000Z" }, now)).toBe(true);
    expect(rules.hasSearchTimeLeft({ search_system: 2, search_deadline_at: "2026-10-12T10:00:00.000Z" }, now)).toBe(false);
    expect(rules.hasSearchTimeLeft({ search_system: 2, search_deadline_at: null }, now)).toBe(false);
    expect(rules.hasSearchTimeLeft({ search_system: 1, search_deadline_at: "2026-10-12T11:00:00.000Z" }, now)).toBe(false);
  });

  it("isInstantBookingType treats scheduled and next-day values as not instant", () => {
    for (const v of [1, "1", "now", "instant", undefined, null]) expect(rules.isInstantBookingType(v)).toBe(true);
    for (const v of [2, "2", 3, "3", "scheduled", "next_day", "nextday", "Scheduled"]) expect(rules.isInstantBookingType(v)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/orderSearchRules.test.js`
Expected: FAIL with `Cannot find module '../orderSearchRules'`.

- [ ] **Step 3: Write the implementation**

```js
// Pure rules for System 2 (Vehicle Category First) and the city-wise Booking Guarantee
// (spec 2026-10-12). No I/O here: orderSearchSettings.js feeds these the rows it loaded.

const SYSTEM = Object.freeze({ DRIVER_AVAILABILITY: 1, VEHICLE_FIRST: 2 });
const DEFAULT_SEARCH_SECONDS = 60;
const LIMITS = Object.freeze({
  radiusKm: [1, 30],
  searchSeconds: [15, 600],
  adminWindowMinutes: [1, 1440],
});

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const inRange = (n, [lo, hi]) => Number.isFinite(n) && n >= lo && n <= hi;
const blank = (v) => v === null || v === undefined || v === "";

function defaultSettings() {
  return {
    searchSystem: SYSTEM.DRIVER_AVAILABILITY,
    searchRadiusKm: null,
    driverSearchSeconds: DEFAULT_SEARCH_SECONDS,
    guaranteeEnabled: false,
    adminWindowMinutes: null,
    guaranteeReferralsRequired: 1,
  };
}

/** A city_order_settings row (snake_case DB columns) as the camelCase settings object; bad values fall back per field. */
function normalizeRow(row) {
  const d = defaultSettings();
  if (!row) return d;
  const radius = blank(row.search_radius_km) ? null : Number(row.search_radius_km);
  const seconds = blank(row.driver_search_seconds) ? d.driverSearchSeconds : Number(row.driver_search_seconds);
  const windowMin = blank(row.admin_window_minutes) ? null : Number(row.admin_window_minutes);
  const refs = Number(row.guarantee_referrals_required);
  return {
    searchSystem: Number(row.search_system) === SYSTEM.VEHICLE_FIRST ? SYSTEM.VEHICLE_FIRST : SYSTEM.DRIVER_AVAILABILITY,
    searchRadiusKm: radius !== null && inRange(radius, LIMITS.radiusKm) ? radius : null,
    driverSearchSeconds: inRange(seconds, LIMITS.searchSeconds) ? Math.round(seconds) : DEFAULT_SEARCH_SECONDS,
    guaranteeEnabled: Boolean(row.guarantee_enabled),
    adminWindowMinutes: windowMin !== null && inRange(windowMin, LIMITS.adminWindowMinutes) ? Math.round(windowMin) : null,
    guaranteeReferralsRequired: Number.isInteger(refs) && refs >= 1 ? refs : 1,
  };
}

const toBool = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

/** Validates admin input (camelCase). Returns only the keys that were sent; throws a 400 on the first bad value. */
function validateSettingsInput(input = {}) {
  const out = {};
  if (input.searchSystem !== undefined) {
    const n = blank(input.searchSystem) ? NaN : Number(input.searchSystem);
    if (n !== SYSTEM.DRIVER_AVAILABILITY && n !== SYSTEM.VEHICLE_FIRST) throw badRequest("search_system must be 1 or 2");
    out.searchSystem = n;
  }
  if (input.searchRadiusKm !== undefined) {
    if (blank(input.searchRadiusKm)) out.searchRadiusKm = null;
    else {
      const n = Number(input.searchRadiusKm);
      if (!inRange(n, LIMITS.radiusKm)) throw badRequest("search_radius_km must be between 1 and 30");
      out.searchRadiusKm = n;
    }
  }
  if (input.driverSearchSeconds !== undefined) {
    const n = blank(input.driverSearchSeconds) ? NaN : Number(input.driverSearchSeconds);
    if (!Number.isInteger(n) || !inRange(n, LIMITS.searchSeconds)) {
      throw badRequest("driver_search_seconds must be a whole number between 15 and 600");
    }
    out.driverSearchSeconds = n;
  }
  if (input.guaranteeEnabled !== undefined) out.guaranteeEnabled = toBool(input.guaranteeEnabled);
  if (input.adminWindowMinutes !== undefined) {
    if (blank(input.adminWindowMinutes)) out.adminWindowMinutes = null;
    else {
      const n = Number(input.adminWindowMinutes);
      if (!Number.isInteger(n) || !inRange(n, LIMITS.adminWindowMinutes)) {
        throw badRequest("admin_window_minutes must be a whole number between 1 and 1440");
      }
      out.adminWindowMinutes = n;
    }
  }
  if (input.guaranteeReferralsRequired !== undefined) {
    const n = blank(input.guaranteeReferralsRequired) ? NaN : Number(input.guaranteeReferralsRequired);
    if (!Number.isInteger(n) || n < 1) throw badRequest("guarantee_referrals_required must be a whole number of at least 1");
    out.guaranteeReferralsRequired = n;
  }
  return out;
}

const searchDeadline = (now, seconds) => new Date(now.getTime() + Number(seconds) * 1000);

const isSystem2Order = (order) => Number(order?.search_system) === SYSTEM.VEHICLE_FIRST;

function hasSearchTimeLeft(order, now = new Date()) {
  if (!isSystem2Order(order) || !order.search_deadline_at) return false;
  return now.getTime() < new Date(order.search_deadline_at).getTime();
}

const FUTURE_BOOKING_TYPES = new Set(["2", "3", "scheduled", "next_day", "nextday"]);
/** false for scheduled / next-day values, in both the numeric (orders) and string (vehicle list) spellings. */
const isInstantBookingType = (value) => !FUTURE_BOOKING_TYPES.has(String(value ?? "now").trim().toLowerCase());

module.exports = {
  SYSTEM, DEFAULT_SEARCH_SECONDS, LIMITS,
  defaultSettings, normalizeRow, validateSettingsInput,
  searchDeadline, isSystem2Order, hasSearchTimeLeft, isInstantBookingType,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/orderSearchRules.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orderSearchRules.js backend/src/services/__tests__/orderSearchRules.test.js
git commit -m "feat(system2): pure rules for city order search settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings service (`orderSearchSettings.js`)

**Files:**
- Create: `backend/src/services/orderSearchSettings.js`
- Test: `backend/src/services/__tests__/orderSearchSettings.test.js`

**Interfaces:**
- Consumes: `orderSearchRules` (Task 2), Prisma models from Task 1.
- Produces:
  - `getCitySettings(cityId, { fresh = false } = {}) -> Promise<settings>` (never throws; falls back to `defaultSettings()`)
  - `saveCitySettings({ cityId, input, adminId }) -> Promise<settings>` (throws 400 on invalid input or unknown city)
  - `getSearchView(order) -> Promise<{ system: 1|2, deadline_at: string|null, guarantee: "off"|"on"|"locked" }>` (never throws)
  - `_resetCache()`

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  city_order_settings: { findUnique: jest.fn(), upsert: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../orderSearchSettings");

beforeEach(() => {
  jest.clearAllMocks();
  svc._resetCache();
});

describe("getCitySettings", () => {
  it("returns the defaults when the city has no row", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue(null);
    const s = await svc.getCitySettings(3);
    expect(s.searchSystem).toBe(1);
    expect(s.guaranteeEnabled).toBe(false);
  });

  it("reads a stored row", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({
      city_id: 3, search_system: 2, search_radius_km: "8.00", driver_search_seconds: 90, guarantee_enabled: 1,
      admin_window_minutes: 20, guarantee_referrals_required: 2,
    });
    expect(await svc.getCitySettings(3)).toEqual({
      searchSystem: 2, searchRadiusKm: 8, driverSearchSeconds: 90, guaranteeEnabled: true, adminWindowMinutes: 20, guaranteeReferralsRequired: 2,
    });
  });

  it("fails closed to System 1 / guarantee off when the read throws (e.g. table missing)", async () => {
    prisma.city_order_settings.findUnique.mockRejectedValue(new Error("P2021 table missing"));
    const s = await svc.getCitySettings(3);
    expect(s.searchSystem).toBe(1);
    expect(s.guaranteeEnabled).toBe(false);
  });

  it("fails closed when the Prisma model itself is undefined (client not regenerated)", async () => {
    const saved = prisma.city_order_settings;
    prisma.city_order_settings = undefined;
    try {
      const s = await svc.getCitySettings(3);
      expect(s.searchSystem).toBe(1);
    } finally {
      prisma.city_order_settings = saved;
    }
  });

  it.each([null, undefined, 0, "abc", -4])("a missing or invalid city id (%p) gives the defaults without a query", async (cityId) => {
    const s = await svc.getCitySettings(cityId);
    expect(s.searchSystem).toBe(1);
    expect(prisma.city_order_settings.findUnique).not.toHaveBeenCalled();
  });

  it("caches a city for a few seconds and re-reads when asked fresh", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue(null);
    await svc.getCitySettings(3);
    await svc.getCitySettings(3);
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(1);
    await svc.getCitySettings(3, { fresh: true });
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("saveCitySettings", () => {
  it("upserts only the validated keys, stamps the admin and returns fresh settings", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.upsert.mockResolvedValue({});
    prisma.city_order_settings.findUnique.mockResolvedValue({
      city_id: 3, search_system: 2, driver_search_seconds: 120, guarantee_enabled: 0, guarantee_referrals_required: 1,
    });
    const out = await svc.saveCitySettings({ cityId: 3, input: { searchSystem: 2, driverSearchSeconds: 120 }, adminId: 9 });
    expect(prisma.city_order_settings.upsert).toHaveBeenCalledWith({
      where: { city_id: 3 },
      update: { search_system: 2, driver_search_seconds: 120, updated_by: 9 },
      create: { city_id: 3, search_system: 2, driver_search_seconds: 120, updated_by: 9 },
    });
    expect(out.searchSystem).toBe(2);
    expect(out.driverSearchSeconds).toBe(120);
  });

  it("rejects invalid input with a 400 and writes nothing", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    await expect(svc.saveCitySettings({ cityId: 3, input: { driverSearchSeconds: 5 }, adminId: 9 })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.city_order_settings.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown city with a 400", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue(null);
    await expect(svc.saveCitySettings({ cityId: 99, input: { searchSystem: 2 }, adminId: 9 })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.city_order_settings.upsert).not.toHaveBeenCalled();
  });

  it("a save drops the cached value so the next read is fresh", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.upsert.mockResolvedValue({});
    prisma.city_order_settings.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ city_id: 3, search_system: 2 });
    await svc.getCitySettings(3);
    await svc.saveCitySettings({ cityId: 3, input: { searchSystem: 2 }, adminId: 1 });
    expect((await svc.getCitySettings(3)).searchSystem).toBe(2);
  });
});

describe("getSearchView", () => {
  const order = { id: 5, uid: 7, city_id: 3, search_system: 2, search_deadline_at: new Date("2026-10-12T10:01:30.000Z") };

  it("a System 1 order has no deadline and no guarantee", async () => {
    expect(await svc.getSearchView({ id: 1, uid: 7, city_id: 3, search_system: null })).toEqual({ system: 1, deadline_at: null, guarantee: "off" });
  });

  it("a System 2 order carries its deadline and the city's guarantee state", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 1 });
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    expect(await svc.getSearchView(order)).toEqual({ system: 2, deadline_at: "2026-10-12T10:01:30.000Z", guarantee: "on" });
  });

  it("reports locked when the customer is guarantee-locked", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 1 });
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: true });
    expect((await svc.getSearchView(order)).guarantee).toBe("locked");
  });

  it("reports off when the city has the guarantee disabled", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 0 });
    expect((await svc.getSearchView(order)).guarantee).toBe("off");
  });

  it("never throws: a failing user lookup still returns the deadline", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 1 });
    prisma.tbl_user.findUnique.mockRejectedValue(new Error("db down"));
    const view = await svc.getSearchView(order);
    expect(view.system).toBe(2);
    expect(view.deadline_at).toBe("2026-10-12T10:01:30.000Z");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/orderSearchSettings.test.js`
Expected: FAIL with `Cannot find module '../orderSearchSettings'`.

- [ ] **Step 3: Write the implementation**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./orderSearchRules");

const TTL_MS = 5000;
const cache = new Map(); // cityId -> { at, value }

const COLUMN = {
  searchSystem: "search_system",
  searchRadiusKm: "search_radius_km",
  driverSearchSeconds: "driver_search_seconds",
  guaranteeEnabled: "guarantee_enabled",
  adminWindowMinutes: "admin_window_minutes",
  guaranteeReferralsRequired: "guarantee_referrals_required",
};

/**
 * The city's order-search settings. Fail closed: a missing city, a missing row or any read error gives
 * System 1 with the guarantee off, so a settings outage can never change how orders are searched or paid.
 */
async function getCitySettings(cityId, { fresh = false } = {}) {
  const id = Number(cityId);
  if (!Number.isInteger(id) || id <= 0) return rules.defaultSettings();
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const row = await prisma.city_order_settings.findUnique({ where: { city_id: id } });
    const value = rules.normalizeRow(row);
    cache.set(id, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.error(`orderSearchSettings.getCitySettings: city ${id} unreadable, using System 1 / guarantee off:`, err);
    return rules.defaultSettings();
  }
}

async function saveCitySettings({ cityId, input, adminId }) {
  const id = Number(cityId);
  const clean = rules.validateSettingsInput(input);
  const city = Number.isInteger(id) && id > 0 ? await prisma.tbl_city.findUnique({ where: { id } }) : null;
  if (!city) throw Object.assign(new Error("Unknown city"), { statusCode: 400 });

  const data = {};
  for (const [key, value] of Object.entries(clean)) data[COLUMN[key]] = value;
  data.updated_by = adminId ?? null;
  await prisma.city_order_settings.upsert({
    where: { city_id: id },
    update: data,
    create: { city_id: id, ...data },
  });
  cache.delete(id);
  logger.info(`order-search settings city=${id} admin=${adminId ?? "-"} ${JSON.stringify(clean)}`);
  return getCitySettings(id, { fresh: true });
}

/** The `search` block of the customer order-details response. Never throws. */
async function getSearchView(order) {
  const system2 = rules.isSystem2Order(order);
  const view = {
    system: system2 ? 2 : 1,
    deadline_at: system2 && order.search_deadline_at ? new Date(order.search_deadline_at).toISOString() : null,
    guarantee: "off",
  };
  if (!system2) return view;
  try {
    const city = await getCitySettings(order.city_id);
    if (!city.guaranteeEnabled) return view;
    view.guarantee = "on";
    const user = await prisma.tbl_user.findUnique({ where: { id: Number(order.uid) }, select: { guarantee_locked: true } });
    if (user?.guarantee_locked) view.guarantee = "locked";
  } catch (err) {
    logger.warn(`orderSearchSettings.getSearchView failed for order ${order?.id}: ${err.message}`);
  }
  return view;
}

function _resetCache() {
  cache.clear();
}

module.exports = { getCitySettings, saveCitySettings, getSearchView, _resetCache };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/orderSearchSettings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orderSearchSettings.js backend/src/services/__tests__/orderSearchSettings.test.js
git commit -m "feat(system2): fail-closed per-city order search settings service

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: System 2 vehicle list

**Files:**
- Modify: `backend/src/controllers/orderAvailabilityController.js`
- Test: `backend/src/controllers/__tests__/orderAvailabilityController.system2.test.js` (create)

**Interfaces:**
- Consumes: `orderSearchSettings.getCitySettings(cityId)` (Task 3), `orderSearchRules.isInstantBookingType` (Task 2).
- Produces: `availableVehicles` response gains top-level `search_system` (1|2) and `driver_search_seconds` (number), and inside `data` the same two keys. In a System 2 city (instant booking) every category has `available: true`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  service_zone: { findMany: jest.fn() },
  tbl_city: { findUnique: jest.fn(), findFirst: jest.fn() },
  tbl_user_plan_subscription: { findFirst: jest.fn() },
  tbl_premium_plan: { findUnique: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  pkg_category: { findMany: jest.fn() },
  setting: { findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock("../../services/geofenceService", () => ({ isInsideZone: jest.fn() }));
jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn() }));

const prisma = require("../../config/db");
const { isInsideZone } = require("../../services/geofenceService");
const orderSearchSettings = require("../../services/orderSearchSettings");
const { availableVehicles } = require("../orderAvailabilityController");

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

function stubCommonLookups() {
  prisma.service_zone.findMany.mockResolvedValue([{ id: 1, city_id: 1 }]);
  isInsideZone.mockReturnValue(true);
  prisma.tbl_city.findUnique.mockResolvedValue({ id: 1, title: "Indore" });
  prisma.tbl_user_plan_subscription.findFirst.mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([
    { id: 10, cat_id: 1, city_id: "0", title: "Bike", user_detail_image: null, start_time: new Date(0), end_time: new Date(0), night_charge_percent: 0, min_charge: 30, service_charge_percent: 0 },
  ]);
  prisma.pkg_category.findMany.mockResolvedValue([{ id: 1, cat_name: "Bike", cat_img: null }]);
  prisma.setting.findFirst.mockResolvedValue({ currency: "INR" });
  prisma.app_settings.findFirst.mockResolvedValue(null);
}

const system2 = { searchSystem: 2, searchRadiusKm: 7, driverSearchSeconds: 90, guaranteeEnabled: false, adminWindowMinutes: null, guaranteeReferralsRequired: 1 };
const system1 = { ...system2, searchSystem: 1, searchRadiusKm: null };
const body = (extra = {}) => ({ body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now", ...extra } });

beforeEach(() => {
  jest.clearAllMocks();
  stubCommonLookups();
});

describe("availableVehicles in a System 2 city", () => {
  it("shows every category as available even with no drivers nearby, using the city radius", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const p = res.json.mock.calls[0][0];
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(1);
    expect(p.vehicles[0].available).toBe(true);
    expect(p.vehicles[0].is_available).toBe(1);
    expect(p.vehicles[0].reason_unavailable).toBeNull();
    expect(p.categories[0].available).toBe(true);
    expect(p.search_radius_km).toBe(7);
    expect(p.search_system).toBe(2);
    expect(p.driver_search_seconds).toBe(90);
    expect(p.data.search_system).toBe(2);
    expect(p.data.driver_search_seconds).toBe(90);
    expect(p.radius_suggestion).toBeNull();
  });

  it("keeps a pickup ETA when a driver really is nearby", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    prisma.$queryRaw.mockResolvedValue([{ rider_id: 1, distance_km: 2 }]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const v = res.json.mock.calls[0][0].vehicles[0];
    expect(v.available).toBe(true);
    expect(v.live_supply).toBe("good");
    expect(v.estimated_pickup_minutes).toBeGreaterThan(0);
  });

  it("a scheduled booking in a System 2 city behaves as before (no forced availability, no city radius)", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body({ booking_type: "scheduled" }), res);
    const p = res.json.mock.calls[0][0];
    expect(p.search_system).toBe(1);
    expect(p.search_radius_km).toBe(4);
  });
});

describe("availableVehicles in a System 1 city", () => {
  it("is unchanged: no drivers means unavailable, with a System 1 marker", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system1);
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const p = res.json.mock.calls[0][0];
    expect(p.vehicles[0].available).toBe(false);
    expect(p.search_system).toBe(1);
    expect(p.search_radius_km).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/orderAvailabilityController.system2.test.js`
Expected: FAIL (`search_system` is undefined / `available` is false).

- [ ] **Step 3: Implement**

At the top of `orderAvailabilityController.js`, after the existing `require` lines:

```js
const orderSearchSettings = require("../services/orderSearchSettings");
const { isInstantBookingType } = require("../services/orderSearchRules");
```

Directly after the line `const pickupArea = { city_id: matchedCityId, city_name: matchedCityName, zone_id: matchedZoneId, zone_name: matchedZoneName };` insert:

```js
    // System 2 (spec 2026-10-12): in a city that chose "Vehicle Category First" every category is bookable and
    // the driver search happens after the order is confirmed. Instant bookings only; fails closed to System 1.
    const citySearch = await orderSearchSettings.getCitySettings(matchedCityId);
    const system2 = citySearch.searchSystem === 2 && isInstantBookingType(bookingType);
    if (system2 && citySearch.searchRadiusKm) radiusKm = citySearch.searchRadiusKm;
```

In the vehicle loop, replace the `if (count >= 1) { ... }` block of the instant branch so it reads:

```js
        const { count, nearestKm } = await countNearbyOnlineDrivers(catName, pickupLat, pickupLng, radiusKm);
        if (count >= 1) {
          liveSupply = "good";
          estimatedPickupMinutes = Math.round(Math.max(4, Math.min(10, nearestKm * 1.2 + 2)));
          available = true;
          reasonUnavailable = null;
        } else if (system2) {
          // No driver right now, but System 2 still lets the customer book and searches afterwards.
          available = true;
          reasonUnavailable = null;
        }
```

In the final success response add the two keys, both at the top level (next to `search_radius_km: radiusKm,`) and inside `data` (next to its `search_radius_km: radiusKm,`):

```js
      search_system: system2 ? 2 : 1,
      driver_search_seconds: citySearch.driverSearchSeconds,
```

- [ ] **Step 4: Run the new and the existing availability tests**

Run: `cd backend && npx jest src/controllers/__tests__/orderAvailabilityController`
Expected: PASS for both files. (The existing file does not mock `orderSearchSettings`; the real one reads `prisma.city_order_settings`, which is undefined in that mock, throws, and fails closed to System 1, so those tests are unaffected.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/orderAvailabilityController.js backend/src/controllers/__tests__/orderAvailabilityController.system2.test.js
git commit -m "feat(system2): show every vehicle category in System 2 cities

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Snapshot on order create and `search` block in order details

**Files:**
- Modify: `backend/src/controllers/orderController.js` (imports at the top; after `resolvedRadiusKm` at ~line 351; `pkg_order.create` data at ~line 527; order details response at ~line 956)
- Test: `backend/src/controllers/__tests__/orderController.system2.test.js` (create)

**Interfaces:**
- Consumes: `orderSearchSettings.getCitySettings`, `orderSearchSettings.getSearchView` (Task 3), `orderSearchRules.searchDeadline` (Task 2).
- Produces: new orders carry `search_system` (2 or null), `search_deadline_at` (Date or null) and `radius_range` = the city radius for System 2; the order details item gains `search: { system, deadline_at, guarantee }`.

- [ ] **Step 1: Write the failing test**

Copy the whole `jest.mock(...)` header and the `input` / `beforeEach` fixtures from `orderController.freeBooking.test.js` (lines 1–58) into the new file, then add `jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn(), getSearchView: jest.fn() }));` and `const orderSearchSettings = require("../../services/orderSearchSettings");`. Then:

```js
const system2 = { searchSystem: 2, searchRadiusKm: 7, driverSearchSeconds: 90, guaranteeEnabled: false, adminWindowMinutes: null, guaranteeReferralsRequired: 1 };

describe("createOrderCore - System 2 snapshot", () => {
  const createdData = () => prisma.pkg_order.create.mock.calls[0][0].data;

  it("stamps search_system 2, a deadline and the city radius on an instant booking", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    const before = Date.now();
    const result = await createOrderCore({ ...input });
    expect(result.ok).toBe(true);
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(2);
    const data = createdData();
    expect(data.search_system).toBe(2);
    expect(data.search_deadline_at).toBeInstanceOf(Date);
    const seconds = (data.search_deadline_at.getTime() - before) / 1000;
    expect(seconds).toBeGreaterThanOrEqual(89);
    expect(seconds).toBeLessThanOrEqual(92);
    expect(data.radius_range).toBe(7); // client sent radiusKm 10; the city radius wins
  });

  it("keeps the client radius when the System 2 city has no radius of its own", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue({ ...system2, searchRadiusKm: null });
    await createOrderCore({ ...input });
    expect(createdData().radius_range).toBe(10);
  });

  it("a System 1 city gets no snapshot", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue({ ...system2, searchSystem: 1 });
    await createOrderCore({ ...input });
    expect(createdData().search_system).toBeNull();
    expect(createdData().search_deadline_at).toBeNull();
    expect(createdData().radius_range).toBe(10);
  });

  it.each([2, 3])("a booking_type %i order in a System 2 city gets no snapshot and the settings are not even read", async (bookingType) => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    await createOrderCore({ ...input, bookingType });
    expect(createdData().search_system).toBeNull();
    expect(createdData().search_deadline_at).toBeNull();
    expect(orderSearchSettings.getCitySettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/orderController.system2.test.js`
Expected: FAIL (`search_system` is undefined on the create data).

- [ ] **Step 3: Implement**

Add near the other service requires at the top of `orderController.js`:

```js
const orderSearchSettings = require("../services/orderSearchSettings");
const orderSearchRules = require("../services/orderSearchRules");
```

Right after the `const resolvedRadiusKm = Math.min(...)` statement (~line 351–354) insert:

```js
  // System 2 (spec 2026-10-12): an instant booking in a "Vehicle Category First" city is searched for
  // `driverSearchSeconds` after confirmation, within the city's own radius. Fails closed to System 1.
  const citySearch = Number(bookingType) === 1 ? await orderSearchSettings.getCitySettings(resolvedCityId) : null;
  const system2 = citySearch?.searchSystem === orderSearchRules.SYSTEM.VEHICLE_FIRST;
  const dispatchRadiusKm = system2 && citySearch.searchRadiusKm ? citySearch.searchRadiusKm : resolvedRadiusKm;
```

In the `prisma.pkg_order.create({ data: { ... } })` object, replace `radius_range: Math.round(resolvedRadiusKm),` with:

```js
      radius_range: Math.round(dispatchRadiusKm),
      search_system: system2 ? orderSearchRules.SYSTEM.VEHICLE_FIRST : null,
      search_deadline_at: system2 ? orderSearchRules.searchDeadline(new Date(), citySearch.driverSearchSeconds) : null,
```

In the order-details response item (the object that contains `guarantee: await bookingGuaranteeService.getView(order),`) add directly below that line:

```js
          // System 2: search window state so the waiting screen can show the right countdown and guarantee note.
          search: await orderSearchSettings.getSearchView(order),
```

- [ ] **Step 4: Run the new and the existing order controller tests**

Run: `cd backend && npx jest src/controllers/__tests__/orderController`
Expected: PASS for `orderController.system2`, `.freeBooking`, `.receiverPay`, `.advancePayment` and `orderController.test.js`. (Existing files do not mock `orderSearchSettings`; the real service fails closed to System 1 when `prisma.city_order_settings` is undefined.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.system2.test.js
git commit -m "feat(system2): snapshot search system and deadline on order create, add search view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dispatch search window (`dispatchManager`)

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (requires at the top; `startDispatch` at ~line 1228; `runBatchInner` at ~line 531; `checkCascadeTermination` at ~line 397; `stopDispatch`; `_resetForTests`; exports)
- Test: `backend/src/services/__tests__/dispatchManager.system2.test.js` (create)

**Interfaces:**
- Consumes: `SEARCH_RETRY_MS` (Task 1), `orderSearchRules.hasSearchTimeLeft` (Task 2), existing `orderStage.offeredRiderIds(orderId)`, `bookingGuaranteeService.openForExhaustedOrder(order, tiers)`.
- Produces:
  - `finishSearchWindow(order, tiers?) -> Promise<{ held: boolean }>` (exported). `held: true` means a Booking Guarantee case now owns the order; otherwise the order has been cancelled with the right reason and the customer notified.
  - dispatch state fields `searchDeadlineAt: Date | null`, `searchExpired: boolean`.

- [ ] **Step 1: Write the failing test**

Create the file with this header (it is the mock block of `dispatchManager.test.js` lines 1–66 plus what the System 2 path needs), then the tests:

```js
jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  pkg_order: {
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _avg: { cust_rate: null } }),
  },
  tbl_order_requests: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  app_settings: { findFirst: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../pricingEngine", () => {
  const actual = jest.requireActual("../pricingEngine");
  return {
    ...actual,
    getPackageById: jest.fn().mockResolvedValue({ id: 6, title: "Model 1", min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 10 }),
    getActivePlanDiscount: jest.fn().mockResolvedValue(null),
  };
});
jest.mock("../settlementSettings", () => ({
  getSettlementSettings: jest.fn().mockResolvedValue({ enabled: false, driverBlockGraceMinutes: 10 }),
}));
jest.mock("../freeBookingService", () => ({
  getDispatchPoolFilter: jest.fn().mockResolvedValue(null),
  fallbackToNormalDispatch: jest.fn().mockResolvedValue(false),
}));
jest.mock("../bookingGuaranteeService", () => ({
  openForExhaustedOrder: jest.fn().mockResolvedValue(false),
}));
jest.mock("../orderStageService", () => ({
  decideStartStage: jest.fn().mockResolvedValue(null),
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
jest.mock("../pushNotifier");
jest.mock("../walletPrepaymentRefund");

const prisma = require("../../config/db");
const bookingGuaranteeService = require("../bookingGuaranteeService");
const dispatchManager = require("../dispatchManager");
const { SEARCH_RETRY_MS } = require("../../config/constants");

const flush = async (ticks = 24) => { for (let i = 0; i < ticks; i++) await Promise.resolve(); };

const base = {
  id: 601, uid: 7, city_id: 3, plat: "28.70", plong: "77.10", dlat: "28.61", dlong: "77.20", distance: 15.4,
  category: "Bike", pmobile: "9876543210", paddress: "A", daddress: "B", pick_name: "Rahul",
  rid: 0, order_status: 0, o_status: "Pending", allowed_delivery_types: JSON.stringify([6]),
};
const system2Order = (deadlineMs) => ({ ...base, search_system: 2, search_deadline_at: new Date(Date.now() + deadlineMs) });

let emitted;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  dispatchManager._resetForTests();
  emitted = [];
  dispatchManager.init({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
  prisma.$queryRaw.mockResolvedValue([]); // never any driver
  prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
  prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  prisma.pkg_order.update.mockResolvedValue({});
  bookingGuaranteeService.openForExhaustedOrder.mockResolvedValue(false);
});
afterEach(() => {
  dispatchManager.stopDispatch(base.id, "cancelled_by_user");
  jest.useRealTimers();
});

const cancelledWith = () => prisma.pkg_order.update.mock.calls
  .map(([a]) => a.data).find((d) => d && d.o_status === "Cancelled");
const driverQueries = () => prisma.$queryRaw.mock.calls.length;

describe("System 2 search window", () => {
  it("keeps searching (re-laps) after the cascade is exhausted while the window is open", async () => {
    const order = system2Order(60_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    const afterFirstLap = driverQueries();
    await jest.advanceTimersByTimeAsync(SEARCH_RETRY_MS + 10_000);
    await flush();
    expect(driverQueries()).toBeGreaterThan(afterFirstLap);
    expect(cancelledWith()).toBeUndefined();
    expect(bookingGuaranteeService.openForExhaustedOrder).not.toHaveBeenCalled();
    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(0);
  });

  it("at the deadline with no guarantee cancels once with 'Driver is not available'", async () => {
    const order = system2Order(25_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    const cancelled = prisma.pkg_order.update.mock.calls.map(([a]) => a.data).filter((d) => d && d.o_status === "Cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].cancel_reason).toBe("Driver is not available");
    const events = emitted.filter((e) => e.event === "order:no_driver_found");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ order_id: "601", reason: "driver_not_available" });
  });

  it("at the deadline an enabled guarantee holds the order instead of cancelling it", async () => {
    bookingGuaranteeService.openForExhaustedOrder.mockResolvedValue(true);
    const order = system2Order(25_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(bookingGuaranteeService.openForExhaustedOrder).toHaveBeenCalledTimes(1);
    expect(cancelledWith()).toBeUndefined();
    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(0);
  });

  it("a customer cancel between laps stops the search: no more driver queries, no cancel write", async () => {
    const order = system2Order(120_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    dispatchManager.stopDispatch(order.id, "cancelled_by_user");
    const queriesAtCancel = driverQueries();
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(driverQueries()).toBe(queriesAtCancel);
    expect(cancelledWith()).toBeUndefined();
  });

  it("a pending re-lap does nothing when the order was assigned in the meantime", async () => {
    const order = system2Order(120_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order, rid: 9, order_status: 1 });
    const queriesBefore = driverQueries();
    await jest.advanceTimersByTimeAsync(SEARCH_RETRY_MS + 5_000);
    await flush();
    expect(driverQueries()).toBe(queriesBefore);
    expect(cancelledWith()).toBeUndefined();
  });

  it("a System 1 order is unchanged: it cancels right after exhaustion with 'No driver found'", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...base });
    await dispatchManager.startDispatch({ ...base });
    await jest.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(cancelledWith()).toMatchObject({ cancel_reason: "No driver found" });
    expect(emitted.find((e) => e.event === "order:no_driver_found").payload.reason).toBeUndefined();
  });
});

describe("finishSearchWindow", () => {
  it("returns held:true when a guarantee case takes the order", async () => {
    bookingGuaranteeService.openForExhaustedOrder.mockResolvedValue(true);
    const out = await dispatchManager.finishSearchWindow({ ...base, search_system: 2 });
    expect(out).toEqual({ held: true });
    expect(bookingGuaranteeService.openForExhaustedOrder).toHaveBeenCalledWith(expect.objectContaining({ id: 601 }), [6]);
  });

  it("falls through to the cancel when opening the case throws", async () => {
    bookingGuaranteeService.openForExhaustedOrder.mockRejectedValue(new Error("table missing"));
    const out = await dispatchManager.finishSearchWindow({ ...base, search_system: 2 });
    expect(out).toEqual({ held: false });
    expect(cancelledWith()).toMatchObject({ cancel_reason: "Driver is not available" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.system2.test.js`
Expected: FAIL (`dispatchManager.finishSearchWindow is not a function`; the System 2 order cancels immediately).

- [ ] **Step 3: Implement**

3a. Requires at the top of `dispatchManager.js` (next to the other service requires; add `SEARCH_RETRY_MS` to the existing destructured `require("../config/constants")` import):

```js
const orderSearchRules = require("./orderSearchRules");
```

3b. Add a tiers helper and the re-lap timers above `startDispatch`:

```js
function parseTiers(order) {
  try {
    const parsed = JSON.parse(order.allowed_delivery_types);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [order.delivery_type];
  } catch {
    return [order.delivery_type];
  }
}

// System 2 (spec 2026-10-12): the pause between two driver-search laps. Held outside activeDispatches so a
// customer cancel / accept (stopDispatch) can clear it.
const searchRelapTimers = new Map(); // orderId -> Timeout

function clearSearchRelap(orderId) {
  const timer = searchRelapTimers.get(orderId);
  if (timer) clearTimeout(timer);
  searchRelapTimers.delete(orderId);
}

function scheduleSearchRelap(order, stage, earlierRiderIds) {
  clearSearchRelap(order.id);
  const timer = setTimeout(async () => {
    searchRelapTimers.delete(order.id);
    try {
      const fresh = await prisma.pkg_order.findUnique({ where: { id: order.id } });
      // Accepted, assigned or cancelled while we were paused: nothing left to search for.
      if (!fresh || fresh.rid !== 0 || fresh.order_status !== 0 || fresh.o_status === "Cancelled") return;
      if (!orderSearchRules.hasSearchTimeLeft(fresh)) {
        await finishSearchWindow(fresh);
        return;
      }
      await startDispatch(fresh, null, { stage, earlierStageRiderIds: earlierRiderIds });
    } catch (err) {
      logger.error(`dispatchManager: search re-lap failed for order ${order.id}:`, err);
    }
  }, SEARCH_RETRY_MS);
  searchRelapTimers.set(order.id, timer);
}
```

3c. Add `finishSearchWindow` (above `checkCascadeTermination`). It is the old tail of `checkCascadeTermination` (guarantee, then cancel) moved into a function:

```js
/**
 * The search is over and nobody accepted: hold the order for the Booking Guarantee admin window if the
 * city enabled it (and the customer is not locked), otherwise cancel it. Used by the cascade ending and by
 * the System 2 deadline and the startup resume. { held: true } = the guarantee case owns the order now.
 */
async function finishSearchWindow(order, tiers) {
  const orderId = order.id;
  const system2 = orderSearchRules.isSystem2Order(order);
  const tierList = Array.isArray(tiers) && tiers.length > 0 ? tiers : parseTiers(order);

  // Booking Guarantee (spec 2026-10-07): a failure here falls through to the cancel below, so a missing
  // table or an outage can never strand an order.
  let heldForGuarantee = false;
  try {
    heldForGuarantee = await require("./bookingGuaranteeService").openForExhaustedOrder(order, tierList);
  } catch (err) {
    logger.error(`dispatchManager: booking guarantee open failed for order ${orderId}:`, err);
  }
  if (heldForGuarantee) return { held: true };

  try {
    adminSocket.notifyDispatchAlert(orderId, order.city_id);
  } catch (adminErr) {
    logger.error(`dispatchManager: admin socket notify failed for order ${orderId}:`, adminErr);
  }

  await prisma.pkg_order.update({
    where: { id: orderId },
    data: { o_status: "Cancelled", cancel_reason: system2 ? "Driver is not available" : "No driver found", order_status: 4 },
  });
  // The customer never got a ride: give back a wallet-prepaid fare.
  await walletPrepayment.refundIfWalletPaid(order, { note: "no driver found" });
  await refundReferralPointsForOrder(orderId);
  requireIo().to(`customer_${order.uid}`).emit("order:no_driver_found", {
    order_id: String(orderId),
    ...(system2 ? { reason: "driver_not_available" } : {}),
  });

  const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { fcm_token: true } });
  await pushNotifier.notifyCustomerNoDriverFound(customer?.fcm_token, orderId);
  return { held: false };
}
```

3d. In `checkCascadeTermination`:

Replace the `isExhausted` declaration with:

```js
  const isExhausted =
    (state.searchExpired || state.consecutiveEmptyTurns >= state.tiers.length || (state.staleLaps || 0) >= 1) &&
    (state.activeExpiryTimers || 0) === 0;
```

After the `if (continueAsNormal) { ... return; }` block (free-booking fallback) and BEFORE the old `// Booking Guarantee (spec 2026-10-07)` block, insert the re-lap:

```js
    // System 2 (spec 2026-10-12): keep searching until the city's driver-search window closes. The next
    // lap only offers riders this order has not been offered to yet (so someone who came online meanwhile
    // is caught, and nobody is asked twice).
    if (!state.searchExpired && state.searchDeadlineAt && Date.now() < state.searchDeadlineAt.getTime()) {
      const offeredSoFar = await orderStage.offeredRiderIds(orderId);
      for (const t of state.timers) clearTimeout(t);
      state.timers.clear();
      activeDispatches.delete(orderId);
      scheduleSearchRelap(order, state.stage, offeredSoFar);
      return;
    }
```

Then delete the old guarantee block and the old admin-alert + cancel + refund + emit + push statements that follow it (everything from `// Booking Guarantee (spec 2026-10-07): instead of cancelling...` down to and including `await pushNotifier.notifyCustomerNoDriverFound(customer?.fcm_token, orderId);`) and replace them with:

```js
    const { held } = await finishSearchWindow(order, state.tiers);
    if (held) {
      for (const t of state.timers) clearTimeout(t);
      state.timers.clear();
      activeDispatches.delete(orderId);
      return;
    }
```

The trailing `activeDispatches.delete(orderId);` at the end of the function stays.

3e. In `runBatchInner`, directly after `if (!state) return; // stopDispatch already ran (accepted/cancelled)`:

```js
  // System 2: the search window is over, so no new offers; popups already live finish on their own and
  // the last one to resolve ends the cascade through checkCascadeTermination.
  if (state.searchDeadlineAt && Date.now() >= state.searchDeadlineAt.getTime()) {
    state.searchExpired = true;
    if ((state.activeExpiryTimers || 0) === 0) await checkCascadeTermination(orderId);
    return;
  }
```

3f. In `startDispatch`: replace the inline `let tiers; try { ... } catch { ... }` with `const tiers = parseTiers(order);`. Add to the `state` object literal:

```js
    // System 2 (spec 2026-10-12): the driver-search window; null for every other order.
    searchDeadlineAt: orderSearchRules.isSystem2Order(order) && order.search_deadline_at ? new Date(order.search_deadline_at) : null,
    searchExpired: false,
```

and after `activeDispatches.set(order.id, state);` (before `runBatch(...)`):

```js
  clearSearchRelap(order.id);
  if (state.searchDeadlineAt) {
    // Wake the cascade at the deadline even if nothing else is scheduled by then.
    const wake = setTimeout(() => {
      state.timers.delete(wake);
      runBatch(order.id).catch((err) => logger.error(`dispatchManager: deadline wake failed for order ${order.id}:`, err));
    }, Math.max(0, state.searchDeadlineAt.getTime() - Date.now()));
    state.timers.add(wake);
  }
```

3g. In `stopDispatch(orderId, reason)`, as the first statement: `clearSearchRelap(orderId);`. In `_resetForTests()` add before `activeDispatches.clear();`:

```js
  for (const timer of searchRelapTimers.values()) clearTimeout(timer);
  searchRelapTimers.clear();
```

3h. Export `finishSearchWindow` in `module.exports`.

- [ ] **Step 4: Run the new test and the whole dispatch suite**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager`
Expected: PASS for `dispatchManager.system2.test.js` and all of `dispatchManager.test.js` (including the Booking Guarantee held/throws tests, the free-booking fallback tests and the tiered stages tests). If a timing assertion in the new file fails, adjust the `advanceTimersByTimeAsync` amounts in the test, not the implementation, as long as the outcome (cancel reason, hold, no further queries) is what the failing assertion names.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.system2.test.js
git commit -m "feat(system2): driver search window with re-laps and a single finish step

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Startup recovery for System 2 orders

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (`reconcileStaleOffersOnStartup` at ~line 1394; add `resumeSystem2Searches`)
- Test: `backend/src/services/__tests__/dispatchManager.system2.test.js` (append)

**Interfaces:**
- Consumes: `finishSearchWindow` (Task 6), `startDispatch`, `orderStage.offeredRiderIds`.
- Produces: startup reconciliation never cancels a System 2 order; `resumeSystem2Searches()` continues or finishes each one.

- [ ] **Step 1: Append the failing tests**

```js
describe("startup recovery of System 2 orders", () => {
  const sqlText = (call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0]));

  it("the stale-order cancel and its refund select both skip System 2 orders", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(0);
    await dispatchManager.reconcileStaleOffersOnStartup();
    const cancelSql = prisma.$executeRaw.mock.calls.map(sqlText).find((s) => s.includes("No driver found (recovered after restart)"));
    const selectSql = prisma.$queryRaw.mock.calls.map(sqlText).find((s) => s.includes("p_method_id = -2"));
    expect(cancelSql).toContain("search_system");
    expect(selectSql).toContain("search_system");
  });

  it("resumes the search for an order whose deadline is still ahead", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockImplementation(async (strings) => (sqlText([strings]).includes("search_system = 2") ? [{ id: 601 }] : []));
    prisma.pkg_order.findUnique.mockResolvedValue(system2Order(60_000));
    await dispatchManager.reconcileStaleOffersOnStartup();
    await flush();
    expect(cancelledWith()).toBeUndefined();
    expect(bookingGuaranteeService.openForExhaustedOrder).not.toHaveBeenCalled();
    expect(require("../orderStageService").offeredRiderIds).toHaveBeenCalledWith(601);
  });

  it("finishes an order whose deadline passed while the server was down", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockImplementation(async (strings) => (sqlText([strings]).includes("search_system = 2") ? [{ id: 601 }] : []));
    prisma.pkg_order.findUnique.mockResolvedValue(system2Order(-5_000));
    await dispatchManager.reconcileStaleOffersOnStartup();
    await flush();
    expect(cancelledWith()).toMatchObject({ cancel_reason: "Driver is not available" });
  });

  it("an order the customer or a driver already closed is left alone", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockImplementation(async (strings) => (sqlText([strings]).includes("search_system = 2") ? [{ id: 601 }] : []));
    prisma.pkg_order.findUnique.mockResolvedValue({ ...system2Order(-5_000), rid: 9, order_status: 1 });
    await dispatchManager.reconcileStaleOffersOnStartup();
    await flush();
    expect(cancelledWith()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.system2.test.js -t "startup recovery"`
Expected: FAIL (the SQL has no `search_system`; nothing resumes).

- [ ] **Step 3: Implement**

In `reconcileStaleOffersOnStartup`, add to BOTH the `staleWalletOrders` select and the `staleOrders` update, directly after the `AND booking_type NOT IN (2, 3)` line:

```sql
        AND (search_system IS NULL OR search_system <> 2)
```

(Use the same indentation as the neighbouring `AND` lines inside the tagged template.) Then, inside the same `try` block right after the `if (staleOrders > 0) { ... }` statement, add `await resumeSystem2Searches();` and define the function above `reconcileStaleOffersOnStartup`:

```js
/**
 * System 2 orders are owned by their search window, not by the stale-order sweep. After a restart: an order
 * still inside its window continues its search (never re-offering riders it already asked), and one whose
 * window ended while we were down is finished now (guarantee window or cancel), exactly once.
 */
async function resumeSystem2Searches() {
  const rows = await prisma.$queryRaw`
    SELECT id FROM pkg_order
    WHERE search_system = 2 AND o_status = 'Pending' AND rid = 0 AND order_status = 0
      AND booking_type NOT IN (2, 3)
      AND id NOT IN (SELECT order_id FROM booking_guarantee_case)
  `;
  for (const { id } of rows || []) {
    try {
      const order = await prisma.pkg_order.findUnique({ where: { id: Number(id) } });
      if (!order || order.rid !== 0 || order.order_status !== 0 || order.o_status === "Cancelled") continue;
      if (orderSearchRules.hasSearchTimeLeft(order)) {
        const offered = await orderStage.offeredRiderIds(order.id);
        await startDispatch(order, null, { earlierStageRiderIds: offered });
      } else {
        await finishSearchWindow(order);
      }
    } catch (err) {
      logger.error(`dispatchManager: resuming System 2 search for order ${id} failed:`, err);
    }
  }
}
```

- [ ] **Step 4: Run the dispatch suites**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager`
Expected: PASS (including the existing "startup reconciliation skips orders that have an open Booking Guarantee case").

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.system2.test.js
git commit -m "feat(system2): resume or finish System 2 searches after a restart

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Booking Guarantee: city gating, city window, lock, unlock

**Files:**
- Modify: `backend/src/services/bookingGuaranteeService.js`
- Modify: `backend/src/services/__tests__/bookingGuaranteeService.test.js` (add one mock, see Step 1)
- Test: `backend/src/services/__tests__/bookingGuaranteeCity.test.js` (create)

**Interfaces:**
- Consumes: `orderSearchSettings.getCitySettings` (Task 3); Prisma `tbl_user.guarantee_locked*` (Task 1).
- Produces:
  - `openForExhaustedOrder(order, selectedIds)` now returns `false` when the order's city has `guaranteeEnabled = false` or the customer is `guarantee_locked`; the case deadline uses `city.adminWindowMinutes ?? settings.getAssignWindowMinutes()`.
  - `expireCase` locks the customer (`guarantee_locked = true`, `guarantee_locked_at = now`) in the same transaction as a credit of amount > 0.
  - `unlockForReferral(userId) -> Promise<boolean>`; `setUserLock(userId, locked) -> Promise<void>`.

- [ ] **Step 1: Keep the existing guarantee tests green**

The existing file must see the guarantee as enabled for its city. In `bookingGuaranteeService.test.js`, directly under the existing `jest.mock("../bookingGuaranteeSettings", ...)` line add:

```js
jest.mock("../orderSearchSettings", () => ({
  getCitySettings: jest.fn().mockResolvedValue({
    searchSystem: 1, searchRadiusKm: null, driverSearchSeconds: 60, guaranteeEnabled: true, adminWindowMinutes: null, guaranteeReferralsRequired: 1,
  }),
}));
```

In the same file, two assertions check the credit's `tbl_user.update` payload and must now expect the lock too. Replace both (line 149 and line 230):

```js
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 100 } } });
```

with:

```js
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { wallet: { increment: 100 }, guarantee_locked: true, guarantee_locked_at: expect.any(Date) },
    });
```

- [ ] **Step 2: Write the failing test file**

```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn().mockResolvedValue({}) },
  tbl_package: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), updateMany: jest.fn() },
  order_status_history: { create: jest.fn().mockResolvedValue({}) },
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_referral: { count: jest.fn() },
}));
jest.mock("../bookingGuaranteeSettings", () => ({ getAssignWindowMinutes: jest.fn().mockResolvedValue(15) }));
jest.mock("../orderSearchSettings", () => ({ getCitySettings: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null) }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const orderSearchSettings = require("../orderSearchSettings");
const settings = require("../bookingGuaranteeSettings");
const adminSocket = require("../../sockets/adminSocket");
const svc = require("../bookingGuaranteeService");

const order = { id: 500, uid: 7, city_id: 3, rid: 0, order_status: 0 };
const city = (extra = {}) => ({
  searchSystem: 2, searchRadiusKm: null, driverSearchSeconds: 60, guaranteeEnabled: true, adminWindowMinutes: null, guaranteeReferralsRequired: 1, ...extra,
});
const caseRow = (o = {}) => ({
  id: 1, order_id: 500, uid: 7, status: "open", selected_package_ids: "[10]", compensation_package_id: 10,
  compensation_amount: "100.00", deadline_at: new Date("2026-10-12T10:00:00Z"), wallet_history_id: null, refunds_done_at: null, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
  prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
  orderSearchSettings.getCitySettings.mockResolvedValue(city());
});

describe("openForExhaustedOrder: city gating", () => {
  beforeEach(() => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  });

  it("does not open a case when the city has the guarantee off", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ guaranteeEnabled: false }));
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(false);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(3);
  });

  it("does not open a case for a guarantee-locked customer", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: true });
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(false);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("uses the city's admin window when set", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ adminWindowMinutes: 30 }));
    const before = Date.now();
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    const created = prisma.booking_guarantee_case.create.mock.calls[0][0].data;
    expect(Math.round((created.deadline_at.getTime() - before) / 60000)).toBe(30);
    expect(settings.getAssignWindowMinutes).not.toHaveBeenCalled();
  });

  it("falls back to the global window when the city has none", async () => {
    const before = Date.now();
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    const created = prisma.booking_guarantee_case.create.mock.calls[0][0].data;
    expect(Math.round((created.deadline_at.getTime() - before) / 60000)).toBe(15);
  });

  it("still returns true for a case that is already open", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ status: "open" });
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
  });
});

describe("expireCase: the lock", () => {
  function arrangeExpiry(amount) {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ compensation_amount: amount }));
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, city_id: 3 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7 });
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 99 });
    prisma.booking_guarantee_case.update.mockResolvedValue({});
  }

  it("locks the customer in the same step as a compensation credit", async () => {
    arrangeExpiry("100.00");
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { wallet: { increment: 100 }, guarantee_locked: true, guarantee_locked_at: expect.any(Date) },
    });
  });

  it("does not lock the customer when the compensation is zero", async () => {
    arrangeExpiry("0.00");
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("unlockForReferral", () => {
  const lockedAt = new Date("2026-10-12T09:00:00Z");
  beforeEach(() => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, guarantee_locked: true, guarantee_locked_at: lockedAt });
    prisma.tbl_user.updateMany.mockResolvedValue({ count: 1 });
  });

  it("does nothing for a customer who is not locked", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, guarantee_locked: false, guarantee_locked_at: null });
    expect(await svc.unlockForReferral(7)).toBe(false);
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });

  it("unlocks once enough referrals completed after the lock", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ guaranteeReferralsRequired: 2 }));
    prisma.tbl_referral.count.mockResolvedValue(2);
    expect(await svc.unlockForReferral(7)).toBe(true);
    expect(prisma.tbl_referral.count).toHaveBeenCalledWith({
      where: { referrer_id: 7, referrer_type: "USER", status: "completed", verified_at: { gte: lockedAt } },
    });
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({ where: { id: 7, guarantee_locked: true }, data: { guarantee_locked: false } });
  });

  it("stays locked while the count is below the city's requirement", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ guaranteeReferralsRequired: 2 }));
    prisma.tbl_referral.count.mockResolvedValue(1);
    expect(await svc.unlockForReferral(7)).toBe(false);
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });
});

describe("setUserLock", () => {
  it("locks with a timestamp", async () => {
    await svc.setUserLock(7, true);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { guarantee_locked: true, guarantee_locked_at: expect.any(Date) },
    });
  });

  it("unlocks", async () => {
    await svc.setUserLock(7, false);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { guarantee_locked: false } });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/bookingGuaranteeCity.test.js`
Expected: FAIL (`svc.unlockForReferral is not a function`, the gating cases open a case).

- [ ] **Step 4: Implement**

At the top of `bookingGuaranteeService.js` add `const orderSearchSettings = require("./orderSearchSettings");`.

Replace the start of `openForExhaustedOrder` (everything from `const existing = ...` through `const deadline = ...`) with:

```js
  const existing = await prisma.booking_guarantee_case.findUnique({ where: { order_id: order.id } });
  if (existing) return existing.status === STATUS.OPEN;

  // City-wise switch (spec 2026-10-12): the guarantee exists only where the city admin turned it on, and a
  // customer who already received a compensation stays locked out until their referrals are done.
  const city = await orderSearchSettings.getCitySettings(order.city_id);
  if (!city.guaranteeEnabled) return false;
  const customer = await prisma.tbl_user.findUnique({ where: { id: order.uid }, select: { guarantee_locked: true } });
  if (customer?.guarantee_locked) return false;

  const ids = toIds(selectedIds);
  const packages = ids.length ? await prisma.tbl_package.findMany({ where: { id: { in: ids } }, select: PACKAGE_SELECT }) : [];
  const { packageId, amount } = rules.computeGuaranteeCompensation(packages);
  const minutes = city.adminWindowMinutes ?? (await settings.getAssignWindowMinutes());
  const deadline = new Date(Date.now() + minutes * 60 * 1000);
```

In `expireCase`, replace the wallet-credit statement `await tx.tbl_user.update({ where: { id: row.uid }, data: { wallet: { increment: amount } } });` with:

```js
        // The compensation also locks the guarantee for this customer until their referrals are done.
        await tx.tbl_user.update({
          where: { id: row.uid },
          data: { wallet: { increment: amount }, guarantee_locked: true, guarantee_locked_at: new Date() },
        });
```

Add before `module.exports`:

```js
/**
 * A referral by this user just became successful. Unlocks a guarantee-locked customer once they have the
 * city's required number of successful referrals made since the lock (earlier ones never count).
 * True if the user was unlocked.
 */
async function unlockForReferral(userId) {
  const id = Number(userId);
  const user = await prisma.tbl_user.findUnique({
    where: { id },
    select: { city_id: true, guarantee_locked: true, guarantee_locked_at: true },
  });
  if (!user?.guarantee_locked) return false;
  const city = await orderSearchSettings.getCitySettings(user.city_id);
  const done = await prisma.tbl_referral.count({
    where: {
      referrer_id: id,
      referrer_type: "USER",
      status: "completed",
      ...(user.guarantee_locked_at ? { verified_at: { gte: user.guarantee_locked_at } } : {}),
    },
  });
  if (done < city.guaranteeReferralsRequired) return false;
  const res = await prisma.tbl_user.updateMany({ where: { id, guarantee_locked: true }, data: { guarantee_locked: false } });
  return res.count === 1;
}

/** Admin override: lock or unlock a customer's Booking Guarantee. */
async function setUserLock(userId, locked) {
  await prisma.tbl_user.update({
    where: { id: Number(userId) },
    data: locked ? { guarantee_locked: true, guarantee_locked_at: new Date() } : { guarantee_locked: false },
  });
}
```

and extend the exports: `STATUS, ALERT_MESSAGE, openForExhaustedOrder, closeOnAssign, closeOnCancel, expireCase, expireDue, quote, getView, unlockForReferral, setUserLock,`.

- [ ] **Step 5: Run the guarantee suites**

Run: `cd backend && npx jest src/services/__tests__/bookingGuarantee`
Expected: PASS for `bookingGuaranteeCity`, `bookingGuaranteeService`, `bookingGuaranteeRules` and `bookingGuaranteeSettings`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/bookingGuaranteeService.js backend/src/services/__tests__/bookingGuaranteeService.test.js backend/src/services/__tests__/bookingGuaranteeCity.test.js
git commit -m "feat(system2): city-wise booking guarantee with referral lock

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Unlock hook in the referral reward

**Files:**
- Modify: `backend/src/services/referralRewardService.js` (~line 54–58)
- Test: `backend/src/services/__tests__/referralRewardService.test.js` (append)

**Interfaces:**
- Consumes: `bookingGuaranteeService.unlockForReferral(userId)` (Task 8).

- [ ] **Step 1: Write the failing test**

In `referralRewardService.test.js`, directly under the existing line `const freeBookingService = require("../freeBookingService");` (line 18) add:

```js
jest.mock("../bookingGuaranteeService", () => ({ unlockForReferral: jest.fn().mockResolvedValue(false) }));
const bookingGuaranteeService = require("../bookingGuaranteeService");
```

Then, inside the same `describe` that holds the four existing unlock tests (the last test there ends at line 199, before the closing `});`), append:

```js
  it("also asks Booking Guarantee to unlock a USER referrer when the referral becomes successful", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(1);
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(bookingGuaranteeService.unlockForReferral).toHaveBeenCalledWith(10);
  });

  it("does not ask Booking Guarantee to unlock for a DRIVER referrer", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral({ referrer_type: "DRIVER" }));
    prisma.pkg_order.count.mockResolvedValue(1);
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(bookingGuaranteeService.unlockForReferral).not.toHaveBeenCalled();
  });

  it("does not ask Booking Guarantee to unlock when the referral was already claimed by another process", async () => {
    prisma.tbl_referral.findFirst.mockResolvedValue(baseReferral());
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral.updateMany.mockResolvedValue({ count: 0 });
    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });
    expect(bookingGuaranteeService.unlockForReferral).not.toHaveBeenCalled();
  });
```

(`baseReferral` and the mocks come from the top of that file; the existing tests in that `describe` already clear mocks between runs. If the new tests see calls left over from a previous test, add `bookingGuaranteeService.unlockForReferral.mockClear();` at the start of each of them.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/referralRewardService.test.js`
Expected: FAIL (`unlockForReferral` was not called).

- [ ] **Step 3: Implement**

In `referralRewardService.js`, replace the block

```js
    if (referral.referrer_type === "USER") {
      require("./freeBookingService").unlockForReferral(referral.referrer_id).catch((err) => {
        logger.error(`unlockForReferral failed for user ${referral.referrer_id}:`, err);
      });
    }
```

with:

```js
    if (referral.referrer_type === "USER") {
      require("./freeBookingService").unlockForReferral(referral.referrer_id).catch((err) => {
        logger.error(`unlockForReferral failed for user ${referral.referrer_id}:`, err);
      });
      // Booking Guarantee has its own lock and its own per-city referral count.
      require("./bookingGuaranteeService").unlockForReferral(referral.referrer_id).catch((err) => {
        logger.error(`guarantee unlockForReferral failed for user ${referral.referrer_id}:`, err);
      });
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/referralRewardService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/referralRewardService.js backend/src/services/__tests__/referralRewardService.test.js
git commit -m "feat(system2): unlock the booking guarantee when a referral completes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin API and routes

**Files:**
- Create: `backend/src/controllers/adminOrderSearchController.js`
- Modify: `backend/src/controllers/adminBookingGuaranteeController.js`
- Modify: `backend/src/routes/adminRoutes.js` (near line 130–133)
- Test: `backend/src/controllers/__tests__/adminOrderSearchController.test.js` (create), `backend/src/controllers/__tests__/adminBookingGuaranteeLock.test.js` (create)

**Interfaces:**
- Consumes: `orderSearchSettings.getCitySettings/saveCitySettings` (Task 3), `bookingGuaranteeService.setUserLock` (Task 8).
- Produces (all under `/api/admin`):
  - `GET /order-search/settings[?city_id=]` → `{ success, data: { search_system, search_radius_km, driver_search_seconds, guarantee_enabled, admin_window_minutes, guarantee_referrals_required } }` (roles `superadmin`, `admin`, `executive`)
  - `PUT /order-search/settings` (body: the same snake_case keys, plus `city_id` for superadmin; roles `superadmin`, `admin`)
  - `POST /booking-guarantee/users/:userId/lock` and `/unlock` (roles `superadmin`, `admin`)
  - `PUT /booking-guarantee/settings` (the global fallback window) becomes `superadmin` only.

- [ ] **Step 1: Write the failing tests**

`adminOrderSearchController.test.js`:

```js
jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn(), saveCitySettings: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const settings = require("../../services/orderSearchSettings");
const ctrl = require("../adminOrderSearchController");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const s = { searchSystem: 2, searchRadiusKm: 7, driverSearchSeconds: 90, guaranteeEnabled: true, adminWindowMinutes: 20, guaranteeReferralsRequired: 2 };
const wire = { search_system: 2, search_radius_km: 7, driver_search_seconds: 90, guarantee_enabled: true, admin_window_minutes: 20, guarantee_referrals_required: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  settings.getCitySettings.mockResolvedValue(s);
  settings.saveCitySettings.mockResolvedValue(s);
});

describe("getSettings", () => {
  it("a city admin reads their own city, ignoring any city_id they send", async () => {
    const r = res();
    await ctrl.getSettings({ user: { role: "admin", city_id: 3 }, query: { city_id: "9" } }, r);
    expect(settings.getCitySettings).toHaveBeenCalledWith(3, { fresh: true });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: wire });
  });

  it("a superadmin reads the city they ask for", async () => {
    const r = res();
    await ctrl.getSettings({ user: { role: "superadmin" }, query: { city_id: "9" } }, r);
    expect(settings.getCitySettings).toHaveBeenCalledWith(9, { fresh: true });
  });

  it("a superadmin without a city_id gets a 400", async () => {
    const r = res();
    await ctrl.getSettings({ user: { role: "superadmin" }, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(settings.getCitySettings).not.toHaveBeenCalled();
  });

  it.each([{ role: "admin", city_id: null }, { role: "executive" }])("a non-superadmin with no city (%j) gets a 403", async (user) => {
    const r = res();
    await ctrl.getSettings({ user, query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(settings.getCitySettings).not.toHaveBeenCalled();
  });
});

describe("saveSettings", () => {
  it("a city admin saves to their own city even if the body names another", async () => {
    const r = res();
    await ctrl.saveSettings({ user: { id: 11, role: "admin", city_id: 3 }, query: {}, body: { city_id: 9, search_system: 2, driver_search_seconds: 90, guarantee_enabled: true } }, r);
    expect(settings.saveCitySettings).toHaveBeenCalledWith({
      cityId: 3,
      input: { searchSystem: 2, searchRadiusKm: undefined, driverSearchSeconds: 90, guaranteeEnabled: true, adminWindowMinutes: undefined, guaranteeReferralsRequired: undefined },
      adminId: 11,
    });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: wire }));
  });

  it("a superadmin saves to the city in the body", async () => {
    const r = res();
    await ctrl.saveSettings({ user: { id: 1, role: "superadmin" }, query: {}, body: { city_id: 9, search_system: 1 } }, r);
    expect(settings.saveCitySettings).toHaveBeenCalledWith(expect.objectContaining({ cityId: 9, adminId: 1 }));
  });

  it("a validation error from the service is returned as its status code", async () => {
    settings.saveCitySettings.mockRejectedValue(Object.assign(new Error("driver_search_seconds must be a whole number between 15 and 600"), { statusCode: 400 }));
    const r = res();
    await ctrl.saveSettings({ user: { id: 1, role: "admin", city_id: 3 }, query: {}, body: { driver_search_seconds: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ success: false, message: "driver_search_seconds must be a whole number between 15 and 600" });
  });
});
```

`adminBookingGuaranteeLock.test.js`:

```js
jest.mock("../../config/db", () => ({ tbl_user: { findUnique: jest.fn() } }));
jest.mock("../../services/bookingGuaranteeService", () => ({ setUserLock: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../services/bookingGuaranteeSettings", () => ({}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const guarantee = require("../../services/bookingGuaranteeService");
const ctrl = require("../adminBookingGuaranteeController");

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
beforeEach(() => jest.clearAllMocks());

describe("lockUser / unlockUser", () => {
  it("a city admin can lock a customer of their own city", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 3 });
    const r = res();
    await ctrl.lockUser({ user: { role: "admin" }, scopedCityId: 3, params: { userId: "7" } }, r);
    expect(guarantee.setUserLock).toHaveBeenCalledWith(7, true);
    expect(r.json).toHaveBeenCalledWith({ success: true, message: "Customer locked" });
  });

  it("a city admin cannot touch a customer of another city", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    const r = res();
    await ctrl.unlockUser({ user: { role: "admin" }, scopedCityId: 3, params: { userId: "7" } }, r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(guarantee.setUserLock).not.toHaveBeenCalled();
  });

  it("a superadmin can unlock any customer", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, city_id: 4 });
    const r = res();
    await ctrl.unlockUser({ user: { role: "superadmin" }, scopedCityId: undefined, params: { userId: "7" } }, r);
    expect(guarantee.setUserLock).toHaveBeenCalledWith(7, false);
  });

  it("rejects a bad id and an unknown customer", async () => {
    const bad = res();
    await ctrl.lockUser({ user: { role: "superadmin" }, params: { userId: "abc" } }, bad);
    expect(bad.status).toHaveBeenCalledWith(400);
    prisma.tbl_user.findUnique.mockResolvedValue(null);
    const none = res();
    await ctrl.lockUser({ user: { role: "superadmin" }, params: { userId: "7" } }, none);
    expect(none.status).toHaveBeenCalledWith(404);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/controllers/__tests__/adminOrderSearchController.test.js src/controllers/__tests__/adminBookingGuaranteeLock.test.js`
Expected: FAIL (`Cannot find module '../adminOrderSearchController'`, `ctrl.lockUser is not a function`).

- [ ] **Step 3: Implement the controller**

`backend/src/controllers/adminOrderSearchController.js`:

```js
const logger = require("../utils/logger");
const settings = require("../services/orderSearchSettings");

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminOrderSearch.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// Superadmin names the city; everyone else is pinned to their own and refused (403) if they have none.
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

const toApi = (s) => ({
  search_system: s.searchSystem,
  search_radius_km: s.searchRadiusKm,
  driver_search_seconds: s.driverSearchSeconds,
  guarantee_enabled: s.guaranteeEnabled,
  admin_window_minutes: s.adminWindowMinutes,
  guarantee_referrals_required: s.guaranteeReferralsRequired,
});

const fromBody = (b = {}) => ({
  searchSystem: b.search_system,
  searchRadiusKm: b.search_radius_km,
  driverSearchSeconds: b.driver_search_seconds,
  guaranteeEnabled: b.guarantee_enabled,
  adminWindowMinutes: b.admin_window_minutes,
  guaranteeReferralsRequired: b.guarantee_referrals_required,
});

async function getSettings(req, res) {
  try {
    const current = await settings.getCitySettings(cityOf(req), { fresh: true });
    return res.json({ success: true, data: toApi(current) });
  } catch (e) {
    return fail(res, e, "getSettings");
  }
}

async function saveSettings(req, res) {
  try {
    const saved = await settings.saveCitySettings({ cityId: cityOf(req), input: fromBody(req.body), adminId: req.user?.id });
    return res.json({ success: true, message: "Order search settings saved", data: toApi(saved) });
  } catch (e) {
    return fail(res, e, "saveSettings");
  }
}

module.exports = { getSettings, saveSettings };
```

In `adminBookingGuaranteeController.js` add `const bookingGuarantee = require("../services/bookingGuaranteeService");` to the requires and, above `module.exports`:

```js
async function setLock(req, res, locked) {
  try {
    const { cityId } = scopeOf(req);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ success: false, message: "userId must be a valid id" });
    }
    const user = await prisma.tbl_user.findUnique({ where: { id: userId }, select: { id: true, city_id: true } });
    if (!user) return res.status(404).json({ success: false, message: "Customer not found" });
    if (cityId !== null && Number(user.city_id) !== cityId) {
      return res.status(403).json({ success: false, message: "This customer belongs to another city" });
    }
    await bookingGuarantee.setUserLock(userId, locked);
    return res.json({ success: true, message: locked ? "Customer locked" : "Customer unlocked" });
  } catch (e) {
    return fail(res, e, locked ? "lockUser" : "unlockUser");
  }
}
const lockUser = (req, res) => setLock(req, res, true);
const unlockUser = (req, res) => setLock(req, res, false);
```

and export them: `module.exports = { getSettings, saveSettings, listCases, caseAudit, lockUser, unlockUser };`.

- [ ] **Step 4: Wire the routes**

In `adminRoutes.js`, add `const adminOrderSearchController = require("../controllers/adminOrderSearchController");` with the other controller requires, then replace the `PUT /booking-guarantee/settings` line and add the new routes:

```js
// The global fallback window affects every city: superadmin only. A city sets its own in /order-search/settings.
router.put("/booking-guarantee/settings", auth, authorize("superadmin"), adminBookingGuaranteeController.saveSettings);
router.post("/booking-guarantee/users/:userId/lock", auth, authorize("superadmin", "admin"), scopeFilter, adminBookingGuaranteeController.lockUser);
router.post("/booking-guarantee/users/:userId/unlock", auth, authorize("superadmin", "admin"), scopeFilter, adminBookingGuaranteeController.unlockUser);

// System 2 / city-wise Booking Guarantee settings (spec 2026-10-12): city admins edit their own city only.
router.get("/order-search/settings", auth, authorize(...RIDER_ROLES), adminOrderSearchController.getSettings);
router.put("/order-search/settings", auth, authorize("superadmin", "admin"), adminOrderSearchController.saveSettings);
```

- [ ] **Step 5: Run the controller tests and the route/security tests**

Run: `cd backend && npx jest src/controllers/__tests__/adminOrderSearchController.test.js src/controllers/__tests__/adminBookingGuaranteeLock.test.js src/routes`
Expected: PASS. If a routes test enumerates mounted routes or role lists, add the new routes to its expectation in the same style.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminOrderSearchController.js backend/src/controllers/adminBookingGuaranteeController.js backend/src/routes/adminRoutes.js backend/src/controllers/__tests__/adminOrderSearchController.test.js backend/src/controllers/__tests__/adminBookingGuaranteeLock.test.js
git commit -m "feat(system2): city-scoped order search settings API and guarantee lock actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Admin panel

**Files:**
- Create: `frontend/src/pages/OrderSearchSettings.jsx`
- Modify: `frontend/src/App.jsx` (lazy import near line 58, route near line 101), `frontend/src/config/navigation.js` (entry after the Booking Guarantee line ~68), `frontend/src/pages/BookingGuarantee.jsx`

**Interfaces:**
- Consumes: the Task 10 endpoints. `api` has base URL `/api/admin`; responses are `{ success, data }`.

- [ ] **Step 1: Create the settings page**

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Radar } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const inputClass = 'mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const SECONDS_PRESETS = [30, 60, 120, 180]

const EMPTY = {
  search_system: '1',
  search_radius_km: '',
  driver_search_seconds: '60',
  guarantee_enabled: false,
  admin_window_minutes: '',
  guarantee_referrals_required: '1',
}

const fromApi = (d) => ({
  search_system: String(d.search_system ?? 1),
  search_radius_km: d.search_radius_km != null ? String(d.search_radius_km) : '',
  driver_search_seconds: String(d.driver_search_seconds ?? 60),
  guarantee_enabled: Boolean(d.guarantee_enabled),
  admin_window_minutes: d.admin_window_minutes != null ? String(d.admin_window_minutes) : '',
  guarantee_referrals_required: String(d.guarantee_referrals_required ?? 1),
})

export default function OrderSearchSettings() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user, hasRole } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const canWrite = hasRole('superadmin', 'admin')

  const [cities, setCities] = useState([])
  const [cityId, setCityId] = useState(isSuper ? '' : String(user?.city_id ?? ''))
  useEffect(() => {
    if (user && user.role !== 'superadmin') setCityId(String(user.city_id ?? ''))
  }, [user])

  const [form, setForm] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const cityRef = useRef(cityId)
  useEffect(() => { cityRef.current = cityId }, [cityId])

  useEffect(() => {
    if (!isSuper) return
    api.get('/cities')
      .then((res) => setCities(res.data?.data || res.data || []))
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load cities')))
  }, [isSuper])

  const params = useCallback(() => (isSuper ? { city_id: cityId } : {}), [isSuper, cityId])

  useEffect(() => {
    setLoaded(false)
    setForm(EMPTY)
    if (!cityId) return
    const sentCity = cityId
    api.get('/order-search/settings', { params: params() })
      .then((res) => {
        if (cityRef.current !== sentCity) return // the admin switched city meanwhile: drop this answer
        setForm(fromApi(res.data.data))
        setLoaded(true)
      })
      .catch((err) => toastRef.current.error(errMsg(err, 'Could not load settings')))
  }, [cityId, params])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    setSaving(true)
    try {
      const body = { ...form, ...(isSuper ? { city_id: Number(cityId) } : {}) }
      const res = await api.put('/order-search/settings', body)
      setForm(fromApi(res.data.data))
      toastRef.current.success('Order search settings saved')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const system2 = form.search_system === '2'
  const disabled = !canWrite || !loaded

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radar size={22} style={{ color: 'var(--ink)' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>Order Search System</h1>
        </div>
        {isSuper && (
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className={inputClass} style={{ ...inputStyle, width: 220, marginTop: 0 }}>
            <option value="">Select a city…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.title || c.name}</option>)}
          </select>
        )}
      </div>

      <div className="rounded-2xl border p-4 text-xs space-y-1" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
        <div><b>System 1 (Driver Availability):</b> a vehicle is shown, and can be booked, only when a driver is available near the pickup.</div>
        <div><b>System 2 (Vehicle Category First):</b> every vehicle category registered in the city is shown. The driver search starts after the customer confirms the order and runs for the driver search time below.</div>
      </div>

      {!cityId && <div className="text-sm" style={{ color: 'var(--ink-faint)' }}>Select a city to see its settings.</div>}

      {cityId && (
        <div className="surface-card rounded-xl p-4 space-y-4">
          <div>
            <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="search_system">Order search system</label>
            <select id="search_system" value={form.search_system} onChange={set('search_system')} disabled={disabled} className={inputClass} style={inputStyle}>
              <option value="1">System 1 – Driver Availability Based</option>
              <option value="2">System 2 – Vehicle Category First</option>
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="search_radius_km">Search radius (km, 1–30)</label>
              <input id="search_radius_km" type="number" min="1" max="30" step="0.5" value={form.search_radius_km} onChange={set('search_radius_km')} disabled={disabled} placeholder="Default (10)" className={inputClass} style={inputStyle} />
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Used for System 2 orders only. Leave empty for the default.</p>
            </div>
            <div>
              <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="driver_search_seconds">Driver search time (seconds, 15–600)</label>
              <input id="driver_search_seconds" type="number" min="15" max="600" step="1" value={form.driver_search_seconds} onChange={set('driver_search_seconds')} disabled={disabled} className={inputClass} style={inputStyle} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SECONDS_PRESETS.map((s) => (
                  <button key={s} type="button" disabled={disabled} onClick={() => setForm((f) => ({ ...f, driver_search_seconds: String(s) }))} className="rounded-lg border px-2 py-1 text-[12px] disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>{s}s</button>
                ))}
              </div>
              {!system2 && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Only applies once System 2 is selected.</p>}
            </div>
          </div>

          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={form.guarantee_enabled} onChange={set('guarantee_enabled')} disabled={disabled} />
              Booking Guarantee active in this city
            </label>
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              When no driver is found in the search time, the order is held so an admin can arrange a vehicle. If that also fails, the customer is compensated and the guarantee locks until they complete the referrals below.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="admin_window_minutes">Admin arrangement time (minutes)</label>
                <input id="admin_window_minutes" type="number" min="1" max="1440" step="1" value={form.admin_window_minutes} onChange={set('admin_window_minutes')} disabled={disabled || !form.guarantee_enabled} placeholder="Default (global setting)" className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="guarantee_referrals_required">Referrals needed to unlock</label>
                <input id="guarantee_referrals_required" type="number" min="1" step="1" value={form.guarantee_referrals_required} onChange={set('guarantee_referrals_required')} disabled={disabled || !form.guarantee_enabled} className={inputClass} style={inputStyle} />
              </div>
            </div>
          </div>

          {canWrite && (
            <button type="button" onClick={save} disabled={saving || !loaded} className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <p className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Changes apply to new orders only; orders already searching keep the time they started with.</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the route and the menu entry**

In `App.jsx` under `const BookingGuarantee = lazy(...)` add `const OrderSearchSettings = lazy(() => import('./pages/OrderSearchSettings'))`, and under the `/booking-guarantee` route add `<Route path="/order-search" element={<OrderSearchSettings />} />`.

In `navigation.js`, directly after the `'/booking-guarantee'` entry add:

```js
      { to: '/order-search', label: 'Order Search System', icon: Radar, roles: ALL_STAFF, built: true },
```

(`Radar` is already imported at the top of that file.)

- [ ] **Step 3: Booking Guarantee page: global window for superadmin only, plus the lock card**

In `BookingGuarantee.jsx` change the role lines to:

```jsx
  const { hasRole } = useAuth()
  const canWrite = hasRole('superadmin', 'admin')
  const isSuper = hasRole('superadmin')
  const [lockUserId, setLockUserId] = useState('')
  const [lockBusy, setLockBusy] = useState(false)
```

In the settings card, change the label to `Default admin assignment time (minutes)`, make the input `disabled={!isSuper}`, show the Save button only when `isSuper`, and change the helper line to: `Used by cities that do not set their own time in Order Search System. Applies to new cases only; cases already open keep their own deadline.`

Add the handler next to `save`:

```jsx
  async function setLock(locked) {
    const id = lockUserId.trim()
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      toastRef.current.error('Enter a valid customer id')
      return
    }
    setLockBusy(true)
    try {
      const res = await api.post(`/booking-guarantee/users/${id}/${locked ? 'lock' : 'unlock'}`)
      toastRef.current.success(res.data?.message || (locked ? 'Customer locked' : 'Customer unlocked'))
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not update the customer'))
    } finally {
      setLockBusy(false)
    }
  }
```

and, directly after the settings card `</div>`, the lock card:

```jsx
      {canWrite && (
        <div className="surface-card mt-4 rounded-xl p-4">
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="lock_user_id">Customer id</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input id="lock_user_id" value={lockUserId} onChange={(e) => setLockUserId(e.target.value)} className="w-40 rounded-xl border px-3.5 py-2.5 text-sm outline-none" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }} />
            <button type="button" disabled={lockBusy} onClick={() => setLock(true)} className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Lock guarantee</button>
            <button type="button" disabled={lockBusy} onClick={() => setLock(false)} className="rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>Unlock guarantee</button>
          </div>
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>A customer is locked automatically after a compensation and unlocked by the referrals set for the city. Use this only to override.</p>
        </div>
      )}
```

Also add `expired_compensated`'s neighbours in `EVENT_LABEL` is not needed (no new events).

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: the build completes without errors. (If the project has a lint script, also run `npm run lint` and fix anything in the files above.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/OrderSearchSettings.jsx frontend/src/App.jsx frontend/src/config/navigation.js frontend/src/pages/BookingGuarantee.jsx
git commit -m "feat(system2): admin panel for order search system and guarantee lock

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Customer app waiting screen

**Files:**
- Modify: `ShifterOnline/lib/utils/booking_guarantee.dart`
- Modify: `ShifterOnline/lib/screens/home/waiting_screen.dart`

**Interfaces:**
- Consumes: order details `search: { system, deadline_at, guarantee }` (Task 5) and the `order:no_driver_found` payload `reason: "driver_not_available"` (Task 6). `select_vehicle.dart` needs no change: it already enables a category when the response row says `available: true` (`_isAvailable`), which the backend now sends for System 2 cities.

- [ ] **Step 1: Add the message helper**

Append to `booking_guarantee.dart`:

```dart
/// System 2 (Vehicle Category First): the search window ended with nobody found and no guarantee compensation.
const String driverNotAvailableMessage = 'Driver is not available.';

/// Shown while a locked customer waits: the guarantee will not apply to this order.
const String guaranteeLockedLine = 'Booking Guarantee is locked. Complete your referrals to unlock it.';
```

- [ ] **Step 2: Search window state and countdown**

In `waiting_screen.dart` add to the state fields (next to `_guaranteePending`):

```dart
  bool _searchSystem2 = false;
  bool _guaranteeLocked = false;
```

Add above `_startTimeout`:

```dart
  // Extra seconds past the search deadline before the safety timer gives up, so the server's own
  // guarantee / "Driver is not available" event always arrives first.
  static const int _searchGraceSeconds = 30;

  /// System 2: replace the fixed 130 s safety timer with the order's real search deadline.
  void _applySearchWindow(Map<String, dynamic> search) {
    if (_isDisposed || _guaranteePending) return;
    if (search['system']?.toString() != '2') return;
    final deadline = DateTime.tryParse(search['deadline_at']?.toString() ?? '');
    if (deadline == null) return;
    final seconds = deadline.difference(DateTime.now()).inSeconds + _searchGraceSeconds;
    if (seconds <= 0) return;
    _timeoutTimer?.cancel();
    _countdownTicker?.cancel();
    _timeoutSet = false;
    _persistWaitingOrder(DateTime.now().millisecondsSinceEpoch + seconds * 1000);
    setState(() {
      _searchSystem2 = true;
      _guaranteeLocked = search['guarantee']?.toString() == 'locked';
    });
    _startTimeout(seconds);
  }
```

In `_recoverActiveOrder`, directly after the `final guarantee = order['guarantee'];` block's closing brace of `if (guarantee is Map) { ... }`, add:

```dart
      final search = order['search'];
      if (search is Map) _applySearchWindow(Map<String, dynamic>.from(search));
```

(it must stay above the `if (riderId > 0 || ...)` hand-off so the screen only sets the countdown when it is staying.) In `initState`, after `_startTimeout(remaining);` add:

```dart
    // Learn the real search window (System 2) as soon as the screen opens.
    WidgetsBinding.instance.addPostFrameCallback((_) => _recoverActiveOrder());
```

- [ ] **Step 3: Messages**

Replace the `onNoDriverFound` toast line

```dart
      ApiWrapper.showToastMessage(noDriverMessage(parseGuaranteeAmount(data['compensation_amount'])).tr);
```

with:

```dart
      final notAvailable = data['reason']?.toString() == 'driver_not_available';
      ApiWrapper.showToastMessage(
        (notAvailable ? driverNotAvailableMessage : noDriverMessage(parseGuaranteeAmount(data['compensation_amount']))).tr,
      );
```

In the build method, change the countdown label `"Auto-closing in".tr` to:

```dart
                              (_searchSystem2 ? "Searching for a driver".tr : "Auto-closing in".tr),
```

(drop the `const` from that `Text`'s `style:` only if the analyzer complains; the style itself stays `const TextStyle(...)`.) Directly after the closing of the countdown `Column(...)` (the `else Column(` branch that ends before `const SizedBox(height: 20),`), add:

```dart
                        if (_guaranteeLocked && !_guaranteePending) ...[
                          const SizedBox(height: 12),
                          Text(
                            guaranteeLockedLine.tr,
                            style: const TextStyle(fontFamily: 'Gilroy_Medium', fontSize: 13, color: Colors.white70),
                            textAlign: TextAlign.center,
                          ),
                        ],
```

- [ ] **Step 4: Analyze**

Run: `cd ShifterOnline && flutter analyze lib/screens/home/waiting_screen.dart lib/utils/booking_guarantee.dart`
Expected: no new errors (existing infos/warnings are fine).

- [ ] **Step 5: Commit (force-add, the folder is gitignored)**

```bash
git add -f ShifterOnline/lib/utils/booking_guarantee.dart ShifterOnline/lib/screens/home/waiting_screen.dart
git commit -m "feat(customer-app): System 2 search countdown and driver-not-available message

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Full verification and rollout (with the owner)

**Files:** none changed.

- [ ] **Step 1: Whole backend suite**

Run: `cd backend && npx jest`
Expected: all green except the known `src/utils/__tests__/aadharPdfVerify.test.js` (2 tests).

- [ ] **Step 2: Behaviour with everything off**

On the dev server, with no `city_order_settings` row for the test city, book an instant order with no driver nearby. Expected: the same as before this work (System 1: the vehicle is shown unavailable; if booked through the API, the cascade ends and the order cancels with "No driver found"; no Booking Guarantee case opens).

- [ ] **Step 3: Owner applies the migration**

Owner runs `backend/prisma/migrations/20261012010000_add_city_order_settings/migration.sql` by hand on each database, then `prisma migrate resolve --applied 20261012010000_add_city_order_settings`. The Booking Guarantee migration `20261007020000_add_booking_guarantee` (not applied anywhere yet) must be applied first on every database, since System 2 builds on its tables.

- [ ] **Step 4: Dev walkthrough (owner, in a test city)**

1. Order Search System page: choose System 2, search time 30 s, guarantee off. Save.
2. Customer app: every vehicle category is selectable with no drivers online. Book. The waiting screen counts down about 30 s (plus the grace). Result: "Driver is not available.", order cancelled with that reason, prepaid wallet fare refunded.
3. Turn the guarantee on with a 2-minute admin time. Book again with no driver. Result: the waiting screen switches to "We're arranging a driver…", admins of that city get the alert, other cities' admins do not. Assign a driver in time: normal trip. Let it expire: compensation credited and the customer is locked.
4. Book again as the locked customer: the waiting screen shows the locked note; at the deadline the order cancels with "Driver is not available." and no admin window opens.
5. Complete the required number of referrals for that customer: the guarantee unlocks (check the Booking Guarantee page or `tbl_user.guarantee_locked`).
6. Restart the backend during a System 2 search: the search continues (or finishes once if the deadline passed) and the order is not cancelled by the startup sweep.
7. A city admin cannot open or change another city's settings (use a second admin account).

- [ ] **Step 5: Report**

Record the results of Steps 1–4 for the owner. Do not push or deploy.

---

## Self-review notes

- **Spec coverage:** settings table and ranges (Tasks 1–3); vehicle list (Task 4); order snapshot, city radius, deadline (Task 5); search window, re-lap, no batch after the deadline, deadline outcome, "Driver is not available" (Task 6); restart safety (Task 7); guarantee city switch, city window, compensation unchanged, lock only on a credit > 0, unlock, manual lock (Tasks 8–10); locked user cancels without a window (Task 8 gating plus Task 6 finish); role matrix and alert scoping (Task 10, alerts already scoped by `broadcastToScope`); admin UI (Task 11); customer app (Task 12); rollout and walkthrough (Task 13). Tiered dispatch: the window spans all stages because the re-lap passes `state.stage` and only fires after the final stage is exhausted (the existing stage hand-off runs first in `checkCascadeTermination`).
- **Type consistency:** settings object keys (`searchSystem, searchRadiusKm, driverSearchSeconds, guaranteeEnabled, adminWindowMinutes, guaranteeReferralsRequired`) are identical in Tasks 2, 3, 4, 5, 8, 10; DB columns are the snake_case forms; `finishSearchWindow(order, tiers?) -> { held }` is used the same way in Tasks 6 and 7; `getSearchView` returns `{ system, deadline_at, guarantee }` in Tasks 3, 5 and 12.
- **Known judgment calls recorded for the reviewer:** (1) a System 2 order whose guarantee is off or whose customer is locked still gets the full search window and is then cancelled with "Driver is not available"; (2) re-laps never re-offer a rider the order already reached, so a rider who let a popup time out is not asked again; (3) the global `booking_guarantee_assign_minutes` stays as the fallback and becomes superadmin-only; (4) the Free Ride fixes are a separate spec and plan.
