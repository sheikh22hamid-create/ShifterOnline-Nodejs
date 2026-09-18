# Driver Contact-Referral (Lead) Feature — Design

## Problem

Drivers currently refer new users only by sharing a code themselves
(existing "refer and earn"). This adds a second channel: a driver
hands the phone numbers of people they know to Shifter, ops calls and
verifies those numbers, and if the person signs up and completes their
first ride, the referring driver is credited — and automatically
becomes that new user's favorite driver.

## Scope

Touches three codebases:
- **Backend** (`backend/`, Node + Prisma) — new model, new
  endpoints, one new hook into existing referral-crediting logic.
- **Admin panel** (`frontend/`) — a lead-verification queue.
- **Driver app** (`ShifterDriver/`, native Android/Java) — a
  "Refer via Contacts" screen.

Reuses existing infrastructure wherever possible:
- `backend/src/services/referralRewardService.js` — reward crediting
  on first completed order (unchanged trigger logic).
- `tbl_favorite_driver` + the `is_favorite` boost in
  `dispatchManager.js` `selectEligibleDrivers` (unchanged dispatch
  logic — no new dispatch code path).
- `tbl_referral_point_log` — same reward ledger.

## Data model

New Prisma model `tbl_driver_lead`:

| field | notes |
|---|---|
| `id` | PK |
| `driver_id` | FK → `tbl_rider`, the submitting driver |
| `name` | as entered/picked from contacts |
| `phone` | unique across the table (first-submitter-wins) |
| `status` | `pending` \| `verified` \| `rejected` \| `converted` \| `expired` |
| `submitted_at`, `verified_at`, `verified_by_admin_id` | audit trail |
| `expires_at` | `verified_at` + configurable window (default 45 days) |
| `converted_user_id`, `converted_at` | set when the phone signs up |

New settings on `tbl_referral_setting`:
- `lead_referral_points` (admin-configurable, separate from
  `driver_points_per_referral`/`user_points_per_referral`)
- `lead_verification_window_days` (default 45)

## Flows

**1. Driver submits leads**
`POST /driver/leads` with `[{name, phone}, ...]` (bulk, from device
contacts). Per number, backend rejects if: phone already belongs to a
registered `tbl_rider`/`tbl_user`, or already exists in
`tbl_driver_lead` (any status, any driver — first submitter keeps it).
Accepted numbers insert as `status: pending`. Response reports
accepted/skipped counts and reasons. Driver app shows the driver their
own leads list with live status.

**2. Admin verifies**
New admin queue lists `pending` leads. Admin calls the number, then
marks `verified` or `rejected` (manual — no OTP/auto-verification).
On `verified`, `verified_at`/`expires_at` are stamped.

**3. Signup match**
In `customerAuthController.js` signup, after the user record is
created, check `tbl_driver_lead` for a `verified`, non-expired row
matching the entered phone. If found: mark it `converted`
(`converted_user_id`, `converted_at`), and create a `tbl_referral` row
exactly as the existing manual-code path does, with
`referrer_id = lead.driver_id` and a `source: "lead"` marker — so it
flows into the **existing, unmodified** `referralRewardService`.

**4. Reward + favorite-driver on first ride**
No changes to `creditReferralIfFirstOrder`'s trigger (still: first
completed order). One addition: when a `source: "lead"` referral
transitions to `completed`, also insert a row into
`tbl_favorite_driver` (driver_id, new_user_id). This reuses the
existing `is_favorite DESC` boost in `dispatchManager.js` — the driver
isn't force-assigned, just ranked first when eligible/nearby, same as
a customer manually favoriting a driver today. The reward amount for
`source: "lead"` referrals reads `lead_referral_points` instead of
the normal per-referral settings.

**5. Expiry**
A scheduled job (reuse whatever cron/queue mechanism already exists
for other expiry jobs, e.g. KYC doc expiry if present — otherwise a
simple daily check in the existing job runner) flips `verified` leads
past `expires_at` to `expired`. Expired leads no longer match at
signup.

## Error handling

- Duplicate phone submission → 409-style rejection per-item in the
  bulk response, not a whole-batch failure.
- Lead matching at signup is best-effort: if no verified/unexpired
  lead matches, signup proceeds exactly as today (no behavior change
  for the non-referred path).
- Admin rejecting a lead is terminal — driver can resubmit the same
  number later (new row) since it was never converted.

## Testing

- Unit: lead dedup logic, expiry transition, signup-match query,
  reward-amount selection (`source: "lead"` vs normal).
- Integration: full flow — submit → verify → signup → complete first
  ride → points credited with `lead_referral_points` amount → favorite
  row created → dispatch ranking reflects it.

## Improvement ideas (not in this pass, noted for later)

- **Lead quality scoring**: track conversion rate per driver; throttle
  or flag drivers who submit many numbers that never convert (abuse
  signal), independent of the hard dedup rule.
- **WhatsApp-based verification** instead of a phone call, as a
  cheaper ops-effort alternative — admin sends a template message with
  a "Yes, I'm interested" button instead of dialing.
- **Tiered lead rewards**: bonus points if the referred user completes
  N rides (not just the first), rewarding drivers for quality leads
  over one-off signups.
- **Leaderboard**: surface top lead-referrers in the driver app to
  gamify submission (careful: must not incentivize spam over quality —
  pair with the quality-scoring idea above).
- **Self-serve verification fallback**: if admin call capacity is a
  bottleneck, let the referred person self-verify via OTP sent from
  the lead-submission flow, with manual call only as a fallback for
  unresponsive numbers.
- **Favorite-driver decay**: today's design makes the favorite
  permanent; consider letting the customer un-favorite freely (already
  supported by existing toggle endpoint) and optionally decay priority
  if the favorite driver's acceptance rate drops.
