# Pickup relocation + OTP-timeout auto-cancel flow

Date: 2026-09-30

## Purpose

Extend the already-built pickup-location-change feature
([[pickup_location_and_stops_update]] memory) to correctly interact with the
OTP-timeout auto-cancel timer, based on the owner's flow diagram, refined
through several rounds of risk analysis in this conversation.

Today, `orderPickupService.confirmPickupChange` always treats a pickup
change made while the driver is already waiting (`order_status === 2`) the
same way: bank the elapsed wait seconds, revert to status 1, wait for
re-arrival. This is correct for a large relocation, but for a small,
nearby correction it unnecessarily interrupts the timer's flow, and there
is no outer limit on how long a relocation can be strung out across
multiple pause/resume cycles, and no compensation for the driver if the
order ultimately times out anyway.

## Problems being solved

1. **Driver has no incentive to let an order auto-cancel.** Today
   (`tripLifecycle.js` `cancelOverduePickup`), the driver earns nothing on
   an OTP-timeout cancel. Completing the trip late (any time before
   cancellation) earns full fare + waiting charge. This makes indefinitely
   stalling more attractive than accepting a cancellation for a driver in
   a bad situation.
2. **No hard ceiling on pause/resume cycling.** However pausing is
   triggered (today: only the existing bank/revert path), nothing forces
   eventual resolution if the driver never completes the pickup.
3. **The "small move vs. large move" decision must not depend on
   ambiguous human judgment.** The owner's diagram gives the driver a
   Yes/No choice ("is this the correct location?") with different timer
   behavior per branch, but leaves the branch selection to the driver's
   tap. A driver could pick "Yes, continue with remaining time" for a
   genuinely distant new pickup and be unfairly auto-cancelled by the
   clock running out during travel.
4. **Whatever GPS point OTP is verified at could silently become the
   billing basis** even if it differs materially from the location the
   customer actually confirmed via the app.

## Design

### 1. New admin settings

Stored in `app_settings` (mirrors the existing `pickup_otp_timeout_minutes`
pattern in `backend/src/utils/pickupOtpTimeout.js`), each read fresh (no
caching) so admin changes take effect on the next check:

| Key | Default | Meaning |
|---|---|---|
| `pickup_relocate_ceiling_minutes` | 35 | Outer limit from first arrival; past this the order force-resolves regardless of how many pauses happened |
| `pickup_small_move_threshold_m` | 200 | A pickup change within this distance does not pause the OTP timer |
| `pickup_otp_mismatch_flag_m` | 500 | If the OTP is verified this far from the last confirmed pickup point, flag for admin review instead of silently accepting |
| `pickup_timeout_driver_compensation` | 0 | Fixed ₹ amount credited to the driver's wallet when an order auto-cancels on OTP timeout |

Exposed in the admin panel as 4 new labeled fields in
`frontend/src/pages/Settings.jsx`, next to the existing
`pickup_otp_timeout_minutes` field — same convention as `max_extra_stops`,
`extra_stop_charge`, etc. No new settings page.

### 2. Schema changes

- `pkg_order_wait_timer.first_arrival_at` (nullable `DateTime`): set once,
  the first time `order_status` transitions 1→2 for this order. Never
  updated by any later pause/resume/relocate cycle. This is what the
  ceiling sweep measures against — distinct from `pickup_wait_start`,
  which does get cleared/reset on every pause.
- `pkg_order.pickup_otp_mismatch_flag` (`Boolean`, default false): set when
  OTP is verified more than `pickup_otp_mismatch_flag_m` from the last
  confirmed pickup point. Purely informational for admin review; never
  blocks trip completion.

### 3. Backend flow changes

**`driverTripService.progressTrip` (arrival detection):** when the 1→2
transition happens, also set `first_arrival_at` if not already set
(insert-only, never overwritten).

**`orderPickupService.confirmPickupChange`**, when called while
`order_status === 2`: compute the distance between the order's current
`plat/plong` and the new coordinates (reuse
`orderRouteRepricing.getDriverRealDistanceKm`/`computeRouteDistanceKm`
helpers already used by this service).

