# Driver Wallet — Withdraw & Outstanding Dues Design

Date: 2026-09-23

## Purpose

Rework the driver wallet flow to match the approved UX (no self-recharge,
withdraw-only, negative balance shown as "outstanding dues" that must be
cleared via an exact-amount UPI payment before the driver can receive new
rides). Fix a known concurrency bug in the withdraw path along the way, and
retire the parallel admin-approval withdrawal flow that the new immediate
flow replaces.

## Current state (for reference)

- `backend/src/controllers/customerWalletController.js` is shared by
  customer and driver wallets via a `wallet_type` field:
  - `addWallet` — Razorpay-verified recharge (must be blocked for drivers).
  - `walletHistory` — balance + history + (driver only) pending-withdrawal
    summary.
  - `withdrawWallet` — immediate self-service debit with a read-then-write
    race (not atomic, not transactional).
  - `createRazorpayOrder` — generic order creation, amount taken from the
    client.
- `backend/src/controllers/driverPayoutController.js` `withdrawRequest` +
  `backend/src/controllers/payoutController.js` `approve`/`reject` — a
  second, admin-approval-gated path for wallet-balance withdrawal via the
  `driver_withdraw_requests` table. This is being deprecated by this work.
  (`driverPayoutController.payoutList`/`requestPayout`, the separate
  trip-earnings payout feature backed by `payout_setting`, is untouched.)
- `backend/src/services/dispatchManager.js` `selectEligibleDrivers` — the
  single existing raw-SQL driver-eligibility gate for new-ride offers
  (approval status, online status, active-trip exclusion, reliability
  suspension, duty-log gating). No wallet-balance check exists yet.
- `backend/src/controllers/settingsController.js` — admin settings:
  `setting` singleton for typed global business knobs, `app_settings` for
  arbitrary key/value flags, both via `PUT /settings`.
- `tbl_rider.wallet_balance` (Decimal) and `tbl_wallet_history` (ledger,
  shared with customer wallet via `wallet_type`) already support negative
  balances and ledger entries — no new tables/columns required.

## Scope decisions (confirmed)

- Withdrawal: fix `withdrawWallet`'s race condition and use it as the sole
  immediate self-service withdraw path. No real bank/UPI payout automation
  (RazorpayX) in this task — withdrawal marks the wallet debited
  immediately, same as today; actual settlement stays a manual/offline
  admin process.
- `driver_max_due_limit`: a single global admin-configurable value (not
  per-city), stored as an `app_settings` key, default `100`.
- Floor enforcement at the due limit: soft cap. Ride-assignment gating
  (see below) already stops new rides at any negative balance, so no
  additional code needs to block in-flight trip commission/cancellation
  debits from pushing balance further negative near/at the limit.
- Driver self-recharge ("Add Money") is blocked server-side, not just
  hidden in the app UI.
- The admin-approval wallet-withdrawal path
  (`driverPayoutController.withdrawRequest` + `payoutController`
  approve/reject) is deprecated: the driver app stops calling it, and no
  new withdrawal requests should be created through it going forward. Its
  code and the `driver_withdraw_requests` table are left in place
  (no data loss), just unused for new withdrawals.

## Design

### 1. Settings

Add `driver_max_due_limit` as a recognized numeric key in
`settingsController.js`'s validated-fields list (alongside the existing
`FLOAT_FIELDS`/`INT_FIELDS` sets used for the `setting` singleton), but
persist it through the existing `app_settings` upsert path used for
arbitrary flags — no schema migration needed. Default it to `100` when
absent, mirroring the `DEFAULT_SETTING_DATA` fallback pattern already used
for the singleton row. Expose it in `getSettings`'s response so the admin
panel can render a normal numeric field for it.

### 2. Block driver self-recharge

