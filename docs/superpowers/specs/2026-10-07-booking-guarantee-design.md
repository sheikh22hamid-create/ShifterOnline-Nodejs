# Booking Guarantee — Design

> **Status & corrections (reviewed 2026-10-07): BUILT - migration pending.** Merged to `main`; migration `20261007020000_add_booking_guarantee` is not yet applied anywhere and the smoke test has not been run. The sweep interval is 15 s. Current code-verified description: [Master Document section 5.5](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

Date: 2026-10-07

## Purpose

If a customer's order finds no driver in any of the models (tbl_package tiers)
they switched ON, the customer is compensated automatically — unless an admin
manually assigns a driver within a configurable window. Compensation equals the
configured amount of the highest selected model.

This builds on systems that already exist and must not be rebuilt:

- The customer model toggle (stored on the order as `pkg_order.allowed_delivery_types`).
- The dynamic model config (`tbl_package`: id, title, `sort_order`, `status`).
- The sequential tier dispatch in `dispatchManager.js`.

Hard rule: no hard-coded Model 1–5 logic. A new Model 6/7 added in
`tbl_package` must work with zero core-logic change.

## Current state

- A "Model" is a `tbl_package` row, ordered by `sort_order`, enabled by `status`.
- `orderController.js` (~L329) sorts the customer's selected package ids by
  `sort_order` and stores them as JSON in `pkg_order.allowed_delivery_types` (~L536).
- `dispatchManager.startDispatch` (~L1170) reads that array as `state.tiers`
  and runs the cascade, one lap only.
- `dispatchManager.checkCascadeTermination` (~L391): once exhausted, it calls
  `adminSocket.notifyDispatchAlert`, then **immediately cancels** the order
  ("No driver found"), refunds a wallet-prepaid fare
  (`walletPrepaymentRefund.refundIfWalletPaid`), refunds referral points,
  emits `order:no_driver_found` and pushes to the customer. The Free Booking
  Offer fallback (`freeBookingService.fallbackToNormalDispatch`) runs before this.
- Admin manual assign: `adminOrderController.assignRider` (~L186).
- Admin alert: `admin:dispatch_alert`, toasted in `frontend/src/components/layout/AppShell.jsx`.
- Wallet ledger: `tbl_wallet_history`.

The guarantee replaces the immediate cancel with a held, admin-assignable window.

## Data model

### `tbl_package.no_driver_compensation`
`DECIMAL(10,2) NOT NULL DEFAULT 0`. Editable in the existing rate-card admin;
`rateCardController.serializePackage` spreads the row so it is returned
automatically. `create`/`update` build explicit data objects and need the field added.

### `booking_guarantee_case`
| column | notes |
|---|---|
| id | PK |
| order_id | UNIQUE — one case per order, the duplicate-payment guard |
| uid | customer id |
| status | `open` \| `resolved_assigned` \| `expired_compensated` \| `cancelled` |
| selected_package_ids | JSON snapshot of `allowed_delivery_types` at open time |
| compensation_package_id | package whose amount applies (highest `sort_order` among selected) |
| compensation_amount | frozen at open time; later config edits never change it |
| opened_at, deadline_at, closed_at | `deadline_at = opened_at + admin assignment time` |
| resolved_by_admin_id | set when an admin assigns |
| wallet_history_id | set when compensation is credited |
| refunds_done_at | set once the prepaid-fare/points refunds ran; the sweeper repairs cases where it is NULL |

### `booking_guarantee_audit`
Append-only: `id, case_id, order_id, event, admin_id?, meta JSON, created_at`.
Events: `opened`, `admin_alerted`, `admin_assigned`, `customer_cancelled`,
`admin_cancelled`, `expired`, `wallet_credited`, `refunds_processed`, `order_already_closed`.

### Admin Assignment Time
A settings row following the existing settings-service pattern (see
`settlementSettings.js` / `model1SuspensionSettings.js`). Default 10 minutes,
integer minutes, validated > 0. Each case snapshots its own `deadline_at`, so
changing the setting affects only new cases.

### Compensation rule
Among the ON package ids, pick the one with the highest `tbl_package.sort_order`;
the amount is that package's `no_driver_compensation`. Payable only when all
selected models failed AND the admin window expired AND no driver was assigned.
Implemented as one pure function `computeGuaranteeCompensation(packages)`.

## Runtime flow

1. **Trigger.** In `checkCascadeTermination`, in the exhausted branch, after the
   free-booking fallback and before the cancel, if the order is still unassigned
   (`rid=0`, `order_status=0`):
   - Create the case (insert guarded by the `order_id` UNIQUE), freeze selected
     models and compensation, set `deadline_at`.
   - Leave the order alive and unassigned: no cancel, no refund, no `no_driver_found`.
   - Emit `order:guarantee_pending { order_id, amount, deadline_at }` to the customer.
   - Alert admins via `notifyDispatchAlert` with the message
     "BOOKING GUARANTEE – MANUAL DRIVER ASSIGNMENT REQUIRED" and `deadline_at`.
   - Write `opened` and `admin_alerted` audit rows.
   - `activeDispatches` is released as today; the case row owns the wait from here.
2. **Admin assigns in time.** `assignRider`, on success, closes any open case for
   the order as `resolved_assigned` (conditional update `WHERE status='open'`),
   ₹0 compensation, audit row. Otherwise unchanged.
3. **Expiry sweeper.** An interval job (also run once on server start) selects
   open cases with `deadline_at <= now`. For each, one transaction:
   - Conditional update `status='open'` → `expired_compensated` (only one worker wins).
   - Cancel the order ("No driver found").
   - Refund a wallet-prepaid fare via the existing helper, and referral points.
   - If `compensation_amount > 0`, credit the customer wallet and record
     `wallet_history_id`.
   - Audit rows.
   After commit: emit `order:no_driver_found` (with `compensation_amount`) and push.
4. **Customer cancels during the window.** The existing cancel path also closes
   the case as `cancelled`, no compensation.
5. **Admin cancels the order.** Also closes the case as `cancelled`, no compensation.
6. **Restart safety.** The case row and `deadline_at` live in the DB; the sweeper
   recovers any open case after a restart.
7. **Unchanged.** If a driver accepts during the cascade, no case is ever created.
   Free-booking orders keep their current fallback behaviour.

## Surfaces

### Backend (customer-facing)
- `POST /api/order/guarantee-quote { package_ids }` → `{ amount, package_id }`,
  using the same `sort_order` rule as order creation. Display only; the real
  frozen value is always recomputed server-side from the order's package ids.
- Order detail/status response gains `guarantee: { state, amount, deadline_at }`
  with `state` one of `none | pending | paid | not_paid`, so reopening the app
  mid-wait shows the right screen.
- `order:no_driver_found` payload gains `compensation_amount`.

### Customer app (`ShifterOnline/`)
- Booking screen: "If no driver is found, you get ₹X", hidden when X = 0; reads
  the existing toggle state via the quote endpoint. No new toggle.
- Searching screen: on `order:guarantee_pending` show "Finding you a driver…"
  with the guarantee amount visible; no countdown; cancel remains available
  (no compensation).
- No-driver screen: show "₹X added to your wallet" when `compensation_amount > 0`.
- The exact classes are not yet located; they are pinned down in the implementation plan.

### Admin panel (`frontend/`)
- Persistent high-priority banner for guarantee alerts (extends `AppShell.jsx`).
- Orders list: badge + live countdown from `deadline_at`; existing Assign Rider
  action resolves the case.
- A dedicated Booking Guarantee page holds the Admin Assignment Time setting and the case history.
- Rate card: "No Driver Found Compensation (₹)" per package.
- Read-only case history with the audit trail.

## Error handling and edge cases

- Duplicate payment: impossible by construction — `order_id` UNIQUE plus the
  conditional `status='open'` update gate both the open and the pay steps.
- Wallet credit failure inside the transaction rolls back the case flip, so the
  sweeper retries on its next tick.
- Admin assigns and the sweeper fires simultaneously: whichever flips
  `status` first wins; the other sees zero rows updated and does nothing.
- Compensation 0: case still opens (admin gets the alert and window); on expiry
  the order cancels with no wallet entry.
- Package config edited mid-window: no effect — amount and selected models are frozen.
- Scheduled orders: guarantee triggers only from the exhausted-cascade path, so
  scheduled orders follow whatever path they take into `checkCascadeTermination`;
  verify during planning that the scheduled-priority flow reaches it the same way.

## Testing

- Compensation rule: the five spec examples (₹0 / 100 / 500 / 1000 / 2000), plus a
  synthetic "Model 6" package proving nothing is hard-coded.
- Admin assigns before deadline → `resolved_assigned`, ₹0, no credit.
- Expiry → credits exactly once, even if the sweeper runs twice concurrently.
- Customer cancel during the window → `cancelled`, no payment.
- Restart recovery → an open past-deadline case is resolved by the startup sweep.
- Free-booking fallback path unchanged.
- Prepaid fare is refunded separately from the compensation.
- Quote endpoint matches the frozen amount for the same package ids.
- Admin audit rows written for every transition.

## Deployment note

The migration adds one column and two tables. Per the project's known dev/prod
schema drift, it must be applied to prod by hand before deploying.

**Prod deploy requirement.** The migration file
`backend/prisma/migrations/20261007020000_add_booking_guarantee/migration.sql`
must be run on PROD before deploying the backend.

**After deploy:** in Rate Cards, set each package's "No Driver Found
Compensation" (initial intent: lowest model Rs 0, then Rs 100 / Rs 500 /
Rs 1000 / Rs 2000 by `sort_order`), and set the "Admin assignment time" on the
Booking Guarantee page.
