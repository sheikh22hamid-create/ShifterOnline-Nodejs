# Tiered Dispatch (Free -> Daily -> Normal), Penalties and Driver Performance - Design

Date: 2026-10-11
Status: DRAFT - awaiting review (manager request, brainstormed 2026-10-11)

## 1. Purpose

Manager request: orders are offered to drivers in a fixed order of priority, with escalating
penalties for the two priority tiers, a refund flow for Free Booking customers, and an admin report
of driver behaviour.

Definitions
- **Free Driver**: a driver the admin added to the Free Booking offer pool (`free_booking_pool`, valid today, active).
- **Daily Driver**: a driver enrolled in a Daily Driver plan for today AND punched in (`daily_driver_duty_log.status = 'in_progress'`, today).
- **Normal Driver**: every other eligible driver.

Flow: **Free -> Daily -> Normal**, for Free Booking orders. Every other order: **Daily -> Normal**.

This spec covers three deliverables, each gets its own implementation plan, in this order:
1. Tiered dispatch + penalties (backend, driver app popup).
2. Free-driver money flow (refund, receiver pays driver, sender popup).
3. Driver Performance report (event log + admin page).

## 2. Decisions agreed

- Free Driver tier applies only to **premium Free Booking customers** (existing rules unchanged: active customer premium plan, offer ON for the city, instant booking only, user not locked, no other open free booking).
- Daily tier applies to **every** order (this is a behaviour change for all orders, so the whole feature sits behind a setting, default OFF).
- Free/Daily drivers get a **popup offer with Accept / Reject and continuous ringing** until they respond or the timer expires. No force-assign.
- **Skip = the offer timer expiring** (`tbl_order_requests.status = 'timeout'`). **Reject = explicit reject** (status `'10'`). There is no separate Skip button.
- Accepting a Free/Daily order makes completing it mandatory.
- Normal drivers: no penalty for accept/reject/skip.
- Penalty is a **percentage of the order's total fare** on an **escalating ladder**, per driver per tier, **lifetime, never reset automatically**:
  miss 1 = 5%, miss 2 = 10%, miss 3 = 20%, miss 4 = 50%, miss 5 and every later miss = 100%. The ladder values are admin-editable.
  The ladder is a warning ramp: the driver is warned before each penalty (section 5.3).
- Free-order refund = what the sender actually spent on that order (net), not the full invoice (see 6). Booker commission is unaffected.
- Refund is paid only after the receiver's payment is settled.

## 3. Stages

New table `order_dispatch_stage` (`order_id` unique, `stage` in free|daily|normal, `updated_at`), so a restart resumes at the right stage.

