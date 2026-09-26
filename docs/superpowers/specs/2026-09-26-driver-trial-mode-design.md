# Driver Trial Mode — Design Spec

Date: 2026-09-26

## Problem / Intent

A prospective driver currently must complete full KYC (Aadhaar, PAN, license,
residence docs, plus the one-time verification payment — see
`driverApproval.js`) before `tbl_rider.a_status` flips to 1 and they become
eligible for dispatch at all. Some drivers want to try the app and take a
handful of real orders before investing the time to submit documents.

Goal: let an admin put a specific driver into a **trial** state — eligible
for dispatch and a fixed number of real orders, clearly marked as
"unverified" in the driver app — without touching the existing KYC
approval logic. When the trial order count is used up, the driver is
auto-blocked from further dispatch until they complete KYC (or an admin
upgrades/removes them).

## Non-goals

- No changes to the existing KYC document-verification flow or its enum
  semantics (`verification_status`, `docsVerified`, `payment_complete`).
- No order-type/value restrictions during trial — trial drivers receive
  normal dispatch like any other eligible driver (explicit product
  decision — see clarifying Q&A below).
- No self-serve trial signup — admin-only, by name + phone, per driver.

## Data model

Add to `tbl_rider` (Prisma schema):

```prisma
enum tbl_rider_trial_status {
  none
  active
  exhausted
  blocked
  upgraded
}

model tbl_rider {
  ...
  trial_status           tbl_rider_trial_status @default(none)
  trial_orders_allowed   Int?
  trial_orders_completed Int                     @default(0)
}
```

This is orthogonal to `verification_status`/`all_verify`/`payment_complete`.
`driverApproval.js`'s `evaluateDriverApproval` is untouched — it still only
concerns itself with real KYC completion. A driver can be
`trial_status='active'` and `verification_status='pending'` at the same
time; that combination is exactly the trial state.

## Dispatch eligibility

No change to the hot-path query. `dispatchManager.js` (both the general
offer query around line 134 and the interest-recheck around line 1037-1043)
already gates purely on:

```
a_status = 1 AND status = 1 AND vehicle = order.category
```

Activating trial mode sets `a_status = 1` directly (bypassing the
docs+payment gate that `evaluateDriverApproval` normally requires). No
dispatch code changes.

## Order-count tracking + auto-block

New helper `backend/src/utils/trialOrderTracker.js`:

```js
async function recordTrialOrderCompletion(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  if (!rider || rider.trial_status !== "active") return;

  const completed = rider.trial_orders_completed + 1;
  const exhausted = rider.trial_orders_allowed != null && completed >= rider.trial_orders_allowed;

  await prisma.tbl_rider.update({
    where: { id: riderId },
    data: {
      trial_orders_completed: completed,
      trial_status: exhausted ? "exhausted" : "active",
      a_status: exhausted ? 0 : rider.a_status,
    },
  });
}
```

Called from `tripLifecycle.js` at the same point an order transitions to
its terminal "completed/delivered" state for the rider (wherever that
status write already happens — this is additive, not a replacement of
existing completion logic).

## Admin panel

New "Trial Drivers" section (frontend), sibling to the existing Drivers
page, following its existing list/modal patterns
(`CreateDriverModal.jsx` already has an admin-creates-driver-directly
flow this can borrow from):

