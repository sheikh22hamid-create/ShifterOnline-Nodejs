# RazorpayX driver payouts — design

Date: 2026-11-14. Status: draft, awaiting owner approval.

## Intent and why

Today a driver's wallet withdrawal is a request that an admin approves, and then the admin sends the money by hand (UPI/bank app) outside the system. The manager wants the payout itself to be automatic, like other platforms. The owner's decision: **keep the admin approval, but when the admin approves, the money goes to the driver straight from Razorpay (RazorpayX Payouts) instead of by hand.**

## Goals

- Admin clicks Approve → the driver's chosen UPI ID / bank account is paid through RazorpayX, with no manual transfer.
- The driver's ledger is never debited without a payout in flight, and never loses money if the payout fails: failed or reversed payouts return the amount to the ledger.
- A payout can never be sent twice for one request, even with double clicks, retries or timeouts.
- The admin Payouts screen shows the real state (processing / paid with UTR / failed with reason).
- No on/off switch: approve always pays through RazorpayX (owner's decision). If RazorpayX is not configured, approve refuses and changes nothing.

## Non-goals

- No change to the driver app (the ledger remarks and existing notifications carry the outcome). No app release needed.
- No auto-approval, no amount-based rules, no limits — approval stays a human decision.
- Customer wallets stay non-withdrawable.
- No bulk payouts, no payout-to-card/wallet, no TDS/GST handling.

## Anti-goals (a failure even if it "works")

- A driver paid twice, or paid while the ledger still shows the money.
- Money debited from the ledger and never returned after a failed payout.
- Money sent to a UPI/bank detail the driver changed after requesting.

## Constraints and facts

- Existing flow: `customerWalletController.withdrawWallet` creates a `driver_withdraw_requests` row (`pending`, with `payout_method` and a masked `payout_detail` text snapshot). `payoutController.approve` currently marks it `approved`, decrements `tbl_rider.wallet_balance`, writes a `tbl_wallet_history` debit, and notifies the driver.
- The driver's real destination lives in `tbl_rider.upi_id` and `tbl_bank_account` (`a_name`, `iban_num` = account number, `ifsc_code`). The request row only has a masked snapshot.
- Razorpay is used today only for collections (`razorpayOrders.js`, `razorpayVerify.js`) with plain `fetch` + Basic auth; there is no Razorpay SDK for payouts, so payouts use the same `fetch` style.
- `app.js` uses a global `express.json()`; a webhook signature needs the raw body for its route.
- RazorpayX is a **separate account**: current account with a pre-funded balance, its own API keys, a webhook secret, and server IP allowlisting for payout calls. The owner has to arrange these; none exist yet.
- The dev DB is hand-patched and lags Prisma; migrations stay unapplied on prod until the owner runs them (see memory notes on schema drift).
- RazorpayX API shape below comes from Razorpay's public docs (payouts at `POST /v1/payouts` with an `X-Payout-Idempotency` header; contact → fund account → payout; modes `UPI` for a VPA and `IMPS` for a bank account; `queue_if_low_balance`; webhooks `payout.processed`, `payout.failed`, `payout.reversed`). Exact field names and the idempotency window must be re-checked against the live API reference while building.

## Approaches considered

- **A. Approve triggers the payout immediately; webhooks finalise the status (chosen).** One click, smallest change on top of `payoutController.approve`. Cost: the admin waits for one Razorpay round trip on click.
- **B. Approve only marks it; a background worker sends payouts with retries.** Admin never waits and retries are tidy, but needs a new worker and queue — too heavy for this.
- **C. Separate "Approve" then "Pay via Razorpay" buttons.** Extra control, but two clicks, which defeats "direct".

Owner picked **A**.

## Design

### Config (no switch)
- There is no on/off setting. `approve` always pays through RazorpayX; the old manual path (admin enters a reference/proof) is removed. Old requests already marked `approved` stay as history.
- RazorpayX env not configured → approve refuses with a clear message and changes nothing (nothing is debited).
- Env: `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` (the RazorpayX account to pay from), `RAZORPAYX_WEBHOOK_SECRET`. Added to `.env.example`. These are separate from the existing collection keys.

### Data (one migration)
- Enum `driver_withdraw_requests_status`: add `processing`, `paid`, `failed`. Existing `approved` stays for manual approvals and history.
- `driver_withdraw_requests`: add `razorpay_payout_id`, `razorpay_fund_account_id`, `utr`, `failure_reason`, `payout_processed_at` (all nullable).
- `tbl_rider`: add `razorpay_contact_id` (nullable) so each driver is created as a Razorpay contact once.
- A small table (or column) to remember processed webhook event ids so a repeated delivery is ignored.

### Approve flow
1. Guards as today (request exists, city scope, status is `pending`).
2. Destination check: take the request's `payout_method`, read the driver's *current* saved UPI/bank, and compare with the request's `payout_detail` snapshot (UPI id; bank last 4 digits). If they differ, refuse: "Driver changed payout details after requesting — reject and ask them to request again." The money never goes to details the driver didn't have when requesting.
3. Claim atomically: `updateMany` where id and status = `pending` → `processing`. Zero rows → 409 (double click / race).
4. In one transaction: conditional wallet debit (`wallet_balance >= amount`, else undo the claim and return 409), and a ledger row "Payout initiated (withdrawal #id)".
5. Call RazorpayX (contact if missing → fund account → payout). Payout body: amount in paise (`Math.round(rupees * 100)`), `mode` UPI or IMPS, `purpose: "payout"`, `queue_if_low_balance: false`, `reference_id` and `X-Payout-Idempotency` both `wd-<request id>`, narration "Shifter driver payout".
6. Outcomes:
   - **Accepted** (payout id returned): store payout id and fund account id, keep `processing`, push "Payout approved — on its way".
   - **Definitively refused** (4xx — e.g. invalid VPA, insufficient RazorpayX balance, auth/config error): refund the ledger (credit row "Payout not sent — returned"), set the request back to `pending` with `failure_reason`, and return the reason to the admin so they can fix and retry or reject. Nothing was sent, so nothing is lost.
   - **Unknown** (timeout, 5xx, network): do **not** refund; leave `processing`. Resolve through the status sync below.

### Webhook
- Route `POST /api/webhooks/razorpayx`, no admin auth; trust comes from the HMAC-SHA256 `X-Razorpay-Signature` over the **raw body** with `RAZORPAYX_WEBHOOK_SECRET` (the global JSON parser gets a `verify` hook that keeps the raw body for this route only). Bad signature → 401.
- Find the request by `reference_id` / payout id. Ignore unknown ids and already-handled event ids. Respond 200 fast.
- `payout.processed` → `paid`, store `utr`, `payout_processed_at`; push "Payout sent".
- `payout.reversed`, `payout.failed`, `payout.rejected` → refund the ledger once (only if the request is `processing`, or `paid` for the rare processed-then-reversed case), set `failed` with the reason; push "Payout failed — ₹X returned to your ledger".
- Other states (queued, pending, initiated) → no change.

### Status sync (for the "unknown" case and missed webhooks)
- Admin action "Check status" on a `processing` request, plus, if the repo already has a scheduled-job pattern, a sweeper for requests stuck in `processing` for more than ~15 minutes. Sync re-sends the payout with the **same** idempotency key (returns the original payout instead of creating a second) or fetches the payout, then applies the same transitions as the webhook. Whether the idempotency window covers the delay must be checked against the docs; if not, fetch by payout id / reference.

### Admin screen (frontend `Payouts.jsx`, `PayoutApproveModal.jsx`, `payoutStatus.js`)
- New statuses and filters: processing (warning), paid (success), failed (danger); existing approved/rejected unchanged.
- Approve modal: text becomes "Sends ₹X to the driver's UPI/bank immediately via Razorpay"; the manual reference/proof inputs are removed (the UTR comes from Razorpay).
- Rows show UTR, failure reason, and the "Check status" action for `processing`.
- The existing admin socket event `notifyPayoutUpdate` is fired on every status change so the list updates live.

### Driver side
- No app change. The ledger shows the debit and any refund; push/in-app notifications use the existing `tbl_rnoti` + FCM path. The driver's pending-amount maths already counts `pending` only, so a `processing` request correctly stops being "available" because the ledger is already debited.

### Safety and edge cases
- Double click / two admins at once: the atomic claim lets exactly one through.
- Crash between the debit and the Razorpay call: request stays `processing`, no payout id; status sync re-sends with the same key. A request in `processing` with no payout id is therefore never silently abandoned.
- RazorpayX balance too low: refused with a clear message, nothing debited (step 6, definitive refusal).
- Money precision: amounts are rupees with 2 decimals; paise are rounded once, in one helper.
- Secrets stay in env, are never logged, never returned to the browser.

## Testing
- Jest tests in the repo's existing `__tests__` style with `fetch` mocked: approve happy path, validation/destination-mismatch refusal, double-claim race, definitive refusal refunds and returns to `pending`, unknown outcome keeps `processing`, missing RazorpayX config refuses without debiting, webhook signature (good/bad), processed, failed/reversed refund exactly once, repeated event ignored.
- Dev end-to-end only with RazorpayX **test mode** keys; no real money moves until prod gets live keys.

## Rollout
- Migration file added; applied to dev by hand (dev DB convention); **not** applied to prod by me — the owner runs it before deploying, together with the other pending prod SQL.
- With no switch, the feature is live as soon as the backend and admin frontend deploy to prod, so deploy only after RazorpayX is funded, the live keys are in the prod env, and the webhook URL + IP allowlist are set up. Until then approve on prod just refuses with a "payouts not configured" message and no driver is debited.

## Rollback
- Rolling the backend back to a build from before this feature, with the migration already applied, breaks reads of `driver_withdraw_requests`: the old Prisma client does not know the `processing` / `paid` / `failed` enum values and throws on any row holding one (the admin Payouts list, the driver withdrawal history, the finance report). The new nullable columns are harmless to the old client.
- So before rolling back code: make sure no row is `processing` (let the sweeper or "Check status" settle them), then either keep the new build's Prisma client or move `paid` rows to `approved` and `failed` rows to `rejected` by hand (their refunds are already in the ledger) before shrinking the enum. Do not drop the new columns while any payout is in flight — `razorpay_payout_id` is what ties a webhook to its request.
- The migration file itself is left unchanged on purpose: editing it would change Prisma's recorded checksum.

## Left to the builder
- Exact Razorpay field names, the idempotency window and the webhook payload shape (verify against the live reference).
- Where the sweeper lives, if the repo has a job runner.
- Table-vs-column choice for processed webhook event ids, and file layout (suggested: `services/razorpayxPayouts.js` for the API calls, `controllers/razorpayxWebhookController.js` for the webhook).

## Needed from the owner (not code)
RazorpayX account with a funded balance, its API key + secret, the account number, a webhook secret, the webhook URL registered in the RazorpayX dashboard, and the server's public IP allowlisted for payouts.
