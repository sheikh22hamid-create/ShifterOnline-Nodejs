# Next-Day Booking: Daily Driver offer, 2 PM auto-live, 10% Daily Driver pricing — Design

Date: 2026-10-13
Status: Design approved in chat (2026-10-13); written spec awaiting review.
Builds on: [2026-09-10-next-day-booking-design.md](2026-09-10-next-day-booking-design.md) (booking_type=3, manual admin assign) and [2026-09-26-daily-driver-system-design.md](2026-09-26-daily-driver-system-design.md).

## 1. Goal

A next-day order (`booking_type=3`) is first arranged by admin through **Daily Drivers**. The admin offers it to one Daily Driver, who can accept or reject. A reject, skip or timeout passes the same order to the next available Daily Driver automatically. If no Daily Driver has accepted by **2:00 PM on the trip day**, the order goes **Live** and is dispatched to Normal Drivers through the existing dispatch engine. An order taken by a Daily Driver pays that driver **10% less** than the normal fare; the customer's fare does not change.

## 2. Decisions (confirmed with the user)

| # | Decision |
|---|---|
| D1 | Deadline = **trip-day 14:00 IST** (the day after booking). Example: booked 12 Oct, goes Live 13 Oct 14:00. The app's 10 AM–8 PM pickup window therefore leaves 14:00–20:00 for Normal Drivers. |
| D2 | Admin picks the **first** Daily Driver; the system runs the cascade after that. Admin may offer or force-assign to anyone at any time. |
| D3 | Customer always pays the **normal fare**. The Daily Driver's earning for the order is 90% of it; the 10% difference is recorded for admin settlement. A Normal Driver order after Live is 100%. |
| D4 | Offer timeout default 60 s and live time default 14:00; both admin-editable. |

## 3. Hard constraint

Current Booking (`booking_type=1`) and Schedule Booking (`booking_type=2`) behaviour must not change. All new behaviour is gated on `booking_type === 3` and lives in new functions or files. `dispatchManager.startDispatch` is called, never edited, for the Live step.

## 4. Data model (additive migration, hand-applied like the others)

`pkg_order` (all nullable / defaulted):
- `next_day_live_at DATETIME(0) NULL` — trip-day live time (IST wall clock converted to the same convention other deadline columns use, see `search_deadline_at`).
- `next_day_stage VARCHAR(10) NULL` — `arranging` or `live`; `NULL` for every other booking type.
- `next_day_discount_amount DECIMAL(10,2) NULL` — the 10% kept by admin when a Daily Driver accepts.

New table `next_day_daily_offer`:
`id`, `order_id`, `rider_id`, `status` (`offered | accepted | rejected | skipped | expired | cancelled`), `offered_by_admin` (nullable; null = system cascade), `offered_at`, `expires_at`, `responded_at`. Index `(order_id, status)`, unique `(order_id, rider_id)` so a driver is never offered the same order twice.

`app_settings` keys: `next_day_offer_seconds` (default 60), `next_day_live_time` (default `14:00`).

## 5. Components

1. **Order creation** (`orderController.createOrderCore`, booking type 3 branch only): set `next_day_stage='arranging'` and `next_day_live_at` from `schedule_date_time` + live time. Still no `startDispatch`.
2. **`nextDayOfferService.js` (new)**
   - `listAvailableDailyDrivers(order)`: riders with a `daily_driver_enrollment` for the trip date in status `enrolled|active`, same vehicle category, not in an active order, not already in `next_day_daily_offer` for this order; ordered by haversine distance to pickup.
   - `offerToDriver({orderId, riderId, adminId})`: transaction creates the offer row, then emits the existing driver order-request popup (`insertOrderRequest` + `emitDriverEvent`) with `expires_at`.
   - `respond({orderId, riderId, action})`: `accept` runs the same claim and finalize path as a normal accept (`tripLifecycle.claimOrderForRider` / `finalizeAcceptedOrder`, as `forceAssignService` does), then sets `driver_earning = round(fare × 0.9, 2)` and `next_day_discount_amount = fare − driver_earning`. `reject` and `skip` close the offer and call `cascade`.
   - `cascade(orderId)`: pick the next available Daily Driver and offer it (`offered_by_admin = null`). When none is left, notify admin ("no Daily Driver left, arrange manually") and keep the order in `arranging`.
   - `expireDueOffers()`: offers past `expires_at` become `expired` and trigger `cascade`.
   - `goLiveDue(now)`: orders with `next_day_stage='arranging'`, `rid=0`, not cancelled, `next_day_live_at <= now`. A conditional update to `live` makes it single-winner; open offers become `cancelled` and their popups are dismissed; then `dispatchManager.startDispatch` runs; admin is alerted.
