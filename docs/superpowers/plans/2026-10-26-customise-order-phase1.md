# Customise Order: Phase 1 (Core Negotiation + Conversion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer posts a detailed Customise Order with a budget; eligible drivers accept or counter; the customer picks one offer; the job becomes a normal assigned `pkg_order` at the agreed fare.

**Architecture:** New `customise_*` tables hold the negotiation (append-only offers, audit events). Acceptance claims the order with a conditional UPDATE, then creates the ride through the existing `createOrderCore` (fare overridden, dispatch skipped) and assigns the driver through the existing `assignRiderToOrder` (repricing skipped), reverting the claim on failure. All behind `app_settings.customise_order_enabled` (default OFF). Legacy `tbl_custom_order*` is untouched.

**Tech Stack:** Node/Express, Prisma (MySQL, hand-applied SQL migration), Socket.io, Jest; React+Vite admin; Flutter customer app; Android Java driver app.

**Spec:** `docs/superpowers/specs/2026-10-26-customise-order-bargaining-design.md` (Phase 1 only: Phases 2-4 are separate plans).

## Global Constraints
- Kill switch `customise_order_enabled` (app_settings, key/value string); OFF/missing = every new endpoint answers `Result:false, msg:"Customise Order is not available"` and driver count is 0.
- New endpoint responses follow the legacy custom-order shape: HTTP 200, `{ Result: true|false, msg, ... }`.
- Times stored UTC `DateTime`; validated with the app's existing IST convention (see `istNow` in `tripLifecycle.js`).
- Offers/events are append-only; never UPDATE an amount, only status.
- Exactly one winner per order: conditional UPDATE on `customise_order.status`.
- No invented rates. Capacity checks use only `pkg_category.max_load_kg`, `dim_length/width/height` (NULL = skip check).
- Apps use `git add -f` for `ShifterOnline/` and `ShifterDriver/` files; commit per task; never push unasked; user's uncommitted Flutter edits (Razorpay key, config.dart, pubspec, wallet etc.) must not be committed.
- Migrations are hand-applied SQL files in `backend/prisma/migrations/<ts>_<name>/migration.sql` plus models in `schema.prisma`.

## Review Focus
- Two drivers accept (or customer accepts two offers) simultaneously: exactly one wins, loser gets "already taken", no duplicate `pkg_order`.
- Conversion fails midway (driver went offline, no package for the category/city): order returns to `open`, no orphan `pkg_order`, customer sees a clear message.
- Order accepted/countered exactly at or after `expires_at` or before `bargain_start_at`: rejected server-side regardless of client clock.
- Driver counters repeatedly: earlier counters become `superseded`, never overwritten; customer sees only the latest active one per driver, history stays in events.
- Overweight/oversize goods with no category chosen: driver whose vehicle cannot carry it cannot see/accept/counter it.
- Retried or double-tapped customer accept (same offer) returns the existing conversion result, not a second order.

## File Structure
- `backend/prisma/migrations/20261027010000_add_customise_order/migration.sql` + models in `schema.prisma`.
- `backend/src/services/customiseOrderRules.js`: pure validation/eligibility functions.
- `backend/src/services/customiseOrderSettings.js`: kill switch and bounds.
- `backend/src/services/customiseOrderService.js`: create, list, offers, accept/counter/dismiss, customer offer decisions, cancel, expiry sweep, events, notifications.
- `backend/src/services/customiseConvertService.js`: claim, create ride, assign, revert.
- `backend/src/controllers/customiseOrderController.js` and routes in `user.routes.js`, `riderRoutes.js`, `adminRoutes.js`.
- Edits: `orderController.js` (`createOrderCore` options), `orderAssignmentService.js` (`assignRiderToOrder` option), `server.js` (sweep).
- Admin: `frontend/src/pages/CustomiseOrders.jsx` (+ route/nav). Customer: `ShifterOnline/lib/screens/customise/*.dart`. Driver: `ShifterDriver/.../activity/CustomiseOrderListActivity.java` + adapter/model + home badge.

