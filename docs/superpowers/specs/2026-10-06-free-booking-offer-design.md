# Free Booking Offer - Design

Date: 2026-10-06
Status: draft for review

## 1. Purpose

Premium customers (active `CUSTOMER_PREMIUM` plan, price set by admin in `tbl_premium_plan`) get a
one-time **wallet credit equal to the full invoice of a completed trip**, provided the trip was
served by a vehicle from the company's **offer pool**.

This is NOT a ₹0 fare. The fare, invoice and receiver payment stay exactly as today. The benefit is
a wallet credit after the trip is completed and paid. After one credit the benefit is **locked**
until the user brings one successful referral.

## 2. Decisions already agreed

- Offer pool = vehicles (riders) that the admin picks from the registered ones. The admin adds and
  removes them, with a date range.
- When a free booking is requested, pool vehicles are searched first. If none is in range, the
  customer sees a popup (paid vehicle, no refund, highlighted) and may proceed as a normal booking.
- Refund = the full actual trip amount, credited to `tbl_user.wallet`; the user can spend it on new rides.
- A free booking order is dispatched **only to pool drivers**.
- Unlock = a referral by this user becomes successful (existing `tbl_referral.status = 'completed'`),
  automatic. The admin also has a manual lock/unlock override.
- City `admin` can turn the offer ON/OFF and set its timeline for their own city; `superadmin` does
  the same for any city through the `?city_id=` dropdown (existing `scopeFilter` behaviour).
- Customer app (Flutter), backend and admin panel are all in scope. The driver app does not change.

## 3. Eligibility (evaluated at booking time, and re-checked server-side at order creation)

A booking is a **free booking** only if ALL of these hold:

1. The user has an active customer premium plan (`customerPlanService.activeSubscription`).
2. The user's `free_booking_locked` is false.
3. The user has no other open free booking (status `FREE_BOOKING_CONFIRMED` or `FREE_BOOKING_REWARD_PENDING`).
   This stops two concurrent trips from both earning a credit.
4. The pickup city's setting is `enabled = 1` and `now` is inside `offer_start..offer_end`.
5. At least one pool driver exists who: has a valid pool row today (`valid_from <= today <= valid_to`,
   `active = 1`, same city), matches the requested vehicle type (`tbl_rider.vehicle = category`),
   is online/approved with a fresh location (same conditions as `selectEligibleDrivers`), and is within
   the order's search radius of the pickup.

Outcomes of the check:

| Outcome | Customer sees |
|---|---|
| `eligible` | "Free Booking" badge, then a normal booking |
| `no_free_vehicle` | Popup: no free vehicle available, paid vehicle only, **no refund**. Proceed or cancel |
| `locked` | Normal booking. Status shows "Free Booking Locked, complete a referral to unlock" |
| `not_premium`, `offer_off` | Normal booking, offer not shown |

The client is never trusted. The create-order endpoint repeats the check. If the client asked for a
free booking but it no longer qualifies, the endpoint answers `free_booking_unavailable` (HTTP 409)
without creating the order, and the app shows the same popup.

## 4. Data model (Prisma, hand-written migration SQL, see section 10)

**`free_booking_setting`** (one row per city)
`city_id` (unique), `enabled` (bool), `offer_start` (datetime), `offer_end` (datetime), `updated_by`, `updated_at`.
The search radius is the order's own `radius_range`, not a new setting.

**`free_booking_pool`**
`id`, `city_id`, `rider_id`, `vehicle_details_id` (nullable, points at `tbl_vehicle_details`, for display),
`valid_from` (date), `valid_to` (date), `active` (bool), `added_by`, `created_at`, `updated_at`.
Index on `(city_id, active, valid_from, valid_to)` and `rider_id`.

**`free_booking_order`** (one row per free booking; this is the audit record)
`id`, `order_id` (unique), `user_id`, `city_id`, `status`, `not_eligible_reason` (nullable),
`pool_rider_id` (rider who accepted), `accepted_in_pool` (bool), `actual_fare`, `credit_amount`,
`wallet_history_id` (nullable), `search_radius_km`, `premium_plan_id`, `premium_plan_amount`,
`created_at`, `completed_at`, `credited_at`.

Statuses stored: `FREE_BOOKING_CONFIRMED`, `FREE_BOOKING_REWARD_PENDING`, `FREE_BOOKING_REWARD_CREDITED`,
`FREE_BOOKING_NOT_ELIGIBLE`. From the product list, `NORMAL_BOOKING` is the absence of a row,
`CHECKING`/`ELIGIBLE` are only the result of the check endpoint (nothing persisted), and `LOCKED`
is a user state (below), not an order state.

**`tbl_user`** gets `free_booking_locked` (bool, default false) and `free_booking_locked_at` (datetime, null).

## 5. Dispatch

`order` gets no new column; `selectEligibleDrivers(order, ...)` looks up `free_booking_order` by
`order_id`. If the row exists with status `CONFIRMED` it adds
`AND r.id IN (<pool riders valid today in order.city_id>)` to the existing WHERE clause (all the
other filters, radius, freshness, wallet limit, settlement block, stay).