3. **Sweeper**: a one-minute interval in `server.js` next to the existing System 2 sweeper, calling `expireDueOffers()` then `goLiveDue()`. It reads only the DB, so a restart loses nothing.
4. **Admin API** (`adminRoutes.js`, additive): `GET /orders/next-day/:id/daily-drivers`, `POST /orders/next-day/:id/offer`, `GET /orders/next-day/:id/offers`. Existing `assignNextDayBatch` stays as the force-assign path and also closes any open offer for that order.
5. **Driver endpoints**: accept and reject reuse the existing order accept and reject entry points; if the order is `booking_type=3` and `stage=arranging`, they route to `respond`. A "Next-day · Daily Driver offer" label and the trip date are added to the popup payload.
6. **Admin panel** (Next-Day orders page): available-driver list with distance, "Offer" action, offer history per order, and a countdown to live time.

## 6. Flow

```
book (type 3) → arranging, rid=0, live_at = trip day 14:00
admin offers D1 ──accept──▶ assigned (earning 90%, discount recorded)
        │ reject / skip / timeout
        ▼
system offers D2, D3 … ──none left──▶ admin alerted, order stays arranging
        │
trip day 14:00 with rid=0 ──▶ stage=live, offers cancelled, startDispatch → Normal Drivers (100%)
```

## 7. Error handling and edge cases

- Accept after the offer expired or after the order was assigned or cancelled: `respond` returns a clean "no longer available" and changes nothing.
- Two admins or a cascade racing: the unique `(order_id, rider_id)` plus conditional status updates make a second writer a no-op.
- Customer cancels while `arranging`: open offers become `cancelled`, popups are dismissed, the sweeper ignores the order.
- Driver ends up in a clashing order before accepting: accept re-checks the active-order rule and fails cleanly, then cascades.
- Live step failure (`startDispatch` throws): `stage` stays `live`, the error is logged and admin is alerted; the next sweep retries only when no dispatch is running for the order.
- After Live with no driver found, the existing Booking Guarantee behaviour applies unchanged.

## 8. Testing

Unit tests (jest, mocked prisma, same style as `bookingGuaranteeService.test.js`):
- cascade order, no duplicate offer, "none left" alert;
- accept: 90/10 split rounding, earning and discount persisted, customer fare untouched;
- reject, skip and timeout all cascade; late accept rejected;
- `goLiveDue`: fires exactly once, ignores assigned or cancelled orders, cancels open offers, calls `startDispatch` with Model 1 pricing;
- guard: orders with `booking_type` 1 or 2 are never touched by the sweeper or the routing in accept and reject.
Full backend suite must stay green apart from the two known `aadharPdfVerify` failures.

## 9. Out of scope

Customer app changes, fare changes for Normal Drivers, Daily Driver settlement formulas (the 10% is recorded; admin settles it by hand), and any change to the Free→Daily→Normal tiered-dispatch design.

## 10. Rollout notes

New migration must be applied to dev and prod before deploying (a missing `pkg_order` column would 500 every order read). The two `app_settings` keys have code defaults, so they need no seed.