---

### Task 1: Schema and migration

**Files:** Create `backend/prisma/migrations/20261027010000_add_customise_order/migration.sql`; Modify `backend/prisma/schema.prisma`; Modify `pkg_order` (add `customise_order_id Int?`).

**Interfaces:** Produces tables/models `customise_order`, `customise_order_stop`, `customise_offer`, `customise_dismissal`, `customise_event` (Prisma delegates of the same names) and `pkg_order.customise_order_id`.

Columns (all tables `id` autoincrement PK):
- `customise_order`: `uid`, `city_id`, `category_id?`, `category_name?`, `status` varchar(20) default 'scheduled' (scheduled|open|converting|converted|expired|cancelled), pickup `p_lat,p_lng` decimal(10,7), `p_address`, `p_exact` tinyint, drop `d_lat,d_lng,d_address`, goods `goods_desc, goods_qty, goods_weight_kg, goods_len_cm, goods_wid_cm, goods_hgt_cm, packing_notes`, pickup handling `p_floor, p_carry_m, p_helpers, p_load_min, p_wait_min, p_notes`, drop handling `d_floor, d_carry_m, d_helpers, d_unload_min, d_wait_min, d_notes`, `initial_fare` decimal(10,2), `p_method_id`, `bargain_start_at`, `expires_at`, `agreed_fare?`, `agreed_rider_id?`, `agreed_offer_id?`, `pkg_order_id?` unique, `created_at`, `updated_at`. Indexes: (`status`,`city_id`), (`uid`), (`expires_at`).
- `customise_order_stop`: `order_id`, `seq`, `lat,lng,address`, `kind` (pickup|drop|both), goods/handling subset (`goods_desc, floor, carry_m, helpers, load_min, unload_min, wait_min, notes`).
- `customise_offer`: `order_id`, `rider_id`, `kind` (accept|counter), `amount` decimal(10,2), `status` (active|accepted|rejected_by_customer|superseded|withdrawn|void), `created_at`, `decided_at?`. Index (`order_id`,`rider_id`,`status`).
- `customise_dismissal`: `order_id`, `rider_id`, `created_at`, unique (`order_id`,`rider_id`).
- `customise_event`: `order_id`, `rider_id?`, `type` varchar(40), `meta` json, `created_at`.

- [ ] **Step 1:** Write the SQL (CREATE TABLE IF NOT EXISTS ... ; `ALTER TABLE pkg_order ADD COLUMN customise_order_id INT NULL, ADD INDEX`) and matching Prisma models.
- [ ] **Step 2:** `cd backend && npx prisma validate && npx prisma generate`. Expected: valid, client generated.
- [ ] **Step 3:** Commit `feat(customise): schema and migration for customise orders` (migration is NOT applied by me: no DATABASE_URL locally; give the user the SQL and the `migrate resolve --applied` command at the end).

### Task 2: Rules (pure) 

**Files:** Create `backend/src/services/customiseOrderRules.js`; Test `backend/src/services/__tests__/customiseOrderRules.test.js`.

**Interfaces:** Produces
- `validateCreate(body, now: Date, bounds) -> { ok: true, value } | { ok: false, errors: string[] }`: required: pickup/drop coordinates+address, `goods_desc`, `goods_qty>0`, `goods_weight_kg>0`, `initial_fare` within `bounds.minFare..maxFare`, `bargain_start_at >= now`, `expires_at > start`, window <= `bounds.maxWindowHours` (default 24), handling numbers non-negative, stops each with own fields; errors name the missing field in plain words.
- `isBiddable(order, now) -> { ok, reason }` (reason: `not_started|expired|not_open`).
- `driverCanCarry(order, category) -> { ok, reason? }` (weight vs `max_load_kg`, dims vs `dim_*` sorted-longest-first; NULL limits skip).
- `driverEligible({ order, rider, category, dismissed, excludedRiderIds }) -> boolean` (rider.status 1, city match, vehicle matches category name when `order.category_name` set, not dismissed/excluded, `driverCanCarry`).

