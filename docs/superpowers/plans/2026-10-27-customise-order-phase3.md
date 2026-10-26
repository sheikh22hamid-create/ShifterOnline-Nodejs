# Customise Order: Phase 3 (Cancellation Policy, Penalties and Relist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** A city admin configures Normal/Special cancellation penalties for Customise rides (driver and customer separately, with an admin share); a driver cancel after assignment reopens the same Customise order in the normal list; a customer cancel closes it.

**Architecture:** Policy lives in `app_settings` (per city, global fallback; absent = Normal = today's behaviour). `customiseCancelService` computes the penalty and handles the Customise side of a cancel. `tripLifecycle.driverCancel` / `customerCancel` consult it for a ride with `pkg_order.customise_order_id`; Normal keeps the existing rate-card fee code untouched. The cancelled ride stays cancelled; the Customise order returns to `open` and a new ride is created on the next acceptance (Phase 1 conversion).

**Spec:** `docs/superpowers/specs/2026-10-26-customise-order-bargaining-design.md` (sections 12-14 and 15 of the original request).

## Global Constraints
- Normal mode, missing/invalid config, or any read error: today's rate-card cancellation logic exactly (never an invented amount).
- Special charge = `fixed + agreedFare * percent / 100`, rounded to 2 decimals, capped at the agreed fare (ruling: a penalty may not exceed what the job paid). Agreed fare = `pkg_order.total_dcharge` of the cancelled ride.
- Admin share = `charge * admin_share_percent / 100` (clamped 0..100) is simply retained by the platform; the remainder goes to the counterparty (driver cancel: customer wallet credit; customer cancel: driver wallet credit) through the existing wallet + ledger rows. No new ledger types.
- Existing idempotency keys on driver-cancel fee rows are reused. Free-cancel cases that already zero the customer's charge (unpaid advance, advance timeout, driver missed ETA, free plan cancellation) stay free in Special mode too.
- Relist only when: ride cancelled by the driver, customer has not cancelled, `expires_at` is in the future. The cancelling driver is added to `customise_dismissal` so they never see it again. Otherwise the Customise order goes `expired` (never relisted).
- A Customise ride must NOT go through the normal driver-cancel re-live/guarantee-recovery search.
- Config writes are `superadmin`/`admin` only, an admin limited to their own city. Hand-applied migration; commit per task; user's uncommitted Flutter/Gradle edits never committed.

## Review Focus
- Driver cancels twice (double tap): one penalty, one relist.
- Driver cancels after the Customise order already expired: no relist, status `expired`.
- Customer cancels the ride: Customise order `cancelled`, never relisted; penalty split admin/driver adds up to the charge exactly (cents).
- Special percent/fixed both 0 or admin share 100: charge 0 or driver gets 0, no negative or NaN amounts.
- Normal-mode Customise ride and every non-Customise ride: unchanged amounts and unchanged re-live behaviour.
- Cancelling driver cannot see/accept/counter the relisted order; other drivers get a fresh beep for it.

## Tasks

### Task 1: Schema
`customise_cancel_fee` (id, order_id [customise order], ride_id, side `driver|customer`, mode `normal|special`, payer_id, recipient_id, agreed_fare, fixed, percent, charge, admin_share, recipient_amount, reason, created_at); unique (`ride_id`,`side`). Migration `20261027030000_add_customise_cancel_fee`.
- [ ] SQL + model, `prisma validate && generate`, commit.

### Task 2: Policy
**Create** `backend/src/services/customiseCancelPolicy.js`, test alongside.
- `penaltyOf(policy, agreedFare) -> { charge, adminShare, recipientAmount }` (pure; `adminShare + recipientAmount === charge`).
- `getPolicy(side, cityId) -> Promise<{ mode, fixed, percent, adminSharePercent }>`: keys `customise_cancel_<side>_<field>` with `_city_<id>` suffix first, then the global key; unreadable/invalid -> `{ mode: "normal" }`.
- `savePolicy(side, cityId, policy) -> Promise<void>` with validation (mode normal|special, fixed >= 0, percent 0..100, share 0..100).
- [ ] Failing tests (cap at fare, cents add up, share clamp, city key beats global, bad config = normal, save validation), implement, green, commit.

### Task 3: Cancel/relist service
**Create** `backend/src/services/customiseCancelService.js`; **modify** `customiseOrderService.js` (`notifyEligible(order, { now, round })` uses event type `notified` for round 0 and `notified_r<N>` after a relist so a relist beeps once).
- `rideInfo(orderId) -> Promise<{ customiseOrderId, agreedFare, cityId } | null>`.
- `feeFor({ side, ride, cityId }) -> Promise<{ special: boolean, charge, adminShare, recipientAmount } >` (special=false means "use the existing rate-card logic").
- `recordFee(client, {...})` writes `customise_cancel_fee` once per (ride, side).
- `afterDriverCancel({ customiseOrderId, riderId, rideId, now })`: lock order; if it is `converted` to this ride: dismiss the driver, then `open` (expiry still ahead; clear agreed_*/pkg_order_id) or `expired`; event `driver_cancelled` (meta rider, ride, fare, relisted); on relist notify customer (socket `customise:relisted` + push) and `notifyEligible` with the next round. Idempotent.
- `afterCustomerCancel({ customiseOrderId, rideId })`: `converted` -> `cancelled`, event, close for the driver.
- [ ] Failing tests for each Review Focus line that belongs here, implement, green, commit.

### Task 4: Lifecycle integration
**Modify** `tripLifecycle.js`: `driverCancel` (skip re-live/recovery for a Customise ride; `applyDriverCancelFee` accepts `feeOverride`; the locked SELECT also reads `customise_order_id, total_dcharge`; after commit call `afterDriverCancel`; customer event carries `customise_relisted`), `customerCancel` (Special penalty replaces the rate-card charge and the driver compensation; `afterCustomerCancel`). **Tests** in `tripLifecycle.test.js`.
- [ ] Failing tests: special driver cancel debits driver / credits customer by the split and relists; normal Customise ride keeps rate-card fee but still relists and skips re-live; customer cancel special split; free-cancel cases stay 0; non-Customise ride unchanged. Implement, run `tripLifecycle` suite and `driverCancelRelive`, commit.

### Task 5: Admin config and monitor
`GET /customise-settings?city_id=`, `PUT /customise-settings` (admin city-scoped), `adminDetail` returns `fees`; page: "Cancellation policy" panel (driver and customer: mode, fixed, percent, admin share) and a "Cancellation and penalties" section in the order drawer.
- [ ] Failing controller tests (city scope, validation), implement, `vite build`, commit.

### Task 6: Wrap-up
- [ ] Full backend suite, memory update, report migration + what is not covered.
