# Wallet & Referral Points History Ledger — Design Spec

**Date:** 2026-09-19
**Status:** Approved for implementation planning

## Problem

Admins can already add/deduct customer wallet balance and referral points
(driver + customer) from the admin panel, but there is no UI to see the
resulting transaction history or drill into a single transaction's detail.
Two ledger tables already exist in the DB and are already being written to
by current flows — they're just not exposed in the admin panel:

- `tbl_wallet_history` — written by customer self-service wallet
  recharge/withdraw (`customerWalletController.js`) and by admin wallet
  adjust (`adminCustomerController.walletAdjust`,
  `backend/src/routes/adminRoutes.js:143`).
- `tbl_referral_point_log` — written by `referralController.adjustPoints`
  (`backend/src/routes/adminRoutes.js:182`) and the referral reward
  service, for both `USER` and `DRIVER` types.

A related gap discovered during investigation: **drivers have no
admin-side wallet adjust endpoint at all** — `adminRiderController.js`
explicitly excludes `wallet_balance` from editable fields. Driver wallet
today only changes via self-service recharge/withdraw. This is in scope:
we add the missing driver wallet admin-adjust endpoint alongside the
history feature, since the ledger should reflect both wallets symmetrically.

## Goals

1. Admin can view a full wallet transaction ledger (all transaction
   sources: admin adjustments, self-service recharge/withdraw, order
   earnings/commission where applicable) for any customer or driver, and
   click a row to see full transaction detail.
2. Admin can view a full referral points ledger (admin adjustments +
   system-awarded points) for any user or driver, with the same
   click-through detail.
3. Wallet history and referral history are presented as **separate
   tabs/sections** (not merged into one combined timeline).
4. Admin can adjust a driver's wallet balance (add/deduct) the same way
   they already can for a customer, with the same audit trail.
5. Ledger accessible two ways: a standalone "Wallet & Referral History"
   page (search/filter across all users) and inline from each
   customer/driver's existing detail view, pre-filtered to that person.

## Non-goals

- No changes to how points/wallet balances are *calculated* (commission
  rates, referral point values, etc.) — this is purely visibility +ing
  the one missing driver-adjust write path.
- No export/CSV, no bulk actions on history rows.
- No changes to the legacy PHP admin (`Php Backend/`) — Node admin panel
  only, consistent with the existing driver-premium-plan and order-flow
  pattern of new admin features living entirely in Node.

## Schema change

`tbl_wallet_history` gets one new nullable column: `performed_by_admin_id`
(FK to the admin/staff table, nullable). Null means the row was written by
a self-service or system flow (recharge, withdraw, order settlement);
non-null means an admin performed a manual adjustment. This lets the
detail view show "Adjusted by <admin name>" vs "Self-service" without
guessing from `remark` text. `tbl_referral_point_log` already has a
`source` field (e.g. `"admin_adjustment"`) that serves the same purpose,
so no schema change needed there.

## Backend

### New: `POST /admin/riders/:id/wallet-adjust`

Mirrors `adminCustomerController.walletAdjust`
(`backend/src/controllers/adminCustomerController.js:154-200`) exactly,
targeting `tbl_rider.wallet_balance` instead of `tbl_user.wallet`:
validates `amount` (positive number) and `type` (credit/debit), on debit
checks sufficient balance and rejects with 400 if insufficient, updates
balance and inserts a `tbl_wallet_history` row with
`wallet_type: "driver"` and `performed_by_admin_id` set to the acting
admin — all inside one Prisma `$transaction`. Superadmin/admin only,
city-scoped like the existing customer route.

### New: `GET /admin/wallet-history`

Query params: `user_id` + `wallet_type` (`user`|`driver`) for a
pre-filtered per-person view, OR free-text `search` (name/mobile) +
`date_from`/`date_to` + `type` (credit/debit) for the standalone page's
open search. Paginated (`page`, `limit`, default 20). Returns rows with
every field needed for the detail view without a second round trip:
amount, type, wallet_type, remark, payment_id, razorpay_payment_id,
order_id, created_at, performed_by_admin_id (resolved to admin name via
join), and the target user's name/mobile (resolved via join on user_id +
wallet_type). Admin-auth'd, city-scoped.

### New: `GET /admin/referral-points-history`

Same shape as above but against `tbl_referral_point_log`: filters on
`user_id` + `user_type` (`USER`|`DRIVER`) or open search + date range +
`txn_type`. Returns points (signed), txn_type, source, ref_id,
balance_after, note, created_at, target user's name/mobile. Paginated,
admin-auth'd, city-scoped.

## Frontend

### Standalone page: `frontend/src/pages/WalletReferralHistory.jsx`

New route + sidebar nav entry. Two tabs:

- **Wallet History** — filter bar (search box, date range, type
  credit/debit, wallet_type user/driver toggle), paginated table
  (date, user, type, amount, remark preview). Row click opens
  `TransactionDetailDrawer` with every field from the API response.
- **Referral Points History** — same layout against the referral
  endpoint (date, user, points, txn_type, source preview), same detail
  drawer pattern.

`TransactionDetailDrawer` is one shared component, parameterized by
`kind: "wallet" | "referral"`, so field layout differs but the
open/close/loading mechanics are shared.

### Per-user entry points

- `Customers.jsx` / `WalletAdjustModal`: add a "View History" link next
  to the wallet balance, opening the same table+drawer pre-filtered to
  `user_id` + `wallet_type: "user"`.
- `DriverDetailDrawer.jsx`: add (a) a wallet adjust action (new — mirrors
  `WalletAdjustModal`, posts to the new driver endpoint) and (b) a "View
  History" link pre-filtered to `user_id` + `wallet_type: "driver"`.
- `Referrals.jsx`: add "View History" link per row next to the existing
  `AdjustPointsModal` trigger, pre-filtered to that user's `user_id` +
  `user_type`.

## Testing

- Backend: unit/integration tests for the new driver wallet-adjust
  endpoint (insufficient balance rejection, successful credit/debit,
  ledger row written with correct `wallet_type` and
  `performed_by_admin_id`) and both history list endpoints (filtering,
  pagination, city-scoping, join correctness).
- Frontend: manual verification in browser — open standalone page, both
  tabs load and paginate, filters narrow results, row click shows correct
  detail; per-user entry points open pre-filtered to the right person;
  driver wallet adjust modal successfully creates a ledger entry visible
  in the history view immediately after.
