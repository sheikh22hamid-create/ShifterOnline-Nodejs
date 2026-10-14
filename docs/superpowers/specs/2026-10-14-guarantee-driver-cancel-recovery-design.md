# Booking Guarantee - post-assignment driver-cancel recovery (design)

Date: 2026-10-14 - Status: draft for review - Extends: `2026-10-14-guarantee-executive-queue-design.md` (Section 12 "known gap")

## 1. Purpose and outcome

Today a driver who cancels after being assigned ends the booking for good: the order is cancelled, refunds are paid, and the customer never gets the Booking Guarantee. This feature closes that gap for guarantee orders. When an eligible assigned driver cancels, the order goes back to the held state, the **same** guarantee case reopens with its **original deadline**, the system searches again and the executive queue gets the case. If no driver is found by that deadline, the existing automatic compensation pays out unchanged.

Success: with the city switch ON, an assigned driver's cancel inside the original guarantee window never strands or silently cancels the customer's order; with the switch OFF (the default) behaviour is byte-for-byte what it is today.

## 2. Decisions (confirmed with the product owner, 2026-10-14)

| # | Decision |
|---|---|
| D1 | On recovery: order returns to held state, case reopens, **auto-search restarts and the executive queue also owns the case**. |
| D2 | Which cancels recover: the **driver's own cancel** and the **Free/Daily admin-approved cancel** (see 3.2 for the correction to the earlier "all driver-side cancels" wording). |
| D3 | Stage: only **before pickup is completed** (`order_status` 0, 1, 2). Status 3 (on route) stays a terminal cancel. |
| D4 | **Per-city switch, default OFF**, effective only where `guarantee_enabled` is on. |
| D5 | `deadline_at` is never extended or reset. If the original deadline has already passed when the driver cancels, the cancel is **terminal exactly as today** (no recovery, no compensation). |
| D6 | Compensation stays fully automatic with no approval step, via the existing `expireCase` and its idempotency key. |

Unchanged by design: compensation maths, idempotency keys, referral lock, wallet code paths, customer and admin cancels, the 15-second sweepers, executive-queue rules.

## 3. Current behaviour and scope

### 3.1 What happens today
- `tripLifecycle.driverCancel` (L1445): under an order row lock sets `rid=0, order_status=4, o_status='Cancelled'`, refunds referral points, wallet advance and wallet-paid fare, applies the driver cancellation fee and `driver_cancel_user_earning`, then `stopDispatch(orderId, "driver_cancelled")` and `order:driver_cancelled` with `searching_for_new_driver:false`.
- The case is already `resolved_assigned` (closed by `closeOnAssign` from driver accept, admin assign, force-assign or next-day batch), so `expireCase` never sees the order.
- `cancelRequestService.approve` (Free/Daily admin-approved cancel) already puts the order back to Pending and re-dispatches, but leaves the case `resolved_assigned`; if that search then fails, `finishSearchWindow` -> `openForExhaustedOrder` returns `false` for a non-open existing case and the order is cancelled **without** compensation. This feature fixes that too.

### 3.2 Which cancels are in scope (correction)
Re-reading the code: `cancelOverduePickup` (customer did not give the OTP) and `cancelExpiredAdvancePayment` (customer did not pay the advance) are **customer-fault** cancels that charge the customer. Reopening those would be wrong, so they are **out of scope and stay terminal**. In scope:

1. `driverCancel` called by the driver (socket `orderSocket.js:134`, `orderController.driverCancel`, legacy `orderStatusChangeLegacy` cancel).
2. `cancelRequestService.approve` (already re-dispatches; gains case reopen).

Customer cancel, admin cancel, `cancelOverduePickup`, `cancelExpiredAdvancePayment` and status-3 cancels remain as today.

## 4. Eligibility (all must hold, evaluated under the order row lock)

1. City switch `guarantee_recover_on_cancel = 1` **and** `guarantee_enabled = 1` for the order's city. City settings are read **before** the transaction (same rule as the executive queue: callbacks use only `tx`); read failure fails closed to "not eligible".
2. A `booking_guarantee_case` exists for the order with `status = 'resolved_assigned'` and `deadline_at > now`.
3. Order `order_status` in (0, 1, 2) and the cancelling rider is the assigned `rid`.
4. Not a repeat of an already-processed cancel (the existing `already_cancelled` idempotency and the case CAS below cover this).

If any condition fails, or any step of recovery throws, the code takes the **existing terminal path unchanged**. Recovery can never leave an order half-moved.

## 5. Recovery transaction

Inside the same transaction and row lock `driverCancel` already holds (and the equivalent point in `approve`):