Fallback: if a free-booking order's pool-filtered query returns no candidate (pool drivers rejected,
timed out, went offline or busy), the row is set to `NOT_ELIGIBLE` (`pool_unavailable`), the customer
gets a notification ("free vehicle was not available, your booking continues as a normal booking,
no refund"), and the same call re-runs without the pool filter. Normal booking from then on.

At acceptance (`tripLifecycle.claimOrderForRider` / `finalizeAcceptedOrder`) the accepting rider is
stored on the row (`pool_rider_id`, `accepted_in_pool`).

## 6. Trip complete and credit

A single function `freeBookingService.onOrderSettled(orderId)` is called when an order is completed
and its payment is settled by the existing settlement flow (all the places where `order_settlement`
becomes paid/closed, including receiver paid online, cash received, admin outcomes; and the
completion path when no settlement row is needed). It is idempotent.

Within one DB transaction, with the `tbl_user` row locked `FOR UPDATE`, it checks:

- the row is `CONFIRMED`, the order is Completed, not cancelled,
- `accepted_in_pool = true` and `pkg_order.rid == pool_rider_id` (no vehicle change, Rule 12),
- payment is settled (the payer may be the receiver or, if the user pays, the user; the rule is
  "the final invoice is paid", not "receiver specifically"),
- the user is still not locked.

If all pass: `credit_amount` = the final invoice total of the order (the same figure the settlement
treats as the amount due; one helper `finalInvoiceTotal(order)`), credited with the `creditBooker`
pattern from `receiverWalletCredits.js` (`tbl_user.wallet` increment plus `tbl_wallet_history` credit
row, idempotency key `free_booking_credit:<order_id>`), status becomes `REWARD_CREDITED`, and the user
is **locked** (`free_booking_locked = 1`, `free_booking_locked_at = now`). A push/inbox notification is sent.

If any check fails the row becomes `NOT_ELIGIBLE` with the reason (`cancelled`, `vehicle_changed`,
`locked`, `payment_failed`). No credit, no lock.

The credit is not reversed by later events; refunds/reversals of the order itself go through the
existing settlement paths. (If product wants a clawback, that is a separate change.)

## 7. Lock and unlock

- Lock: only in the credit transaction above, or by the admin override.
- Auto-unlock: in `referralRewardService.awardReferralReward`, right after the successful atomic claim
  (`status: pending -> completed`), if the referrer is a `USER` and `free_booking_locked = 1`, set
  `free_booking_locked = 0`. The claim sets `verified_at = now`, so it is always later than
  `free_booking_locked_at`; a referral that was already completed before the lock can never unlock it,
  because the claim only fires on the pending-to-completed transition. A referral registered before
  the lock but completed after it does count, since "successful" is the event that matters.
- Manual: admin can lock or unlock any user from the admin panel (logged with admin id).
- The status the app shows: `available` (premium, not locked), `locked` (with the "complete a
  referral to unlock" text), `unlocked` is shown once after an unlock (a flag `free_booking_just_unlocked`
  cleared when read), `not_premium`, `offer_off`.

## 8. API

Customer (same style and the same known auth gap as the other customer routes; see the memory note
on order dispatch auth):

- `POST /api/customer/free-booking/check` `{uid, plat, plong, category, city_id, radius_range}`
  returns `{outcome, ...}` per section 3.
- `GET /api/customer/free-booking/status?uid=` returns the badge state.
- Order create takes an optional `free_booking: true`; the server re-checks (section 3) and writes the
  `free_booking_order` row in the same transaction as the order.

Admin (`auth`, `authorize`, `scopeFilter`; reads for `RIDER_ROLES`, writes for `superadmin`/`admin`):

- `GET/PUT /api/admin/free-booking/settings` (city ON/OFF, offer start/end)
- `GET /api/admin/free-booking/pool`, `GET .../pool/candidates` (registered, approved riders of the city
  not already in the pool), `POST .../pool`, `PUT .../pool/:id`, `DELETE .../pool/:id`
- `GET /api/admin/free-booking/orders` (audit list with filters)
- `POST /api/admin/free-booking/users/:userId/lock` and `.../unlock`

## 9. Admin panel and customer app

Admin panel (React): new "Free Booking Offer" page with three tabs: Settings (city dropdown for
superadmin, ON/OFF toggle, start/end), Offer Pool (add/remove vehicles, date range, active toggle),
Bookings and Users (audit list, lock/unlock). `admin` sees only their city.

Customer app (Flutter, `ShifterOnline/`, gitignored: files committed with `git add -f`):
- On the booking screen, call the check when pickup, drop and vehicle type are set; show the badge or
  the popup (sections 3 and 7). The popup highlights "no refund", with Proceed and Cancel.
- Offer status chip on the premium/profile area.
- The credit shows up in the existing wallet history screen through the normal `tbl_wallet_history`
  row (remark: "Free Booking refund for order #N").

## 10. Rollout

- `prisma db push` on dev, hand-written `migration.sql`, `prisma migrate resolve --applied`
  (same workflow as Daily Driver). Production needs the SQL run by the user before deploy.
- Feature is dark by default: no `free_booking_setting` row means OFF for that city.
- Logging on every status transition for fraud/tracking.

## 11. Testing

- Unit tests (pure functions): eligibility decision, credit-amount and unlock rule (`verified_at > locked_at`).
- Integration tests: check endpoint outcomes, create-order re-check and 409, dispatch pool filter and
  fallback, credit idempotency (double call credits once), concurrent two free bookings credit once,
  vehicle-changed and cancelled cases, referral auto-unlock, admin override.

## 12. Out of scope

Clawback of credit after a later dispute, per-vehicle-type enable lists, any driver app change,
migration of the PHP premium purchase flow.