- **Add Trial Driver** modal: name, phone, vehicle category, number of
  trial orders allowed. Backend endpoint find-or-creates the
  `tbl_rider` row by `fmobile` (same find-or-create pattern already used
  in `driverKycStatusController.js`'s `verifyDriverDocument`), then sets
  `trial_status='active'`, `trial_orders_allowed=N`, `a_status=1`,
  `status=1`.
- **List view**: one row per trial driver, showing name, phone,
  progress (`trial_orders_completed / trial_orders_allowed`), and
  `trial_status` badge.
- **Row actions**:
  - *Block* → `trial_status='blocked'`, `a_status=0`.
  - *Remove from trial* → `trial_status='none'`, `a_status=0` (driver
    reverts to needing normal KYC before dispatch eligibility).
  - *Upgrade to Verified* → same effect as the existing manual-approval
    path (`verification_status='approved'`, `payment_complete=true`,
    triggers `assignDefaultDeliveryTypes`), plus `trial_status='upgraded'`.
    `a_status` stays 1 throughout — no dispatch gap during the upgrade.

## Payout hold

Wallet crediting for completed orders is unchanged — trial-order
earnings post to the wallet exactly like any other driver's (explicit
product decision: hold earnings, don't block earning them).

`payoutController.js`'s payout/withdrawal request endpoint gets one new
guard: reject the request if `trial_status` is `active` or `exhausted`
**and** `verification_status !== 'approved'`. Once KYC completes
normally, or an admin runs "Upgrade to Verified", `verification_status`
becomes `approved` and payout unblocks automatically — no separate
"trial payout hold" flag to manage or clean up.

## Driver app (ShifterDriver — native Android/Java)

Current behavior (from research): gating is binary and happens only at
splash/login routing —`FirstActivity.checkAndNavigate()`,
`LoginActivity.openHome()`, `SendOTPActivity.handleExistingUser()` all
independently implement: `verification_status == "approved"` → Home;
else `payment_complete == 1` → Home anyway (pending-review, let in);
else → verification/payment flow. There is no in-Home check that blocks
order acceptance — a driver never reaches Home unless already let in by
one of these branches. No dashboard "unverified" banner exists today
(only `ProfileActivity`'s color-coded status text: green
approved/verified, orange `#FF9800` otherwise). The `document_check.php`
call declared in `UserService.java` is dead code — never invoked.

Changes:

- `RiderData.java`: add `trialStatus`, `trialOrdersAllowed`,
  `trialOrdersCompleted`, populated from the login/OTP-verify API
  responses (`riderAuthController.js` needs to include these three
  fields in its login/verify payloads — small additive change,
  mirroring how `verification_status` is already returned there).
- `FirstActivity` / `LoginActivity` / `SendOTPActivity`: add a branch —
  not approved, but `trialStatus == "active"` → proceed to `HomeActivity`
  (same shape as the existing pending-payment "let them in anyway"
  branch). `trialStatus` in (`exhausted`, `blocked`) → route to a new
  "trial ended" screen (extend `UnderReviewActivity` or add a sibling)
  with a CTA into the existing `ChooseVerificationMethodActivity` KYC
  flow.
- New persistent banner on the Home dashboard (no reusable component
  exists — this is new) styled with the existing orange `#FF9800`
  "pending" convention: "Unverified – Trial Mode: X/N orders used.
  Complete KYC to continue." Refreshed via a lightweight profile-fetch
  on `HomeActivity` resume (not the dead `document_check.php` call —
  simpler to extend the login/profile response than wire up an unused
  legacy PHP endpoint).

## Testing

- Backend: unit tests for `trialOrderTracker.recordTrialOrderCompletion`
  (increments, exhausts at the boundary, no-ops for non-trial riders);
  `payoutController` guard (blocks active/exhausted+unapproved, allows
  once approved); admin trial-driver endpoints (create/block/remove/
  upgrade transitions), following existing patterns in
  `backend/src/controllers/__tests__/`.
- Admin panel: manual verification of the Trial Drivers list/actions
  against a local backend (no existing frontend test harness for
  comparable admin pages, per repo convention).
- Driver app: manual verification on a device/emulator — trial driver
  reaches Home with banner, order counter increments on completion,
  auto-block at limit routes to the trial-ended screen, upgrade path
  clears the banner.

## Open questions / risks

- Exact terminal "order completed for this rider" write site in
  `tripLifecycle.js` needs to be pinned down during planning — the
  tracker must hook the point that's true for every completion path
  (normal delivery, not cancellation).
- `payoutController.js`'s current payout endpoint(s) need identifying
  precisely (there was no existing verification-status gate to pattern
  from) so the new guard lands on the right handler(s).