1. **Case CAS:** `UPDATE booking_guarantee_case SET status='open', closed_at=NULL, resolved_by_admin_id=NULL, queue fields reset ... WHERE order_id=? AND status='resolved_assigned' AND deadline_at > NOW()`. `affected = 0` means ineligible: fall back to the terminal path. `deadline_at` and `opened_at` are never written.
2. **Order:** `rid=0, order_status=0, o_status='Pending', accept_time=NULL` (the shape `cancelRequestService.approve` already uses). Not cancelled.
3. **Money:** nothing is refunded at recovery time. The order is simply un-assigned, exactly as `cancelRequestService.approve` already does for Free/Daily cancels (that path is the proven precedent): `advance_payment` and `payment_status` are left untouched, and the prepaid fare and referral points stay held like any unassigned held order. Reason: `finalizeAcceptedOrder` carries `payment_status` forward and rewrites `advance_payment`, and `payAdvanceFromWallet` reuses the ledger key `advance_apply:<order>`, so refunding or resetting the advance at this point would risk a double charge or an unrefundable second debit. Instead the **existing expiry path gains one idempotent call**: `finishExpiry` also runs `walletAdvance.refundWalletAdvanceIfAny(orderId)` (a no-op when no wallet-paid advance exists), so a recovered order that finally expires still returns every rupee: prepaid fare, referral points and the applied wallet advance (a Razorpay advance already sits in the wallet). Customer and admin cancels already refund the advance today.
4. **Driver side:** the driver's cancellation fee and `driver_cancel_user_earning` credit apply as today with their existing idempotency keys; `tbl_order_requests` row for this rider is marked `"10"` (reject) so the cascade never offers the order to the same driver again; `driver_trip_progress` rows cleared; `order_status_history` row "Driver Cancelled".
5. **Audit:** `booking_guarantee_audit` event `reopened_after_driver_cancel` with `{ rider_id, source: "driver_cancel" | "admin_approved_cancel", remaining_seconds }`.

After commit (best-effort, never rolls back):
- `dispatchManager.stopDispatch` is **not** called (dispatch is being restarted instead).
- Restart auto-search with the existing `startDispatch`. System 2 orders get `search_deadline_at = min(now + driver_search_seconds, case.deadline_at)` so a search can never outlive the case. System 1 cascades end by exhaustion, then `finishSearchWindow` -> `openForExhaustedOrder` finds the case already `open` and returns `true` (hold), unchanged.
- `guaranteeQueue.onCaseOpened(case, city_id)` so the executive queue assigns an owner (previous ownership period was ended by `onCaseClosed`; history is kept).
- Customer event `order:driver_unassigned` (existing event) plus `order:guarantee_pending` with the original `deadline_at`; admin alert as for a newly opened case.

## 6. Expiry and race handling

- Driver found before the deadline: any accept or assign calls `closeOnAssign`, case back to `resolved_assigned`. Existing flow, unchanged. A second driver cancel repeats this loop; the deadline is the only bound.
- Deadline reached with no driver: existing `expireCase` (conditional flip, cancel, credit with key `booking_guarantee_credit:<order>`, refunds via `finishExpiry`). **Only change:** after a successful expiry, call `dispatchManager.stopDispatch(orderId, "guarantee_expired")` so a restarted search stops (idempotent no-op if none is active).
- Races, all resolved by existing atomic guards: assignment vs expiry (`expireCase` cancels only `rid=0 AND order_status=0`; assign requires pending), double cancel (case CAS + order row lock), cancel vs customer cancel (`closeOnCancel` only affects an `open` case), approve vs driver accept.
- Reminder/escalation: once-only stamps are reset on reopen so the queue treats it as a fresh period. Thresholds remain percentages of the full original window, so a case reopened late may escalate immediately, which is intended (little time left).

## 7. Settings, schema, API, UI

- Migration (additive, hand-applied like all guarantee migrations): `city_order_settings.guarantee_recover_on_cancel TINYINT(1) NOT NULL DEFAULT 0`. Prisma schema updated; `orderSearchSettings`/`guaranteeQueueSettings` expose it and fail closed.
- Existing city settings endpoint and admin city-settings form gain the toggle (superadmin and city admin, same RBAC as the other guarantee switches; city isolation unchanged).
- The `reopened_after_driver_cancel` audit event appears in the case-detail audit trail the API already returns; no new badge is built. No driver-app or customer-app code change (existing events are reused).

## 8. Failure handling

Every recovery error path degrades to today's terminal behaviour; nothing can strand an order or double-pay. Wallet effects are idempotent (existing keys). With the switch OFF the new branch is never entered. Rollback = turn the city switch off.

## 9. Test plan (real MySQL is mandatory; a skipped test does not pass)

Unit/service: eligibility matrix (switch off, guarantee off, case not `resolved_assigned`, deadline passed, status 3, wrong rider, customer-fault cancels untouched); recovery transaction state (order pending, case open, deadline unchanged, refunds as specified, fee and earning keys, requests row "10"); fall-back on injected failure; `approve` path reopens the case.
Concurrency (real MySQL): double driver-cancel; cancel vs expiry sweep at the deadline; cancel vs customer cancel; cancel vs admin assign; two cancels on two orders (no cross effects); repeated cancel/assign loop until deadline then single compensation.
Money: compensation paid exactly once across reopen cycles; prepaid fare and referral points refunded exactly once, at expiry only; advance refunded once and re-requested for the next driver.
Regression: full backend suite plus existing guarantee and executive-queue suites unchanged. Dev smoke with a test city: end-to-end cancel -> reopen -> reassign, and cancel -> expiry -> compensation, switch ON for that city only, then OFF again.

## 10. Rollout

Additive migration on dev (backup first, verify the target DB name), deploy to dev, switch stays OFF, enable for one dev test city for the smoke test only with approval. Nothing to production without explicit approval; production needs the migration first.

## 11. Out of scope / open

- Customer-fault cancels (OTP no-show, unpaid advance) stay terminal.
- Cancels at status 3 stay terminal.
- A driver cancelling an order that never had a guarantee case is unchanged (no protection is invented).
- Cancel after the original deadline stays terminal (D5).
- Driver cancellation penalties for the Free/Daily ladder are unchanged.
- Known residual (same as the existing Free/Daily approve path): because `payment_status` is carried forward, the next driver's advance may be treated as already paid when the previous driver's advance was paid. This is existing behaviour of the proven approve path and is **checked in the dev smoke test** (complete a recovered order and read the wallet ledger); it is not changed here.
