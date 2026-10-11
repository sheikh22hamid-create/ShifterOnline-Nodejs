# Handoff: Tiered dispatch (Free -> Daily -> Normal), penalties, Free Booking limits, Driver Performance report

Audience: a coding AI (or developer) taking over this work, and the owner who supervises it.
Repo: this one (`Shifter Online`). Backend is `backend/` (Node, Express, Prisma, MySQL, Jest). Driver app is native Android Java in `ShifterDriver/ShifterDriver/` and the customer app is Flutter in `ShifterOnline/` (both are gitignored: commit changes there with `git add -f <exact files>`). Admin panel is React in `frontend/`.

## What already exists (read these first, in this order)

1. `docs/superpowers/specs/2026-10-11-tiered-dispatch-free-daily-design.md` - the agreed design (manager decisions are baked in; section 10 lists what is still open).
2. `docs/superpowers/plans/2026-10-11-tiered-dispatch-penalties-cancel-approval.md` - **Plan 1**, backend only, 12 tasks with exact code and tests. Its code and tests were dry-run verified (149 tests green) and then reverted: **nothing is implemented in `backend/src` yet**.
3. Memory-style summary: `docs/superpowers/specs/` + this file. Existing related features: Free Booking Offer (`backend/src/services/freeBooking*.js`, spec `2026-10-06-free-booking-offer-design.md`), Daily Driver (`dailyDriver*.js`, spec `2026-09-26-daily-driver-system-design.md`), receiver-pays (spec `2026-10-05-receiver-pays-design.md`).

## Work order

| # | Work | Status |
|---|------|--------|
| 1 | Implement Plan 1 (backend tasks 1-11; task 12 is the dev rollout, do it with the owner) | plan ready |
| 2 | Write Plan 2: Free order rules + refund (spec 3.2 admin limits `max_free_orders`/`max_amount`/`max_km`, payer = receiver for a free order, full-invoice refund popup/push `free_booking:refunded`, customer app handling of `order:driver_unassigned`) and the driver-app side (tier badge, penalty warning, continuous ringing for free/daily offers, "Request cancel" instead of cancel, no cancel after pickup) | not written |
| 3 | Write Plan 3: Driver Performance report (admin API + React page, uses `driver_order_event`; offers that have a `superseded` event must be excluded from every rate; score formula in spec section 7) | not written |
| 4 | Implement Plans 2 and 3 | after 2 and 3 |

Do the steps in order. Plan 2 and 3 depend on the tables and services Plan 1 creates.

## Prompt to give the AI for step 1

> You are implementing an existing, reviewed plan. Read `docs/superpowers/specs/2026-10-11-tiered-dispatch-free-daily-design.md` and then `docs/superpowers/plans/2026-10-11-tiered-dispatch-penalties-cancel-approval.md`. Implement Tasks 1 to 11 of the plan in order. For each task: write the test first, run it and see it fail, implement exactly what the plan says, run it and see it pass, run the whole `backend` suite (`cd backend && npx jest`), then make one commit with the message the plan gives (end every commit message with the co-author line the plan names). Do not edit files the plan does not list. Do not run Task 12. Do not push, deploy, apply SQL to any database, or touch `.env` or any credentials. Keep the `tiered_dispatch_enabled` setting OFF. `src/utils/__tests__/aadharPdfVerify.test.js` already fails on main (2 tests, unrelated); everything else must be green. If a plan step does not work as written, stop and report which step and the exact error instead of improvising.

## Prompt for steps 2 and 3 (planning)

> Read the spec (`docs/superpowers/specs/2026-10-11-tiered-dispatch-free-daily-design.md`, especially sections 3.2, 5, 6, 7 and 10) and Plan 1. Plan 1 is implemented. Write **Plan 2** (and then **Plan 3**) in the same format and level of detail as Plan 1: exact file paths, exact code, tests written first, a verify command per step, small commits, no placeholders. Before writing a step, read the existing code it changes (for example `backend/src/services/freeBookingService.js`, `orderController.createOrderCore`, `receiverSettlementService.js`, `ShifterDriver/.../utility/OrderAlertPlayer.java`, `OrderDialogHelper.java`, `ShifterOnline/lib/screens/home/free_booking_dialogs.dart`, `frontend/src/pages/FreeBookingOffer.jsx`) and quote real function names. Save the plans under `docs/superpowers/plans/`. Do not implement anything yet.

## Rules for any AI working on this

- Never push, deploy, restart servers, or run SQL on dev/prod without the owner's explicit OK. Task 12 of Plan 1 needs a human.
- Never ask for, store, or paste server passwords. The server root password was shared in a chat once and must be reset in hPanel.
- Tiered dispatch and penalties stay OFF by default (`app_settings`: `tiered_dispatch_enabled`, `tier_penalty_enabled`).
- Migrations are hand-written SQL applied by hand (the dev DB has no shadow DB); then `prisma migrate resolve --applied`. Apply on every DB before deploying the code that uses it.
- The customer and driver app folders are gitignored: `git add -f` only the exact files you changed.

## Open points the owner must settle with the manager

- Cancel penalty percentage for an admin-approved cancel (`cancel_penalty_pct`; default 100 in the spec).
- Does `max_amount` apply to the order total including GST (spec assumes `total_dcharge`) or to the base fare?
- Score formula and status bands (spec section 7: 0.4 acceptance + 0.4 completion + 0.2 (100 - reject/skip); Excellent 85, Good 70, Average 50).
- Consequence of the full-invoice refund: when the receiver pays the driver and the sender also gets the full invoice credited, the sender gains the advance that stays in their wallet. Accepted by the manager.

## Human review checklist (after each plan is implemented)

1. `git log --oneline` shows one commit per task and nothing the plan did not list (`git diff --stat main..HEAD`).
2. `cd backend && npx jest` is green except the known `aadharPdfVerify` suite.
3. With the flags OFF, dispatch behaves exactly as before (order flow on the dev server).
4. Read the diff of `dispatchManager.js`, `tierPenaltyService.js` and `cancelRequestService.js` yourself: they touch the dispatch loop and driver wallet money.
5. Manual checks listed in Task 12 of Plan 1 (reject, skip, cancel request, Daily settlement netting, scheduled and next-day orders, advance already paid then cancel approved).
