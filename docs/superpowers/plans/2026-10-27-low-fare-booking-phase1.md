# Low Fare Booking: Phase 1 (Backend and Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** A Premium customer's next-day booking is priced at the vehicle's Model-1 fare minus an admin discount, listed to drivers of that vehicle category only between the customer's window start and end, accepted by exactly one driver, and expired when nobody takes it.

**Architecture:** Everything is behind `app_settings.low_fare_booking_enabled` (default OFF) and a new `pkg_order.next_day_stage = 'low_fare'`. `createOrderCore` (booking_type 3 branch only) validates the window, applies the discount and stores the Model-1 fare, percent and window. A new `lowFareService` lists/counts/accepts (atomic conditional UPDATE, then the existing `tripLifecycle.acceptOrder`, the same way the Customise conversion does), a sweep expires unaccepted orders, and `driverCancel` reopens a cancelled `low_fare` order instead of starting the normal search. Old Daily Driver / batch-assign code is untouched.

**Spec:** `docs/superpowers/specs/2026-10-27-low-fare-booking-design.md` (including the manager's answers). Apps are separate plans: customer app (Plan 2), driver app (Plan 3).

## Global Constraints
- Switch OFF = every existing behaviour unchanged; booking types 1 and 2 never touched.
- Fare is computed and validated on the server from the vehicle category's Model-1 package (lowest `sort_order`, no radius charge, existing pricing rules); the client's price is ignored. `discounted = round2(model1 - model1 * percent / 100)`; `next_day_model1_fare`, `next_day_discount_percent` and `d_charge` / `total_dcharge` are saved on the order and never recomputed.
- Premium-only: reuse the existing `PREMIUM_PLAN_REQUIRED` check in `createOrderCore`.
- One window (from, until) on one date: date >= tomorrow IST and <= `low_fare_max_days_ahead` (default 7); from in the future; until after from; window <= `low_fare_max_window_hours` (default 12). Times are IST wall clock stored as UTC instants.
- A driver sees an order only from window start until window end (before the start it is hidden), only if their vehicle equals the order category, they are approved, and they have not cancelled it before (an `order_status_history` row `Driver Cancelled` for that rider).
- Accept = one atomic conditional UPDATE (`rid = 0`, `order_status = 0`, stage `low_fare`, window open) then `tripLifecycle.acceptOrder`; failure reverts and answers "Already Attended" / "No longer available".
- No new penalty; driver cancel uses the existing `applyDriverCancelFee`. No separate trip lifecycle. Hand-applied migration; commit per task; user's uncommitted app edits never committed.

## Review Focus
- Two drivers accept at once: one wins, the other gets "Already Attended", exactly one assignment.
- Accept one second before the window starts or at/after its end: refused on the server whatever the screen showed.
- Driver cancels inside the window: same order id reopens, the cancelling driver no longer sees it, penalty applied once; after the window ends it expires instead.
- Admin changes the discount % later: existing bookings keep their stored fare.
- Window end passes with no driver: order cancelled once, customer notified, never listed again.
- Normal (type 1/2) and old-style next-day orders (switch OFF or stage `arranging`/`live`) behave exactly as before.

## Tasks

### Task 1: Schema
`pkg_order`: `next_day_model1_fare DECIMAL(10,2) NULL`, `next_day_discount_percent DECIMAL(5,2) NULL`, `next_day_live_until DATETIME(0) NULL`. New table `low_fare_view` (`id`, `rider_id`, `order_id`, `seen_at`, unique `rider_id,order_id`) for the unread badge. Migration `20261028010000_add_low_fare_booking` + Prisma.
- [ ] SQL + models, `prisma validate && generate`, commit.

### Task 2: Settings and rules
**Create** `backend/src/services/lowFareSettings.js` (`isEnabled()` fail-closed; `getConfig() -> { discountPercent, maxDaysAhead, maxWindowHours }`, discount clamped 0..50, defaults 20/7/12; `saveConfig`) and `lowFareRules.js` (pure): `validateWindow({ date, from, until }, now, cfg) -> { ok, liveAt, liveUntil } | { ok:false, error }`, `discountedFare(model1, percent) -> { discounted, discountAmount }`, `isOpenNow(order, now)`.
- [ ] Failing tests (each validation message, boundary at exactly from/until, discount rounding, clamp, fail-closed switch), implement, green, commit.

### Task 3: Creation and quote
**Modify** `orderController.createOrderCore` (type 3 branch, only when the switch is ON): requires `lowFareWindow { date, from, until }`; validate via rules; after the Model-1 fare is computed, apply the discount to `finalTotalCharge` / `finalDCharge` / commission (as the Customise `agreedFare` path does), set `next_day_stage = 'low_fare'`, `next_day_live_at` = from, `next_day_live_until` = until, store model1 fare + percent, `schedule_date_time` = the chosen date. Add `POST /api/order/low-fare-quote` returning, for a category and route, `{ model1_fare, discount_percent, final_fare, max_days_ahead, max_window_hours }`.
- [ ] Failing tests (fare math with stops ignored client price, premium refusal, bad windows, switch OFF leaves old behaviour byte-identical), implement, green (existing orderController suites too), commit.

### Task 4: Listing, count, accept
**Create** `backend/src/services/lowFareService.js`: `listForDriver(riderId, now)`, `countForDriver(riderId, now)` (unread = listed and no `low_fare_view` row), `markSeen(riderId, orderIds)`, `accept(orderId, riderId, now)`, `notifyNew(order)` (socket `lowfare:new` to eligible online drivers, deduped), `notifyTaken(order, winnerId)` (socket `lowfare:closed` reason `taken`), `expireDue(now)`.
- [ ] Failing tests for every Review Focus line owned here, implement, green, commit.

### Task 5: Driver cancel and customer cancel
**Modify** `tripLifecycle.driverCancel`: for a `low_fare` order skip guarantee recovery and re-live; in the same transaction as the cancel, if `next_day_live_until` is in the future put the order back to unassigned Pending (stage stays `low_fare`) and afterwards `lowFareService.notifyNew`; otherwise cancel it with the expiry reason. Customer cancel / admin cancel simply cancel it (it disappears from lists).
- [ ] Failing tests (penalty applied once via the existing path, reopen vs expire, cancelling driver excluded), implement, run `tripLifecycle` + `cancelPaymentMatrix` suites, commit.

### Task 6: Routes and sweep
Driver routes (behind `appKeyAuth`): `POST /api/rider/low-fare/list|count|seen|accept`. Customer quote route under `/api/order`. `server.js` 30 s sweep calls `lowFareService.expireDue`.
- [ ] Controller tests (switch OFF answers Result:false, validation, app key present), implement, commit.

### Task 7: Admin
Next Day Orders page: for `low_fare` orders hide assign/offer controls and show Model-1 fare, discount %, final fare, date, window, derived status (Waiting to open / Open / Accepted / Expired / Cancelled), accepting driver. Settings: discount %, switch, max days, max window (dropdown + fields on the Settings page, same pattern as the Customise switch). `listNextDay` returns the new fields.
- [ ] Controller test then UI, `vite build`, commit.

### Task 8: Wrap-up
- [ ] Full backend suite; memory; report migration to apply and what Plans 2 and 3 (apps) still need.
