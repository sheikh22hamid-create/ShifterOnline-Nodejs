# Customise Order: Phase 2 (Customer-Selected Timers and Extra Charges) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** On a Customise ride, waiting/loading/unloading beyond the customer's selected minutes is charged at the rate card's existing waiting rate, each segment recorded once for audit.

**Architecture:** At trip completion (`tripLifecycle.updateStatus` "complete") a Customise ride (`pkg_order.customise_order_id`) replaces the pooled rate-card free-minutes formula with per-segment billing: elapsed minus the customer's selected minutes, times `order.wating_charge` (the rate the normal flow already uses). Segment rows are upserted into `customise_order_timer`.

**Spec:** `docs/superpowers/specs/2026-10-26-customise-order-bargaining-design.md` (section 11 of the original request); Phase 1 plan: `2026-10-26-customise-order-phase1.md`.

## Global Constraints
- No new rates: charge = `order.wating_charge` per minute (same rate and rounding as today: `round2(seconds / 60 * rate)`). No separate loading/unloading rate exists in the flow, so the waiting rate applies (the spec's own fallback).
- The rate card's `free_waiting_time` does NOT apply to a Customise ride: the customer's selected minutes replace it. A segment the customer left at 0 is billed from its first second.
- Segments never overlap, so no interval is charged twice: pickup_wait (arrival to pickup OTP), pickup_load (pickup OTP to pickup complete, existing `pickup_load_wait_seconds`), drop (drop arrival to completion; allowance = drop waiting + unloading minutes combined, because the app has no separate "unloading started" event; the drop OTP is asked at completion).
- Normal (non-Customise) rides must behave exactly as before.
- Audit write failure must never fail a trip completion (log it).
- Per-stop timers are NOT built: the driver app has no "left stop" event, so a stop's dwell cannot be measured. Selected stop durations stay shown to the driver; billing for them needs a new driver action (separate follow-up).
- Hand-applied migration; commit per task; app dirs need `git add -f`; user's uncommitted Flutter/Gradle edits are never committed.

## Review Focus
- Waiting exactly equal to the selected minutes: charge 0. One second over: charged for that second (fractional minutes, round2).
- A ride with no wait-timer row, or a timer missing `pickup_wait_end`: those segments are 0, never NaN.
- Completion called twice: second call returns early (already Completed); a recompute must not double a stored segment (upsert by order+segment).
- A normal ride (no `customise_order_id`) keeps the pooled free-minutes formula.
- Customise order row missing/unreadable: fall back to the normal formula rather than failing the completion.

## Tasks

### Task 1: Schema
**Files:** Create `backend/prisma/migrations/20261027020000_add_customise_order_timer/migration.sql`; Modify `backend/prisma/schema.prisma` (model `customise_order_timer`).
Columns: `id`, `order_id`, `segment` varchar(20) (pickup_wait|pickup_load|drop), `selected_min` int, `started_at` datetime null, `ended_at` datetime null, `elapsed_seconds` int, `billed_seconds` int, `rate_per_min` decimal(10,2), `charge` decimal(10,2), `computed_at` datetime; unique (`order_id`,`segment`).
- [ ] Write SQL + model, `DATABASE_URL=mysql://u:p@localhost:3306/x npx prisma validate && npx prisma generate` passes, commit.

### Task 2: Billing service
**Files:** Create `backend/src/services/customiseTimerService.js`; Test `backend/src/services/__tests__/customiseTimerService.test.js`.
**Produces:**
- `segmentsOf({ co, waitTimer, dropWaitSeconds, rate }) -> Segment[]` (pure). `co` = customise_order row (`p_wait_min`, `p_load_min`, `d_wait_min`, `d_unload_min`). Segment = `{ segment, selected_min, started_at, ended_at, elapsed_seconds, billed_seconds, rate_per_min, charge }`; `billed_seconds = max(0, elapsed - selected_min*60)`; `charge = round2(billed_seconds/60 * rate)`.
- `billFor(order, waitTimer, dropWaitSeconds) -> Promise<{ total, segments } | null>` (null when not a Customise ride or the order row is unreadable).
- `record(orderId, segments) -> Promise<void>` (upsert per segment, event `timers_charged`; never throws).
- [ ] Failing tests: equal-to-allowance is 0; one second over; missing timer gives zeros; pickup_wait uses `pickup_wait_seconds`; drop allowance is wait+unload; `billFor` null for a normal order; `record` upserts by (order, segment).
- [ ] Implement, run to green, commit.

### Task 3: Completion integration
**Files:** Modify `backend/src/services/tripLifecycle.js` ("complete" branch); Test in `backend/src/services/__tests__/tripLifecycle.test.js`.
- [ ] Failing test: a Customise ride's `total_dcharge` becomes agreed fare + per-segment charges and ignores the rate card's free minutes; a normal ride unchanged; audit failure does not fail completion.
- [ ] Implement via `customiseTimerService.billFor` / `record`, run `tripLifecycle` suite green, commit.

### Task 4: Admin visibility
**Files:** Modify `backend/src/controllers/customiseOrderController.js` (`adminDetail` returns `timers`), `frontend/src/pages/CustomiseOrders.jsx` (Timers section: selected vs actual, extra charge, total); Test in `customiseOrderController.test.js`.
- [ ] Failing test then implement; `vite build`; commit.

### Task 5: Wrap-up
- [ ] Full backend suite; update memory; report the migration to apply and what is not covered (stop timers).
