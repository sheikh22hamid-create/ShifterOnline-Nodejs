# Next-Day Daily Driver Offer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin offer a next-day order (`booking_type=3`) to one Daily Driver at a time with automatic cascade on reject or timeout, auto-release the order to Normal Drivers at trip-day 14:00 IST, and pay a Daily Driver 90% of the fare on those orders.

**Architecture:** One new service (`nextDayOfferService`) owns offers, the cascade and the go-live step. Offers reuse the existing driver popup and accept path (`dispatchManager.offerToInterestedRiders` extended with defaulted options; `tripLifecycle.claimOrderForRider` unchanged). A 10-second sweeper reads only the DB (restart-safe) and reconciles offers (accepted / rejected / expired / cancelled) and performs go-live. One additive hook in `rejectOrder` makes a reject cascade instantly; one gated statement at trip completion applies the 90% earning.

**Tech Stack:** Node.js/Express, Prisma (MySQL, hand-applied migrations), Socket.IO, Jest (mocked prisma), React admin panel.

**Spec:** [docs/superpowers/specs/2026-10-13-next-day-daily-driver-offer-design.md](../specs/2026-10-13-next-day-daily-driver-offer-design.md)

## Global Constraints

- Current Booking (`booking_type=1`) and Schedule Booking (`booking_type=2`) behaviour must not change; every new branch is gated on `booking_type === 3`.
- Live time default `14:00` IST (trip day); offer timeout default `60` s; both stored in `app_settings` and admin-editable.
- Customer fare is never changed. Daily Driver earning = `round2(fare × 0.9)`; difference = `round2(fare − earning)` stored in `pkg_order.next_day_discount_amount`. A Normal Driver (order in `live` stage) earns 100%.
- Offer statuses: `offered | accepted | rejected | expired | cancelled` (a driver "skip" is a popup timeout, so it is `expired`; this folds the spec's `skipped` into `expired`).
- A driver is never offered the same order twice: unique `(order_id, rider_id)`.
- New columns/tables are hand-applied on dev and prod before deploy (see memory: schema drift causes P2022 500s).
- `dispatchManager.startDispatch` is called, not edited. `offerToInterestedRiders` gains an optional 5th `opts` argument whose defaults reproduce today's behaviour exactly.

## Spec refinements made while planning (read before Task 1)

1. **Earning is applied at completion, not at accept.** `tripLifecycle` rewrites `driver_earning` to the full fare at completion, so a value set at accept would be overwritten. The 90% is applied right after the Daily-Driver exemption check at completion (Task 5) and also shown in the offer popup (Task 4). `next_day_discount_amount` is therefore written at completion.
2. **Availability** = enrolled (`enrolled` or `active`) in `daily_driver_enrollment` for the trip date, `tbl_rider.status = 1`, vehicle equals order category, not already offered this order. The spec's "not in an active order" check is dropped: the trip is tomorrow, and a Daily Driver may hold several next-day orders.
3. **Force-assign to a Daily Driver** (existing `assignNextDayBatch`) also gets 90% automatically, because the rule is "Daily Driver on an `arranging` next-day order", applied at completion.
4. **Accept detection** is by the sweeper (`order.rid === offer.rider_id`), not a hook, so `finalizeAcceptedOrder` stays untouched.

## Review Focus

- Driver accepts at the exact moment the sweeper expires the offer → order must be assigned once, offer ends `accepted`, no second cascade offer (reconcile checks `order.rid` before expiry).
- Customer cancels, or admin force-assigns, while an offer is open → offer becomes `cancelled`/`accepted`, popup dismissed, no cascade.
- Every Daily Driver has rejected or timed out → admin alert, order stays `arranging`, goes live at 14:00 anyway.
- Go-live fires twice (two sweeper ticks, two processes) → exactly one `startDispatch` (conditional update).
- Daily Driver who accepts an order that already went `live` → full fare (no 10% cut).
- Non-next-day orders → untouched by the sweeper, reject hook and completion branch.

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` (modify) | `pkg_order` 3 columns + `next_day_daily_offer` model |
| `backend/prisma/migrations/20261013030000_add_next_day_daily_offer/migration.sql` (create) | the SQL for the above |
| `backend/src/services/nextDayRules.js` (create) | pure helpers: fare split, live-at, driver ranking |
| `backend/src/services/nextDaySettings.js` (create) | `app_settings` getters/setters for offer seconds and live time |
| `backend/src/services/nextDayOfferService.js` (create) | availability, offer, cascade, reconcile, go-live, sweep |
| `backend/src/services/dispatchManager.js` (modify `offerToInterestedRiders`) | optional `opts` |
| `backend/src/services/tripLifecycle.js` (modify) | reject hook; completion earning |
| `backend/src/controllers/orderController.js` (modify) | set stage and live-at at order creation |
| `backend/src/controllers/adminNextDayOfferController.js` (create) | admin endpoints |
| `backend/src/routes/adminRoutes.js` (modify) | routes |
| `backend/src/server.js`, `backend/src/config/constants.js` (modify) | sweeper wiring |
| `frontend/src/components/orders/NextDayOfferModal.jsx` (create), `frontend/src/pages/NextDayOrders.jsx` (modify) | admin UI |
| `backend/src/services/__tests__/nextDayRules.test.js`, `nextDayOfferService.test.js` (create) | tests |

---

### Task 1: Schema, migration and pure rules

**Files:**
- Modify: `backend/prisma/schema.prisma` (`pkg_order` model, end of file)
- Create: `backend/prisma/migrations/20261013030000_add_next_day_daily_offer/migration.sql`
- Create: `backend/src/services/nextDayRules.js`
- Test: `backend/src/services/__tests__/nextDayRules.test.js`

**Interfaces:**
- Produces: `nextDayRules.splitDailyDriverFare(fare) → { driverEarning, discount }` (numbers, 2 dp); `nextDayRules.parseLiveTime(value) → "HH:MM"` (default `"14:00"`); `nextDayRules.liveAtFor(scheduleDate, liveTime) → Date` (UTC instant of that IST wall time); `nextDayRules.rankByPickupDistance(order, riders) → riders[]` (nearest pickup first, no-location last); constants `DAILY_DRIVER_SHARE = 0.9`, `STAGE = { ARRANGING: "arranging", LIVE: "live" }`, `OFFER = {...}`.

- [ ] **Step 1: Write the failing test** — `backend/src/services/__tests__/nextDayRules.test.js`

```js
const rules = require("../nextDayRules");

describe("splitDailyDriverFare", () => {
  it("gives the Daily Driver 90% and records the 10% difference", () => {
    expect(rules.splitDailyDriverFare(100)).toEqual({ driverEarning: 90, discount: 10 });
  });
  it("rounds to 2 decimals and the two parts always add up to the fare", () => {
    const { driverEarning, discount } = rules.splitDailyDriverFare(133.37);
    expect(driverEarning).toBe(120.03);
    expect(Math.round((driverEarning + discount) * 100) / 100).toBe(133.37);
  });
  it("treats a bad fare as zero", () => {
    expect(rules.splitDailyDriverFare("abc")).toEqual({ driverEarning: 0, discount: 0 });
  });
});

describe("parseLiveTime", () => {
  it("accepts HH:MM", () => expect(rules.parseLiveTime("13:30")).toBe("13:30"));
  it("falls back to 14:00 for junk", () => {
    for (const v of [undefined, null, "", "2pm", "25:00", "14:60"]) expect(rules.parseLiveTime(v)).toBe("14:00");
  });
});

describe("liveAtFor", () => {
  it("is the IST wall time on the trip date, as a UTC instant", () => {
    expect(rules.liveAtFor("2026-10-13", "14:00").toISOString()).toBe("2026-10-13T08:30:00.000Z");
  });
  it("returns null for an unusable date", () => {
    expect(rules.liveAtFor("not-a-date", "14:00")).toBeNull();
  });
});

describe("rankByPickupDistance", () => {
  const order = { plat: "22.7196", plong: "75.8577" };
  it("orders nearest first and puts riders without a location last", () => {
    const riders = [
      { id: 1, rlats: "22.80", rlongs: "75.90" },
      { id: 2, rlats: null, rlongs: null },
      { id: 3, rlats: "22.72", rlongs: "75.86" },
    ];
    expect(rules.rankByPickupDistance(order, riders).map((r) => r.id)).toEqual([3, 1, 2]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/nextDayRules.test.js`
Expected: FAIL — `Cannot find module '../nextDayRules'`.

- [ ] **Step 3: Implement** — `backend/src/services/nextDayRules.js`

```js
// Pure rules for the Next-Day Daily Driver offer flow (spec 2026-10-13). No I/O.
const { haversineKm } = require("../utils/geoDistance");

const DAILY_DRIVER_SHARE = 0.9;
const DEFAULT_LIVE_TIME = "14:00";
const STAGE = Object.freeze({ ARRANGING: "arranging", LIVE: "live" });
const OFFER = Object.freeze({ OFFERED: "offered", ACCEPTED: "accepted", REJECTED: "rejected", EXPIRED: "expired", CANCELLED: "cancelled" });

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The Daily Driver's earning for a next-day order and the 10% difference admin settles. */
function splitDailyDriverFare(fare) {
  const total = round2(fare);
  const driverEarning = round2(total * DAILY_DRIVER_SHARE);
  return { driverEarning, discount: round2(total - driverEarning) };
}

function parseLiveTime(value) {
  return typeof value === "string" && TIME_RE.test(value.trim()) ? value.trim() : DEFAULT_LIVE_TIME;
}

/** UTC instant of `liveTime` (IST wall clock) on `scheduleDate` ("YYYY-MM-DD"); null when the date is unusable. */
function liveAtFor(scheduleDate, liveTime) {
  const date = String(scheduleDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = new Date(`${date}T${parseLiveTime(liveTime)}:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Nearest-to-pickup first; riders with no usable location go last (stable). */
function rankByPickupDistance(order, riders) {
  const plat = Number(order.plat);
  const plong = Number(order.plong);
  const keyed = riders.map((rider, index) => {
    const lat = Number(rider.rlats);
    const lng = Number(rider.rlongs);
    const known = rider.rlats != null && rider.rlongs != null && Number.isFinite(lat) && Number.isFinite(lng);
    return { rider, index, distance: known ? haversineKm(plat, plong, lat, lng) : Infinity };
  });
  keyed.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return keyed.map((k) => k.rider);
}

module.exports = { DAILY_DRIVER_SHARE, DEFAULT_LIVE_TIME, STAGE, OFFER, splitDailyDriverFare, parseLiveTime, liveAtFor, rankByPickupDistance };
```

Check `haversineKm` is exported: `grep -n "module.exports" backend/src/utils/geoDistance.js`. If it is not, add it to that export object.

- [ ] **Step 4: Add the schema and migration**

In `backend/prisma/schema.prisma`, inside `model pkg_order`, before the `@@index([rid, order_status]...)` line add:

```prisma
  next_day_live_at         DateTime? @db.DateTime(0)
  next_day_stage           String?   @db.VarChar(10)
  next_day_discount_amount Decimal?  @db.Decimal(10, 2)
```

At the end of the file add:

```prisma
// Next-day order offers to Daily Drivers (spec 2026-10-13). One row per (order, driver) offer.
model next_day_daily_offer {
  id               Int       @id @default(autoincrement())
  order_id         Int
  rider_id         Int
  status           String    @default("offered") @db.VarChar(12)
  offered_by_admin Int?
  offered_at       DateTime  @default(now()) @db.DateTime(0)
  expires_at       DateTime  @db.DateTime(0)
  responded_at     DateTime? @db.DateTime(0)

  @@unique([order_id, rider_id], map: "uniq_ndo_order_rider")
  @@index([order_id, status], map: "idx_ndo_order_status")
  @@index([status, expires_at], map: "idx_ndo_status_expires")
}
```

Create `backend/prisma/migrations/20261013030000_add_next_day_daily_offer/migration.sql`:

```sql
-- Next-day Daily Driver offers (spec 2026-10-13).
-- Apply by hand on EVERY database BEFORE deploying the backend, then `prisma migrate resolve --applied`.
ALTER TABLE `pkg_order`
  ADD COLUMN `next_day_live_at` DATETIME(0) NULL,
  ADD COLUMN `next_day_stage` VARCHAR(10) NULL,
  ADD COLUMN `next_day_discount_amount` DECIMAL(10,2) NULL;

CREATE TABLE `next_day_daily_offer` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'offered',
  `offered_by_admin` INT NULL,
  `offered_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `expires_at` DATETIME(0) NOT NULL,
  `responded_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ndo_order_rider` (`order_id`, `rider_id`),
  KEY `idx_ndo_order_status` (`order_id`, `status`),
  KEY `idx_ndo_status_expires` (`status`, `expires_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 5: Regenerate the client and run the test**

Run: `cd backend && npx prisma generate && npx jest src/services/__tests__/nextDayRules.test.js`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma backend/src/services/nextDayRules.js backend/src/services/__tests__/nextDayRules.test.js backend/src/utils/geoDistance.js
git commit -m "feat(next-day): schema and pure rules for Daily Driver offers"
```

---

### Task 2: Settings service

**Files:**
- Create: `backend/src/services/nextDaySettings.js`
- Test: `backend/src/services/__tests__/nextDaySettings.test.js`

**Interfaces:**
- Consumes: `nextDayRules.parseLiveTime`.
- Produces: `getOfferSeconds() → number` (15–600, default 60); `setOfferSeconds(n)`; `getLiveTime() → "HH:MM"`; `setLiveTime(s)`. Setters throw an error with `statusCode: 400` on bad input.

- [ ] **Step 1: Failing test**

```js
jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn(), upsert: jest.fn().mockResolvedValue({}) } }));
const prisma = require("../../config/db");
const s = require("../nextDaySettings");

beforeEach(() => jest.clearAllMocks());

it("defaults to 60 seconds and 14:00", async () => {
  prisma.app_settings.findFirst.mockResolvedValue(null);
  expect(await s.getOfferSeconds()).toBe(60);
  expect(await s.getLiveTime()).toBe("14:00");
});
it("reads stored values and ignores corrupt ones", async () => {
  prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "90" });
  expect(await s.getOfferSeconds()).toBe(90);
  prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "abc" });
  expect(await s.getOfferSeconds()).toBe(60);
  prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "99:99" });
  expect(await s.getLiveTime()).toBe("14:00");
});
it("validates on write", async () => {
  await expect(s.setOfferSeconds(5)).rejects.toMatchObject({ statusCode: 400 });
  await expect(s.setOfferSeconds(601)).rejects.toMatchObject({ statusCode: 400 });
  await expect(s.setLiveTime("2pm")).rejects.toMatchObject({ statusCode: 400 });
  expect(await s.setOfferSeconds("75")).toBe(75);
  expect(await s.setLiveTime("13:30")).toBe("13:30");
});
```

- [ ] **Step 2: Run:** `cd backend && npx jest src/services/__tests__/nextDaySettings.test.js` — Expected FAIL (module missing).

- [ ] **Step 3: Implement**

```js
const prisma = require("../config/db");
const rules = require("./nextDayRules");

const OFFER_SECONDS_KEY = "next_day_offer_seconds";
const LIVE_TIME_KEY = "next_day_live_time";
const DEFAULT_OFFER_SECONDS = 60;
const OFFER_SECONDS_RANGE = [15, 600];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

async function read(key) {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: key } });
  return row && row.setting_value !== null && row.setting_value !== undefined ? String(row.setting_value) : null;
}
async function write(key, value) {
  await prisma.app_settings.upsert({
    where: { setting_key: key },
    update: { setting_value: String(value) },
    create: { setting_key: key, setting_value: String(value) },
  });
}

async function getOfferSeconds() {
  const n = parseInt(await read(OFFER_SECONDS_KEY), 10);
  return Number.isInteger(n) && n >= OFFER_SECONDS_RANGE[0] && n <= OFFER_SECONDS_RANGE[1] ? n : DEFAULT_OFFER_SECONDS;
}
async function setOfferSeconds(value) {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isInteger(n) || n < OFFER_SECONDS_RANGE[0] || n > OFFER_SECONDS_RANGE[1]) {
    throw badRequest(`offer_seconds must be a whole number between ${OFFER_SECONDS_RANGE[0]} and ${OFFER_SECONDS_RANGE[1]}`);
  }
  await write(OFFER_SECONDS_KEY, n);
  return n;
}

async function getLiveTime() {
  return rules.parseLiveTime(await read(LIVE_TIME_KEY));
}
async function setLiveTime(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!TIME_RE.test(v)) throw badRequest("live_time must be HH:MM (24-hour)");
  await write(LIVE_TIME_KEY, v);
  return v;
}

module.exports = { getOfferSeconds, setOfferSeconds, getLiveTime, setLiveTime };
```

- [ ] **Step 4: Run** the test again — Expected PASS.
- [ ] **Step 5: Commit** `git add backend/src/services/nextDaySettings.js backend/src/services/__tests__/nextDaySettings.test.js && git commit -m "feat(next-day): offer timeout and live-time settings"`

---

### Task 3: Extend `offerToInterestedRiders` with defaulted options

**Files:**
- Modify: `backend/src/services/dispatchManager.js:1229-1296` (function `offerToInterestedRiders`)
- Test: add to `backend/src/services/__tests__/dispatchManager.test.js` (or a new `dispatchManager.nextDayOffer.test.js` if the existing file's mocks make that easier — follow how existing tests call `offerToInterestedRiders`; `grep -n offerToInterestedRiders backend/src/services/__tests__/*.js`).

**Interfaces:**
- Consumes: nothing new.
- Produces: `offerToInterestedRiders(order, riderIds, pkg, discount, opts = {})` where `opts = { ttlMs?: number, popupMs?: number, requireOnline?: boolean (default true), fareScale?: number (default 1), payloadExtras?: object }`. With no `opts` the behaviour is byte-for-byte today's. Returns the same `{ offeredRiderIds }`.

- [ ] **Step 1: Failing test.** Using the same module mocks the existing dispatchManager tests use, call `dispatchManager.offerToInterestedRiders(order, [7], pkg, null, { ttlMs: 60000, popupMs: 45000, requireOnline: false, fareScale: 0.9, payloadExtras: { next_day_daily_offer: "1" } })` with `prisma.tbl_rider.findMany` mocked to return one rider with `a_status: 0`. Assert:
  1. `prisma.tbl_rider.findMany` was called with a `where` that has **no** `a_status` key;
  2. `prisma.$executeRaw` received `60` as the TTL seconds (check the tagged-template values array);
  3. the emitted `order:request` payload has `next_day_daily_offer === "1"`, `popup_duration === "45"` and its fare field equals `round2(basefare × 0.9)`;
  4. a second call with **no opts** still filters `a_status: 1` (regression guard).
  Reuse the file's existing `priceForPackage` mock to pin `basefare`.

- [ ] **Step 2: Run** `cd backend && npx jest src/services/__tests__/dispatchManager` — the new test FAILs, existing tests pass.

- [ ] **Step 3: Implement.** In `offerToInterestedRiders`:
  - signature → `async function offerToInterestedRiders(order, riderIds, pkg, discount, opts = {})`;
  - `const ttlMs = opts.ttlMs ?? SCHEDULED_ORDER_PRIORITY_WINDOW_MS;` `const popupMs = opts.popupMs ?? SCHEDULED_ORDER_PRIORITY_POPUP_MS;` `const fareScale = opts.fareScale ?? 1;`
  - the rider query's `where` becomes `{ id: {...}, ...(opts.requireOnline === false ? {} : { a_status: 1 }), status: 1, vehicle: order.category }`;
  - `const expiresAt = armedAt + ttlMs;` and `ttlMs` passed to `insertOrderRequest`;
  - after `priceForPackage`, `const shownFare = fareScale === 1 ? fare : Math.round(fare * fareScale * 100) / 100;` and pass `shownFare` to `buildOrderRequestPayload` (replace `fare` there only);
  - `payload.popup_duration = String(Math.round(popupMs / 1000));`
  - after that line: `if (opts.payloadExtras) Object.assign(payload, opts.payloadExtras);`

- [ ] **Step 4: Run** the full file: `npx jest src/services/__tests__/dispatchManager` — PASS, including the untouched existing tests.
- [ ] **Step 5: Commit** `git commit -am "feat(dispatch): optional ttl/online/fare options on offerToInterestedRiders"` (stage only dispatchManager.js and its test).

---

### Task 4: `nextDayOfferService`

**Files:**
- Create: `backend/src/services/nextDayOfferService.js`
- Test: `backend/src/services/__tests__/nextDayOfferService.test.js`

**Interfaces:**
- Consumes: `nextDayRules` (Task 1), `nextDaySettings` (Task 2), `dispatchManager.offerToInterestedRiders(order, ids, pkg, discount, opts)` (Task 3), `dispatchManager.startDispatch(order)`, `dispatchManager.emitDriverEvent`, `pricingEngine.getFirstTierPricingContext(order)`, `adminSocket.notifyDispatchAlert(orderId, cityId, message, meta)`.
- Produces:
  - `listAvailableDailyDrivers(order) → rider[]` (ranked);
  - `offerToDriver({ order, riderId, adminId, now? }) → offerRow` (throws `Error` with `statusCode` 400/409);
  - `cascade(orderId, now?) → "offered" | "none_left" | "skipped"`;
  - `onRejected(orderId, riderId) → void`;
  - `reconcileOffers(now?) → void`;
  - `goLiveDue(now?) → number` (orders released);
  - `sweep(now?) → void`;
  - `listOffers(orderId) → rows`.

- [ ] **Step 1: Write the failing tests** — `backend/src/services/__tests__/nextDayOfferService.test.js`

```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  tbl_order_requests: { findFirst: jest.fn(), updateMany: jest.fn() },
  daily_driver_enrollment: { findMany: jest.fn() },
  next_day_daily_offer: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../nextDaySettings", () => ({ getOfferSeconds: jest.fn().mockResolvedValue(60), getLiveTime: jest.fn().mockResolvedValue("14:00") }));
jest.mock("../pricingEngine", () => ({ getFirstTierPricingContext: jest.fn().mockResolvedValue({ pkg: { id: 1 }, discount: null }) }));
jest.mock("../dispatchManager", () => ({
  offerToInterestedRiders: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), emitDriverEvent: jest.fn(),
}));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const adminSocket = require("../../sockets/adminSocket");
const svc = require("../nextDayOfferService");

const NOW = new Date("2026-10-13T05:00:00Z");
const order = (extra = {}) => ({
  id: 10, uid: 3, city_id: 1, category: "Bike", booking_type: 3, next_day_stage: "arranging", rid: 0, o_status: "Pending",
  schedule_date_time: "2026-10-13", plat: "22.72", plong: "75.86", ...extra,
});
const rider = (id, lat = "22.73", lng = "75.87") => ({ id, status: 1, vehicle: "Bike", rlats: lat, rlongs: lng, full_name: `D${id}` });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue(order());
  prisma.daily_driver_enrollment.findMany.mockResolvedValue([{ rider_id: 1 }, { rider_id: 2 }, { rider_id: 3 }]);
  prisma.next_day_daily_offer.findMany.mockResolvedValue([]);
  prisma.next_day_daily_offer.findFirst.mockResolvedValue(null);
  prisma.next_day_daily_offer.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  prisma.next_day_daily_offer.updateMany.mockResolvedValue({ count: 1 });
  prisma.next_day_daily_offer.update.mockResolvedValue({});
  prisma.tbl_rider.findMany.mockResolvedValue([rider(1), rider(2), rider(3)]);
  dispatchManager.offerToInterestedRiders.mockImplementation(async (o, ids) => ({ offeredRiderIds: ids }));
});

describe("listAvailableDailyDrivers", () => {
  it("excludes riders already offered this order and queries only the trip date's enrolled riders", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([{ rider_id: 2 }]);
    await svc.listAvailableDailyDrivers(order());
    const where = prisma.tbl_rider.findMany.mock.calls[0][0].where;
    expect(where.id.in.sort()).toEqual([1, 3]);
    expect(where).toMatchObject({ status: 1, vehicle: "Bike" });
    expect(prisma.daily_driver_enrollment.findMany.mock.calls[0][0].where.status.in).toEqual(["enrolled", "active"]);
  });
});

describe("offerToDriver", () => {
  it("records the offer and sends a 60 s popup at 90% fare", async () => {
    const row = await svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW });
    expect(row).toMatchObject({ order_id: 10, rider_id: 1, status: "offered", offered_by_admin: 9 });
    expect(row.expires_at.getTime() - NOW.getTime()).toBe(60000);
    const opts = dispatchManager.offerToInterestedRiders.mock.calls[0][4];
    expect(opts).toMatchObject({ ttlMs: 60000, requireOnline: false, fareScale: 0.9 });
    expect(opts.payloadExtras.next_day_daily_offer).toBe("1");
  });
  it("refuses when an offer is already open", async () => {
    prisma.next_day_daily_offer.findFirst.mockResolvedValue({ id: 5 });
    await expect(svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("refuses a rider who is not an available Daily Driver", async () => {
    await expect(svc.offerToDriver({ order: order(), riderId: 99, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("refuses orders that are not arranging next-day orders", async () => {
    await expect(svc.offerToDriver({ order: order({ next_day_stage: "live" }), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.offerToDriver({ order: order({ booking_type: 1 }), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("cancels the row and reports 409 when the driver could not be reached", async () => {
    dispatchManager.offerToInterestedRiders.mockResolvedValue({ offeredRiderIds: [] });
    await expect(svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.next_day_daily_offer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
});

describe("cascade", () => {
  it("offers to the nearest remaining Daily Driver with no admin attached", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([rider(1, "22.90", "75.90"), rider(3, "22.72", "75.86")]);
    expect(await svc.cascade(10, NOW)).toBe("offered");
    expect(prisma.next_day_daily_offer.create.mock.calls[0][0].data).toMatchObject({ rider_id: 3, offered_by_admin: null });
  });
  it("alerts admin when nobody is left", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    expect(await svc.cascade(10, NOW)).toBe("none_left");
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(10, 1, expect.stringContaining("NEXT-DAY"), expect.objectContaining({ kind: "next_day_none_left" }));
  });
  it("tries the next driver when the first cannot be reached", async () => {
    dispatchManager.offerToInterestedRiders
      .mockResolvedValueOnce({ offeredRiderIds: [] })
      .mockImplementationOnce(async (o, ids) => ({ offeredRiderIds: ids }));
    expect(await svc.cascade(10, NOW)).toBe("offered");
    expect(prisma.next_day_daily_offer.create).toHaveBeenCalledTimes(2);
  });
  it("does nothing for an order that is no longer arranging or already has a driver", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 5 }));
    expect(await svc.cascade(10, NOW)).toBe("skipped");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ next_day_stage: "live" }));
    expect(await svc.cascade(10, NOW)).toBe("skipped");
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("does nothing while another offer is open", async () => {
    prisma.next_day_daily_offer.findFirst.mockResolvedValue({ id: 5 });
    expect(await svc.cascade(10, NOW)).toBe("skipped");
  });
});

describe("onRejected", () => {
  it("closes the offer as rejected and cascades once", async () => {
    await svc.onRejected(10, 1);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_id: 10, rider_id: 1, status: "offered" }, data: expect.objectContaining({ status: "rejected" }),
    }));
    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledTimes(1);
  });
  it("does not cascade when there was no open offer for that rider", async () => {
    prisma.next_day_daily_offer.updateMany.mockResolvedValue({ count: 0 });
    await svc.onRejected(10, 1);
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
});

describe("reconcileOffers", () => {
  const open = (extra = {}) => ({ id: 1, order_id: 10, rider_id: 1, status: "offered", expires_at: new Date(NOW.getTime() + 30000), ...extra });
  beforeEach(() => prisma.tbl_order_requests.findFirst.mockResolvedValue({ status: "sent" }));

  it("marks the offer accepted when the order now belongs to that driver, without cascading", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 1, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }));
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("accept wins over expiry when both are true", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open({ expires_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 1, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }));
  });
  it("cancels the offer and dismisses the popup when someone else got the order or it was cancelled", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 7, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(1, "order:dismiss", expect.objectContaining({ order_id: "10" }));
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("expires an overdue offer and cascades", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open({ expires_at: new Date(NOW.getTime() - 1000) })]);
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }));
    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledTimes(1);
  });
  it("treats a reject recorded on the request row as a reject and cascades", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ status: "10" });
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) }));
    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledTimes(1);
  });
  it("leaves a fresh, unanswered offer alone", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).not.toHaveBeenCalled();
  });
});

describe("goLiveDue", () => {
  it("releases a due unassigned order exactly once and starts normal dispatch", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.next_day_daily_offer.findMany.mockResolvedValue([]);
    expect(await svc.goLiveDue(NOW)).toBe(1);
    expect(prisma.pkg_order.updateMany).toHaveBeenCalledWith({
      where: { id: 10, next_day_stage: "arranging", rid: 0, o_status: "Pending" }, data: { next_day_stage: "live" },
    });
    expect(dispatchManager.startDispatch).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(10, 1, expect.stringContaining("NEXT-DAY"), expect.objectContaining({ kind: "next_day_live" }));
  });
  it("does nothing when another worker already flipped it", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.goLiveDue(NOW)).toBe(0);
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });
  it("cancels the open offer and dismisses its popup before dispatching", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.next_day_daily_offer.findMany.mockResolvedValue([{ id: 1, order_id: 10, rider_id: 4, status: "offered" }]);
    await svc.goLiveDue(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(4, "order:dismiss", expect.any(Object));
  });
  it("selects only arranging, unassigned, pending next-day orders that are due", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([]);
    await svc.goLiveDue(NOW);
    expect(prisma.pkg_order.findMany.mock.calls[0][0].where).toEqual({
      booking_type: 3, next_day_stage: "arranging", rid: 0, o_status: "Pending", next_day_live_at: { lte: NOW },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails:** `cd backend && npx jest src/services/__tests__/nextDayOfferService.test.js` — Expected FAIL (module missing).

- [ ] **Step 3: Implement** — `backend/src/services/nextDayOfferService.js`

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const adminSocket = require("../sockets/adminSocket");
const pricingEngine = require("./pricingEngine");
const settings = require("./nextDaySettings");
const rules = require("./nextDayRules");

// dispatchManager requires many modules; load it lazily like bookingGuaranteeService does.
const dispatchManager = () => require("./dispatchManager");

const { OFFER, STAGE, DAILY_DRIVER_SHARE } = rules;
const ALERT = "NEXT-DAY ORDER";
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const isArranging = (order) =>
  Boolean(order) && Number(order.booking_type) === 3 && order.next_day_stage === STAGE.ARRANGING
  && Number(order.rid) === 0 && order.o_status === "Pending";

/** Daily Drivers who can still be offered this order, nearest pickup first. */
async function listAvailableDailyDrivers(order) {
  const tripDate = new Date(`${String(order.schedule_date_time || "").slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(tripDate.getTime())) return [];
  const [enrolled, offered] = await Promise.all([
    prisma.daily_driver_enrollment.findMany({
      where: { enrollment_date: tripDate, status: { in: ["enrolled", "active"] } },
      select: { rider_id: true },
    }),
    prisma.next_day_daily_offer.findMany({ where: { order_id: order.id }, select: { rider_id: true } }),
  ]);
  const already = new Set(offered.map((o) => Number(o.rider_id)));
  const ids = [...new Set(enrolled.map((e) => Number(e.rider_id)))].filter((id) => !already.has(id));
  if (!ids.length) return [];
  const riders = await prisma.tbl_rider.findMany({
    where: { id: { in: ids }, status: 1, vehicle: order.category },
    select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, vehicle_no: true, rlats: true, rlongs: true, a_status: true },
  });
  return rules.rankByPickupDistance(order, riders);
}

async function offerToDriver({ order, riderId, adminId = null, now = new Date() }) {
  if (!isArranging(order)) throw httpError(409, "This order is not waiting for a Daily Driver");
  const open = await prisma.next_day_daily_offer.findFirst({ where: { order_id: order.id, status: OFFER.OFFERED } });
  if (open) throw httpError(409, "An offer for this order is already open");
  const available = await listAvailableDailyDrivers(order);
  if (!available.some((r) => Number(r.id) === Number(riderId))) throw httpError(400, "This driver is not an available Daily Driver for this order");

  const seconds = await settings.getOfferSeconds();
  const expiresAt = new Date(now.getTime() + seconds * 1000);
  let row;
  try {
    row = await prisma.next_day_daily_offer.create({
      data: { order_id: order.id, rider_id: Number(riderId), status: OFFER.OFFERED, offered_by_admin: adminId, offered_at: now, expires_at: expiresAt },
    });
  } catch (err) {
    if (err && err.code === "P2002") throw httpError(409, "This driver was already offered this order");
    throw err;
  }

  const { pkg, discount } = await pricingEngine.getFirstTierPricingContext(order);
  const sent = await dispatchManager().offerToInterestedRiders(order, [Number(riderId)], pkg, discount, {
    ttlMs: seconds * 1000,
    popupMs: seconds * 1000,
    requireOnline: false,
    fareScale: DAILY_DRIVER_SHARE,
    payloadExtras: { next_day_daily_offer: "1", schedule_date_time: String(order.schedule_date_time || "") },
  });
  if (!(sent?.offeredRiderIds || []).map(Number).includes(Number(riderId))) {
    await prisma.next_day_daily_offer.update({ where: { id: row.id }, data: { status: OFFER.CANCELLED, responded_at: now } });
    throw httpError(409, "Could not reach this driver right now");
  }
  return row;
}

/** Offer to the nearest remaining Daily Driver; admin is alerted when nobody is left. */
async function cascade(orderId, now = new Date()) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  if (!isArranging(order)) return "skipped";
  const open = await prisma.next_day_daily_offer.findFirst({ where: { order_id: order.id, status: OFFER.OFFERED } });
  if (open) return "skipped";

  const available = await listAvailableDailyDrivers(order);
  for (const rider of available) {
    try {
      await offerToDriver({ order, riderId: rider.id, adminId: null, now });
      return "offered";
    } catch (err) {
      if (err.statusCode === 409 || err.statusCode === 400) continue; // unreachable / raced: try the next one
      throw err;
    }
  }
  try {
    adminSocket.notifyDispatchAlert(order.id, order.city_id, `${ALERT} – NO DAILY DRIVER LEFT, ARRANGE MANUALLY`, { kind: "next_day_none_left" });
  } catch (err) {
    logger.error(`nextDayOffer: none-left alert failed for order ${order.id}:`, err);
  }
  return "none_left";
}

async function closeOffer(offer, status, now) {
  const res = await prisma.next_day_daily_offer.updateMany({
    where: { id: offer.id, status: OFFER.OFFERED }, data: { status, responded_at: now },
  });
  return res.count === 1;
}

async function onRejected(orderId, riderId, now = new Date()) {
  const res = await prisma.next_day_daily_offer.updateMany({
    where: { order_id: Number(orderId), rider_id: Number(riderId), status: OFFER.OFFERED },
    data: { status: OFFER.REJECTED, responded_at: now },
  });
  if (res.count === 1) await cascade(orderId, now);
}

const dismiss = (riderId, orderId, reason) => {
  try { dispatchManager().emitDriverEvent(Number(riderId), "order:dismiss", { order_id: String(orderId), reason }); } catch (_) { /* best effort */ }
};

/** Settles every open offer from the DB: accepted, cancelled, rejected or expired (cascading where needed). */
async function reconcileOffers(now = new Date()) {
  const open = await prisma.next_day_daily_offer.findMany({ where: { status: OFFER.OFFERED }, take: 100 });
  for (const offer of open) {
    try {
      const order = await prisma.pkg_order.findUnique({ where: { id: offer.order_id } });
      if (order && Number(order.rid) === Number(offer.rider_id) && order.o_status !== "Cancelled") {
        await closeOffer(offer, OFFER.ACCEPTED, now); // accept always wins, even past expiry
        continue;
      }
      if (!isArranging(order)) {
        if (await closeOffer(offer, OFFER.CANCELLED, now)) dismiss(offer.rider_id, offer.order_id, "next_day_closed");
        continue;
      }
      const request = await prisma.tbl_order_requests.findFirst({
        where: { order_id: offer.order_id, rider_id: offer.rider_id }, orderBy: { id: "desc" }, select: { status: true },
      });
      if (request && String(request.status) === "10") {
        if (await closeOffer(offer, OFFER.REJECTED, now)) await cascade(offer.order_id, now);
        continue;
      }
      if (new Date(offer.expires_at).getTime() <= now.getTime()) {
        if (await closeOffer(offer, OFFER.EXPIRED, now)) {
          await prisma.tbl_order_requests.updateMany({ where: { order_id: offer.order_id, rider_id: offer.rider_id, status: "sent" }, data: { status: "timeout" } });
          dismiss(offer.rider_id, offer.order_id, "timeout");
          await cascade(offer.order_id, now);
        }
      }
    } catch (err) {
      logger.error(`nextDayOffer: reconciling offer ${offer.id} failed:`, err);
    }
  }
}

/** At the live time, release unassigned orders to Normal Drivers through the normal dispatch engine. */
async function goLiveDue(now = new Date()) {
  const due = await prisma.pkg_order.findMany({
    where: { booking_type: 3, next_day_stage: STAGE.ARRANGING, rid: 0, o_status: "Pending", next_day_live_at: { lte: now } },
  });
  let released = 0;
  for (const order of due) {
    try {
      const flipped = await prisma.pkg_order.updateMany({
        where: { id: order.id, next_day_stage: STAGE.ARRANGING, rid: 0, o_status: "Pending" }, data: { next_day_stage: STAGE.LIVE },
      });
      if (flipped.count !== 1) continue; // another worker won
      const openOffers = await prisma.next_day_daily_offer.findMany({ where: { order_id: order.id, status: OFFER.OFFERED } });
      for (const offer of openOffers) {
        if (await closeOffer(offer, OFFER.CANCELLED, now)) dismiss(offer.rider_id, order.id, "next_day_live");
      }
      await dispatchManager().startDispatch({ ...order, next_day_stage: STAGE.LIVE });
      try {
        adminSocket.notifyDispatchAlert(order.id, order.city_id, `${ALERT} WENT LIVE – DISPATCHING TO NORMAL DRIVERS`, { kind: "next_day_live" });
      } catch (err) {
        logger.error(`nextDayOffer: live alert failed for order ${order.id}:`, err);
      }
      released += 1;
    } catch (err) {
      logger.error(`nextDayOffer: going live failed for order ${order.id}:`, err);
    }
  }
  return released;
}

async function sweep(now = new Date()) {
  await reconcileOffers(now);
  await goLiveDue(now);
}

const listOffers = (orderId) => prisma.next_day_daily_offer.findMany({ where: { order_id: Number(orderId) }, orderBy: { id: "asc" } });

module.exports = { listAvailableDailyDrivers, offerToDriver, cascade, onRejected, reconcileOffers, goLiveDue, sweep, listOffers };
```

- [ ] **Step 4: Run:** `cd backend && npx jest src/services/__tests__/nextDayOfferService.test.js` — Expected PASS. Fix the implementation (not the tests) if a case fails.
- [ ] **Step 5: Commit** `git add backend/src/services/nextDayOfferService.js backend/src/services/__tests__/nextDayOfferService.test.js && git commit -m "feat(next-day): Daily Driver offer service with cascade and go-live"`

---

### Task 5: Hooks in existing flows (creation, reject, completion, sweeper)

**Files:**
- Modify: `backend/src/controllers/orderController.js` (pkg_order create `data`, near line 543)
- Modify: `backend/src/services/tripLifecycle.js` (`rejectOrder` ~line 444; completion ~line 675)
- Modify: `backend/src/config/constants.js:48`, `backend/src/server.js:68`
- Test: `backend/src/services/__tests__/tripLifecycle.test.js` (add cases), `backend/src/services/__tests__/nextDayRules.test.js` unchanged

**Interfaces:**
- Consumes: `nextDayRules.liveAtFor`, `nextDayRules.splitDailyDriverFare`, `nextDaySettings.getLiveTime`, `nextDayOfferService.onRejected`, `nextDayOfferService.sweep`.
- Produces: no new exports.

- [ ] **Step 1 — creation (orderController).** Add near the top requires: `const nextDaySettings = require("../services/nextDaySettings"); const nextDayRules = require("../services/nextDayRules");`. After `finalScheduleDateTime` is computed (line ~540) add:

```js
  // Next-day (spec 2026-10-13): arranged through Daily Drivers until the live time on the trip day.
  const nextDayFields = Number(bookingType) === 3
    ? {
        next_day_stage: nextDayRules.STAGE.ARRANGING,
        next_day_live_at: nextDayRules.liveAtFor(finalScheduleDateTime, await nextDaySettings.getLiveTime()),
      }
    : {};
```

and add `...nextDayFields,` inside the `prisma.pkg_order.create({ data: { ... } })` object (next to `schedule_date_time`). Test: in the existing orderController next-day tests (`grep -ln "booking_type: 3\|bookingType: 3" backend/src/controllers/__tests__`), assert the create call's `data` contains `next_day_stage: "arranging"` and a `next_day_live_at` Date for type 3, and neither key for type 1 and 2. If no suitable test file exists, add `backend/src/controllers/__tests__/orderController.nextDay.test.js` following the mocks in `orderController.system2.test.js`.

- [ ] **Step 2 — reject hook (tripLifecycle).** In `rejectOrder`, inside `if (result.count > 0) { ... }` right after `recordModel1Outcome(riderId, resolvedPackageId, "miss")` add:

```js
    // Next-day Daily Driver offer (spec 2026-10-13): a reject passes the order to the next Daily Driver at once.
    // The sweeper would catch it within ~10 s anyway; this just makes it instant. Never blocks the reject.
    require("./nextDayOfferService")
      .onRejected(orderId, riderId)
      .catch((err) => logger.error(`rejectOrder: next-day cascade failed for order ${orderId}:`, err));
```

`onRejected` is a no-op unless an open offer exists for that rider, so other orders are unaffected. Test: in `tripLifecycle.test.js` mock `../nextDayOfferService` and assert `onRejected` is called with `(orderId, riderId)` when a request row is updated, and not called when `count` is 0.

- [ ] **Step 3 — completion earning (tripLifecycle).** Immediately after `const isDailyDriverExempt = await dailyDriverEnrollmentQuery.hasActiveDailyDriverEnrollmentToday(riderId);` (line ~675) add:

```js
    // Next-day booking taken by a Daily Driver while it was still being arranged: the driver's order value is
    // 10% lower; the difference is recorded for admin to settle (spec 2026-10-13). An order that already went
    // live (Normal Driver dispatch) pays 100%.
    if (isDailyDriverExempt && Number(order.booking_type) === 3 && order.next_day_stage === "arranging") {
      const split = nextDayRules.splitDailyDriverFare(finalTotal);
      await prisma.pkg_order.update({
        where: { id: orderId },
        data: { driver_earning: split.driverEarning, next_day_discount_amount: split.discount },
      });
    }
```

and `const nextDayRules = require("./nextDayRules");` at the top of the file. Tests (extend the existing completion tests in `tripLifecycle.test.js`; copy the closest "completes a trip for a Daily Driver" case): (a) Daily Driver + `booking_type: 3` + `next_day_stage: "arranging"` + fare 100 → an update with `{ driver_earning: 90, next_day_discount_amount: 10 }`; (b) same but `next_day_stage: "live"` → no such update; (c) `booking_type: 1` → no such update; (d) non-Daily Driver on a next-day arranging order → no such update.

- [ ] **Step 4 — sweeper.** `constants.js`: add `NEXT_DAY_SWEEP_INTERVAL_MS: 10 * 1000,` after `SYSTEM2_SWEEP_INTERVAL_MS`. `server.js`: destructure it with the other constants and add after the System 2 sweeper block:

```js
// Next-day Daily Driver offers: settle open offers (accepted / rejected / expired) and release orders that reached
// their live time to Normal Drivers. DB-backed, so restart-safe.
const nextDayOfferService = require("./services/nextDayOfferService");
let nextDaySweepRunning = false;
setInterval(() => {
  if (nextDaySweepRunning) return;
  nextDaySweepRunning = true;
  nextDayOfferService
    .sweep()
    .catch((err) => logger.error("next-day offer sweep failed:", err))
    .finally(() => { nextDaySweepRunning = false; });
}, NEXT_DAY_SWEEP_INTERVAL_MS);
```

- [ ] **Step 5: Run the full backend suite:** `cd backend && npx jest` — Expected: all pass except the two known `aadharPdfVerify` failures.
- [ ] **Step 6: Commit** `git add backend/src/controllers/orderController.js backend/src/services/tripLifecycle.js backend/src/config/constants.js backend/src/server.js backend/src/**/__tests__ && git commit -m "feat(next-day): order creation fields, reject hook, 90% completion earning, sweeper"`

---

### Task 6: Admin API

**Files:**
- Create: `backend/src/controllers/adminNextDayOfferController.js`
- Modify: `backend/src/routes/adminRoutes.js:213-215`
- Test: `backend/src/controllers/__tests__/adminNextDayOfferController.test.js`

**Interfaces:**
- Consumes: `nextDayOfferService.listAvailableDailyDrivers / offerToDriver / listOffers`, `nextDaySettings.*`.
- Produces (all under `/api/admin`): `GET /orders/next-day/settings` → `{ offer_seconds, live_time }`; `PUT /orders/next-day/settings` body `{ offer_seconds?, live_time? }` (admin/superadmin only); `GET /orders/next-day/:id/daily-drivers`; `POST /orders/next-day/:id/offer` body `{ rider_id }`; `GET /orders/next-day/:id/offers`.

- [ ] **Step 1: Failing test**

```js
jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn() } }));
jest.mock("../../services/nextDayOfferService", () => ({
  listAvailableDailyDrivers: jest.fn(), offerToDriver: jest.fn(), listOffers: jest.fn(),
}));
jest.mock("../../services/nextDaySettings", () => ({
  getOfferSeconds: jest.fn().mockResolvedValue(60), getLiveTime: jest.fn().mockResolvedValue("14:00"),
  setOfferSeconds: jest.fn(), setLiveTime: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const offers = require("../../services/nextDayOfferService");
const ctrl = require("../adminNextDayOfferController");

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const req = (extra = {}) => ({ params: { id: "10" }, body: {}, user: { id: 9, role: "admin", city_id: 1 }, ...extra });
const next = (o = {}) => ({ id: 10, city_id: 1, booking_type: 3, ...o });

beforeEach(() => { jest.clearAllMocks(); prisma.pkg_order.findUnique.mockResolvedValue(next()); });

it("lists available Daily Drivers for a next-day order", async () => {
  offers.listAvailableDailyDrivers.mockResolvedValue([{ id: 1 }]);
  const r = res();
  await ctrl.listDailyDrivers(req(), r);
  expect(r.json).toHaveBeenCalledWith({ success: true, data: [{ id: 1 }] });
});
it("404s for a missing order and 400s for a non-next-day order", async () => {
  prisma.pkg_order.findUnique.mockResolvedValue(null);
  let r = res(); await ctrl.listDailyDrivers(req(), r); expect(r.status).toHaveBeenCalledWith(404);
  prisma.pkg_order.findUnique.mockResolvedValue(next({ booking_type: 1 }));
  r = res(); await ctrl.listDailyDrivers(req(), r); expect(r.status).toHaveBeenCalledWith(400);
});
it("refuses an order from another city", async () => {
  prisma.pkg_order.findUnique.mockResolvedValue(next({ city_id: 2 }));
  const r = res(); await ctrl.listDailyDrivers(req(), r); expect(r.status).toHaveBeenCalledWith(403);
});
it("offers the order to the chosen driver as the calling admin", async () => {
  offers.offerToDriver.mockResolvedValue({ id: 1, rider_id: 5 });
  const r = res();
  await ctrl.offer(req({ body: { rider_id: "5" } }), r);
  expect(offers.offerToDriver).toHaveBeenCalledWith({ order: next(), riderId: 5, adminId: 9 });
  expect(r.status).toHaveBeenCalledWith(201);
});
it("requires rider_id and passes service errors through with their status", async () => {
  let r = res(); await ctrl.offer(req({ body: {} }), r); expect(r.status).toHaveBeenCalledWith(400);
  offers.offerToDriver.mockRejectedValue(Object.assign(new Error("An offer for this order is already open"), { statusCode: 409 }));
  r = res(); await ctrl.offer(req({ body: { rider_id: 5 } }), r);
  expect(r.status).toHaveBeenCalledWith(409);
  expect(r.json).toHaveBeenCalledWith({ success: false, message: "An offer for this order is already open" });
});
it("saves settings", async () => {
  const s = require("../../services/nextDaySettings");
  s.setOfferSeconds.mockResolvedValue(90);
  const r = res();
  await ctrl.saveSettings({ body: { offer_seconds: 90 }, user: { id: 9, role: "admin" } }, r);
  expect(s.setOfferSeconds).toHaveBeenCalledWith(90);
  expect(r.json).toHaveBeenCalledWith({ success: true, data: { offer_seconds: 90, live_time: "14:00" } });
});
```

- [ ] **Step 2: Run** `cd backend && npx jest src/controllers/__tests__/adminNextDayOfferController.test.js` — Expected FAIL (module missing).

- [ ] **Step 3: Implement** `backend/src/controllers/adminNextDayOfferController.js`

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const offers = require("../services/nextDayOfferService");
const settings = require("../services/nextDaySettings");

const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminNextDayOffer.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

function scopedOut(req, cityId) {
  const role = String(req.user?.role || "").toLowerCase();
  if (role === "superadmin" || role === "super_admin") return false;
  if (!cityId || !req.user?.city_id) return false;
  return Number(cityId) !== parseInt(req.user.city_id, 10);
}

// Loads the order and enforces: exists, is a next-day order, inside the admin's city.
async function loadOrder(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Invalid order id"), { statusCode: 400 });
  const order = await prisma.pkg_order.findUnique({ where: { id } });
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (Number(order.booking_type) !== 3) throw Object.assign(new Error("Not a next-day order"), { statusCode: 400 });
  if (scopedOut(req, order.city_id)) throw Object.assign(new Error("Forbidden: order is outside your assigned city"), { statusCode: 403 });
  return order;
}

async function listDailyDrivers(req, res) {
  try {
    const order = await loadOrder(req);
    return res.json({ success: true, data: await offers.listAvailableDailyDrivers(order) });
  } catch (e) { return fail(res, e, "listDailyDrivers"); }
}

async function offer(req, res) {
  try {
    const order = await loadOrder(req);
    const riderId = Number(req.body?.rider_id);
    if (!Number.isInteger(riderId) || riderId <= 0) return res.status(400).json({ success: false, message: "rider_id is required" });
    const row = await offers.offerToDriver({ order, riderId, adminId: req.user?.id ?? null });
    return res.status(201).json({ success: true, message: "Offer sent to the driver", data: row });
  } catch (e) { return fail(res, e, "offer"); }
}

async function listOffers(req, res) {
  try {
    const order = await loadOrder(req);
    return res.json({ success: true, data: await offers.listOffers(order.id) });
  } catch (e) { return fail(res, e, "listOffers"); }
}

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: { offer_seconds: await settings.getOfferSeconds(), live_time: await settings.getLiveTime() } });
  } catch (e) { return fail(res, e, "getSettings"); }
}

async function saveSettings(req, res) {
  try {
    if (req.body?.offer_seconds !== undefined) await settings.setOfferSeconds(req.body.offer_seconds);
    if (req.body?.live_time !== undefined) await settings.setLiveTime(req.body.live_time);
    return res.json({ success: true, data: { offer_seconds: await settings.getOfferSeconds(), live_time: await settings.getLiveTime() } });
  } catch (e) { return fail(res, e, "saveSettings"); }
}

module.exports = { listDailyDrivers, offer, listOffers, getSettings, saveSettings };
```

- [ ] **Step 4: Routes.** In `adminRoutes.js` add `const adminNextDayOfferController = require("../controllers/adminNextDayOfferController");` with the other controller requires, and directly after the three existing `/orders/next-day...` lines (before `/orders/:id`):

```js
router.get("/orders/next-day/settings", auth, authorize(...RIDER_ROLES), scopeFilter, adminNextDayOfferController.getSettings);
router.put("/orders/next-day/settings", auth, authorize("superadmin", "admin"), scopeFilter, adminNextDayOfferController.saveSettings);
router.get("/orders/next-day/:id/daily-drivers", auth, authorize(...RIDER_ROLES), scopeFilter, adminNextDayOfferController.listDailyDrivers);
router.post("/orders/next-day/:id/offer", auth, authorize(...RIDER_ROLES), scopeFilter, adminNextDayOfferController.offer);
router.get("/orders/next-day/:id/offers", auth, authorize(...RIDER_ROLES), scopeFilter, adminNextDayOfferController.listOffers);
```

- [ ] **Step 5: Run** `npx jest src/controllers/__tests__/adminNextDayOfferController.test.js` — Expected PASS. Then `npx jest` for the whole backend.
- [ ] **Step 6: Commit** `git add backend/src/controllers/adminNextDayOfferController.js backend/src/controllers/__tests__/adminNextDayOfferController.test.js backend/src/routes/adminRoutes.js && git commit -m "feat(next-day): admin API for Daily Driver offers and settings"`

---

### Task 7: Admin panel UI

**Files:**
- Create: `frontend/src/components/orders/NextDayOfferModal.jsx`
- Modify: `frontend/src/pages/NextDayOrders.jsx` (table header at line 66, row at 99-125, modal mount near line 131)

**Interfaces:**
- Consumes: the Task 6 endpoints through `api` (`frontend/src/services/api`), `Modal` (`../common/Modal`, props `open, onClose, title, children, footer, width`), `useToast`.
- Produces: an "Offer" button on every unassigned row; a live-time column.

- [ ] **Step 1: Create the modal** — `frontend/src/components/orders/NextDayOfferModal.jsx`

```jsx
import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import { useToast } from '../../context/ToastContext'

const errMsg = (err, fallback) => err?.response?.data?.message || fallback
const STATUS_COLOR = { offered: 'var(--brand)', accepted: 'var(--success)', rejected: 'var(--danger)', expired: 'var(--ink-faint)', cancelled: 'var(--ink-faint)' }

export default function NextDayOfferModal({ open, order, onClose, onChanged }) {
  const toast = useToast()
  const [drivers, setDrivers] = useState([])
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!order) return
    setLoading(true)
    try {
      const [d, o] = await Promise.all([
        api.get(`/orders/next-day/${order.id}/daily-drivers`),
        api.get(`/orders/next-day/${order.id}/offers`),
      ])
      setDrivers(d.data?.data ?? [])
      setOffers(o.data?.data ?? [])
    } catch (err) {
      toast.error(errMsg(err, 'Could not load Daily Drivers'))
    } finally {
      setLoading(false)
    }
  }, [order, toast])

  useEffect(() => {
    if (!open) return undefined
    load()
    const t = setInterval(load, 5000) // follow the cascade while the modal is open
    return () => clearInterval(t)
  }, [open, load])

  const openOffer = offers.find((o) => o.status === 'offered')

  async function offerTo(riderId) {
    setBusyId(riderId)
    try {
      await api.post(`/orders/next-day/${order.id}/offer`, { rider_id: riderId })
      toast.success('Offer sent. If the driver rejects or does not answer, the next Daily Driver is tried automatically.')
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(errMsg(err, 'Could not send the offer'))
    } finally {
      setBusyId(null)
    }
  }

  const liveAt = order?.next_day_live_at ? new Date(order.next_day_live_at).toLocaleString() : '—'

  return (
    <Modal open={open} onClose={onClose} title={order ? `Offer order #${order.id} to a Daily Driver` : 'Offer'} width={560}>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 text-[13px]" style={{ color: 'var(--ink)' }}>
        <p style={{ color: 'var(--ink-muted)' }}>
          Goes live to Normal Drivers at <b>{liveAt}</b> if no Daily Driver has accepted. A Daily Driver earns 90% of the fare on this order.
        </p>

        {openOffer && (
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--brand-soft-border)', background: 'var(--brand-soft)' }}>
            Waiting for driver #{openOffer.rider_id} to answer…
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Available Daily Drivers (nearest first)</p>
          {loading && drivers.length === 0 && <p style={{ color: 'var(--ink-faint)' }}>Loading…</p>}
          {!loading && drivers.length === 0 && <p style={{ color: 'var(--ink-faint)' }}>No Daily Driver is available for this order.</p>}
          {drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-t py-2" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div>{d.full_name || `${d.first_name || ''} ${d.last_name || ''}`.trim() || `Driver #${d.id}`} <span style={{ color: 'var(--ink-faint)' }}>#{d.id}</span></div>
                <div style={{ color: 'var(--ink-faint)' }}>{d.vehicle_no || '—'} · {d.fmobile || '—'}</div>
              </div>
              <button
                type="button"
                disabled={Boolean(openOffer) || busyId === d.id}
                onClick={() => offerTo(d.id)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                {busyId === d.id ? 'Sending…' : 'Offer'}
              </button>
            </div>
          ))}
        </div>

        {offers.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Offer history</p>
            {offers.map((o) => (
              <div key={o.id} className="flex items-center justify-between border-t py-1.5" style={{ borderColor: 'var(--border)' }}>
                <span>Driver #{o.rider_id} {o.offered_by_admin ? '(admin)' : '(auto)'}</span>
                <span style={{ color: STATUS_COLOR[o.status] || 'var(--ink-muted)' }}>{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Wire it into the page** — `frontend/src/pages/NextDayOrders.jsx`:
  1. Import: `import NextDayOfferModal from '../components/orders/NextDayOfferModal'`.
  2. State: `const [offerOrder, setOfferOrder] = useState(null)`.
  3. Header array: replace `'Driver'` with `'Live at', 'Driver', ''` and change both `colSpan={8}` to `colSpan={10}`.
  4. In the row, before the Driver cell add:
     ```jsx
     <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
       {o.next_day_stage === 'live' ? 'Live' : o.next_day_live_at ? new Date(o.next_day_live_at).toLocaleString() : '—'}
     </td>
     ```
     and after the Driver cell add the action cell:
     ```jsx
     <td className="whitespace-nowrap px-4 py-2.5">
       {!o.rid && o.next_day_stage === 'arranging' && (
         <button type="button" onClick={() => setOfferOrder(o)} className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
           Offer to Daily Driver
         </button>
       )}
     </td>
     ```
  5. Mount before `</div>` at the end: `<NextDayOfferModal open={Boolean(offerOrder)} order={offerOrder} onClose={() => setOfferOrder(null)} onChanged={refetch} />`.
  6. Replace the descriptive sentence at line 45 with: `Next-day bookings are priced at Model 1. Offer each one to a Daily Driver; if none accepts, it goes live to Normal Drivers at the live time.`

- [ ] **Step 3: Build check:** `cd frontend && npx vite build` (or `npm run build`) — Expected: build succeeds. ESLint is broken in this repo (pre-existing), so do not use it as the gate.
- [ ] **Step 4: Manual smoke (dev DB, after the migration is applied):** book a next-day order, open Next-Day page, click "Offer to Daily Driver", confirm the modal lists enrolled Daily Drivers, offer one, reject from the driver app, confirm the history shows `rejected` then a new `(auto)` offer.
- [ ] **Step 5: Commit** `git add frontend/src/components/orders/NextDayOfferModal.jsx frontend/src/pages/NextDayOrders.jsx && git commit -m "feat(next-day): admin UI to offer an order to Daily Drivers"`

---

## Rollout checklist (not code)

1. Apply `20261013030000_add_next_day_daily_offer/migration.sql` on dev, then prod, **before** deploying (a missing `pkg_order` column 500s every order read).
2. `npx prisma generate` on the server, deploy the backend, restart the pm2 process.
3. Driver app: no change required; the popup shows the existing layout at 90% fare. (Optional later: read `next_day_daily_offer` / `schedule_date_time` from the payload to show a "Next-day Daily Driver offer" label.)

## Self-review notes

- Spec coverage: §4 data → Task 1; §5.1 creation → Task 5; §5.2 service → Tasks 3-4; §5.3 sweeper → Task 5; §5.4 admin API → Task 6; §5.5 driver endpoints → reuse of existing accept/reject (Tasks 3, 5); §5.6 admin panel → Task 7; §7 edge cases → Task 4 tests; §8 tests → each task.
- Known gaps recorded rather than hidden: a server restart during the *live* cascade is not reconciled at startup (the existing startup reconcile excludes `booking_type` 3 by design); Booking Guarantee covers the no-driver outcome after live.
- Types consistent across tasks: `OFFER`/`STAGE` constants (Task 1) used in Task 4; `offerToInterestedRiders` opts keys (`ttlMs, popupMs, requireOnline, fareScale, payloadExtras`) identical in Tasks 3 and 4; `onRejected(orderId, riderId)` identical in Tasks 4 and 5.
