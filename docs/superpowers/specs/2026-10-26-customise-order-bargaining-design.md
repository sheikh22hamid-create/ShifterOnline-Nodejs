# Customise Order with Counter-Offer Bargaining: Design

Date: 2026-10-26. Status: draft for approval, nothing built yet.

## Intent
A customer describes a non-standard transport job in detail (goods, floors, helpers, durations, stops), names their own budget, and eligible drivers either accept that price or counter it. The customer picks one driver; the job then becomes an ordinary Shifter ride (advance payment, OTP, tracking, completion, wallet/ledger) at the agreed fare. Why: standard rate-card pricing does not fit heavy/awkward jobs, and the tester asked for negotiated fares.

## Goals
- One negotiation flow shared by Customer app, Driver app and Admin panel, consistent in real time.
- After acceptance, everything downstream is the existing ride lifecycle. No second payment, OTP or tracking system.
- Full, append-only audit history of offers, timers, charges, cancellations and re-listings.
- Exactly one driver can ever win an order (row-lock / conditional update, same pattern as `claimOrderForRider`).

## Non-goals / anti-goals
- No new advance-payment formula, no invented waiting/penalty rates.
- No forced re-live popup (unlike the normal driver-cancel re-live); re-listing is a normal list item.
- Admin does not assign drivers manually in this feature (monitor only).
- Must not change behaviour of normal bookings. All new code is behind a kill switch `customise_order_enabled` (app_settings, default OFF).

## What exists today (and why we do not extend it)
`tbl_custom_order` / `tbl_custom_order_bid` plus `customOrderBiddingController`, `customOrderController`, Flutter `custom_order_*.dart`, Driver `CustomOrderListActivity`, admin `CustomOrders.jsx`. It is a thin port of old PHP: free-text addresses with no coordinates, one bid per driver and no counter history, no start/expiry time, no ownership checks, and `convertOrder` explicitly creates NO ride. It cannot reach the requirements. Decision: build new tables and endpoints (`customise_*`), leave the legacy tables untouched, and point the app/driver/admin entry points at the new flow. Legacy code is removed only in a later cleanup the user approves.

## Architecture
Negotiation layer (new) -> on accept -> real `pkg_order` (existing). 

1. **Customise order** (`customise_order`): owner uid, pickup/drop/stops with coordinates, pickup_exact flag, goods block (description, quantity, dimensions, weight, packing notes), pickup and drop handling blocks (floor, carry distance, helpers, load/unload minutes, wait minutes, notes), optional `category_id`, `initial_fare`, `bargain_start_at`, `expires_at`, `city_id`, `status` (scheduled, open, accepted, converted, expired, cancelled), `agreed_fare`, `agreed_rider_id`, `pkg_order_id` (permanent link), relist counters.
2. **Stops** (`customise_order_stop`): one row per stop with its own handling and duration fields (never merged).
3. **Offers** (`customise_offer`): append-only. Customer initial offer is on the order; every driver action is a row (order, rider, amount, kind accept|counter, status active|accepted|rejected_by_customer|withdrawn|superseded|void, timestamps). A driver's new counter marks their previous one `superseded` (history kept).
4. **Driver rejections** (`customise_driver_dismissal`): so a rejected order is not re-shown or re-notified.
5. **Events** (`customise_order_event`): audit trail (created, offer, accept, convert, driver_cancel, relist, customer_cancel, expire, timer_start/stop, charge).
6. **Timers** (`customise_order_timer`): per activity (pickup_wait, pickup_load, drop_wait, drop_unload, stop_n_*): selected minutes, actual start/end, elapsed, billed extra minutes, charge, rate source.
7. **Config**: `app_settings` per city for cancellation policy (driver and customer separately: mode normal|special, fixed, percent, admin_share_percent).