- **Distance ≤ `pickup_small_move_threshold_m`:** update `plat/plong` and
  reprice as today, but do **not** bank/revert — leave `order_status`,
  `pickup_wait_start` untouched. The OTP-timeout clock keeps running
  with its current remaining time.
- **Distance > threshold:** run the existing bank/revert logic unchanged
  (this is already correct — bank elapsed `pickup_wait_start` seconds
  into `pickup_wait_banked_seconds`, revert to status 1, clear
  `pickup_wait_start/end`, delete the stale `driver_trip_event` "arrived"
  row). Re-arrival at the new point naturally re-triggers status 1→2 and
  resumes the timer with its banked remaining time, exactly as today —
  `first_arrival_at` is untouched, so the ceiling keeps counting from the
  original arrival regardless of how many times this cycles.

**New/extended ceiling sweep** (alongside `tripLifecycle.sweepOverduePickups`,
same periodic-sweep convention): for orders with `order_status < 3` and
`first_arrival_at` older than `pickup_relocate_ceiling_minutes`, force
`cancelOverduePickup` regardless of current pause state (i.e. even if
`pickup_wait_start` is currently null because the order is mid-pause).

**`cancelOverduePickup`** gains a driver-compensation step: after the
existing cancellation logic, if `pickup_timeout_driver_compensation > 0`,
increment `tbl_rider.wallet_balance` and insert a `tbl_wallet_history` row
(`wallet_type: "driver"`, `type: "credit"`), mirroring the existing debit
pattern in `payoutController.js`.

**OTP verification path**: when OTP is verified, compare the driver's
verified GPS to the order's current confirmed `plat/plong`. Within
`pickup_otp_mismatch_flag_m`, proceed as today (that point becomes the
priced pickup location, reusing the existing radius-charge recompute —
no new fee, per the earlier decision that this is a recompute of the
existing charge, not a new pricing component). Beyond the threshold: the
trip still completes normally (never block a handover that already
happened), fare is priced off the last **confirmed** pickup point (not the
raw OTP GPS), and `pkg_order.pickup_otp_mismatch_flag` is set for admin
review.

### 4. Driver-app UI (Android, `OrderDetailsActivity.java`)

No new screens — extends the existing waiting-timer/status-banner/OTP-dialog
UI already in this activity, per the decision to optimize for driver
clarity over matching the diagram's exact mockup:

- **Small-move update:** a brief status-banner text change (existing
  `txtTripLocationStatus`-style banner), timer keeps counting, no button
  changes.
- **Large-move update:** the OTP-verify button area temporarily shows
  "Pickup moved — Navigate to new location" instead of the OTP entry
  affordance; the timer area shows a "Paused" state. Once the existing
  GPS arrival-detection fires at the new point (status 1→2 again), the UI
  flips back to the normal OTP-wait state and the timer resumes counting
  its remaining (banked) time.
- **Ceiling cancellation:** no new client logic — reuses the existing
  `order:customer_cancelled` socket handling already in this activity.

### 5. Testing

Backend: Jest/TDD, following this repo's existing convention — RED/GREEN
per unit (`orderPickupService`, `tripLifecycle` ceiling sweep + driver
compensation, OTP-mismatch flagging), full suite run at the end.

Android: no existing automated-test convention is exercised elsewhere in
this repo for driver-app changes; this part is build-verified manually,
not unit-tested.

## Out of scope

- Any change to the existing radius/pickup-charge calculation formula
  itself — this design only changes *which point* it's calculated against.
- A dedicated admin-review UI/workflow for `pickup_otp_mismatch_flag` —
  the flag is stored and visible on the order record; a review screen is
  future scope if the flag proves to need one.
- Multi-relocation chaining edge cases (customer changes pickup a third
  time while driver is already en route to the second point) — the
  distance-branch logic re-evaluates against the order's *current*
  `plat/plong` each time it's called, so chained relocations fall through
  the same small/large logic naturally; no special-casing needed.