In `addWallet`, add an early check: if `walletType === "driver"`, return
the same `fail()` envelope with a clear message (e.g. "Drivers cannot add
money to their wallet.") before any Razorpay verification happens. Leave
customer recharge untouched.

### 3. Fix the withdraw race + enforce due-limit-aware rules

Rewrite `withdrawWallet` to:

1. Reject immediately if `walletType === "driver"` and current balance is
   `<= 0` (mirrors "Withdraw hidden/disabled" states — enforce server-side
   even though the app should already hide the button).
2. Perform the debit atomically instead of read-then-write:
   ```js
   const result = await prisma[model].updateMany({
     where: { id: account.id, wallet_balance: { gte: amount } },
     data: { wallet_balance: { decrement: amount } },
   });
   if (result.count === 0) return /* Insufficient Balance */;
   ```
   wrapped together with the `tbl_wallet_history` debit insert inside a
   single `prisma.$transaction`, so a concurrent duplicate request either
   sees the updated balance and correctly fails, or the two operations
   commit/rollback together. Apply the same pattern for `walletType ===
   "user"` for consistency, since the bug exists there too.
3. Re-fetch/compute the post-debit balance from the transaction result for
   the response payload (`NewBalance`), rather than trusting the
   pre-transaction `currentBalance - amount` arithmetic.

### 4. "Clear Outstanding" flow (new, driver-only)

Two new endpoints in `customerWalletController.js` (or a new
`driverWalletController.js` if the file is getting large — implementer's
call), gated to `wallet_type: "driver"` only:

- `createClearDueOrder(req, res)`:
  - Look up the driver by mobile, compute
    `outstandingDue = Math.max(0, -Number(rider.wallet_balance))`.
  - If `outstandingDue === 0`, return a failure ("No outstanding dues to
    clear.") — the amount is never taken from the client, precisely to
    prevent tampering with what gets paid/credited.
  - Create a Razorpay order for `outstandingDue` rupees via the same
    raw-fetch approach as `createRazorpayOrder`, tagged with a receipt
    prefix like `cleardue_${riderId}_${Date.now()}` so it can't be
    confused with a recharge order downstream.
- `clearOutstandingDue(req, res)`:
  - Verify the payment via `verifyRazorpayPayment` exactly like `addWallet`
    (same signature/amount/status checks against Razorpay's API).
  - Re-derive the amount to credit from the **verified Razorpay order
    amount**, not from any client-supplied amount field.
  - Credit `wallet_balance` by that amount (bringing it toward/at 0 — never
    used to add extra positive balance beyond clearing the due, since the
    order was created for exactly the due amount) and insert a
    `tbl_wallet_history` credit row with remark `"Outstanding Due Cleared"`
    and `razorpay_payment_id` set, reusing the same unique-constraint
    idempotency guard (`P2002` → "already credited") as `addWallet`.

### 5. `walletHistory` response additions (driver branch only)

Add to the existing driver-only `withdrawalSummary` block:
- `outstanding_due`: `Math.max(0, -wallet_balance).toFixed(2)`
- `max_due_limit`: current `driver_max_due_limit` setting value
- `can_withdraw`: `wallet_balance > 0`
- `can_clear_due`: `wallet_balance < 0`
- `due_limit_reached`: `wallet_balance <= -max_due_limit`

These mirror the button-visibility table from the approved mockup exactly,
so the driver app renders off these flags instead of re-deriving the rules
client-side from raw balance + a hardcoded limit.

### 6. Ride-assignment gating

In `dispatchManager.js` `selectEligibleDrivers`'s raw SQL `WHERE` clause,
add `AND r.wallet_balance >= 0` alongside the existing conditions (approval
status, online status, active-trip exclusion, reliability suspension). Any
negative balance — regardless of how far below the due limit — excludes a
driver from new-ride offers, consistent with the mockup's button-visibility
table (both "-₹1 to -₹99" and "= -₹100" rows show "Can Receive Rides: No").

### 7. Deprecating the admin-approval withdrawal path

- Stop routing the driver app to `POST /rider/payout/withdraw-request`
  (`driverPayoutController.withdrawRequest`) for wallet-balance withdrawals
  — the app should call the (fixed) immediate `withdrawWallet` endpoint
  instead.
- Leave `driverPayoutController.withdrawRequest`,
  `payoutController.approve`/`reject`, and the `driver_withdraw_requests`
  table in the codebase unchanged (no route removal, no migration) since
  they may still hold historical data worth keeping queryable. Add a code
  comment at the top of `withdrawRequest` noting it's superseded by the
  immediate withdraw flow, to stop future work from building on it further.

## Out of scope

- Real bank/UPI payout automation (RazorpayX integration).
- Driver mobile app UI changes (separate repo/task) — this spec only fixes
  the backend API contract the app needs.
- Per-city due limits.
- Hard-floor enforcement at the due limit (soft cap only, per decision
  above).

## Testing

- `withdrawWallet`: concurrent-request test proving only one of two
  simultaneous withdrawals for the same balance succeeds; balance-`<=0`
  rejection; insufficient-balance rejection.
- `addWallet`: driver `wallet_type` is rejected before Razorpay
  verification runs.
- `createClearDueOrder`/`clearOutstandingDue`: order amount matches
  server-computed due, not client input; duplicate `razorpay_payment_id`
  is rejected (idempotency); balance reaches exactly 0 after clearing a
  due equal to the full outstanding amount.
- `dispatchManager.selectEligibleDrivers`: a driver with negative
  `wallet_balance` is excluded from eligible-drivers results even when all
  other conditions pass.
- `walletHistory` (driver branch): `can_withdraw`/`can_clear_due`/
  `due_limit_reached` flags match each balance scenario from the
  mockup's button-visibility table.