Conversion (`customiseConvertService`): inside one transaction after locking the customise_order row: verify status open/not expired, offer active, eligibility; create the `pkg_order` through the existing `createOrderCore` path with fare overridden to the agreed amount (so advance, commission, driver_earning, ledger all reuse the normal calculation on the agreed fare), set `pkg_order.customise_order_id`, assign the driver via the same claim/finalize functions used by self-accept. Idempotent on `customise_order.pkg_order_id`. Customer then lands on the existing advance-payment screen.

## Rules
- **Eligibility**: driver in pickup city, approved/online, not dismissed, not the cancelling driver for this relist. Category selected -> driver vehicle in that category. No category -> any vehicle, but backend must pass capacity checks (weight, and dimensions vs vehicle body) before accept/counter. Capacity data comes from existing vehicle/category fields; where a field does not exist the check is skipped and noted, never invented.
- **Time**: start/expiry stored UTC, validated on server with the app's existing IST rules. start >= now, expiry > start, max window configurable. Expiry sweep (cron, like `sweepExpiredAdvancePayments`) plus a check on every write, so an expired order can never be accepted.
- **Fare**: server validates min/max (sanity bounds from admin setting) and numeric format; stored decimal. Agreed fare is the accepted offer's amount, copied once.
- **Count badge / beep**: count = open, started, non-expired, eligible, non-dismissed, not-already-offered-by-me orders, computed server-side. Beep via existing socket/push on order open or relist, deduped by (order, rider, event).
- **Timers**: start events reuse existing trip events (pickup OTP verified -> pickup wait/load; drop arrival / drop OTP -> drop wait/unload; stops: stop arrival). Where the app has no explicit load/unload start/stop, add explicit driver actions "Loading started/done", "Unloading started/done". Charge for time beyond the customer-selected minutes uses the rate-card `waiting_charge` and `free_waiting_time` semantic already used by normal orders; if no separate loading/unloading rate exists, the waiting rate applies. Intervals are non-overlapping per order; billed minutes stored once.
- **Cancellation**: policy resolved per city; missing config -> fall back to the existing normal cancel logic (never a made-up amount). Driver cancel after assignment: existing `driverCancel` path plus configured penalty and admin share into the existing ledger; the customise order returns to `open` (original id, history kept, cancelling driver excluded for that relist) if not customer-cancelled and not expired; pkg_order is cancelled with the normal refund rules and a new pkg_order is created on the next acceptance (permanent link list kept in events). Customer cancel: penalty per policy, order closed everywhere, no relist.
- **Auth**: new endpoints verify the caller owns the order / is the rider on the offer. (The wider uid-trust gap in older endpoints stays deferred, per prior decision.)

## Phasing (each phase shippable and tested before the next)
1. **Core negotiation + conversion**: tables, create (with all goods/handling fields + validation), driver list/badge/beep, accept/counter/dismiss, customer offers list, accept/reject offer, atomic conversion to pkg_order, advance via existing screen, expiry. Admin: read-only monitor list/detail.
2. **Timers + extra charges** with audit.
3. **Cancellation policy + relist + penalties**, admin config screen.
4. **Admin monitoring polish** (all columns in section 15), legacy cleanup proposal.

## Calls I made (change any)
- New tables rather than extending legacy ones.
- Kill switch default OFF; per-city admin config.
- Driver cancel creates a new pkg_order on re-acceptance (old one cancelled normally) instead of reopening the old pkg_order, because the old order's fare/advance/ledger belong to the old driver.
- Capacity checks only use fields that already exist.
- Phase 1 first; the apps get a rebuild per phase.

## Open questions only the owner can answer
1. Fare floor: may the agreed fare be below the normal rate-card fare for the same route (driver or customer low-ball), or should there be a minimum such as the rate-card base?
2. Driver cancel with the customer's advance already paid: refund fully to customer and charge the driver the penalty, or carry the advance over to the next driver's order?
3. "Recipient" of the cancellation penalty (besides admin): the customer, the driver, or just the wallet ledger entry types that already exist?
4. How long may bargaining run at most (e.g. 24h / 7 days), and may the customer raise their own offer mid-bargaining?
