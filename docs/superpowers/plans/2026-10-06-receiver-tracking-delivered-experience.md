# Receiver Tracking: App Theme and Delivered Experience Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT.** Implementation record - kept for history. Where it differs from the code, the code and the master document win. Current code-verified description: [Master Document section 5.3](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the public tracking page in the app's light theme and turn its "Delivered" state into a useful screen: trip summary, the route the driver drove, a Pay button (Receiver-pays orders), a rating form, help buttons and an app-download button.

**Architecture:** The snapshot builder (`trackSnapshotService`) adds delivered-only data. Two new token-authorized POST endpoints (`pay-link`, `review`) live in a new `trackActionService`; `pay-link` reuses the existing `/pay` page by minting a pay token without sending WhatsApp. Reviews go to a new table. The inline HTML page gets the new theme and delivered blocks. The admin gets a "Receiver" tab.

**Tech Stack:** Node/Express, Prisma/MySQL, Jest, vanilla JS page (fake-DOM behaviour tests), React admin page.

**Spec:** `docs/superpowers/specs/2026-10-06-receiver-tracking-delivered-experience-design.md` (extends `2026-10-06-receiver-live-tracking-design.md`).

## Global Constraints

- Page theme is always light (`color-scheme: light`, no `prefers-color-scheme: dark` block). Tokens: accent `#FF6B35`, accent-2 `#FF8A5C`, page background `#F7F7F7`, card `#FFFFFF`, text `#202020`, muted `#827E7E`, border `#DEE3E7`, success text `#0B8A12`, warning `#E68C00`, error `#D93025`. Route line stays `#1a73e8`.
- Money fields (`amount_due`, `markup`, `total`) appear in the snapshot ONLY inside `pay`, and `pay` is non-null only when the order has an `order_receiver_pay` row (state `payable` while the settlement is `payer = receiver` and `pending`; state `paid` when the row status is `paid`).
- `trip_route`, `summary`, `pay`, `review`, `help`, `app_url` are returned only in the `delivered` state; the delivered window stays 24 h (`drop_time`/`ddate` are IST wall-clock, expiry instant = value - 5.5 h).
- `POST /api/track/:token/pay-link` and `POST /api/track/:token/review`: rate limit 10/min per IP; token shape (43 base64url chars) checked before any DB access; the order's current `dmobile` must equal the link's `receiver_phone`; the order must be Completed and inside the 24 h window; responses `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- Review: ratings integers 1-5 (at least one required); tags only from this whitelist: `Polite & Helpful`, `On-Time Arrival`, `Careful with items`, `Safe Driving`, `Clean Vehicle`, `Delayed Arrival`, `Demanded Extra Cash`, `Careless Handling`, `Rash Driving`, `Rude Behaviour`; comment trimmed, max 500 characters; one review per order (second submit: 409 `ALREADY_SUBMITTED`).
- Pay link minting rotates the order's pay token WITHOUT sending WhatsApp and WITHOUT incrementing `link_send_count`; errors: `NOT_PAYABLE`/`NOT_ACTIVE` -> 409, `NOT_CONFIGURED` -> 503.
- Dynamic page text only via `textContent`; no `innerHTML`; `tel:` and `wa.me` values are digit-sanitized; the app URL is used only if it starts with `https://`.
- Help: phone `9109114515` (override `SUPPORT_PHONE`), WhatsApp number = `91` + phone. App URL `https://play.google.com/store/apps/details?id=com.shifter.online`.
- Migration `20261006020000_add_order_receiver_feedback`; table `order_receiver_feedback`.
- Backend tests: `cd backend && npx jest <path>`. Known pre-existing failure: `src/utils/__tests__/aadharPdfVerify.test.js`. Admin check: `cd frontend && npm run build` (admin `npm run lint` is broken at baseline).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A receiver of a NON-receiver-pays order must never get any money field, and an order with a closed/declined pay row must not show a Pay card (Task 2 tests).
2. `pay-link` and `review` must refuse an order that is not Completed, is outside the 24 h window, or whose `dmobile` no longer matches the link (Task 3 tests).
3. Double-click / double-submit: the review table is unique per order (409) and the page disables Pay/Submit while a request runs (Tasks 3 and 4 tests).
4. Orders with no GPS trail, a failing route builder, or no coordinates must still render the delivered screen (Task 2 tests, Task 4 page tests).
5. XSS and URL safety with the new dynamic fields (summary strings, tags, help numbers, app URL, pay redirect URL) (Task 4 tests).

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/migrations/20261006020000_add_order_receiver_feedback/migration.sql`, `schema.prisma` | New table |
| `backend/src/services/receiverTrackSettings.js` (modify) | `getHelpConfig`, `APP_URL` |
| `backend/src/services/trackSnapshotService.js` (modify) | `loadLinkedOrder`, delivered extras |
| `backend/src/services/receiverPayService.js` (modify) | `mintLink` (shares validation with `issueLink`) |
| `backend/src/services/trackActionService.js` (new) | `mintPayLink`, `submitReview`, `TrackActionError` |
| `backend/src/controllers/trackController.js`, `routes/trackRoutes.js` (modify) | POST handlers + rate limits |
| `backend/src/controllers/trackPage.js` (rewrite) | New theme + delivered UI |
| `backend/src/controllers/__tests__/helpers/trackPageHarness.js` (new) | Shared fake-DOM harness |
| `backend/src/controllers/adminTripFeedbackController.js`, `routes/adminRoutes.js` (modify) | Receiver feedback list |
| `frontend/src/pages/TripFeedback.jsx` (modify) | "Receiver" tab |

---

### Task 1: Feedback table, help config

**Files:**
- Create: `backend/prisma/migrations/20261006020000_add_order_receiver_feedback/migration.sql`
- Modify: `backend/prisma/schema.prisma` (append model), `backend/src/services/receiverTrackSettings.js`, `backend/.env.example`
- Test: `backend/src/services/__tests__/receiverTrackSettings.test.js` (append)

**Interfaces:**
- Produces: `receiverTrackSettings.getHelpConfig(env = process.env): { phone: string, whatsapp: string }`, `receiverTrackSettings.APP_URL: string`; Prisma model `order_receiver_feedback` (`id, order_id (unique), rider_id, receiver_phone, driver_rating?, delivery_rating?, feedback_tags?, comment?, created_at`).

- [x] **Step 1: Write the failing tests** (append to the existing file, which already mocks `../../config/db` and logger)

```js
describe("getHelpConfig / APP_URL", () => {
  it("defaults to the support number and builds the WhatsApp number with the country code", () => {
    expect(s.getHelpConfig({})).toEqual({ phone: "9109114515", whatsapp: "919109114515" });
  });
  it("accepts an env override, normalising spaces and a country prefix", () => {
    expect(s.getHelpConfig({ SUPPORT_PHONE: "+91 98765 43210" })).toEqual({ phone: "9876543210", whatsapp: "919876543210" });
  });
  it("falls back to the default for an invalid override", () => {
    expect(s.getHelpConfig({ SUPPORT_PHONE: "12345" }).phone).toBe("9109114515");
  });
  it("exposes the Play Store listing", () => {
    expect(s.APP_URL).toBe("https://play.google.com/store/apps/details?id=com.shifter.online");
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverTrackSettings.test.js`
Expected: the new tests FAIL (`s.getHelpConfig is not a function`).

- [x] **Step 3: Implement** in `receiverTrackSettings.js`: add above `module.exports`

```js
const APP_URL = "https://play.google.com/store/apps/details?id=com.shifter.online";
const DEFAULT_SUPPORT_PHONE = "9109114515";

// Support number shown on the delivered screen: the Customer Care number the WhatsApp messages already
// use, overridable with SUPPORT_PHONE. WhatsApp wants the country code.
function getHelpConfig(env = process.env) {
  const digits = String(env.SUPPORT_PHONE || "").replace(/\D/g, "").slice(-10);
  const phone = digits.length === 10 ? digits : DEFAULT_SUPPORT_PHONE;
  return { phone, whatsapp: `91${phone}` };
}
```

and change the export line to `module.exports = { KEYS, APP_URL, isTrackingEnabled, getMapConfig, getHelpConfig };`.

- [x] **Step 4: Add the migration, the Prisma model and the env docs**

`migration.sql`:

```sql
-- Receiver review of a delivery (spec 2026-10-06 delivered experience). Apply on prod BEFORE deploying the backend.
CREATE TABLE `order_receiver_feedback` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `rider_id` INT NOT NULL,
  `receiver_phone` VARCHAR(15) NOT NULL,
  `driver_rating` INT NULL,
  `delivery_rating` INT NULL,
  `feedback_tags` VARCHAR(255) NULL,
  `comment` TEXT NULL,
  `created_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_receiver_feedback_order` (`order_id`),
  INDEX `idx_order_receiver_feedback_rider` (`rider_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Append to `schema.prisma`:

```prisma
model order_receiver_feedback {
  id              Int      @id @default(autoincrement())
  order_id        Int      @unique(map: "uq_order_receiver_feedback_order")
  rider_id        Int
  receiver_phone  String   @db.VarChar(15)
  driver_rating   Int?
  delivery_rating Int?
  feedback_tags   String?  @db.VarChar(255)
  comment         String?  @db.Text
  created_at      DateTime @db.DateTime(0)

  @@index([rider_id], map: "idx_order_receiver_feedback_rider")
}
```

Append to `backend/.env.example`:

```
# Optional: support number shown on the receiver tracking page after delivery (default 9109114515).
# SUPPORT_PHONE=9109114515
```

- [x] **Step 5: Validate and run the tests**

Run: `cd backend && npx prisma validate && npx prisma generate && npx jest src/services/__tests__/receiverTrackSettings.test.js`
Expected: schema valid, client generated, all settings tests PASS.

- [x] **Step 6: Commit**

```bash
git add backend/prisma backend/src/services/receiverTrackSettings.js backend/src/services/__tests__/receiverTrackSettings.test.js backend/.env.example
git commit -m "feat(receiver-tracking): receiver feedback table and help config

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Delivered data in the snapshot

**Files:**
- Modify: `backend/src/services/trackSnapshotService.js`, `backend/src/services/__tests__/trackSnapshotService.test.js` (two existing tests change on purpose, see Step 4)
- Create: `backend/src/services/__tests__/trackSnapshotDelivered.test.js`

**Interfaces:**
- Consumes: Task 1 `getHelpConfig`, `APP_URL`; existing `tripRouteService.buildRoute(client, orderId)` returning `{ has_trail, points:[{lat,lng,...}], distance_km, pickup, final_pickup, drop, ... }` (points are `{lat,lng}` or null); `trackEtaService.simplify(points, max?)`; `receiverPayCalc.receiverPayable(amountDue, markup)`.
- Produces: `trackSnapshotService.loadLinkedOrder(link): Promise<{ order } | { reason: "expired" | "invalid" }>`, `isCompleted(order): boolean`, `deliveredWindowOpen(order, now): boolean`, and `buildSnapshot` whose `delivered` result has the extra keys below.

Delivered snapshot (exact shape):

```
{ state: "delivered", order_id, step: 5, delivered_at, poll_ms: 15000,
  summary: { driver: {first_name, vehicle_no} | null, pickup: {address} | null, drop: {address} | null, distance_km: number | null },
  trip_route: { has_trail, points: [[lat,lng],...], pickup: {lat,lng} | null, drop: {lat,lng} | null } | null,
  pay: { state: "payable" | "paid", amount_due, markup, total } | null,
  review: { submitted: boolean },
  help: { phone, whatsapp },
  app_url }
```

- [x] **Step 1: Write the failing tests**

```js
// backend/src/services/__tests__/trackSnapshotDelivered.test.js
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn() },
  order_receiver_pay: { findUnique: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
  order_receiver_feedback: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverTrackSettings", () => ({
  isTrackingEnabled: jest.fn(),
  getHelpConfig: jest.fn(() => ({ phone: "9109114515", whatsapp: "919109114515" })),
  APP_URL: "https://play.example/app",
}));
jest.mock("../trackEtaService", () => ({ getEta: jest.fn(), getRoute: jest.fn(), clearOrder: jest.fn(), simplify: jest.fn((p) => p) }));
jest.mock("../tripRouteService", () => ({ buildRoute: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../receiverTrackSettings");
const tripRoute = require("../tripRouteService");
const { buildSnapshot, isCompleted, deliveredWindowOpen, loadLinkedOrder } = require("../trackSnapshotService");

const NOW = Date.UTC(2026, 9, 7, 8, 0, 0); // 22.5 h after the 15:00 IST delivery below
const link = { id: 1, order_id: 50, receiver_phone: "9876543210" };
const order = (o = {}) => ({
  id: 50, rid: 9, order_status: 5, o_status: "Completed", dmobile: "98765 43210",
  plat: "22.70", plong: "75.80", dlat: "22.80", dlong: "75.90",
  paddress: "Pickup road", daddress: "Drop road", drop_time: new Date("2026-10-06T15:00:00Z"), ddate: null, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  settings.isTrackingEnabled.mockResolvedValue(true);
  prisma.pkg_order.findUnique.mockResolvedValue(order());
  prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Suresh Kumar", vehicle_no: "MP09AB1234" });
  prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
  prisma.order_settlement.findUnique.mockResolvedValue(null);
  prisma.order_receiver_feedback.findUnique.mockResolvedValue(null);
  tripRoute.buildRoute.mockResolvedValue({
    has_trail: true, distance_km: 4.26,
    points: [{ lat: 22.7, lng: 75.8 }, { lat: 22.75, lng: 75.85 }, { lat: 22.8, lng: 75.9 }],
    pickup: { lat: 22.7, lng: 75.8 }, final_pickup: null, drop: { lat: 22.8, lng: 75.9 },
  });
});

const run = () => buildSnapshot(link, { now: NOW });

describe("delivered summary and trip route", () => {
  it("returns the summary, the trip route as [lat,lng] pairs and the static blocks", async () => {
    const s = await run();
    expect(s).toMatchObject({
      state: "delivered", order_id: 50, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000,
      summary: { driver: { first_name: "Suresh", vehicle_no: "MP09AB1234" }, pickup: { address: "Pickup road" }, drop: { address: "Drop road" }, distance_km: 4.3 },
      trip_route: { has_trail: true, points: [[22.7, 75.8], [22.75, 75.85], [22.8, 75.9]], pickup: { lat: 22.7, lng: 75.8 }, drop: { lat: 22.8, lng: 75.9 } },
      review: { submitted: false },
      help: { phone: "9109114515", whatsapp: "919109114515" },
      app_url: "https://play.example/app",
    });
  });
  it("uses the changed pickup (final_pickup) when the pickup was moved", async () => {
    tripRoute.buildRoute.mockResolvedValue({ has_trail: false, distance_km: 0, points: [], pickup: { lat: 1, lng: 2 }, final_pickup: { lat: 3, lng: 4 }, drop: { lat: 5, lng: 6 } });
    const s = await run();
    expect(s.trip_route).toEqual({ has_trail: false, points: [], pickup: { lat: 3, lng: 4 }, drop: { lat: 5, lng: 6 } });
    expect(s.summary.distance_km).toBeNull();
  });
  it("a failing route builder only blanks the route; the rest of the screen is intact", async () => {
    tripRoute.buildRoute.mockRejectedValue(new Error("db"));
    const s = await run();
    expect(s.trip_route).toBeNull();
    expect(s.summary.driver).toEqual({ first_name: "Suresh", vehicle_no: "MP09AB1234" });
    expect(s.help.phone).toBe("9109114515");
  });
  it("a missing driver gives driver null", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    expect((await run()).summary.driver).toBeNull();
  });
  it("is still delivered when the review table cannot be read", async () => {
    prisma.order_receiver_feedback.findUnique.mockRejectedValue(new Error("no table"));
    expect((await run()).review).toEqual({ submitted: false });
  });
  it("review.submitted is true when a review exists", async () => {
    prisma.order_receiver_feedback.findUnique.mockResolvedValue({ id: 1 });
    expect((await run()).review).toEqual({ submitted: true });
  });
});

describe("pay block (money only for Receiver-pays orders)", () => {
  const settlement = (o = {}) => ({ payer: "receiver", status: "pending", amount_due: 100, receiver_markup: 3, ...o });
  it("an order without a Receiver-pays row has no pay block and no money field anywhere", async () => {
    const s = await run();
    expect(s.pay).toBeNull();
    const text = JSON.stringify(s);
    for (const key of ["amount_due", "markup", "total\"", "fare", "wallet", "otp"]) expect(text).not.toContain(key);
  });
  it("payable while the settlement is receiver / pending", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status: "active" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    expect((await run()).pay).toEqual({ state: "payable", amount_due: 100, markup: 3, total: 103 });
  });
  it("paid once the row is paid (cash or online), with the total that was due", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status: "paid" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "cash_received" }));
    expect((await run()).pay).toEqual({ state: "paid", amount_due: 100, markup: 3, total: 103 });
  });
  it.each(["declined", "closed"])("no pay block when the row is %s", async (status) => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ payer: "customer" }));
    expect((await run()).pay).toBeNull();
  });
  it("no pay block when the settlement is missing, or an active row's settlement is not pending", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({ status: "active" });
    expect((await run()).pay).toBeNull();
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "disputed" }));
    expect((await run()).pay).toBeNull();
  });
});

describe("delivered extras are delivered-only", () => {
  it("an active order carries none of them", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 3, o_status: "On_Route", drop_time: null }));
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    const s = await run();
    for (const key of ["summary", "trip_route", "pay", "review", "help", "app_url"]) expect(s).not.toHaveProperty(key);
  });
  it("a cancelled or expired order carries none of them", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 4, o_status: "Cancelled" }));
    expect(Object.keys(await run()).sort()).toEqual(["order_id", "poll_ms", "state"]);
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    const late = await buildSnapshot(link, { now: Date.UTC(2026, 9, 7, 10, 0, 0) });
    expect(late).toEqual({ state: "expired", poll_ms: 15000 });
  });
});

describe("exported helpers", () => {
  it("isCompleted / deliveredWindowOpen", () => {
    expect(isCompleted({ order_status: 5, o_status: "x" })).toBe(true);
    expect(isCompleted({ order_status: 3, o_status: "Completed" })).toBe(true);
    expect(isCompleted({ order_status: 3, o_status: "On_Route" })).toBe(false);
    const o = order();
    expect(deliveredWindowOpen(o, NOW)).toBe(true);
    expect(deliveredWindowOpen(o, Date.UTC(2026, 9, 7, 10, 0, 0))).toBe(false);
    expect(deliveredWindowOpen(order({ drop_time: null }), NOW)).toBe(true);
  });
  it("loadLinkedOrder gives a reason when the flag is off or the number changed", async () => {
    settings.isTrackingEnabled.mockResolvedValue(false);
    expect(await loadLinkedOrder(link)).toEqual({ reason: "expired" });
    settings.isTrackingEnabled.mockResolvedValue(true);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9000000000" }));
    expect(await loadLinkedOrder(link)).toEqual({ reason: "invalid" });
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    expect((await loadLinkedOrder(link)).order.id).toBe(50);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/trackSnapshotDelivered.test.js`
Expected: FAIL (no `isCompleted`, no extras, `tripRouteService` mock path unused).

- [x] **Step 3: Implement in `trackSnapshotService.js`**

Add requires next to the existing ones:

```js
const tripRouteService = require("./tripRouteService");
const { receiverPayable } = require("./receiverPayCalc");
```

Add after `firstName` (before `toPoint`):

```js
const ORDER_SELECT = {
  id: true, rid: true, order_status: true, o_status: true, dmobile: true,
  plat: true, plong: true, dlat: true, dlong: true, paddress: true, daddress: true, drop_time: true, ddate: true,
};

// drop_time / ddate hold IST wall-clock values (see driverOrderHistoryController).
const deliveredAt = (order) => order.drop_time || order.ddate || null;
const isCompleted = (order) => Number(order.order_status) === 5 || order.o_status === "Completed";
function deliveredWindowOpen(order, now) {
  const done = deliveredAt(order);
  return !done || now <= new Date(done).getTime() - IST_OFFSET_MS + EXPIRE_AFTER_DELIVERY_MS;
}

// The order behind a link, or the reason there is none. The link belongs to the order's current drop
// contact, so a changed number kills the old link. Shared with the pay-link and review endpoints.
async function loadLinkedOrder(link) {
  if (!(await settings.isTrackingEnabled())) return { reason: "expired" };
  const order = await prisma.pkg_order.findUnique({ where: { id: link.order_id }, select: ORDER_SELECT });
  if (!order || normalizeToLast10Digits(order.dmobile) !== link.receiver_phone) return { reason: "invalid" };
  return { order };
}

// Money is only ever shown to a receiver who has to pay (a Receiver-pays row exists).
async function payState(orderId) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId }, select: { status: true } });
  if (!row) return null;
  const s = await prisma.order_settlement.findUnique({
    where: { order_id: orderId }, select: { payer: true, status: true, amount_due: true, receiver_markup: true },
  });
  if (!s) return null;
  const amounts = { amount_due: Number(s.amount_due), markup: Number(s.receiver_markup), total: receiverPayable(s.amount_due, s.receiver_markup) };
  if (row.status === "paid") return { state: "paid", ...amounts };
  if (row.status === "active" && s.payer === "receiver" && s.status === "pending") return { state: "payable", ...amounts };
  return null;
}

async function deliveredExtras(order) {
  const [rider, trip, pay, review] = await Promise.all([
    safe("rider", () => prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { first_name: true, vehicle_no: true } })),
    safe("trip route", () => tripRouteService.buildRoute(prisma, order.id)),
    safe("pay", () => payState(order.id)),
    safe("review", () => prisma.order_receiver_feedback.findUnique({ where: { order_id: order.id }, select: { id: true } })),
  ]);
  const hasTrail = Boolean(trip && trip.has_trail);
  const distance = trip && Number(trip.distance_km) > 0 ? Math.round(Number(trip.distance_km) * 10) / 10 : null;
  return {
    summary: {
      driver: rider ? { first_name: firstName(rider.first_name), vehicle_no: rider.vehicle_no || null } : null,
      pickup: order.paddress ? { address: short(order.paddress) } : null,
      drop: order.daddress ? { address: short(order.daddress) } : null,
      distance_km: distance,
    },
    trip_route: trip
      ? {
          has_trail: hasTrail,
          points: hasTrail ? etaService.simplify(trip.points.map((p) => [p.lat, p.lng])) : [],
          pickup: trip.final_pickup || trip.pickup || null,
          drop: trip.drop || null,
        }
      : null,
    pay,
    review: { submitted: Boolean(review) },
    help: settings.getHelpConfig(),
    app_url: settings.APP_URL,
  };
}
```

Replace the first lines of `buildSnapshot` (the flag check, the `findUnique` with its `select`, the `invalid` check) with:

```js
  const loaded = await loadLinkedOrder(link);
  if (!loaded.order) return { state: loaded.reason, poll_ms: POLL_IDLE_MS };
  const order = loaded.order;
```

and replace the `if (status === 5 || order.o_status === "Completed") { ... }` block with:

```js
  if (isCompleted(order)) {
    etaService.clearOrder(order.id);
    if (!deliveredWindowOpen(order, now)) return { state: "expired", poll_ms: POLL_IDLE_MS };
    const doneAt = deliveredAt(order);
    return {
      state: "delivered", order_id: order.id, step: 5,
      delivered_at: doneAt ? new Date(doneAt).toISOString().replace("Z", "+05:30") : null,
      poll_ms: POLL_IDLE_MS,
      ...(await deliveredExtras(order)),
    };
  }
```

(`status` is still computed from `order.order_status` just above the cancelled check; keep that line.) Change the export to `module.exports = { buildSnapshot, loadLinkedOrder, isCompleted, deliveredWindowOpen };`.

- [x] **Step 4: Update the two existing snapshot tests that assert the old delivered shape**

In `trackSnapshotService.test.js` the mock block gets `simplify: jest.fn((p) => p)` added to the `../trackEtaService` mock and a mock `jest.mock("../tripRouteService", () => ({ buildRoute: jest.fn().mockRejectedValue(new Error("not under test")) }));`; the DB mock gets `order_receiver_pay`, `order_settlement` and `order_receiver_feedback` entries each `{ findUnique: jest.fn().mockResolvedValue(null) }`. The test "is delivered with the IST delivery time, with no position, for 24 hours" changes its `toEqual({...})` to `toMatchObject({ state: "delivered", order_id: 50, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000 })`; "a completed order with no delivery time" already uses `toMatchObject` and stays. The "cancelled" and "expired" tests are unchanged (they must still `toEqual` their small shapes).

- [x] **Step 5: Run the snapshot tests**

Run: `cd backend && npx jest src/services/__tests__/trackSnapshotService.test.js src/services/__tests__/trackSnapshotDelivered.test.js src/controllers/__tests__/trackController.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add backend/src/services/trackSnapshotService.js backend/src/services/__tests__/trackSnapshotService.test.js backend/src/services/__tests__/trackSnapshotDelivered.test.js
git commit -m "feat(receiver-tracking): delivered snapshot with summary, trip route, pay and review state

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pay-link and review endpoints

**Files:**
- Modify: `backend/src/services/receiverPayService.js`, `backend/src/controllers/trackController.js`, `backend/src/routes/trackRoutes.js`, `backend/src/services/__tests__/receiverPayService.test.js` (append), `backend/src/controllers/__tests__/trackController.test.js` (append), `backend/src/controllers/__tests__/trackRoutes.test.js` (update)
- Create: `backend/src/services/trackActionService.js`, `backend/src/services/__tests__/trackActionService.test.js`

**Interfaces:**
- Consumes: Task 2 `loadLinkedOrder`, `isCompleted`, `deliveredWindowOpen`; Task 1 table; existing `receiverPayService` internals (`mintToken`, `buildPayLink`, `ReceiverPayError`, `settings.getReceiverPaySettings`).
- Produces: `receiverPayService.mintLink({ orderId }): Promise<{ link: string }>`; `trackActionService.mintPayLink(link, { now? }): Promise<{ link }>`, `.submitReview(link, body, { now? }): Promise<{ ok: true }>`, `.TrackActionError` (`code`, `message`, `status`), `.ALLOWED_TAGS: Set<string>`; controller handlers `payLink`, `review`; routes `POST /api/track/:token/pay-link` and `/review`.

- [x] **Step 1: Write the failing `mintLink` tests** (append to `receiverPayService.test.js`; it mocks `order_receiver_pay`, `order_settlement` and the settings module already)

```js
describe("receiverPayService.mintLink", () => {
  const row = (o = {}) => ({ id: 3, order_id: 50, status: "active", receiver_phone: "9876543210", link_send_count: 2, link_sent_at: new Date(), ...o });
  const settlement = (o = {}) => ({ payer: "receiver", status: "pending", amount_due: 100, receiver_markup: 3, ...o });
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://api.example.com";
    settings.getReceiverPaySettings.mockResolvedValue({ linkTtlHours: 24 });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(row());
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    prisma.order_receiver_pay.update.mockResolvedValue({});
  });
  it("rotates the pay token, returns the /pay link and neither counts a send nor sends WhatsApp", async () => {
    const { link } = await svc.mintLink({ orderId: 50 });
    expect(link).toMatch(/^https:\/\/api\.example\.com\/pay\/[A-Za-z0-9_-]{43}$/);
    const data = prisma.order_receiver_pay.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ token_hash: expect.any(String), token_expires_at: expect.any(Date) });
    expect(data).not.toHaveProperty("link_send_count");
    expect(data).not.toHaveProperty("link_sent_at");
    const { sendWhatsAppNotification } = require("../../whatsapp/notifications");
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });
  it("NOT_ACTIVE when the row is missing or not active", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(row({ status: "paid" }));
    await expect(svc.mintLink({ orderId: 50 })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });
  it("NOT_PAYABLE when nothing is pending for the receiver", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ payer: "customer" }));
    await expect(svc.mintLink({ orderId: 50 })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    expect(prisma.order_receiver_pay.update).not.toHaveBeenCalled();
  });
  it("NOT_CONFIGURED without PUBLIC_BASE_URL, before touching the token", async () => {
    delete process.env.PUBLIC_BASE_URL;
    await expect(svc.mintLink({ orderId: 50 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(prisma.order_receiver_pay.update).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run to verify they fail**, then implement in `receiverPayService.js`. Replace the top of `issueLink` and add `mintLink`:

Run: `cd backend && npx jest src/services/__tests__/receiverPayService.test.js` -> the `mintLink` tests FAIL (`svc.mintLink is not a function`).

Add before `issueLink`:

```js
// The pay row and settlement an order must be in before a receiver can be given a pay link.
async function loadPayable(orderId) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId } });
  if (!row || row.status !== "active") throw new ReceiverPayError("NOT_ACTIVE", "Receiver payment is not active for this order.");
  const settlement = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!settlement || settlement.payer !== "receiver" || settlement.status !== "pending") {
    throw new ReceiverPayError("NOT_PAYABLE", "There is nothing for the receiver to pay on this order.");
  }
  if (!process.env.PUBLIC_BASE_URL) {
    logger.error("receiverPay: PUBLIC_BASE_URL is not configured; cannot build a pay link.");
    throw new ReceiverPayError("NOT_CONFIGURED", "Payment link is not available right now.");
  }
  return { row, settlement };
}

// Mints a fresh pay token (the previous link stops working). `counted` also records a WhatsApp send.
async function rotatePayToken(row, now, { counted }) {
  const { linkTtlHours } = await settings.getReceiverPaySettings();
  const { token, hash } = mintToken();
  await prisma.order_receiver_pay.update({
    where: { id: row.id },
    data: {
      token_hash: hash,
      token_expires_at: new Date(now.getTime() + linkTtlHours * 3600 * 1000),
      updated_at: now,
      ...(counted ? { link_sent_at: now, link_send_count: { increment: 1 } } : {}),
    },
  });
  return token;
}

// A pay link for the tracking page's "Pay now" button: same token rotation as issueLink, but nothing is
// sent over WhatsApp and it does not count against the resend limit.
async function mintLink({ orderId }) {
  const { row } = await loadPayable(orderId);
  const token = await rotatePayToken(row, new Date(), { counted: false });
  return { link: buildPayLink(token) };
}
```

In `issueLink`, replace everything from the `const row = await prisma.order_receiver_pay.findUnique(...)` line down to and including the `const { token, hash } = mintToken(); await prisma.order_receiver_pay.update({...});` statement with:

```js
  const { row, settlement } = await loadPayable(orderId);
  const now = new Date();
  if (resend) {
    if (row.link_send_count >= MAX_LINK_SENDS) throw new ReceiverPayError("LINK_LIMIT", "The link was already sent too many times.");
    if (row.link_sent_at && now.getTime() - new Date(row.link_sent_at).getTime() < RESEND_COOLDOWN_MS) {
      throw new ReceiverPayError("TOO_SOON", "Please wait a minute before sending the link again.");
    }
  }
  const token = await rotatePayToken(row, now, { counted: true });
```

(the lines after it, from `const link = buildPayLink(token);`, stay as they are). Add `mintLink` to `module.exports`. The existing `issueLink` tests must keep passing unchanged.

- [x] **Step 3: Run** `cd backend && npx jest src/services/__tests__/receiverPayService.test.js src/services/__tests__/receiverPayChangePhone.test.js` -> PASS.

- [x] **Step 4: Write the failing `trackActionService` tests**

```js
// backend/src/services/__tests__/trackActionService.test.js
jest.mock("../../config/db", () => ({ order_receiver_feedback: { findUnique: jest.fn(), create: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../trackSnapshotService", () => ({
  loadLinkedOrder: jest.fn(),
  isCompleted: jest.requireActual("../trackSnapshotService").isCompleted,
  deliveredWindowOpen: jest.requireActual("../trackSnapshotService").deliveredWindowOpen,
}));
jest.mock("../receiverPayService", () => {
  class ReceiverPayError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  return { ReceiverPayError, mintLink: jest.fn() };
});

const prisma = require("../../config/db");
const snapshot = require("../trackSnapshotService");
const pay = require("../receiverPayService");
const svc = require("../trackActionService");

const NOW = Date.UTC(2026, 9, 7, 8, 0, 0);
const link = { id: 1, order_id: 50, receiver_phone: "9876543210" };
const done = (o = {}) => ({ id: 50, rid: 9, order_status: 5, o_status: "Completed", drop_time: new Date("2026-10-06T15:00:00Z"), ...o });

beforeEach(() => {
  jest.clearAllMocks();
  snapshot.loadLinkedOrder.mockResolvedValue({ order: done() });
  prisma.order_receiver_feedback.findUnique.mockResolvedValue(null);
  prisma.order_receiver_feedback.create.mockResolvedValue({});
});

describe("both endpoints only act on a delivered order of this link", () => {
  it.each([
    ["the number changed / flag off", { reason: "invalid" }],
    ["the order is not completed", { order: done({ order_status: 3, o_status: "On_Route" }) }],
    ["the 24 h window is over", { order: done({ drop_time: new Date("2026-10-05T15:00:00Z") }) }],
  ])("refuses when %s", async (_n, loaded) => {
    snapshot.loadLinkedOrder.mockResolvedValue(loaded);
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toMatchObject({ code: "NOT_AVAILABLE", status: 404 });
    await expect(svc.submitReview(link, { driver_rating: 5 }, { now: NOW })).rejects.toMatchObject({ code: "NOT_AVAILABLE", status: 404 });
    expect(pay.mintLink).not.toHaveBeenCalled();
    expect(prisma.order_receiver_feedback.create).not.toHaveBeenCalled();
  });
});

describe("mintPayLink", () => {
  it("returns the pay link for the linked order", async () => {
    pay.mintLink.mockResolvedValue({ link: "https://x/pay/t" });
    expect(await svc.mintPayLink(link, { now: NOW })).toEqual({ link: "https://x/pay/t" });
    expect(pay.mintLink).toHaveBeenCalledWith({ orderId: 50 });
  });
  it("maps NOT_CONFIGURED to 503 and the other pay errors to 409", async () => {
    pay.mintLink.mockRejectedValue(new pay.ReceiverPayError("NOT_CONFIGURED", "off"));
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toMatchObject({ code: "NOT_CONFIGURED", status: 503 });
    pay.mintLink.mockRejectedValue(new pay.ReceiverPayError("NOT_PAYABLE", "nothing"));
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toMatchObject({ code: "NOT_PAYABLE", status: 409 });
  });
  it("lets unexpected errors through", async () => {
    pay.mintLink.mockRejectedValue(new Error("db"));
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toThrow("db");
  });
});

describe("submitReview", () => {
  it("stores the review for the linked order and rider", async () => {
    const out = await svc.submitReview(link, { driver_rating: 5, delivery_rating: 4, tags: ["Safe Driving", "Clean Vehicle"], comment: "  Great  " }, { now: NOW });
    expect(out).toEqual({ ok: true });
    expect(prisma.order_receiver_feedback.create).toHaveBeenCalledWith({
      data: { order_id: 50, rider_id: 9, receiver_phone: "9876543210", driver_rating: 5, delivery_rating: 4, feedback_tags: "Safe Driving, Clean Vehicle", comment: "Great", created_at: expect.any(Date) },
    });
  });
  it("accepts a single rating, no tags and no comment", async () => {
    await svc.submitReview(link, { delivery_rating: 3 }, { now: NOW });
    expect(prisma.order_receiver_feedback.create.mock.calls[0][0].data).toMatchObject({ driver_rating: null, delivery_rating: 3, feedback_tags: null, comment: null });
  });
  it.each([
    [{}], [{ driver_rating: 0 }], [{ driver_rating: 6 }], [{ driver_rating: 4.5 }], [{ driver_rating: "x" }],
    [{ driver_rating: 5, tags: ["Not a tag"] }], [{ driver_rating: 5, tags: "Safe Driving" }],
  ])("rejects invalid input %j", async (body) => {
    await expect(svc.submitReview(link, body, { now: NOW })).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
    expect(prisma.order_receiver_feedback.create).not.toHaveBeenCalled();
  });
  it("cuts the comment at 500 characters and de-duplicates tags", async () => {
    await svc.submitReview(link, { driver_rating: 5, tags: ["Safe Driving", "Safe Driving"], comment: "x".repeat(900) }, { now: NOW });
    const data = prisma.order_receiver_feedback.create.mock.calls[0][0].data;
    expect(data.comment).toHaveLength(500);
    expect(data.feedback_tags).toBe("Safe Driving");
  });
  it("a second review is ALREADY_SUBMITTED (409), also when the insert loses a race", async () => {
    prisma.order_receiver_feedback.findUnique.mockResolvedValue({ id: 1 });
    await expect(svc.submitReview(link, { driver_rating: 5 }, { now: NOW })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED", status: 409 });
    prisma.order_receiver_feedback.findUnique.mockResolvedValue(null);
    prisma.order_receiver_feedback.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(svc.submitReview(link, { driver_rating: 5 }, { now: NOW })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED", status: 409 });
  });
  it("whitelist is exactly the customer app's ten tags", () => {
    expect([...svc.ALLOWED_TAGS].sort()).toEqual([
      "Careful with items", "Careless Handling", "Clean Vehicle", "Delayed Arrival", "Demanded Extra Cash",
      "On-Time Arrival", "Polite & Helpful", "Rash Driving", "Rude Behaviour", "Safe Driving",
    ]);
  });
});
```

- [x] **Step 5: Run to verify it fails**: `cd backend && npx jest src/services/__tests__/trackActionService.test.js` -> FAIL (module missing). Then implement:

```js
// backend/src/services/trackActionService.js
// The two things a receiver can DO from the tracking page after delivery. Both authorize through the
// tracking link: the order must be the link's order, still the link's drop contact, Completed, and
// inside the 24 h delivered window.
const prisma = require("../config/db");
const snapshot = require("./trackSnapshotService");
const receiverPayService = require("./receiverPayService");

class TrackActionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "TrackActionError";
    this.code = code;
    this.status = status;
  }
}

const ALLOWED_TAGS = new Set([
  "Polite & Helpful", "On-Time Arrival", "Careful with items", "Safe Driving", "Clean Vehicle",
  "Delayed Arrival", "Demanded Extra Cash", "Careless Handling", "Rash Driving", "Rude Behaviour",
]);
const COMMENT_MAX = 500;

async function requireDelivered(link, now) {
  const loaded = await snapshot.loadLinkedOrder(link);
  const order = loaded.order;
  if (!order || !snapshot.isCompleted(order) || !snapshot.deliveredWindowOpen(order, now)) {
    throw new TrackActionError("NOT_AVAILABLE", "This link is no longer available.", 404);
  }
  return order;
}

async function mintPayLink(link, { now = Date.now() } = {}) {
  const order = await requireDelivered(link, now);
  try {
    return await receiverPayService.mintLink({ orderId: order.id });
  } catch (err) {
    if (err instanceof receiverPayService.ReceiverPayError) {
      throw new TrackActionError(err.code, err.message, err.code === "NOT_CONFIGURED" ? 503 : 409);
    }
    throw err;
  }
}

function parseRating(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? { ok: true, value: n } : { ok: false };
}

async function submitReview(link, body, { now = Date.now() } = {}) {
  const order = await requireDelivered(link, now);
  const b = body || {};
  const driver = parseRating(b.driver_rating);
  const delivery = parseRating(b.delivery_rating);
  if (!driver.ok || !delivery.ok || (driver.value === null && delivery.value === null)) {
    throw new TrackActionError("VALIDATION", "Please give a rating between 1 and 5.", 400);
  }
  const rawTags = b.tags === undefined || b.tags === null ? [] : b.tags;
  if (!Array.isArray(rawTags) || rawTags.some((t) => typeof t !== "string" || !ALLOWED_TAGS.has(t))) {
    throw new TrackActionError("VALIDATION", "Unknown feedback tag.", 400);
  }
  const tags = [...new Set(rawTags)];
  const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, COMMENT_MAX) : "";

  const existing = await prisma.order_receiver_feedback.findUnique({ where: { order_id: order.id }, select: { id: true } });
  if (existing) throw new TrackActionError("ALREADY_SUBMITTED", "You have already sent your feedback.", 409);
  try {
    await prisma.order_receiver_feedback.create({
      data: {
        order_id: order.id,
        rider_id: Number(order.rid) || 0,
        receiver_phone: link.receiver_phone,
        driver_rating: driver.value,
        delivery_rating: delivery.value,
        feedback_tags: tags.length ? tags.join(", ").slice(0, 255) : null,
        comment: comment || null,
        created_at: new Date(),
      },
    });
  } catch (err) {
    if (err && err.code === "P2002") throw new TrackActionError("ALREADY_SUBMITTED", "You have already sent your feedback.", 409);
    throw err;
  }
  return { ok: true };
}

module.exports = { TrackActionError, ALLOWED_TAGS, mintPayLink, submitReview };
```

- [x] **Step 6: Run** `cd backend && npx jest src/services/__tests__/trackActionService.test.js` -> PASS.

- [x] **Step 7: Write the failing controller and route tests**

Append to `trackController.test.js` (add `jest.mock("../../services/trackActionService", () => { class TrackActionError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } } return { TrackActionError, mintPayLink: jest.fn(), submitReview: jest.fn() }; });` with the other mocks, and `const actions = require("../../services/trackActionService");`):

```js
describe("payLink / review handlers", () => {
  const post = (body) => ({ params: { token: TOKEN }, body });
  beforeEach(() => links.findByToken.mockResolvedValue({ id: 3, order_id: 50, receiver_phone: "9876543210" }));

  it.each(["payLink", "review"])("%s rejects a malformed token with a 404 before any lookup", async (name) => {
    const r = res();
    await c[name]({ params: { token: "../x" }, body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(links.findByToken).not.toHaveBeenCalled();
  });
  it.each(["payLink", "review"])("%s answers 404 for an unknown token", async (name) => {
    links.findByToken.mockResolvedValue(null);
    const r = res();
    await c[name](post({}), r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ ok: false, code: "NOT_AVAILABLE", message: "This link is no longer available." });
  });
  it("payLink returns the url with no-store headers", async () => {
    actions.mintPayLink.mockResolvedValue({ link: "https://x/pay/t" });
    const r = res();
    await c.payLink(post({}), r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }));
    expect(r.json).toHaveBeenCalledWith({ ok: true, url: "https://x/pay/t" });
  });
  it("review passes the body to the service and answers ok", async () => {
    actions.submitReview.mockResolvedValue({ ok: true });
    const r = res();
    await c.review(post({ driver_rating: 5 }), r);
    expect(actions.submitReview).toHaveBeenCalledWith({ id: 3, order_id: 50, receiver_phone: "9876543210" }, { driver_rating: 5 });
    expect(r.json).toHaveBeenCalledWith({ ok: true });
  });
  it("maps a TrackActionError to its status and code", async () => {
    actions.submitReview.mockRejectedValue(new actions.TrackActionError("ALREADY_SUBMITTED", "dup", 409));
    const r = res();
    await c.review(post({ driver_rating: 5 }), r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json).toHaveBeenCalledWith({ ok: false, code: "ALREADY_SUBMITTED", message: "dup" });
  });
  it("an unexpected error is a generic 500", async () => {
    actions.mintPayLink.mockRejectedValue(new Error("secret db detail"));
    const r = res();
    await c.payLink(post({}), r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ ok: false, code: "ERROR", message: "Something went wrong. Please try again." });
  });
});
```

Update `trackRoutes.test.js`: the controller mock becomes `{ snapshot: jest.fn(), page: jest.fn(), payLink: jest.fn(), review: jest.fn() }`, and the API router assertion becomes:

```js
expect(paths(apiRouter)).toEqual(["get /:token x2", "post /:token/pay-link x2", "post /:token/review x2"]);
```

- [x] **Step 8: Run to verify they fail**, then implement the controller handlers and routes.

In `trackController.js` add `const trackActionService = require("../services/trackActionService");` and, before `module.exports`:

```js
const ACTION_FAIL = { ok: false, code: "NOT_AVAILABLE", message: "This link is no longer available." };

// Shared shell of the two POST endpoints: token shape, link lookup, error mapping.
function action(label, run) {
  return async (req, res) => {
    res.set(API_HEADERS);
    const { token } = req.params;
    if (!trackLinkService.isTokenShape(token)) return res.status(404).json(ACTION_FAIL);
    try {
      const link = await trackLinkService.findByToken(token);
      if (!link) return res.status(404).json(ACTION_FAIL);
      return res.json(await run(link, req.body));
    } catch (err) {
      if (err instanceof trackActionService.TrackActionError) {
        return res.status(err.status).json({ ok: false, code: err.code, message: err.message });
      }
      logger.error(`${label} failed:`, err);
      return res.status(500).json({ ok: false, code: "ERROR", message: "Something went wrong. Please try again." });
    }
  };
}

const payLink = action("track pay-link", async (link) => ({ ok: true, url: (await trackActionService.mintPayLink(link)).link }));
const review = action("track review", async (link, body) => trackActionService.submitReview(link, body));
```

and `module.exports = { snapshot, page, payLink, review };`.

In `trackRoutes.js` add before `module.exports`:

```js
const actionLimiter = createIpRateLimiter({ name: "track-action", windowMs: 60000, max: 10 });
apiRouter.post("/:token/pay-link", actionLimiter, controller.payLink);
apiRouter.post("/:token/review", actionLimiter, controller.review);
```

- [x] **Step 9: Run the whole backend suite**

Run: `cd backend && npx jest`
Expected: all PASS except the pre-existing `aadharPdfVerify`.

- [x] **Step 10: Commit**

```bash
git add backend/src
git commit -m "feat(receiver-tracking): pay-link and review endpoints for the delivered screen

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The page: app theme and delivered screen

**Files:**
- Rewrite: `backend/src/controllers/trackPage.js`
- Create: `backend/src/controllers/__tests__/helpers/trackPageHarness.js`, `backend/src/controllers/__tests__/trackPageDelivered.test.js`
- Modify: `backend/src/controllers/__tests__/trackPageBehaviour.test.js` (use the shared harness), `backend/src/controllers/__tests__/trackPage.test.js` (theme assertions), `docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md` (append rows)

**Interfaces:**
- Consumes: the Task 2 delivered snapshot and the Task 3 endpoints (`POST /api/track/<token>/pay-link` answers `{ok, url}`; `POST /api/track/<token>/review` answers `{ok}` or 409 `{ok:false, code:"ALREADY_SUBMITTED"}`).
- Produces: `renderPage(config): string` (unchanged signature); DOM ids used by tests: `summaryCard sumDriver sumPickup sumDrop sumDistance payCard payFare payFeeRow payFee payTotal payBtn paidNote payMsg reviewCard starsDriver starsDelivery tags comment reviewBtn reviewMsg thanksCard helpCard helpCall helpWa appBtn` plus the existing `order status eta stale offline map driverCard driverName driverVehicle call addrCard pickupAddr dropAddr steps cfg`.

- [x] **Step 1: Create the shared harness** (extract and extend what `trackPageBehaviour.test.js` has inline today)

```js
// backend/src/controllers/__tests__/helpers/trackPageHarness.js
// Runs the tracking page script against a minimal hand-written fake DOM (jsdom is not installed and must
// not be added as a dependency). Not a test file: jest only picks up *.test.js.
const { renderPage } = require("../../trackPage");

function makeEl() {
  const el = {
    hidden: false, href: "", className: "", children: [], style: {}, value: "", disabled: false, type: "",
    attrs: {}, handlers: {},
    classList: { add() {}, remove() {} },
    appendChild(c) { el.children.push(c); return c; },
    setAttribute(k, v) { el.attrs[k] = v; },
    addEventListener(ev, fn) { el.handlers[ev] = fn; },
    click() { if (el.handlers.click) el.handlers.click(); },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._t || ""; },
    set(v) { el._t = String(v); if (v === "") el.children = []; },
  });
  return el;
}

// snapshots: array of GET /api/track/<token> bodies (the last one repeats). opts.postReplies maps the last
// path segment of a POST ("review", "pay-link") to { status, body } or an Error (default: 200 {ok:true}).
function boot(snapshots, opts = {}) {
  const html = renderPage({ tileUrl: opts.tileUrl || null, attribution: "" });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const els = {};
  const document = {
    hidden: !!opts.hidden,
    getElementById(id) { return (els[id] = els[id] || makeEl()); },
    createElement() { return makeEl(); },
    addEventListener() {},
  };
  document.getElementById("cfg").textContent = JSON.stringify({ tileUrl: opts.tileUrl || null, attribution: "" });
  document.getElementById("map").hidden = true;
  const timers = [];
  const fetchCalls = [];
  const posts = [];
  const location = { pathname: "/track/abc123", href: "" };
  let i = 0;
  const fetchStub = (url, init) => {
    if (init && init.method === "POST") {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      const reply = (opts.postReplies || {})[String(url).split("/").pop()] || { status: 200, body: { ok: true } };
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ status: reply.status || 200, json: () => Promise.resolve(reply.body) });
    }
    fetchCalls.push(url);
    const body = snapshots[Math.min(i++, snapshots.length - 1)];
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve({ status: body && body.__status ? body.__status : 200, json: () => Promise.resolve(body) });
  };
  const win = opts.L ? { L: opts.L } : {};
  // requestAnimationFrame does not exist in node: the marker animation is a no-op here.
  new Function("document", "location", "fetch", "setTimeout", "clearTimeout", "window", "L", "requestAnimationFrame", "cancelAnimationFrame", script)(
    document, location, fetchStub,
    (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, win, opts.L,
    () => 1, () => {}
  );
  const flush = () => new Promise((r) => setImmediate(r));
  return { els, timers, fetchCalls, posts, location, flush, document };
}

module.exports = { boot, makeEl };
```

In `trackPageBehaviour.test.js` delete the local `makeEl` and `boot` and the `renderPage` require, and add `const { boot } = require("./helpers/trackPageHarness");` at the top; the test bodies stay unchanged (`boot`'s signature and return fields are a superset).

Run: `cd backend && npx jest src/controllers/__tests__/trackPageBehaviour.test.js` -> all existing behaviour tests PASS on the harness (this proves the extraction).

- [x] **Step 2: Write the failing page tests**

Append to `trackPage.test.js`:

```js
describe("app theme", () => {
  const html = renderPage({ tileUrl: null, attribution: "" });
  it("is always light and uses the app orange", () => {
    expect(html).toContain("color-scheme: light");
    expect(html).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(html).toContain("#FF6B35");
    expect(html).toContain("#F7F7F7");
  });
  it("has an inline favicon so the browser does not request /favicon.ico", () => {
    expect(html).toContain('rel="icon" href="data:,"');
  });
  it("contains the delivered blocks", () => {
    for (const id of ["summaryCard", "payCard", "payBtn", "reviewCard", "reviewBtn", "thanksCard", "helpCard", "helpCall", "helpWa", "appBtn"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
```

Create `trackPageDelivered.test.js`:

```js
const { boot } = require("./helpers/trackPageHarness");

const delivered = (extra = {}) => ({
  state: "delivered", order_id: 489, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000,
  summary: { driver: { first_name: "Ravi", vehicle_no: "MP09AB1234" }, pickup: { address: "Pickup road" }, drop: { address: "Drop road" }, distance_km: 4.3 },
  trip_route: null, pay: null, review: { submitted: false },
  help: { phone: "9109114515", whatsapp: "919109114515" }, app_url: "https://play.google.com/store/apps/details?id=com.shifter.online",
  ...extra,
});

describe("delivered screen", () => {
  it("renders the summary as text only and stops polling", async () => {
    const p = boot([delivered({ summary: { driver: { first_name: "<b>Ravi</b>", vehicle_no: "X1" }, pickup: { address: "<i>a</i>" }, drop: { address: "b" }, distance_km: 4.3 } })]);
    await p.flush();
    expect(p.els.status.textContent).toBe("Delivered");
    expect(p.els.summaryCard.hidden).toBe(false);
    expect(p.els.sumDriver.textContent).toBe("<b>Ravi</b> · X1");
    expect(p.els.sumPickup.textContent).toBe("<i>a</i>");
    expect(p.els.sumDistance.textContent).toBe("4.3 km");
    expect(p.timers.length).toBe(0);
  });
  it("shows dashes for missing summary parts", async () => {
    const p = boot([delivered({ summary: { driver: null, pickup: null, drop: null, distance_km: null } })]);
    await p.flush();
    expect(p.els.sumDriver.textContent).toBe("—");
    expect(p.els.sumDistance.textContent).toBe("—");
  });
  it("help links are digit-sanitised and the app button needs https", async () => {
    const p = boot([delivered({ help: { phone: "91 09-114515;x", whatsapp: "91 9109114515" }, app_url: "javascript:alert(1)" })]);
    await p.flush();
    expect(p.els.helpCard.hidden).toBe(false);
    expect(p.els.helpCall.href).toBe("tel:9109114515");
    expect(p.els.helpWa.href).toBe("https://wa.me/919109114515?text=" + encodeURIComponent("Order #489 - I need help"));
    expect(p.els.appBtn.hidden).toBe(true);
    const ok = boot([delivered()]);
    await ok.flush();
    expect(ok.els.appBtn.hidden).toBe(false);
    expect(ok.els.appBtn.href).toBe("https://play.google.com/store/apps/details?id=com.shifter.online");
  });
  it("a cancelled or expired link shows none of the delivered cards", async () => {
    for (const state of ["cancelled", "expired", "invalid"]) {
      const q = boot([{ state, order_id: 489 }]);
      await q.flush();
      for (const id of ["summaryCard", "payCard", "reviewCard", "thanksCard", "helpCard", "appBtn"]) expect(q.els[id].hidden).toBe(true);
    }
  });
});

describe("pay card", () => {
  const payable = { state: "payable", amount_due: 100, markup: 3, total: 103 };
  it("no pay card without a pay block", async () => {
    const p = boot([delivered()]);
    await p.flush();
    expect(p.els.payCard.hidden).toBe(true);
  });
  it("shows fare, fee and total and a Pay button", async () => {
    const p = boot([delivered({ pay: payable })]);
    await p.flush();
    expect(p.els.payCard.hidden).toBe(false);
    expect(p.els.payFare.textContent).toBe("₹100.00");
    expect(p.els.payFeeRow.hidden).toBe(false);
    expect(p.els.payFee.textContent).toBe("₹3.00");
    expect(p.els.payTotal.textContent).toBe("₹103.00");
    expect(p.els.payBtn.hidden).toBe(false);
    expect(p.els.paidNote.hidden).toBe(true);
  });
  it("hides the fee row when there is no fee", async () => {
    const p = boot([delivered({ pay: { ...payable, markup: 0, total: 100 } })]);
    await p.flush();
    expect(p.els.payFeeRow.hidden).toBe(true);
  });
  it("a paid order shows Paid and no button", async () => {
    const p = boot([delivered({ pay: { ...payable, state: "paid" } })]);
    await p.flush();
    expect(p.els.payBtn.hidden).toBe(true);
    expect(p.els.paidNote.hidden).toBe(false);
  });
  it("Pay now posts once and redirects to the pay page; a second click does nothing", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": { status: 200, body: { ok: true, url: "https://api.example.com/pay/tok" } } } });
    await p.flush();
    p.els.payBtn.click();
    p.els.payBtn.click();
    await p.flush();
    expect(p.posts).toEqual([{ url: "/api/track/abc123/pay-link", body: {} }]);
    expect(p.location.href).toBe("https://api.example.com/pay/tok");
    expect(p.els.payBtn.disabled).toBe(true);
  });
  it("never follows a non-http(s) url", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": { status: 200, body: { ok: true, url: "javascript:alert(1)" } } } });
    await p.flush();
    p.els.payBtn.click();
    await p.flush();
    expect(p.location.href).toBe("");
    expect(p.els.payMsg.textContent).not.toBe("");
    expect(p.els.payBtn.disabled).toBe(false);
  });
  it("shows the server message and re-enables the button on failure", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": { status: 503, body: { ok: false, code: "NOT_CONFIGURED", message: "Payment link is not available right now." } } } });
    await p.flush();
    p.els.payBtn.click();
    await p.flush();
    expect(p.els.payMsg.textContent).toBe("Payment link is not available right now.");
    expect(p.els.payBtn.disabled).toBe(false);
    expect(p.location.href).toBe("");
  });
  it("a network error also re-enables the button", async () => {
    const p = boot([delivered({ pay: payable })], { postReplies: { "pay-link": new Error("down") } });
    await p.flush();
    p.els.payBtn.click();
    await p.flush();
    expect(p.els.payMsg.textContent).toMatch(/try again/i);
    expect(p.els.payBtn.disabled).toBe(false);
  });
});

describe("review form", () => {
  it("is shown until a review exists, then a thank-you replaces it", async () => {
    const open = boot([delivered()]);
    await open.flush();
    expect(open.els.reviewCard.hidden).toBe(false);
    expect(open.els.thanksCard.hidden).toBe(true);
    expect(open.els.starsDriver.children.length).toBe(5);
    expect(open.els.starsDelivery.children.length).toBe(5);
    const done = boot([delivered({ review: { submitted: true } })]);
    await done.flush();
    expect(done.els.reviewCard.hidden).toBe(true);
    expect(done.els.thanksCard.hidden).toBe(false);
  });
  it("needs a rating before it posts", async () => {
    const p = boot([delivered()]);
    await p.flush();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.posts).toEqual([]);
    expect(p.els.reviewMsg.textContent).toMatch(/rating/i);
  });
  it("positive tags for 4-5 stars, negative tags for 1-3", async () => {
    const p = boot([delivered()]);
    await p.flush();
    p.els.starsDriver.children[4].click();
    expect(p.els.tags.children.map((c) => c.textContent)).toContain("Safe Driving");
    p.els.starsDriver.children[1].click();
    const labels = p.els.tags.children.map((c) => c.textContent);
    expect(labels).toContain("Rash Driving");
    expect(labels).not.toContain("Safe Driving");
  });
  it("posts ratings, tags and comment once and then thanks the receiver", async () => {
    const p = boot([delivered()]);
    await p.flush();
    p.els.starsDriver.children[4].click();
    p.els.starsDelivery.children[3].click();
    p.els.tags.children.find((c) => c.textContent === "Safe Driving").click();
    p.els.comment.value = "Great driver";
    p.els.reviewBtn.click();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.posts).toEqual([{ url: "/api/track/abc123/review", body: { driver_rating: 5, delivery_rating: 4, tags: ["Safe Driving"], comment: "Great driver" } }]);
    expect(p.els.reviewCard.hidden).toBe(true);
    expect(p.els.thanksCard.hidden).toBe(false);
  });
  it("treats 409 ALREADY_SUBMITTED as done", async () => {
    const p = boot([delivered()], { postReplies: { review: { status: 409, body: { ok: false, code: "ALREADY_SUBMITTED", message: "dup" } } } });
    await p.flush();
    p.els.starsDriver.children[4].click();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.els.thanksCard.hidden).toBe(false);
  });
  it("keeps the form and shows the message on a server error", async () => {
    const p = boot([delivered()], { postReplies: { review: { status: 500, body: { ok: false, code: "ERROR", message: "Something went wrong. Please try again." } } } });
    await p.flush();
    p.els.starsDriver.children[4].click();
    p.els.reviewBtn.click();
    await p.flush();
    expect(p.els.reviewCard.hidden).toBe(false);
    expect(p.els.reviewMsg.textContent).toBe("Something went wrong. Please try again.");
    expect(p.els.reviewBtn.disabled).toBe(false);
  });
});

describe("trip route map", () => {
  function makeL() {
    const calls = { markers: [], lines: [], removed: [], bounds: 0 };
    const L = {
      map: () => ({ setView() { return this; }, fitBounds() { calls.bounds += 1; }, removeLayer(l) { calls.removed.push(l); } }),
      tileLayer: () => ({ addTo() {} }),
      divIcon: () => ({}),
      latLng: (lat, lng) => ({ lat, lng }),
      latLngBounds: (x) => x,
      polyline(pts) { const l = { pts, addTo() { return l; } }; calls.lines.push(l); return l; },
      marker(ll) { const m = { ll, sets: [], addTo() { return m; }, setLatLng(v) { m.sets.push(v); }, getElement() { return null; }, getLatLng() { return { lat: ll[0], lng: ll[1] }; } }; calls.markers.push(m); return m; },
    };
    return { L, calls };
  }
  const tiles = "https://t/{z}/{x}/{y}.png";
  const route = { has_trail: true, points: [[1, 2], [3, 4], [5, 6]], pickup: { lat: 1, lng: 2 }, drop: { lat: 5, lng: 6 } };

  it("draws the driven route and the pins, and shows the map", async () => {
    const { L, calls } = makeL();
    const p = boot([delivered({ trip_route: route })], { L, tileUrl: tiles });
    await p.flush();
    expect(p.els.map.hidden).toBe(false);
    expect(calls.lines).toHaveLength(1);
    expect(calls.lines[0].pts).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(calls.markers).toHaveLength(2);
    expect(calls.bounds).toBe(1);
  });
  it("without a trail it shows just the pins", async () => {
    const { L, calls } = makeL();
    const p = boot([delivered({ trip_route: { has_trail: false, points: [], pickup: { lat: 1, lng: 2 }, drop: { lat: 5, lng: 6 } } })], { L, tileUrl: tiles });
    await p.flush();
    expect(calls.lines).toHaveLength(0);
    expect(calls.markers).toHaveLength(2);
  });
  it("removes the live driver marker and live route when the order turns delivered", async () => {
    const { L, calls } = makeL();
    const live = { state: "active", step: 3, poll_ms: 5000, pickup: { lat: 1, lng: 2, address: "a" }, drop: { lat: 5, lng: 6, address: "b" }, route: [[1, 2], [5, 6]], position: { lat: 3, lng: 4, heading: 0, stale: false }, driver: { first_name: "R", phone: "1" } };
    const p = boot([live, delivered({ trip_route: route })], { L, tileUrl: tiles });
    await p.flush();
    p.timers[0].fn();
    await p.flush();
    expect(calls.removed.length).toBeGreaterThanOrEqual(2); // live route line and driver marker
  });
  it("works without Leaflet: the other blocks still render and the map stays hidden", async () => {
    const p = boot([delivered({ trip_route: route, pay: { state: "payable", amount_due: 1, markup: 0, total: 1 } })]);
    await p.flush();
    expect(p.els.map.hidden).toBe(true);
    expect(p.els.summaryCard.hidden).toBe(false);
    expect(p.els.payCard.hidden).toBe(false);
  });
});
```

- [x] **Step 3: Run to verify they fail**: `cd backend && npx jest src/controllers/__tests__/trackPage.test.js src/controllers/__tests__/trackPageDelivered.test.js` -> FAIL (old dark page, no delivered blocks).

- [x] **Step 4: Replace `backend/src/controllers/trackPage.js` with this content**

The file is a template literal: it must not contain a backtick or `${`. In the page script the middle dot and the rupee sign are written as `\\u00B7`, `\\u20B9`, `\\u2605` and `\\u2014` (double backslash in the file, so the page script receives `·` and so on). Keep them as written.

````js
// backend/src/controllers/trackPage.js
// Public receiver tracking page. One inline HTML document, no build step (same approach as
// receiverPayPage.js). All dynamic text is set with textContent; the only HTML strings below are
// static literals. The map is a progressive enhancement: without Leaflet or tiles everything except
// the map still works. Light app theme only (orange #FF6B35).
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>Shifter Online - Track delivery</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" integrity="sha256-tXCrvaljxgtN5LT/Syb5Mm9T+yzPFGH98JVcoJT7JTk=" crossorigin="anonymous">
<style>
  :root { color-scheme: light; --bg:#F7F7F7; --card:#FFFFFF; --text:#202020; --muted:#827E7E; --accent:#FF6B35; --accent2:#FF8A5C; --ok:#0B8A12; --warn:#E68C00; --err:#D93025; --line:#DEE3E7; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:0 12px 28px; }
  header { margin:0 -12px 12px; padding:16px 16px 18px; background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; border-radius:0 0 18px 18px; box-shadow:0 4px 14px rgba(255,107,53,.25); }
  header h1 { font-size:17px; margin:0; font-weight:700; letter-spacing:.2px; } header .sub { opacity:.9; font-size:13px; margin-top:2px; }
  #status { font-size:22px; font-weight:800; margin:10px 0 2px; line-height:1.2; }
  #eta { font-size:15px; font-weight:600; min-height:1.2em; }
  #offline, #stale { font-size:13px; min-height:1.1em; background:rgba(0,0,0,.12); border-radius:8px; padding:0 6px; } #offline:empty, #stale:empty { display:none; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; margin-bottom:10px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
  h2 { font-size:15px; margin:0 0 8px; } .muted { color:var(--muted); font-size:13px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:5px 0; border-bottom:1px solid var(--line); font-size:14px; } .row:last-of-type { border-bottom:0; }
  .row > :last-child { text-align:right; font-weight:600; } .row.total { font-size:17px; font-weight:800; }
  #map { height:46vh; min-height:260px; border-radius:14px; border:1px solid var(--line); margin-bottom:10px; overflow:hidden; }
  ol { list-style:none; margin:4px 0 0; padding:0; }
  li { position:relative; padding:6px 0 6px 28px; color:var(--muted); }
  li::before { content:""; position:absolute; left:6px; top:11px; width:12px; height:12px; border-radius:50%; border:2px solid var(--line); background:var(--card); }
  li.done { color:var(--text); } li.done::before { background:var(--accent); border-color:var(--accent); }
  li.current { color:var(--text); font-weight:700; } li.current::before { border-color:var(--accent); box-shadow:0 0 0 4px rgba(255,107,53,.2); }
  .driver { display:flex; align-items:center; justify-content:space-between; gap:12px; } .driver b { display:block; }
  .btn { display:block; width:100%; text-align:center; background:var(--accent); color:#fff; text-decoration:none; border:0; border-radius:12px; padding:13px 16px; font:inherit; font-weight:700; cursor:pointer; margin-top:10px; }
  .btn.ghost { background:#fff; color:var(--accent); border:1.5px solid var(--accent); } .btn:disabled { opacity:.6; cursor:default; }
  a.call { background:var(--accent); color:#fff; text-decoration:none; padding:10px 16px; border-radius:10px; font-weight:700; white-space:nowrap; }
  .ok { color:var(--ok); font-weight:700; margin-top:8px; } .err { color:var(--err); font-size:13px; min-height:1.1em; margin-top:6px; }
  .stars { display:flex; gap:6px; margin:4px 0 10px; } .star { background:none; border:0; font-size:30px; line-height:1; color:var(--line); cursor:pointer; padding:0 2px; } .star.on { color:#F5A623; }
  .tags { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; } .tag { background:#fff; border:1.5px solid var(--line); color:var(--text); border-radius:999px; padding:6px 12px; font:inherit; font-size:13px; cursor:pointer; } .tag.on { border-color:var(--accent); background:rgba(255,107,53,.1); color:var(--accent); font-weight:700; }
  textarea { width:100%; min-height:70px; border:1.5px solid var(--line); border-radius:10px; padding:10px; font:inherit; font-size:14px; resize:vertical; }
  .pin { width:14px; height:14px; border-radius:50%; border:3px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,.45); } .pin.p { background:#1a73e8; } .pin.d { background:#d93025; }
  .car { width:34px; height:34px; } .car > div { width:34px; height:34px; transition:transform .3s linear; }
  .car svg { width:34px; height:34px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); } .car.stale svg { opacity:.45; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Shifter Online</h1>
    <div class="sub" id="order"></div>
    <div id="status">Loading...</div>
    <div id="eta"></div>
    <div id="stale"></div>
    <div id="offline"></div>
  </header>
  <div id="map" hidden></div>
  <div class="card" id="driverCard" hidden>
    <div class="driver">
      <div><b id="driverName"></b><span class="muted" id="driverVehicle"></span></div>
      <a class="call" id="call" href="#">Call driver</a>
    </div>
  </div>
  <div class="card" id="addrCard" hidden>
    <div class="muted">Pickup</div><div id="pickupAddr"></div>
    <div class="muted" style="margin-top:8px">Drop</div><div id="dropAddr"></div>
  </div>
  <div class="card" id="summaryCard" hidden>
    <h2>Trip summary</h2>
    <div class="row"><span class="muted">Driver</span><span id="sumDriver"></span></div>
    <div class="row"><span class="muted">Pickup</span><span id="sumPickup"></span></div>
    <div class="row"><span class="muted">Drop</span><span id="sumDrop"></span></div>
    <div class="row"><span class="muted">Distance</span><span id="sumDistance"></span></div>
  </div>
  <div class="card" id="payCard" hidden>
    <h2>Payment</h2>
    <div class="row"><span class="muted">Fare</span><span id="payFare"></span></div>
    <div class="row" id="payFeeRow"><span class="muted">Service fee</span><span id="payFee"></span></div>
    <div class="row total"><span>Total</span><span id="payTotal"></span></div>
    <button class="btn" id="payBtn" type="button">Pay now</button>
    <div class="ok" id="paidNote" hidden>Paid &#10003;</div>
    <div class="err" id="payMsg" role="status"></div>
  </div>
  <div class="card" id="reviewCard" hidden>
    <h2>Rate your delivery</h2>
    <div class="muted">Driver</div><div class="stars" id="starsDriver"></div>
    <div class="muted">Delivery</div><div class="stars" id="starsDelivery"></div>
    <div class="tags" id="tags"></div>
    <textarea id="comment" maxlength="500" placeholder="Anything else? (optional)"></textarea>
    <button class="btn" id="reviewBtn" type="button">Submit</button>
    <div class="err" id="reviewMsg" role="status"></div>
  </div>
  <div class="card" id="thanksCard" hidden><div class="ok">Thanks for your feedback &#10003;</div></div>
  <div class="card" id="helpCard" hidden>
    <h2>Need help?</h2>
    <a class="btn ghost" id="helpCall" href="#">Call support</a>
    <a class="btn ghost" id="helpWa" href="#" target="_blank" rel="noopener">WhatsApp</a>
  </div>
  <a class="btn" id="appBtn" href="#" hidden>Get the Shifter Online app</a>
  <div class="card"><ol id="steps"></ol></div>
</main>
<script type="application/json" id="cfg">__CONFIG__</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" integrity="sha256-XJrs/DDkVkUZ29zdzFOkGCJ9zHVo5hnpdi3c7HYJ7Uc=" crossorigin="anonymous"></script>
<script>
(function () {
  var CONFIG = JSON.parse(document.getElementById("cfg").textContent);
  var token = location.pathname.split("/").filter(Boolean).pop();
  var api = "/api/track/" + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  var STEPS = [["assigned", "Driver assigned"], ["reached_pickup", "Reached pickup"], ["on_the_way", "On the way"], ["reached_drop", "Reached drop"], ["delivered", "Delivered"]];
  var HEADLINES = { 0: "Looking for a driver", 1: "Driver is heading to the pickup point", 2: "Driver reached the pickup point", 3: "Your parcel is on the way", 4: "Driver has reached your location", 5: "Delivered" };
  var POSITIVE = ["Polite & Helpful", "On-Time Arrival", "Careful with items", "Safe Driving", "Clean Vehicle"];
  var NEGATIVE = ["Delayed Arrival", "Demanded Extra Cash", "Careless Handling", "Rash Driving", "Rude Behaviour"];
  var CAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="#FF6B35" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var DELIVERED_CARDS = ["summaryCard", "payCard", "reviewCard", "thanksCard", "helpCard", "appBtn"];
  var map = null, driverMarker = null, pickupMarker = null, dropMarker = null, routeLine = null, fitted = false;
  var timer = null, pollMs = 5000, failures = 0, anim = null, lastKey = "";
  var rating = { driver: 0, delivery: 0 }, chosen = {}, stars = { driver: [], delivery: [] }, reviewBuilt = false, paying = false, sending = false;

  function setText(id, text) { $(id).textContent = text || ""; }
  function terminal(state) { return state === "delivered" || state === "cancelled" || state === "expired" || state === "invalid"; }
  function money(n) { return "\\u20B9" + Number(n).toFixed(2); }
  function digits(v) { return String(v || "").replace(/[^0-9]/g, ""); }

  function renderSteps(step) {
    var ol = $("steps"); ol.textContent = "";
    for (var i = 0; i < STEPS.length; i++) {
      var li = document.createElement("li");
      var n = i + 1;
      li.textContent = STEPS[i][1];
      if (n < step || (n === step && step === 5)) li.className = "done";
      else if (n === step) li.className = "current";
      ol.appendChild(li);
    }
  }

  function fmtDelivered(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return "Delivered on " + d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function ensureMap() {
    if (map) return true;
    if (!window.L || !CONFIG.tileUrl) return false;
    try {
      $("map").hidden = false;
      map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20.5937, 78.9629], 5);
      L.tileLayer(CONFIG.tileUrl, { maxZoom: 19, attribution: CONFIG.attribution }).addTo(map);
      return true;
    } catch (e) { map = null; $("map").hidden = true; return false; }
  }

  function pinIcon(cls) { return L.divIcon({ className: "", html: '<div class="pin ' + cls + '"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }); }
  function carIcon() { return L.divIcon({ className: "car", html: "<div>" + CAR_SVG + "</div>", iconSize: [34, 34], iconAnchor: [17, 17] }); }

  function moveDriver(pos) {
    var to = L.latLng(pos.lat, pos.lng);
    if (!driverMarker) { driverMarker = L.marker(to, { icon: carIcon(), interactive: false }).addTo(map); }
    var el = driverMarker.getElement();
    if (el) {
      if (pos.stale) el.classList.add("stale"); else el.classList.remove("stale");
      var inner = el.firstChild;
      if (inner && inner.style) inner.style.transform = "rotate(" + (Number(pos.heading) || 0) + "deg)";
    }
    var from = driverMarker.getLatLng();
    if (anim) cancelAnimationFrame(anim);
    var start = null, dur = Math.min(pollMs, 4000);
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      driverMarker.setLatLng([from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t]);
      if (t < 1) anim = requestAnimationFrame(frame);
    }
    anim = requestAnimationFrame(frame);
  }

  // Pickup and drop pins; existing pins follow a changed coordinate.
  function placePins(pickup, drop) {
    if (pickup) {
      if (!pickupMarker) pickupMarker = L.marker([pickup.lat, pickup.lng], { icon: pinIcon("p"), interactive: false }).addTo(map);
      else pickupMarker.setLatLng([pickup.lat, pickup.lng]);
    }
    if (drop) {
      if (!dropMarker) dropMarker = L.marker([drop.lat, drop.lng], { icon: pinIcon("d"), interactive: false }).addTo(map);
      else dropMarker.setLatLng([drop.lat, drop.lng]);
    }
  }

  function drawMap(s) {
    if (!(s.pickup || s.drop || s.position)) return;
    if (!ensureMap()) return;
    var pts = [];
    if (s.route && s.route.length > 1) {
      var key = s.route.length + ":" + s.route[0] + ":" + s.route[s.route.length - 1];
      if (key !== lastKey) { if (routeLine) map.removeLayer(routeLine); routeLine = L.polyline(s.route, { color: "#1a73e8", weight: 5, opacity: 0.8 }).addTo(map); lastKey = key; }
      pts = pts.concat(s.route);
    }
    placePins(s.pickup, s.drop);
    if (s.pickup) pts.push([s.pickup.lat, s.pickup.lng]);
    if (s.drop) pts.push([s.drop.lat, s.drop.lng]);
    if (s.position) { moveDriver(s.position); pts.push([s.position.lat, s.position.lng]); }
    if (!fitted && pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 }); fitted = true; }
  }

  // After delivery: the route the driver actually drove plus the two pins; the live marker and route go away.
  function drawTripRoute(tr) {
    if (!tr || !(tr.pickup || tr.drop || (tr.points && tr.points.length))) { if (map) $("map").hidden = true; return; }
    if (!ensureMap()) return;
    $("map").hidden = false;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    lastKey = "";
    var pts = [];
    if (tr.points && tr.points.length > 1) {
      routeLine = L.polyline(tr.points, { color: "#1a73e8", weight: 5, opacity: 0.8 }).addTo(map);
      pts = pts.concat(tr.points);
    }
    placePins(tr.pickup, tr.drop);
    if (tr.pickup) pts.push([tr.pickup.lat, tr.pickup.lng]);
    if (tr.drop) pts.push([tr.drop.lat, tr.drop.lng]);
    if (pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 }); fitted = true; }
  }

  function post(path, body) {
    return fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  // ---- review form ----
  function paintStars(group) {
    for (var i = 0; i < 5; i++) stars[group][i].className = "star" + (i < rating[group] ? " on" : "");
  }
  function buildStars(group, boxId) {
    var box = $(boxId); box.textContent = ""; stars[group] = [];
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "star"; b.textContent = "\\u2605";
        b.setAttribute("aria-label", n + (n === 1 ? " star" : " stars"));
        b.addEventListener("click", function () { rating[group] = n; paintStars(group); if (group === "driver") buildTags(); });
        box.appendChild(b); stars[group].push(b);
      })(i);
    }
  }
  function buildTags() {
    var list = rating.driver > 0 && rating.driver <= 3 ? NEGATIVE : POSITIVE;
    var box = $("tags"); box.textContent = "";
    var keep = {};
    for (var i = 0; i < list.length; i++) {
      (function (label) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = label; b.className = "tag" + (chosen[label] ? " on" : "");
        if (chosen[label]) keep[label] = true;
        b.addEventListener("click", function () { chosen[label] = !chosen[label]; b.className = "tag" + (chosen[label] ? " on" : ""); });
        box.appendChild(b);
      })(list[i]);
    }
    chosen = keep;
  }
  function ensureReviewForm() {
    if (reviewBuilt) return;
    buildStars("driver", "starsDriver"); buildStars("delivery", "starsDelivery"); buildTags(); reviewBuilt = true;
  }
  function thanks() { $("reviewCard").hidden = true; $("thanksCard").hidden = false; }

  $("reviewBtn").addEventListener("click", function () {
    if (sending) return;
    if (!rating.driver && !rating.delivery) { setText("reviewMsg", "Please give a rating first."); return; }
    sending = true; $("reviewBtn").disabled = true; setText("reviewMsg", "");
    var tags = []; for (var k in chosen) { if (chosen[k]) tags.push(k); }
    var fail = function (msg) { sending = false; $("reviewBtn").disabled = false; setText("reviewMsg", msg || "Could not send your feedback. Please try again."); };
    post("/review", { driver_rating: rating.driver || undefined, delivery_rating: rating.delivery || undefined, tags: tags, comment: $("comment").value })
      .then(function (x) {
        if ((x.body && x.body.ok) || x.status === 409) { sending = false; $("reviewBtn").disabled = false; thanks(); return; }
        fail(x.body && x.body.message);
      })
      .catch(function () { fail(); });
  });

  // ---- pay ----
  $("payBtn").addEventListener("click", function () {
    if (paying) return;
    paying = true; $("payBtn").disabled = true; setText("payMsg", "");
    var fail = function (msg) { paying = false; $("payBtn").disabled = false; setText("payMsg", msg || "Could not start the payment. Please try again."); };
    post("/pay-link", {})
      .then(function (x) {
        if (x.body && x.body.ok && /^https?:\\/\\//.test(String(x.body.url || ""))) { location.href = x.body.url; return; }
        fail(x.body && x.body.ok ? "" : (x.body && x.body.message));
      })
      .catch(function () { fail(); });
  });

  function renderDelivered(s) {
    setText("status", "Delivered"); setText("eta", fmtDelivered(s.delivered_at)); renderSteps(5);
    var sm = s.summary;
    if (sm) {
      $("summaryCard").hidden = false;
      var d = sm.driver;
      setText("sumDriver", d && d.first_name ? d.first_name + (d.vehicle_no ? " \\u00B7 " + d.vehicle_no : "") : "\\u2014");
      setText("sumPickup", sm.pickup && sm.pickup.address ? sm.pickup.address : "\\u2014");
      setText("sumDrop", sm.drop && sm.drop.address ? sm.drop.address : "\\u2014");
      setText("sumDistance", sm.distance_km != null ? sm.distance_km + " km" : "\\u2014");
    }
    drawTripRoute(s.trip_route);
    var p = s.pay;
    if (p) {
      $("payCard").hidden = false;
      setText("payFare", money(p.amount_due)); setText("payTotal", money(p.total));
      $("payFeeRow").hidden = !(Number(p.markup) > 0); setText("payFee", money(p.markup));
      $("payBtn").hidden = p.state === "paid"; $("paidNote").hidden = p.state !== "paid";
    }
    if (s.review && s.review.submitted) { $("thanksCard").hidden = false; }
    else { $("reviewCard").hidden = false; ensureReviewForm(); }
    if (s.help) {
      $("helpCard").hidden = false;
      $("helpCall").href = "tel:" + digits(s.help.phone);
      $("helpWa").href = "https://wa.me/" + digits(s.help.whatsapp) + "?text=" + encodeURIComponent("Order #" + s.order_id + " - I need help");
    }
    if (/^https:\\/\\//.test(String(s.app_url || ""))) { $("appBtn").href = s.app_url; $("appBtn").hidden = false; }
  }

  function render(s) {
    setText("order", s.order_id ? "Order #" + s.order_id : "");
    $("driverCard").hidden = true; $("addrCard").hidden = true;
    for (var c = 0; c < DELIVERED_CARDS.length; c++) $(DELIVERED_CARDS[c]).hidden = true;
    setText("eta", ""); setText("stale", "");
    if (s.state === "invalid" || s.state === "expired" || s.state === "cancelled") {
      var msg = s.state === "cancelled" ? "This order was cancelled" : s.state === "expired" ? "This tracking link has expired" : "This tracking link is no longer valid";
      setText("status", msg); $("steps").textContent = ""; if (map) $("map").hidden = true; return;
    }
    if (s.state === "delivered") { renderDelivered(s); return; }
    if (s.state !== "active") { return; }
    var step = s.step || 0;
    setText("status", HEADLINES[step] || "Tracking");
    renderSteps(step);
    if (s.eta) setText("eta", "Arriving in ~" + s.eta.minutes + " min" + (s.eta.distance_km != null ? " \\u00B7 " + s.eta.distance_km + " km away" : ""));
    if (s.position && s.position.stale) setText("stale", "Waiting for the driver's location");
    if (s.driver && s.driver.first_name) {
      $("driverCard").hidden = false;
      setText("driverName", s.driver.first_name);
      setText("driverVehicle", s.driver.vehicle_no ? " \\u00B7 " + s.driver.vehicle_no : "");
      var phone = String(s.driver.phone || "").replace(/[^0-9+]/g, "");
      if (phone) { $("call").href = "tel:" + phone; $("call").hidden = false; } else { $("call").hidden = true; }
    }
    if (s.pickup || s.drop) {
      $("addrCard").hidden = false;
      setText("pickupAddr", s.pickup ? s.pickup.address : ""); setText("dropAddr", s.drop ? s.drop.address : "");
    }
    drawMap(s);
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(load, pollMs); }

  function load() {
    if (document.hidden) { schedule(); return; }
    fetch(api, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (x) {
        var s = x.body || {};
        // A 429 / proxy error body has no state: keep the last render and back off.
        if (typeof s.state !== "string" || s.state === "error") { throw new Error("server"); }
        failures = 0; setText("offline", "");
        render(s);
        pollMs = s.poll_ms || 5000;
        if (!terminal(s.state)) schedule();
      })
      .catch(function () {
        failures += 1; setText("offline", "Connection problem - retrying...");
        pollMs = Math.min(30000, 5000 * Math.pow(2, Math.min(failures, 3)));
        schedule();
      });
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) { clearTimeout(timer); load(); } });
  load();
})();
</script>
</body>
</html>`;

function renderPage(config) {
  const safe = JSON.stringify({
    tileUrl: (config && config.tileUrl) || null,
    attribution: (config && config.attribution) || "",
  }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__CONFIG__", () => safe);
}

module.exports = { renderPage };
````

- [x] **Step 5: Run the page tests and the syntax check**

Run: `cd backend && npx jest src/controllers/__tests__/trackPage.test.js src/controllers/__tests__/trackPageBehaviour.test.js src/controllers/__tests__/trackPageDelivered.test.js src/controllers/__tests__/trackController.test.js`
Expected: PASS. If an existing `trackPage.test.js` assertion pins something the redesign intentionally removed (the old accent/dark values), update that assertion and say so in your report; do not weaken any safety assertion (SRI pins, `innerHTML`, the JSON config escaping).

Run: `cd backend && node -e "const {renderPage}=require('./src/controllers/trackPage');const h=renderPage({tileUrl:null,attribution:''});const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('page script parses', m[1].length)"`
Expected: `page script parses <n>`.

- [x] **Step 6: Append QA rows** to `docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md` (rows 20-27) and add a short result-log line "Delivered screen and theme: not run on a device yet":

```
| 20 | Open the tracking link on a phone in dark mode | Page is light with the orange header, never dark |
| 21 | Complete a delivery (cash order, no Receiver pays) and open the link | Delivered screen: summary, driven route on the map, rating form, help buttons, app button; NO payment card and no amounts anywhere |
| 22 | Complete a Receiver-pays delivery with a 3% commission | Payment card shows fare, service fee and total; "Pay now" opens the /pay page with the same total; after paying, returning to the tracking link shows "Paid" |
| 23 | Rate 5 stars and pick tags, submit | "Thanks for your feedback"; the Receiver tab in the admin Trip Feedback shows it; reloading the link shows the thank-you, not the form |
| 24 | Rate 2 stars | Negative tags are offered instead of positive ones |
| 25 | Double-tap Pay now / Submit | Only one request goes out |
| 26 | "Call support" and "WhatsApp" | Dialer opens with 9109114515; WhatsApp chat opens with "Order #<id> - I need help" prefilled |
| 27 | Open the link 25 hours after delivery | "This tracking link has expired"; none of the delivered cards show |
```

- [x] **Step 7: Run the whole backend suite**, then commit

Run: `cd backend && npx jest` -> all PASS except the pre-existing `aadharPdfVerify`.

```bash
git add backend/src/controllers docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md
git commit -m "feat(receiver-tracking): app light theme and the delivered screen

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Admin Receiver feedback tab

**Files:**
- Modify: `backend/src/controllers/adminTripFeedbackController.js`, `backend/src/routes/adminRoutes.js`, `frontend/src/pages/TripFeedback.jsx`
- Test: `backend/src/controllers/__tests__/adminReceiverFeedback.test.js`

**Interfaces:**
- Consumes: Task 1 table `order_receiver_feedback`.
- Produces: `adminTripFeedbackController.listReceiverFeedback(req, res)` answering `{ success, data: [{ id, order_id, receiver_mobile, driver_id, driver_name, driver_mobile, pickup, drop, goods_type, driver_rating, delivery_rating, feedback_tags, comment, created_at }], total, page, limit }`; route `GET /api/v1/admin/receiver-feedback`.

- [x] **Step 1: Write the failing backend test**

```js
// backend/src/controllers/__tests__/adminReceiverFeedback.test.js
jest.mock("../../config/db", () => ({
  order_receiver_feedback: { count: jest.fn(), findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const { listReceiverFeedback } = require("../adminTripFeedbackController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = (query = {}, extra = {}) => ({ query, ...extra });
const row = (o = {}) => ({
  id: 1, order_id: 50, rider_id: 9, receiver_phone: "9876543210", driver_rating: 5, delivery_rating: 4,
  feedback_tags: "Safe Driving", comment: "Great", created_at: new Date("2026-10-06T10:00:00Z"), ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.order_receiver_feedback.count.mockResolvedValue(1);
  prisma.order_receiver_feedback.findMany.mockResolvedValue([row()]);
  prisma.pkg_order.findMany.mockResolvedValue([{ id: 50, paddress: "P", daddress: "D", goods_type_name: "Boxes", city_id: 1 }]);
  prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, full_name: "Suresh Patel", fmobile: "9109114515" }]);
});

it("lists receiver feedback joined with the order and driver", async () => {
  const r = res();
  await listReceiverFeedback(req(), r);
  expect(r.status).toHaveBeenCalledWith(200);
  expect(r.json).toHaveBeenCalledWith({
    success: true, total: 1, page: 1, limit: 25,
    data: [{
      id: 1, order_id: 50, receiver_mobile: "9876543210", driver_id: 9, driver_name: "Suresh Patel", driver_mobile: "9109114515",
      pickup: "P", drop: "D", goods_type: "Boxes", driver_rating: 5, delivery_rating: 4,
      feedback_tags: "Safe Driving", comment: "Great", created_at: new Date("2026-10-06T10:00:00Z"),
    }],
  });
});
it("falls back to a placeholder driver name", async () => {
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  const r = res();
  await listReceiverFeedback(req(), r);
  expect(r.json.mock.calls[0][0].data[0].driver_name).toBe("Driver #9");
});
it("filters by rating on either rating column, by date range, and paginates", async () => {
  await listReceiverFeedback(req({ rating: "4", from: "2026-10-01", to: "2026-10-06", page: "2", limit: "10" }), res());
  const args = prisma.order_receiver_feedback.findMany.mock.calls[0][0];
  expect(args.where.OR).toEqual([{ driver_rating: 4 }, { delivery_rating: 4 }]);
  expect(args.where.created_at.gte).toEqual(new Date("2026-10-01T00:00:00"));
  expect(args.where.created_at.lte).toEqual(new Date("2026-10-06T23:59:59"));
  expect(args.skip).toBe(10);
  expect(args.take).toBe(10);
});
it("searches by order id, receiver number or driver name", async () => {
  prisma.tbl_rider.findMany.mockResolvedValueOnce([{ id: 9 }]).mockResolvedValue([{ id: 9, full_name: "Suresh Patel", fmobile: "1" }]);
  await listReceiverFeedback(req({ search: "50" }), res());
  const where = prisma.order_receiver_feedback.findMany.mock.calls[0][0].where;
  expect(where.AND[0].OR).toEqual(expect.arrayContaining([{ order_id: 50 }, { receiver_phone: { contains: "50" } }, { rider_id: { in: [9] } }]));
});
it("limits a city-scoped admin to that city's orders", async () => {
  prisma.pkg_order.findMany.mockResolvedValueOnce([{ id: 50 }]).mockResolvedValue([{ id: 50, paddress: "P", daddress: "D", goods_type_name: "x", city_id: 1 }]);
  await listReceiverFeedback(req({}, { scopedCityId: 1 }), res());
  expect(prisma.pkg_order.findMany.mock.calls[0][0].where).toMatchObject({ city_id: 1 });
  expect(prisma.order_receiver_feedback.findMany.mock.calls[0][0].where.AND[0]).toEqual({ order_id: { in: [50] } });
});
it("answers 500 without leaking details", async () => {
  prisma.order_receiver_feedback.count.mockRejectedValue(new Error("secret"));
  const r = res();
  await listReceiverFeedback(req(), r);
  expect(r.status).toHaveBeenCalledWith(500);
  expect(r.json).toHaveBeenCalledWith({ success: false, message: "Internal server error" });
});
```

- [x] **Step 2: Run to verify it fails**: `cd backend && npx jest src/controllers/__tests__/adminReceiverFeedback.test.js` -> FAIL (`listReceiverFeedback` undefined).

- [x] **Step 3: Implement** in `adminTripFeedbackController.js`: add before `module.exports` and export it.

```js
const RECEIVER_RATING_COLUMNS = ["driver_rating", "delivery_rating"];

/**
 * Admin "Receiver Feedback" tab: the review a receiver left on the public tracking page after delivery.
 * Query: page, limit, search (order id, receiver number or driver name), rating (1-5, either rating),
 * from, to (YYYY-MM-DD). City-scoped admins only see their city's orders.
 */
async function listReceiverFeedback(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const where = {};
    const and = [];
    const rating = parseInt(req.query.rating, 10);
    if (rating >= 1 && rating <= 5) where.OR = RECEIVER_RATING_COLUMNS.map((c) => ({ [c]: rating }));

    if (req.query.from || req.query.to) {
      where.created_at = {};
      if (req.query.from) where.created_at.gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) where.created_at.lte = new Date(`${req.query.to}T23:59:59`);
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const asNumber = parseInt(search, 10);
      const riders = await prisma.tbl_rider.findMany({ where: { full_name: { contains: search } }, select: { id: true }, take: 200 });
      and.push({
        OR: [
          ...(Number.isFinite(asNumber) ? [{ order_id: asNumber }] : []),
          { receiver_phone: { contains: search } },
          ...(riders.length ? [{ rider_id: { in: riders.map((r) => r.id) } }] : []),
        ],
      });
    }
    if (req.scopedCityId) {
      const inCity = await prisma.pkg_order.findMany({ where: { city_id: req.scopedCityId }, select: { id: true } });
      and.push({ order_id: { in: inCity.map((o) => o.id) } });
    }
    if (and.length) where.AND = and;

    const [total, rows] = await Promise.all([
      prisma.order_receiver_feedback.count({ where }),
      prisma.order_receiver_feedback.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    ]);

    const orderIds = rows.map((r) => r.order_id);
    const rids = [...new Set(rows.map((r) => r.rider_id))];
    const [orders, riders] = await Promise.all([
      orderIds.length
        ? prisma.pkg_order.findMany({ where: { id: { in: orderIds } }, select: { id: true, paddress: true, daddress: true, goods_type_name: true, city_id: true } })
        : [],
      rids.length ? prisma.tbl_rider.findMany({ where: { id: { in: rids } }, select: { id: true, full_name: true, fmobile: true } }) : [],
    ]);
    const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const data = rows.map((r) => ({
      id: r.id,
      order_id: r.order_id,
      receiver_mobile: r.receiver_phone,
      driver_id: r.rider_id,
      driver_name: riderById[r.rider_id]?.full_name || `Driver #${r.rider_id}`,
      driver_mobile: riderById[r.rider_id]?.fmobile || null,
      pickup: orderById[r.order_id]?.paddress || null,
      drop: orderById[r.order_id]?.daddress || null,
      goods_type: orderById[r.order_id]?.goods_type_name || null,
      driver_rating: r.driver_rating,
      delivery_rating: r.delivery_rating,
      feedback_tags: r.feedback_tags,
      comment: r.comment,
      created_at: r.created_at,
    }));

    return res.status(200).json({ success: true, data, total, page, limit });
  } catch (err) {
    logger.error("admin receiver feedback list failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
```

Change the export line to `module.exports = { list, listCustomerFeedback, listReceiverFeedback };`. In `adminRoutes.js`, after the `/customer-feedback` route add:

```js
router.get("/receiver-feedback", auth, authorize(...RIDER_ROLES), scopeFilter, adminTripFeedbackController.listReceiverFeedback);
```

- [x] **Step 4: Run to verify it passes**: `cd backend && npx jest src/controllers/__tests__/adminReceiverFeedback.test.js` -> PASS.

- [x] **Step 5: Add the third tab in `frontend/src/pages/TripFeedback.jsx`** (read the file first; make exactly these edits):

1. Import: add `Package` to the `lucide-react` import list (`import { Search, Star, ..., Quote, Package } from 'lucide-react'`).
2. After the `CUSTOMER_HEADERS` constant add:
```js
const RECEIVER_HEADERS = ['Order', 'Receiver', 'Driver', 'Driver Rating', 'Delivery Speed', 'Feedback Tags', 'Receiver Comment', 'Submitted']
```
3. Replace the tab state comment and the endpoint line: `const [tab, setTab] = useState('driver') // 'driver' | 'customer' | 'receiver'` and
```js
const endpoint = tab === 'customer' ? '/customer-feedback' : tab === 'receiver' ? '/receiver-feedback' : '/trip-feedback'
const headers = tab === 'driver' ? DRIVER_HEADERS : tab === 'receiver' ? RECEIVER_HEADERS : CUSTOMER_HEADERS
```
4. In the page subtitle ternary add a receiver case: `: tab === 'receiver' ? 'What receivers said on the public tracking page after delivery: driver rating, delivery speed, tags and comments.' :` before the customer text.
5. After the "Customer Feedback" tab button add a third button identical in structure with `switchTab('receiver')`, `tab === 'receiver'` in its three style conditions, the `<Package size={15} />` icon and the label `Receiver Feedback`.
6. Replace the four `(tab === 'driver' ? DRIVER_HEADERS : CUSTOMER_HEADERS)` occurrences (header map and the three `colSpan`s) with `headers`, and the empty-state text `No {tab === 'driver' ? 'driver' : 'customer'} feedback found.` with ``No {tab} feedback found.``.
7. In the row renderer change the binary `tab === 'driver' ? (...) : (...)` into `tab === 'driver' ? (...) : tab === 'receiver' ? (<>RECEIVER ROW</>) : (...)` where RECEIVER ROW is the customer row's cells with these differences: the "Customer" cell becomes the receiver cell (`<div className="font-mono-data font-medium" style={{ color: 'var(--ink)' }}>{r.receiver_mobile}</div>` with no name line), and there is no "Vehicle Condition" cell. Keep the other cells (order with goods type, driver, driver stars, delivery stars, tags badges, comment with the quote icon, submitted time) byte-for-byte as in the customer row.

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [x] **Step 6: Run the whole backend suite**, then commit

Run: `cd backend && npx jest` -> all PASS except the pre-existing `aadharPdfVerify`.

```bash
git add backend/src frontend/src/pages/TripFeedback.jsx
git commit -m "feat(receiver-tracking): Receiver tab in the admin Trip Feedback page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (against the spec)

- Theme (light, orange tokens, no dark block, favicon): Task 4. ✓
- Delivered screen blocks (summary, route, pay, review, help, app): data in Task 2, UI in Task 4. ✓
- Privacy (money only with a Receiver-pays row; delivered-only extras; token-authorized POSTs, order/number/window checks): Task 2 tests, Task 3 tests. ✓
- Pay via the existing /pay page without WhatsApp and without counting a send: Task 3 `mintLink`. ✓
- Review table, endpoint rules (1-5, whitelist, 500 chars, one per order, 409): Tasks 1 and 3. ✓
- Admin Receiver tab (deviation noted in the spec handoff: a third tab instead of a badge): Task 5. ✓
- Page behaviour (double click, 409, failures, redirect safety, no Leaflet): Task 4 tests. ✓
- Type consistency: `loadLinkedOrder`, `isCompleted`, `deliveredWindowOpen` (Task 2) are used with identical names in Task 3; `mintLink({ orderId })` returns `{ link }` and the controller turns it into `{ ok, url }`; `TrackActionError.status` is what the controller maps; snapshot field names match the page's reads (`summary`, `trip_route`, `pay`, `review`, `help`, `app_url`). ✓
- Placeholder scan: none.