- [ ] **Step 1:** Write failing tests: missing goods weight -> error "Goods weight is required"; expiry before start rejected; start in past rejected; fare below min rejected; `isBiddable` at `now == expires_at` -> expired, before start -> not_started; `driverCanCarry` 600 kg vs 500 kg limit -> not ok, NULL limit -> ok; `driverEligible` false when vehicle mismatches selected category, true when no category and carry ok, false when dismissed.
- [ ] **Step 2:** `npx jest customiseOrderRules` -> FAIL. 
- [ ] **Step 3:** Implement the four functions.
- [ ] **Step 4:** Run again -> PASS. 
- [ ] **Step 5:** Commit `feat(customise): validation and eligibility rules`.

### Task 3: Settings

**Files:** Create `backend/src/services/customiseOrderSettings.js`; Test alongside.

**Interfaces:** Produces `isEnabled() -> Promise<boolean>` (key `customise_order_enabled`, same fail-closed read as `driverCancelRelive.isEnabled` but default OFF), `getBounds() -> Promise<{ minFare, maxFare, maxWindowHours }>` (keys `customise_min_fare` default 50, `customise_max_fare` default 500000, `customise_max_window_hours` default 24).

- [ ] **Step 1:** Tests: missing row -> disabled; "1" -> enabled; DB error -> disabled; bounds defaults.
- [ ] **Step 2-4:** Implement; run -> PASS.
- [ ] **Step 5:** Commit.

### Task 4: Order service (create, lists, offers, decisions)

**Files:** Create `backend/src/services/customiseOrderService.js`; Test `.../__tests__/customiseOrderService.test.js` (prisma mocked, as in `driverCancelRelive.test.js`).

**Interfaces:** Produces (all return `{ ok, msg?, ...data }`, never throw):
- `createOrder(uid, body) -> { ok, order_id }`: validates via rules, writes order (+stops) with status `scheduled` if start in future else `open`, logs `created` event, notifies if open.
- `listOpenForDriver(riderId) -> { orders, count }` and `countOpenForDriver(riderId)`: started, unexpired, status open, eligible, not dismissed, rider has no active offer excluded? (shows with "your offer" flag instead).
- `driverAccept(orderId, riderId)`: re-checks `isBiddable` + eligibility, rider approved/online, inserts `accept` offer at `initial_fare` (supersedes riders previous active offer), event `driver_accept`, notifies customer. Does NOT convert (customer decides) EXCEPT see Spec Case A: accept means the driver takes the customer's price, so it immediately calls `customiseConvertService.convert(orderId, offerId)`; result returned to driver.
- `driverCounter(orderId, riderId, amount)`: validates bounds; previous active offer -> `superseded`; inserts `counter` active; event; `emitCustomerEvent(uid, "customise:offer", ...)`.
- `driverDismiss(orderId, riderId)`: inserts dismissal (idempotent), voids rider's active offer.
- `listOffers(orderId, uid)`: ownership check; active offers with driver first name, vehicle, amount, kind, created_at; plus history count.
- `customerAcceptOffer(orderId, uid, offerId)` -> delegates to convert; `customerRejectOffer(orderId, uid, offerId)` -> offer `rejected_by_customer`, order stays open.
- `customerCancel(orderId, uid)`: only status scheduled|open (Phase 1; post-assignment is Phase 3): status `cancelled`, all active offers `void`, event, `customise:closed` to riders who had offers.
- `expireDue(now) -> number`: open/scheduled with `expires_at <= now` -> `expired`, offers `void`, events.
- `activateDue(now)`: scheduled with start <= now -> `open`, notify eligible drivers (dedupe per order+rider via event type `notified`).
- `notifyEligible(order)`: socket `customise:new` to eligible `driver_<id>` rooms + `pushNotifier` beep, once per (order, rider) using `customise_event type='notified'`.

