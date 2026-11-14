# RazorpayX Driver Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin approves a driver withdrawal request, the money is paid to the driver's UPI/bank through RazorpayX Payouts automatically, with webhook-driven final status and safe refunds on failure.

**Architecture:** `payoutController.approve` claims the request and debits the ledger in one transaction, then calls RazorpayX (contact → fund account → payout, idempotent by request id). A webhook (plus an admin "Check status" action and a sweeper) moves `processing` requests to `paid` or `failed`; failure refunds the ledger exactly once. State transitions live in one service so approve, webhook, sync and sweeper share them.

**Tech Stack:** Node/Express, Prisma (MySQL), Jest, plain `fetch` (no Razorpay SDK for payouts), React admin frontend.

**Spec:** `docs/superpowers/specs/2026-11-14-razorpayx-driver-payouts-design.md`

**Execution:** do this in a worktree/branch `feature/razorpayx-payouts` cut from the current HEAD, so the spec and plan come along and the unrelated uncommitted changes in the main working tree stay out. Commits are local only; never push or deploy. Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Global Constraints

- No on/off switch. Approve always pays through RazorpayX; if env is not configured it refuses and debits nothing.
- Env names (separate from the existing collection keys): `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET`. Read at call time, never logged or returned to the browser.
- Request `reference_id` and `X-Payout-Idempotency` header are both `wd-<request id>`. Payout body: amount in paise `Math.round(rupees * 100)`, `mode` `UPI` (VPA) or `IMPS` (bank), `purpose: "payout"`, `queue_if_low_balance: false`, narration "Shifter driver payout".
- Statuses on `driver_withdraw_requests`: existing `pending`, `approved` (manual history), `rejected`, plus new `processing`, `paid`, `failed`.
- Refund exactly once: every refund/transition is guarded by an atomic `updateMany` on the expected current status.
- Never send to details the driver changed after requesting (destination check against the request's `payout_detail` snapshot).
- Migrations are hand-applied SQL (repo convention); apply to **dev only**, never prod. No `migrate deploy`.
- Tests: Jest, `jest.mock("../../config/db", ...)` factory style as in `backend/src/controllers/__tests__/payoutController.test.js`. Razorpay field names, the idempotency window and the webhook payload shape come from Razorpay's docs and must be re-checked against the live API reference while building Task 2/6.
- No driver-app change. Customer wallets stay non-withdrawable.

## Review Focus

- Two admins (or a double click) approve the same request at once → exactly one payout, one debit. (Task 3)
- Webhook arrives before approve has stored the payout id → still resolved through `reference_id` `wd-<id>`. (Task 6)
- `payout.processed` followed later by `payout.reversed` → refunded once and marked `failed`; a repeated `reversed` event does nothing. (Tasks 3, 6)
- Webhook with a missing/bad signature, unparseable body, unknown payout, or an event type we don't handle → never crashes, never changes state (401 for bad signature, 200 otherwise). (Task 6)
- Amount edge cases: `"2.00"` Decimal strings and `99.99` convert to exact paise (`200`, `9999`); wallet lowered between request and approval → refused with nothing sent. (Tasks 2, 3)

---

### Task 1: Migration and Prisma schema

**Files:**
- Create: `backend/prisma/migrations/20261114010000_add_razorpayx_payouts/migration.sql`
- Modify: `backend/prisma/schema.prisma` (`model driver_withdraw_requests` ~line 170, `enum driver_withdraw_requests_status` ~line 1825, `model tbl_rider` ~line 1180)

**Interfaces:**
- Produces: Prisma fields `driver_withdraw_requests.{razorpay_payout_id, razorpay_fund_account_id, utr, failure_reason, payout_started_at, payout_processed_at}` (all nullable), enum values `processing | paid | failed`, `tbl_rider.razorpay_contact_id` (nullable `String?`).

- [ ] **Step 1: Check the live column.** On the dev DB run `SHOW COLUMNS FROM driver_withdraw_requests LIKE 'status'` and copy its nullability/default into the `MODIFY COLUMN` below so the enum change doesn't alter either.
- [ ] **Step 2: Write `migration.sql`** with the repo's header comment style (apply by hand on every database, then `prisma migrate resolve --applied`; never `migrate deploy`): `ALTER TABLE driver_withdraw_requests MODIFY COLUMN status ENUM('pending','approved','rejected','processing','paid','failed')` (keeping the existing null/default), `ADD COLUMN` `razorpay_payout_id VARCHAR(64) NULL`, `razorpay_fund_account_id VARCHAR(64) NULL`, `utr VARCHAR(64) NULL`, `failure_reason VARCHAR(255) NULL`, `payout_started_at DATETIME(0) NULL`, `payout_processed_at DATETIME(0) NULL`, `ADD INDEX idx_dwr_razorpay_payout_id (razorpay_payout_id)`; and `ALTER TABLE tbl_rider ADD COLUMN razorpay_contact_id VARCHAR(64) NULL`.
- [ ] **Step 3: Mirror it in `schema.prisma`** (same names; `@db.VarChar(64)` / `@db.VarChar(255)` / `@db.DateTime(0)`; add `@@index([razorpay_payout_id], map: "idx_dwr_razorpay_payout_id")`; extend the enum).
- [ ] **Step 4: Apply to dev by hand** (the dev DB is `.env`), run `npx prisma migrate resolve --applied 20261114010000_add_razorpayx_payouts`, then `npx prisma generate`.
- [ ] **Step 5: Verify.** `npx prisma validate` passes; `SHOW COLUMNS FROM driver_withdraw_requests` lists the six new columns and the 6-value enum; `SHOW COLUMNS FROM tbl_rider LIKE 'razorpay_contact_id'` returns a row.
- [ ] **Step 6: Commit** the two files: `feat(payouts): schema for RazorpayX payout tracking`.

---

### Task 2: RazorpayX API client

**Files:**
- Create: `backend/src/utils/razorpayx.js`
- Test: `backend/src/utils/__tests__/razorpayx.test.js`

**Interfaces:**
- Produces (all in `razorpayx.js`; follow the style of `utils/razorpayOrders.js`: Basic auth with `RAZORPAYX_KEY_ID:RAZORPAYX_KEY_SECRET`, `AbortSignal.timeout(10000)`):
  - `isConfigured(): boolean` — true only when `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` are all set.
  - `toPaise(rupees: number | string): number` — `Math.round(Number(rupees) * 100)`.
  - `verifyWebhookSignature(rawBody: Buffer, signature: string): boolean` — HMAC-SHA256 hex of the raw body with `RAZORPAYX_WEBHOOK_SECRET`, compared with `crypto.timingSafeEqual`; `false` when secret/signature missing or lengths differ.
  - `createContact({ name, mobile, referenceId }): Promise<Result<{ id }>>`
  - `createFundAccount({ contactId, method: "upi" | "bank", upiId?, accountName?, accountNumber?, ifsc? }): Promise<Result<{ id }>>`
  - `createPayout({ fundAccountId, amountRupees, method: "upi" | "bank", referenceId }): Promise<Result<{ id, status, utr }>>` — sends `X-Payout-Idempotency: <referenceId>`.
  - `fetchPayout(payoutId): Promise<Result<{ id, status, utr, failureReason, referenceId }>>`
  - `Result<T>` = `{ ok: true, ...T }` | `{ ok: false, definitive: boolean, reason: string }`. `definitive: true` for a 4xx (reason = Razorpay's `error.description`); `false` for network error, timeout, 5xx or unreadable body.

- [ ] **Step 1: Write failing tests** with `global.fetch` mocked:
  - `toPaise("2.00") === 200`, `toPaise(99.99) === 9999`, `toPaise(0.29) === 29`.
  - `isConfigured()` false with any one env var missing, true with all three.
  - `verifyWebhookSignature`: true for a body signed with the secret; false for a tampered body, a missing signature, an unset secret, and a signature of different length.
  - `createPayout` sends POST `/v1/payouts` with header `X-Payout-Idempotency: wd-5`, body `amount: 200`, `mode: "UPI"` for `upi` and `"IMPS"` for `bank`, `currency: "INR"`, `purpose: "payout"`, `queue_if_low_balance: false`, `reference_id: "wd-5"`, and the configured account number.
  - A 400 response with `{ error: { description: "Invalid VPA" } }` → `{ ok: false, definitive: true, reason: "Invalid VPA" }`; a 500, a rejected fetch and a non-JSON body → `{ ok: false, definitive: false }`.
- [ ] **Step 2: Run** `npx jest src/utils/__tests__/razorpayx.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the functions above in `backend/src/utils/razorpayx.js` using one internal request helper that does auth, timeout and the definitive/non-definitive classification. Confirm endpoint paths, `type` for contacts and field names against Razorpay's live RazorpayX API reference before finalising.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** both files: `feat(payouts): RazorpayX API client`.

---

### Task 3: Withdrawal state transitions

**Files:**
- Create: `backend/src/services/withdrawalPayout.js`
- Test: `backend/src/services/__tests__/withdrawalPayout.test.js`

**Interfaces:**
- Consumes: Prisma models from Task 1; `adminSocket.notifyPayoutUpdate`, `pushNotifier.notifyDriverWalletTransaction`, `istNow` (as used by the current `payoutController.approve`).
- Produces (exports of `withdrawalPayout.js`):
  - `claimAndDebit(withdrawalId: number): Promise<{ ok: true, withdrawal } | { ok: false, reason: "not_pending" | "low_balance" }>` — one interactive `prisma.$transaction`: `driver_withdraw_requests.updateMany({ where: { id, status: "pending" }, data: { status: "processing", payout_started_at: new Date(), failure_reason: null } })` (count 0 → `not_pending`); then `tbl_rider.updateMany({ where: { id: rider_id, wallet_balance: { gte: amount } }, data: { wallet_balance: { decrement: amount } } })` (count 0 → roll back the whole transaction → `low_balance`); then a `tbl_wallet_history` debit row, `wallet_type: "driver"`, remark `Payout initiated (withdrawal #<id>)` plus ` via <payout_detail>` when present.
  - `revertToPending(withdrawalId: number, reason: string): Promise<boolean>` — transaction: `updateMany` `processing → pending` with `failure_reason: reason` (count 0 → return false, no refund); refund the rider's `wallet_balance` and write a credit ledger row `Payout not sent — returned (withdrawal #<id>)`; notify admin socket (status `pending`).
  - `applyPayoutState({ withdrawalId, payoutId, status, utr, failureReason }): Promise<"paid" | "failed" | "ignored">` — Razorpay status `processed` → mark paid (`updateMany` where status `processing`; set `paid`, `utr`, `razorpay_payout_id`, `payout_processed_at`; notify driver "Payout sent" via `tbl_rnoti` + push when `fcm_token` exists); `reversed` | `failed` | `rejected` | `cancelled` → mark failed (`updateMany` where status in `processing`/`paid`, set `failed` + `failure_reason`; only when that update's count is 1: refund ledger credit row `Payout failed — returned (withdrawal #<id>)`, `tbl_rnoti` + push "Payout failed — ₹X returned to your ledger"); any other status → `"ignored"`. Always call `adminSocket.notifyPayoutUpdate` after a real transition.

- [ ] **Step 1: Write failing tests** (prisma mocked; `$transaction.mockImplementation((fn) => fn(prisma))`):
  - `claimAndDebit` happy path: claim count 1, debit count 1 → `ok: true`; debit called with `wallet_balance: { gte: amount }`; ledger row has type `debit` and remark containing `withdrawal #55`.
  - `claimAndDebit` when claim count is 0 → `{ ok: false, reason: "not_pending" }` and no debit/ledger call (this is the double-approve race).
  - `claimAndDebit` when debit count is 0 → `{ ok: false, reason: "low_balance" }` and the transaction callback throws/rolls back (assert via the mock's rejection handling) so the claim isn't kept.
  - `applyPayoutState` `processed` → `paid` with utr stored, no wallet update.
  - `applyPayoutState` `reversed` on a `processing` row → `failed`, wallet incremented once, credit ledger row once; a second identical call (update count 0) → `ignored`-equivalent no-op with no second refund.
  - `applyPayoutState` `reversed` on a row currently `paid` (processed-then-reversed) → `failed` with one refund.
  - `applyPayoutState` with status `queued` → `"ignored"`, no DB writes.
  - `revertToPending` refunds and writes the credit row once; when the update count is 0 → returns false with no refund.
- [ ] **Step 2: Run** `npx jest src/services/__tests__/withdrawalPayout.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the three functions in `backend/src/services/withdrawalPayout.js`; keep a small private `notifyDriver(rider, title, msg, amount, type)` for the `tbl_rnoti` row + push.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** both files: `feat(payouts): atomic withdrawal state transitions`.

---

### Task 4: Destination check, submit, sync, sweeper

**Files:**
- Modify: `backend/src/services/withdrawalPayout.js`
- Test: `backend/src/services/__tests__/withdrawalPayoutSubmit.test.js`

**Interfaces:**
- Consumes: Task 2 client (mock `../../utils/razorpayx`), Task 3 functions.
- Produces (more exports of `withdrawalPayout.js`):
  - `resolveDestination(withdrawal, rider): Promise<{ ok: true, method: "upi" | "bank", upiId?, accountName?, accountNumber?, ifsc? } | { ok: false, message: string }>` — `payout_method` null → fail ("no payout method on this request — reject and ask the driver to request again"). UPI: the rider's current `upi_id` must make `payout_detail === "UPI (<upi_id>)"`. Bank: read the rider's `tbl_bank_account`; its `iban_num` last 4 digits must equal the digits inside `payout_detail`'s `(•••NNNN)`. Any mismatch → "Driver changed payout details after requesting — reject and ask them to request again."
  - `submitPayout(withdrawalId: number): Promise<{ outcome: "accepted" | "refused" | "unknown", reason?: string }>` — loads the request + rider, resolves destination, ensures the contact (reuse `tbl_rider.razorpay_contact_id`, else `createContact({ name, mobile: fmobile, referenceId: "rider-<id>" })` and store it), reuses `razorpay_fund_account_id` when set else creates and stores it, then `createPayout({ ..., referenceId: "wd-<id>" })`. Result mapping: `ok` → store `razorpay_payout_id`, run `applyPayoutState` with the returned status (in case it is already final), `accepted`; `ok: false, definitive: true` at any step → `revertToPending(id, reason)`, `refused`; `definitive: false` → leave `processing`, `unknown`. A destination mismatch → `revertToPending` + `refused` with that message.
  - `syncWithdrawal(withdrawalId: number): Promise<"paid" | "failed" | "processing" | "refused">` — only for `processing` rows: with a stored payout id → `fetchPayout` → `applyPayoutState`; without one → `submitPayout`.
  - `sweepStuckPayouts(olderThanMs = 15 * 60 * 1000): Promise<number>` — `processing` rows with `payout_started_at` older than the cutoff (max 20 per call), each through `syncWithdrawal`, errors logged per row and not thrown; returns how many it looked at.

- [ ] **Step 1: Write failing tests:**
  - `resolveDestination`: matching UPI → ok with `upiId`; changed UPI → `ok: false` mentioning "changed"; bank with matching last-4 → ok with full number/IFSC/name; bank with different last-4 → `ok: false`; null `payout_method` → `ok: false`.
  - `submitPayout` accepted: contact created and stored, fund account created and stored, payout created with `referenceId "wd-55"`, `razorpay_payout_id` stored → `accepted`; request not reverted.
  - `submitPayout` with an existing `razorpay_contact_id` and `razorpay_fund_account_id` skips both create calls.
  - `submitPayout` where `createPayout` returns `{ ok: false, definitive: true, reason: "Insufficient balance" }` → `revertToPending` called with that reason, outcome `refused`.
  - `submitPayout` where `createPayout` returns `{ ok: false, definitive: false }` → no revert, outcome `unknown`.
  - `syncWithdrawal` with a payout id and `fetchPayout` → `processed` → `paid`; without a payout id → calls `submitPayout` (same `referenceId`).
  - `sweepStuckPayouts` skips fresh rows (query uses the cutoff) and keeps going when one row's sync throws.
- [ ] **Step 2: Run** `npx jest src/services/__tests__/withdrawalPayoutSubmit.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the four functions in `withdrawalPayout.js`.
- [ ] **Step 4: Run** both service test files — expect PASS.
- [ ] **Step 5: Commit** the two files: `feat(payouts): submit, sync and sweep RazorpayX payouts`.

---

### Task 5: Approve rewrite, sync endpoint, list fields

**Files:**
- Modify: `backend/src/controllers/payoutController.js` (`approve` lines 69-146, `list` lines 38-61, exports line 195), `backend/src/routes/adminRoutes.js` (after line 287)
- Test: `backend/src/controllers/__tests__/payoutController.test.js` (replace the two existing `approve` tests; add the new ones; its db mock gains `driver_withdraw_requests.updateMany`)

**Interfaces:**
- Consumes: `claimAndDebit`, `submitPayout`, `syncWithdrawal` (Tasks 3-4), `razorpayx.isConfigured` (Task 2).
- Produces: `approve(req, res)` responses — `503 { success: false, message: "RazorpayX payouts are not configured." }` (before any DB write); existing 404/403/409 guards unchanged (not found, not pending, city scope); `409` on `not_pending` / `low_balance` (message "Driver's wallet balance is lower than the requested amount"); `422 { success: false, message: <reason> }` when `submitPayout` returns `refused`; `202 { success: true, status: "processing", message: "Payout submitted; confirmation pending" }` on `unknown`; `200 { success: true, status: "processing", message: "Payout sent to RazorpayX" }` on `accepted`. `sync(req, res)` — `POST /payouts/:id/sync`, same auth/city scope as approve, only for `processing` (else 409), returns `{ success: true, status }` from `syncWithdrawal`. `list` rows additionally carry `utr`, `failure_reason`, `razorpay_payout_id`. Extract the duplicated city-scope check into one local helper used by approve, reject and sync.

- [ ] **Step 1: Write failing tests** (mock `../../services/withdrawalPayout` and `../../utils/razorpayx`):
  - not configured → 503 and `claimAndDebit` never called.
  - accepted → 200, `claimAndDebit` then `submitPayout` called with the request id, `transaction_reference`/`payment_proof_url` in the body are ignored.
  - `claimAndDebit` `not_pending` → 409; `low_balance` → 409; neither calls `submitPayout`.
  - `submitPayout` refused with "Invalid VPA" → 422 with that message.
  - `submitPayout` unknown → 202.
  - request not `pending` → 409 before any claim; city mismatch (non-superadmin) → 403.
  - `sync`: a `processing` request → calls `syncWithdrawal`, returns its status; a `pending` request → 409.
  - `list` includes `utr` and `failure_reason` on a `paid`/`failed` row.
- [ ] **Step 2: Run** `npx jest src/controllers/__tests__/payoutController.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the new `approve`, `sync`, the `list` fields and the exports; register `router.post("/payouts/:id/sync", auth, authorize("superadmin", "admin"), payoutController.sync)` in `adminRoutes.js`. `reject` stays as is (still only for `pending`).
- [ ] **Step 4: Run** the controller test, then the full suite `npm test` in `backend` (confirms `driverWalletFlows.test.js` and others that reference payouts still pass) — expect PASS.
- [ ] **Step 5: Commit** the three files: `feat(payouts): approve pays through RazorpayX, add status sync`.

---

### Task 6: Webhook endpoint

**Files:**
- Create: `backend/src/controllers/razorpayxWebhookController.js`, `backend/src/routes/razorpayxWebhookRoutes.js`
- Modify: `backend/src/app.js` (line 16 JSON parser, route mounting near line 60)
- Test: `backend/src/controllers/__tests__/razorpayxWebhookController.test.js`

**Interfaces:**
- Consumes: `razorpayx.verifyWebhookSignature`, `withdrawalPayout.applyPayoutState`.
- Produces: `handle(req, res)` in the controller; the route file exports an Express router with `POST /`; `app.js` mounts it at `/api/webhooks/razorpayx` and changes `express.json({ limit: "50mb" })` to also keep the raw bytes — add `verify: (req, res, buf) => { if (req.originalUrl.startsWith("/api/webhooks/razorpayx")) req.rawBody = buf; }`. Handling rules: no/invalid `x-razorpay-signature` over `req.rawBody` → 401, nothing else runs; valid → find the request from the payout entity's `reference_id` matching `/^wd-(\d+)$/`, falling back to a lookup by `razorpay_payout_id`; unknown → 200 and ignore; otherwise call `applyPayoutState({ withdrawalId, payoutId, status, utr, failureReason })` using `payload.payout.entity` (`id`, `status`, `utr`, `failure_reason` / `status_details`) — confirm the exact payload shape against the live webhook docs. Any error thrown while applying a valid event is logged and answered `500` so Razorpay retries; retries are safe because every transition is guarded by the expected current status (this replaces the spec's optional processed-event-id table).

- [ ] **Step 1: Write failing tests** (mock `razorpayx` and `withdrawalPayout`):
  - invalid signature → 401, `applyPayoutState` not called; missing `rawBody` → 401.
  - `payout.processed` with `reference_id: "wd-12"` → `applyPayoutState` called with `withdrawalId: 12, status: "processed", utr` → 200.
  - webhook for a request whose `razorpay_payout_id` isn't stored yet (approve response still in flight) resolves purely by `reference_id` `wd-12` → still applied.
  - `payout.reversed` after `paid` → applied; a repeated delivery → `applyPayoutState` returns `"ignored"` and the response is still 200.
  - unknown `reference_id`/payout, an unhandled event name, and a body that isn't valid JSON → 200 and `applyPayoutState` not called with a bad id.
  - `applyPayoutState` throwing a DB error → 500.
- [ ] **Step 2: Run** `npx jest src/controllers/__tests__/razorpayxWebhookController.test.js` — expect FAIL.
- [ ] **Step 3: Implement** controller, route, and the `app.js` changes.
- [ ] **Step 4: Run** the new test and then the full backend suite — expect PASS. Also start the server once (`node src/server.js`), `POST` a payload with a wrong signature to `/api/webhooks/razorpayx` and confirm a 401; stop it.
- [ ] **Step 5: Commit** the four files: `feat(payouts): RazorpayX webhook with signature check`.

---

### Task 7: Stuck-payout sweeper

**Files:**
- Modify: `backend/src/server.js` (next to the other `setInterval` sweeps, ~line 95-120)

**Interfaces:**
- Consumes: `withdrawalPayout.sweepStuckPayouts()` (Task 4).

- [ ] **Step 1: Add** an interval every 5 minutes (a named constant near the other sweep intervals in `config/constants.js`) calling `sweepStuckPayouts()`, with an in-flight guard like `nextDaySweepRunning` and `.catch` logging `logger.error("sweepStuckPayouts failed:", err)`. It must be a no-op, and must not throw, when `razorpayx.isConfigured()` is false.
- [ ] **Step 2: Verify:** `node --check src/server.js` prints nothing (no syntax errors) and the full backend suite passes.
- [ ] **Step 3: Commit:** `feat(payouts): sweep payouts stuck in processing`.

---

### Task 8: Admin frontend

**Files:**
- Modify: `frontend/src/utils/payoutStatus.js`, `frontend/src/pages/Payouts.jsx`, `frontend/src/components/payouts/PayoutApproveModal.jsx`

**Interfaces:**
- Consumes: `POST /payouts/:id/approve` (200/202/409/422/503 per Task 5), `POST /payouts/:id/sync`, list rows with `status`, `utr`, `failure_reason`.

- [ ] **Step 1: `payoutStatus.js`:** add filters Processing, Paid, Failed (values `processing`, `paid`, `failed`); tones — `approved` and `paid` → `success`, `rejected` and `failed` → `danger`, `processing` → `warning`, `pending` → `warning`.
- [ ] **Step 2: `PayoutApproveModal.jsx`:** remove the transaction-reference and proof-URL inputs and their state; body text becomes "Sends ₹X to the driver's UPI/bank immediately via Razorpay. This can't be undone once the bank accepts it." Button label stays "Approve & pay out". POST an empty body. On a 202 response show the returned message in the page via `onDone` still closing the modal (the row will show `processing`); on error keep showing `err.response?.data?.message`.
- [ ] **Step 3: `Payouts.jsx`:** under the status badge show the `utr` (when `paid`) or `failure_reason` (when `failed`, or when `pending` with a reason from a refused attempt); for `processing` rows render a "Check status" button calling `POST /payouts/:id/sync` then `refetch()`, disabled while in flight; the `Approve`/`Reject` buttons stay only for `pending`.
- [ ] **Step 4: Verify:** `cd frontend && npm run build` succeeds. If a dev backend with RazorpayX test keys is available, approve a test request and confirm the row goes `processing` → `paid`; otherwise state in the hand-off that the UI flow was build-checked only.
- [ ] **Step 5: Commit** the three files: `feat(payouts): admin Payouts screen shows RazorpayX status`.

---

### Task 9: Env example, final verification, hand-off

**Files:**
- Modify: `backend/.env.example` (after the Razorpay block at lines 37-44)

- [ ] **Step 1: Add** commented entries for the four `RAZORPAYX_*` variables with a short note: separate RazorpayX account/keys, webhook URL `/api/webhooks/razorpayx`, server IP must be allowlisted by Razorpay, approve refuses until all are set.
- [ ] **Step 2: Run** the full backend suite (`npm test` in `backend`) — expect all passing — and `cd frontend && npm run build`.
- [ ] **Step 3: Review the branch diff once** against the spec's "Safety and edge cases" list; fix any gap inline.
- [ ] **Step 4: Commit:** `docs(payouts): RazorpayX env vars in .env.example`.
- [ ] **Step 5: Hand-off message** must say: migration `20261114010000_add_razorpayx_payouts` is applied to dev only and still has to be run on prod; nothing is pushed; with no switch the feature goes live on prod the moment this is deployed there, so deploy only after RazorpayX is funded, live keys are in the prod env, the webhook is registered and the server IP is allowlisted; whether Razorpay's field names/idempotency window were verified against the live reference.