- Starting stage at order create (inside dispatch start): `free` if a `free_booking_order` row is `FREE_BOOKING_CONFIRMED`; else `daily` if at least one eligible Daily driver exists; else `normal`. If tiered dispatch is OFF the order starts and stays `normal` (today's behaviour, including today's free-booking pool filter).
- `selectEligibleDrivers(order, ...)` receives the stage and restricts the candidate set:
  - `free`: pool riders (today's pool filter).
  - `daily`: riders punched in today on a Daily plan.
  - `normal`: everyone, excluding riders already offered this order in an earlier stage.
  All other existing filters stay (online, fresh location, radius, no active order, wallet due limit, blocked driver, settlement block).
- A stage ends when all its eligible drivers have been offered (or none is eligible, then immediately). The order then moves to the next stage by restarting dispatch for the order, the same mechanism `checkCascadeTermination` uses today for the free-booking fallback (`startDispatch`). The "No driver found" path and Booking Guarantee run only after the `normal` stage is exhausted, as today.
- Within a stage every eligible driver is offered in turn (existing batch/lock/expiry logic); a reject or skip penalises that driver only, it does not end the stage.
- A driver who was offered in an earlier stage is not offered the same order again in the `normal` stage.
- Free driver accepts, then fails before pickup (cancels / breakdown): the order is re-dispatched from the `daily` stage, the Free Booking row becomes NOT_ELIGIBLE (no refund) and the failed-complete penalty applies. After pickup a failure is handled by the admin (out of scope, no automatic re-dispatch).
- Daily driver rejects/skips: penalty, next Daily driver, then `normal`. Daily driver accepts a Free Booking order: no refund, payer returns to normal rules (receiver pays the full amount to the driver, sender is charged nothing extra).

## 4. Penalty

Tables
- `driver_tier_penalty_setting` (single row): `enabled`, `ladder_pct` JSON (default `[5,10,20,50,100]`), `failed_complete_pct` (default 100), `updated_by`, `updated_at`.
- `driver_tier_penalty_counter` (`rider_id`, `tier` in free|daily, `misses`, `updated_at`; unique on rider+tier).

Rules
- On reject or skip by a Free/Daily driver: `misses += 1` for that tier, `pct = ladder[min(misses, len) - 1]`, `amount = round2(order total fare * pct / 100)`. Debit the driver wallet with a ledger row (`wallet_type = 'driver'`) and reason text; idempotency key `tier_penalty:<order>:<rider>` so one driver is penalised at most once per order. The first event wins: a skip (timeout) is penalised once, and a late reject on the same offer (the app can upgrade `timeout` to `'10'`) adds no second penalty.
- Order total fare = the order's total as shown in the offer (`tripTotal`), at offer time.
- Failed-complete (accepted then cancelled / not completed, section 3): `amount = round2(order total * failed_complete_pct / 100)`; not counted on the ladder.
- Penalty debits are allowed to take the wallet negative (it is a due, consistent with existing driver dues); the existing due limit then blocks new offers.
- Admin can waive a penalty (credits back with a ledger row, event `penalty_waived`) and reset a driver's tier counter. Both are logged with the admin id.

## 5. Driver app and offer payload

5.1 `order:request` payload adds `tier` (free|daily|normal), `order_amount`, `penalty_pct`, `penalty_amount` (what a reject/skip would cost right now; 0 for normal).
5.2 Free/Daily popup: tier badge ("FREE ORDER - completing is mandatory"), the warning "Reject or skip = Rs X penalty (Y%)", Accept / Reject. `OrderAlertPlayer` loops until accept, reject or expiry. After accept the trip screen shows a "mandatory order" note and the cancel action warns with the failed-complete penalty.
5.3 After every penalty the driver gets a notification: "Penalty Rs X applied. Your next skip or reject will cost Rs Y (N%)." From the 5th miss the popup shows "100% penalty = Rs Z".
5.4 Receiver collection reuses the existing receiver-pay collection screen (collect the full fare from the receiver).

## 6. Free-driver money flow

- When a pool driver accepts a Free Booking order, the order's payer becomes the receiver (existing receiver-pay / `order_settlement` with `payer = 'receiver'`): the receiver pays the driver the full invoice (cash or online), as today.
- Refund to the sender = the sender's **net spend on that order** computed from `tbl_wallet_history` for the order (debits such as `advance_apply` and wallet prepayment minus credits already returned). A receiver-paid order's advance stays in the wallet and is not a spend, so it is not refunded twice. Booker commission is paid exactly as today and is not part of the refund.
- The refund is credited once the settlement is `paid_online` or `cash_received` (the existing `tryCredit` / settlement hook, idempotent). Receiver refusal, waived settlement or a vehicle change keep voiding it (existing rules).
- A zero net spend still sends the completion popup, with no credit line.
- After the credit the backend emits a socket event and a push (`free_booking:refunded`, order id, amount). The customer app shows: "Your order was completed by our Free Driver. The order amount has been refunded to your wallet."
- The existing premium lock (until N referrals) is unchanged.
- `freeBookingService.tryCredit` replaces its `decision.amount = actual_fare` with the net-spend figure; the rest of its transaction is unchanged.

## 7. Event log and Driver Performance report

Table `driver_order_event`: `id`, `rider_id`, `order_id`, `tier`, `event` (offered | accepted | rejected | skipped | completed | cancelled | penalty | penalty_waived), `at`, `reason`, `penalty_pct`, `penalty_amount`, `miss_no`, `meta` JSON. Index on `(rider_id, at)` and `(tier, at)`.

Write hooks (all best-effort: a failed log write must never fail dispatch or a trip):
- offered: `dispatchManager.insertOrderRequest`.
- accepted: `tripLifecycle` accept (after the claim succeeds).
- rejected: `tripLifecycle.rejectOrder` (when the row flips to `'10'`).
- skipped: `dispatchManager.scheduleExpiry` timeout path.
- completed / cancelled: `tripLifecycle` completion and driver-cancel paths.
- penalty / penalty_waived: the penalty service.

Admin page "Driver Performance" (React, new route, `scopeFilter` city scoping like other admin pages):
- Per driver: total orders received (distinct offered), accepted (+ drill-down list with date/time), rejected (+ list), skipped (+ list), completed, cancelled, applied penalties (sum + list with reason), acceptance rate = accepted / offered, completion rate = completed / accepted, reject-skip rate = (rejected + skipped) / offered, overall score and status.
- Score = `0.4 * acceptance + 0.4 * completion + 0.2 * (100 - rejectSkip)`; status: Excellent >= 85, Good >= 70, Average >= 50, Poor below (constants in code first).
- Filters: tier (Free / Daily / Normal, taken from the event row, so history is correct if a driver changes category), date range, city, search by driver.
- Admin actions: waive a penalty, reset a driver's tier counter.
- Limitation: data starts from the day the event table goes live.

## 8. Settings and rollout

- Admin settings page (extend the Free Booking page or a new "Dispatch tiers" tab): tiered dispatch ON/OFF, penalty ladder, failed-complete %, penalties ON/OFF.
- Everything is dark by default: tiered dispatch OFF = current behaviour; penalties OFF = events are logged but nothing is debited.
- Migrations: hand-written SQL files, `prisma migrate resolve --applied` on every DB (dev DB has no shadow DB; see the Daily Driver workflow). Apply the SQL on dev, then prod, BEFORE deploying code.
- Driver app change ships behind the payload fields: an old app ignores `tier` and still works (it just lacks the badge and warning, ringing as today).

## 9. Testing

- Pure-rule unit tests: ladder lookup, penalty amount, stage transition, net-spend refund calc.
- Dispatch tests: stage filter per tier, exhaustion moves free -> daily -> normal, no re-offer in normal, tiered dispatch OFF = unchanged.
- Penalty tests: one penalty per (order, rider), reject-after-timeout, waive restores, counter reset, wallet may go negative.
- Free flow tests: refund only after settlement, receiver refusal voids, Daily acceptance voids, failed-complete penalty and re-dispatch.
- Event hooks: each hook writes the right event; a failing log write does not break the trip.
- Manual: driver popup ringing and warning text on a device; customer refund popup; admin report in a browser.

## 10. Assumptions to confirm at review

- A stage offers every eligible driver in turn before moving on (a single driver's reject does not skip the stage).
- Failed-complete uses its own admin-set % (default 100), not the ladder.
- Penalty debits may make a driver wallet negative (a due), relying on the existing due limit to stop new offers.
- Score formula and status bands in section 7.
- After pickup, a Free/Daily driver failure is handled manually by the admin.

## 11. Out of scope / open

- Automatic re-dispatch after a Free/Daily driver fails mid-trip (after pickup).
- Clawback of an already-credited refund.
- Separate Skip button in the driver app.
- Backfilling the report with history from before the event table.
- Customer app changes beyond the refund popup.