- [ ] **Step 1:** Failing tests, each named and asserting: `createOrder` rejects invalid and returns status `scheduled` for future start; `driverCounter` after expiry returns `{ ok:false }` and writes nothing; second counter marks first `superseded`; `driverDismiss` twice is one row; `listOffers` for non-owner returns `{ ok:false }`; `expireDue` voids offers; `notifyEligible` second call emits nothing.
- [ ] **Step 2:** Run -> FAIL.
- [ ] **Step 3:** Implement. Use `prisma.$transaction` + `SELECT ... FOR UPDATE` on the `customise_order` row for every offer write so time/status checks and the insert are atomic.
- [ ] **Step 4:** Run -> PASS. 
- [ ] **Step 5:** Commit.

### Task 5: Conversion (claim -> ride -> assign -> revert)

**Files:** Modify `orderController.js` (`createOrderCore`: new optional params `agreedFare`, `skipDispatch`, `customiseOrderId`; when `agreedFare` set it forces `finalTotalCharge/finalDCharge` even with stops, skips `startDispatch`, and writes `customise_order_id`); Modify `orderAssignmentService.js` (`assignRiderToOrder` new `fixedFare` option: skip `priceForPackageId` repricing, set `driver_earning = fixedFare - commission` computed by existing commission rule? **No new rule**: set `driver_earning = fixedFare`, same gross convention as the file's own comment); Create `customiseConvertService.js`; Tests: extend `orderController` tests for the two options, `customiseConvertService.test.js`.

**Interfaces:** Produces `convert(orderId, offerId) -> { ok, pkg_order_id?, msg? }`.
Steps inside `convert`:
1. Conditional `UPDATE customise_order SET status='converting' WHERE id=? AND status='open' AND expires_at > NOW() AND bargain_start_at <= NOW()`; 0 rows -> if `pkg_order_id` already set and offer is the agreed one return it (idempotent), else `{ ok:false, msg:"This order is no longer available" }`.
2. Load offer (must be `active`, same order) and rider; find category by `rider.vehicle` = `pkg_category.cat_name`, package = first active `tbl_package` for `cat_id` + order city; none -> revert, message "No rate card for this vehicle in your city".
3. `createOrderCore({ uid, category: rider.vehicle, deliveryTypeIds:[pkg.id], plat.., stops, description from goods, packageWeight, pMethodId, cityId, agreedFare: offer.amount, skipDispatch: true, customiseOrderId })`.
4. `assignRiderToOrder({ order, riderId, actor:{id:0, username:"customise-order"}, fixedFare: offer.amount, remark:"Customise Order accepted" })`; not ok -> cancel the just-created pkg_order via the same internal helper used by admin cancel with no charge, revert order to `open`, return message.
5. Success: offer `accepted`, other active offers `void`, order `converted` with `agreed_fare/agreed_rider_id/agreed_offer_id/pkg_order_id`, event `converted`, `customise:closed` to other riders, customer socket `customise:converted` with `pkg_order_id`.

- [ ] **Step 1:** Failing tests: success path creates once and sets links; second concurrent `convert` (claim returns 0) creates nothing; assign failure reverts to `open` and cancels the created order; no package -> reverts; repeated call after success returns same `pkg_order_id`; `createOrderCore` with `agreedFare` and stops uses the agreed fare and does not call `startDispatch`.
- [ ] **Step 2:** Run -> FAIL.
- [ ] **Step 3:** Implement all three edits.
- [ ] **Step 4:** Run these tests plus the existing `orderController*`, `orderAssignment*` suites -> PASS (existing behaviour unchanged when options absent).
- [ ] **Step 5:** Commit.

### Task 6: Controllers, routes, sweep

**Files:** Create `controllers/customiseOrderController.js`; Modify `routes/user.routes.js` (`POST /customise/create|my|offers|accept-offer|reject-offer|cancel`), `routes/riderRoutes.js` (`POST /customise/list|count|accept|counter|dismiss`), `routes/adminRoutes.js` (`GET /customise-orders`, `GET /customise-orders/:id` for roles `RIDER_ROLES`-equivalent used by the legacy route, with `scopeFilter`; add both to the approved list in `adminRoutesRbac` test); Modify `server.js` to run `activateDue` + `expireDue` every 30 s next to the other sweeps; Test `customiseOrderController.test.js`.

**Interfaces:** Consumes Task 4/5 services; every handler first checks `customiseOrderSettings.isEnabled()` and takes `uid` / `rider_id` from the body like sibling endpoints; customer handlers verify the order's `uid`, rider handlers verify the offer's `rider_id`.

- [ ] **Step 1:** Failing tests: disabled switch returns `Result:false`; non-owner `offers` denied; count endpoint returns number; admin list is city-scoped.
- [ ] **Step 2-4:** Implement, run, then full `npx jest` -> only the 2 known `aadharPdfVerify` failures remain.
- [ ] **Step 5:** Commit.

### Task 7: Admin monitor page

**Files:** Create `frontend/src/pages/CustomiseOrders.jsx`; Modify `frontend/src/App.jsx` and the nav list. Read-only table (id, customer, pickup->drop, goods, category, initial fare, offers count, agreed fare, driver, start/expiry, status) with a detail drawer showing offers list and events; realtime refresh via `useRealtimeSync` like `OrderRouteMap`.

- [ ] **Step 1:** Build page using the legacy `CustomOrders.jsx` as the layout reference.
- [ ] **Step 2:** `cd frontend && npx vite build` -> succeeds.
- [ ] **Step 3:** Commit.

### Task 8: Customer app (Flutter)

**Files:** Create `ShifterOnline/lib/screens/customise/customise_order_form.dart` (sections: route+stops, goods, pickup handling, drop handling, optional vehicle, fare, start/expiry pickers; per-field validation messages), `customise_order_detail.dart` (status, offers list with driver name/amount/time, Accept/Reject, live updates on `customise:offer`, converted -> push existing order screen/advance payment), `customise_models.dart`; Modify the Home "Customise Order" tile target (`home_option_tiles.dart`) and `Api/config.dart` endpoints (only the added lines; user's other uncommitted edits in these files stay uncommitted: stage with `git add -p` equivalent by committing only new files and using a hunk-limited patch for modified ones).

- [ ] **Step 1:** Implement screens reusing existing location-picker and date-time helper widgets already used by the booking flow.
- [ ] **Step 2:** `flutter analyze` on the new files -> no errors.
- [ ] **Step 3:** Commit exact files with `git add -f`.

### Task 9: Driver app (Android)

**Files:** Create `CustomiseOrderListActivity.java` (+ layout, adapter, model); Modify `HomeFragment.java` (button + WhatsApp-style count badge fed by `/customise/count`, refreshed on `customise:new|closed` socket events) and `NodeService.java` (endpoints); beep via the existing notification channel/sound used for new orders. List card highlights the customer's fare; actions Accept / Counter (amount dialog) / Reject.

- [ ] **Step 1:** Implement; build with `gradlew assembleDebug` (if the local toolchain cannot build, say so and do not claim device testing).
- [ ] **Step 2:** Commit exact files with `git add -f`.

### Task 10: Wrap-up

- [ ] **Step 1:** Full `npx jest`; report exact counts.
- [ ] **Step 2:** Save memory `customise_order.md` (status, migration unapplied, phases 2-4 pending) and index line.
- [ ] **Step 3:** Hand the user: SQL to apply, `migrate resolve --applied`, setting to turn on, rebuild list (admin vite, Flutter APK, Driver APK), and what is untested on device.
