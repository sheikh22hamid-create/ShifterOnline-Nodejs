# Customise Order: Phase 4 (Stop Timers and Admin Monitoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** Bill extra time at each additional stop against that stop's own selected minutes, and make the admin monitor show everything section 15 of the original request lists.

**Correction to Phase 2:** the trip flow DOES record per-stop events: `arrived_stop_N` and `complete_stop_N` rows in `driver_trip_event` (unique per order and milestone, `created_at` = when the driver tapped). Phase 2's note that stop dwell time could not be measured was wrong; this phase uses those events. No new driver-app action is needed.

**Spec:** `docs/superpowers/specs/2026-10-26-customise-order-bargaining-design.md`; Phase 2 plan for the billing rules.

## Global Constraints
- Same rules as Phase 2: no new rate (`order.wating_charge`), the customer's selected minutes replace the rate card's free minutes, `round2(billedSeconds / 60 * rate)`, never double-charged (upsert by order + segment), audit failure never fails a completion.
- A stop's allowance = that stop's `wait_min + load_min + unload_min` from `customise_order_stop`, matched to the ride's stop by sequence (`seq` N = `arrived_stop_N`).
- A stop with no arrival event, no complete event, or complete before arrival is not billed (no data, no guess).
- Normal rides and Customise rides without stops: unchanged.
- No deletion of the legacy custom-order code (spec: do not remove existing controls); it is listed for the owner to decide.

## Review Focus
- Stop dwell exactly equal to the allowance: charge 0; one second more is charged.
- Driver skipped "complete stop": that stop is not billed, others still are, completion does not fail.
- Two stops billed independently; pickup/drop segments unchanged.
- Admin detail for an order that was reassigned shows every ride (cancelled ones too) with its driver and cancel reason.

## Tasks

### Task 1: Stop segments
**Modify** `backend/src/services/customiseTimerService.js`, test `customiseTimerService.test.js`.
- `stopSegmentsOf({ stops, events, rate }) -> Segment[]` (pure): `stops` = `customise_order_stop` rows, `events` = `[{ milestone, created_at }]`; segment `stop_<seq>`; elapsed = complete - arrival (seconds, floor); `started_at` = arrival, `ended_at` = complete.
- `billFor(order, waitTimer, dropWaitSeconds, endedAt)` also reads the stops and the events and appends the stop segments (total includes them).
- [ ] Failing tests (equal to allowance, one second over, missing complete, complete before arrival, two stops, `billFor` includes them), implement, green, commit.

### Task 2: Admin completeness
**Modify** `customiseOrderController.adminList` (customer mobile) and `adminDetail` (`rides`: every `pkg_order` with `customise_order_id` = this order: id, rid, driver name, o_status, order_status, cancel_reason, total_dcharge, advance_payment, payment_status, cancel_charge), `frontend/src/pages/CustomiseOrders.jsx` (customer name + mobile, "Rides and reassignment history" section, stop segment labels).
- [ ] Failing controller tests, implement, `vite build`, commit.

### Task 3: Wrap-up
- [ ] Full backend suite, memory (also fix the stop-timer note), final report with the legacy-cleanup list.
