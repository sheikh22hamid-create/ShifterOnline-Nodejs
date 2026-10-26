# Next Day Booking becomes Low Fare Booking: Design

Date: 2026-10-27. Status: draft for approval, nothing built yet.
Builds on: [2026-09-10 next-day booking](2026-09-10-next-day-booking-design.md) (booking_type 3, Model 1 pricing, no dispatch) and [2026-10-13 next-day Daily Driver offer](2026-10-13-next-day-daily-driver-offer-design.md) (arranging stage, cascade, 2 PM auto-live).

## Intent
A Premium customer books a ride for a future date at a Model-1 fare minus an admin-set discount. Instead of an admin assigning a driver, the order sits in a "Low Fare Booking" list on the Driver App; eligible drivers (same vehicle category) can accept it once the customer's chosen start time arrives, first taker wins, and the accepted ride runs through the normal ride lifecycle.

## Goals
- Customer: date + "live from" + "live until" times, then pickup, drop, vehicle; sees Model-1 fare, discount % and final fare before confirming.
- Backend computes and stores the fare, so a later admin discount change never alters an existing booking.
- Driver: Low Fare Booking section with an unread-style count badge, list (newest first), details popup, Accept only inside the window, "Already Attended" for everyone else.
- Admin: Next Day Orders page shows Model-1 fare, discount, final fare, window, status and the accepting driver, with no manual assign.
- A driver cancel reopens the same order (same id, history kept) for other drivers while the window is open.

## Non-goals / anti-goals
- No new trip lifecycle: after acceptance it is an ordinary ride (pickup OTP, tracking, drop, payment, completion).
- No new penalty amounts: a driver cancel uses the existing cancellation fee logic.
- Orders and flows for booking types 1, 2 and the old next-day stages must not change behaviour. Everything new is behind `app_settings.low_fare_booking_enabled` (default OFF) and a new `next_day_stage` value.

## Design

**Switch and compatibility.** With `low_fare_booking_enabled` OFF, everything works as today. With it ON, every NEW booking_type-3 order is created in stage `low_fare` and skips the Daily Driver cascade and the 14:00 auto-live. Orders already in `arranging` or `live` keep their old behaviour until they finish. The admin assign/offer controls are hidden for `low_fare` orders; the old code stays in place (not deleted).

**Fare.** At creation the server takes the selected vehicle category's Model-1 package (the existing `firstPkg` rule: lowest `sort_order`), prices it with the existing Model-1 formula (no radius charge, as today), and applies `discounted = model1 - model1 * percent / 100` (rounded 2 dp). Stored on the order: `next_day_model1_fare`, `next_day_discount_percent`, and `d_charge` / `total_dcharge` = discounted fare. Commission and driver earning follow the existing package rule applied to the discounted fare. The client's price is ignored. The customer cannot pick another model. A new quote endpoint returns Model-1 fare, percent and final fare per vehicle for the confirmation screen.

**Eligibility and scheduling rules (server-validated).** Premium check reuses the existing plan check in `createOrderCore`. Date must be tomorrow or later and at most `low_fare_max_days_ahead` days out (default 7); `live_from` must be in the future; `live_until` after `live_from`, on the same date, longest window `low_fare_max_window_hours` (default 12). Stored as `next_day_live_at` (from) and a new `next_day_live_until`.

**Driver list.** An order is listed for a driver when: stage `low_fare`, unassigned and not cancelled, `live_until` in the future, the driver's vehicle equals the order category, the driver is approved, and the driver has not cancelled it before (an existing `Driver Cancelled` history row for that rider). Before `live_from` the driver sees the details but no Accept. The badge counts listed orders not yet opened by this driver (read state kept per driver); the server is the source of the number.

**Accept.** One atomic conditional UPDATE (`rid = 0`, `order_status = 0`, stage `low_fare`, inside the window) assigns the order; then the existing accept/finalize path runs (as the Customise conversion does: pre-assign, then `tripLifecycle.acceptOrder`). Loser gets "Already Attended". Socket events keep other drivers' lists and badges fresh; Accept re-validates on the server regardless of what the screen shows.

**No taker.** When `live_until` passes with no driver the order is cancelled with reason "No driver accepted in the booking window" and the customer is notified (nothing was charged: next-day bookings take no advance).

**Driver cancels.** The existing `driverCancel` runs (penalty, history, refunds). For a `low_fare` order it does not start the normal dispatch search; instead the same order returns to unassigned Pending, still `low_fare`, if `live_until` is in the future, and drivers get a fresh badge/beep; otherwise it is cancelled as above. The cancelling driver never sees it again.

**Admin.** Settings: discount percent (0 to 50, default 20), switch, max days ahead, max window. Next Day Orders table/drawer: Model-1 fare, discount %, final fare, date, window, status, accepting driver. Statuses are derived from stage + order state.

**Data.** Additive migration on `pkg_order`: `next_day_model1_fare`, `next_day_discount_percent`, `next_day_live_until`; table `low_fare_view` (rider_id, order_id, seen_at) for the badge. `next_day_stage` accepts `low_fare`.

**Phasing.** (1) Backend: settings, quote, creation, list/count/accept, expiry sweep, cancel handling. (2) Admin page. (3) Customer app flow. (4) Driver app section. Each phase tested and committed separately.

## Calls I made (change any)
- New bookings use Low Fare only while the switch is ON; old in-flight next-day orders finish the old way.
- The customer's window is when drivers may ACCEPT; after accepting, the driver heads to pickup right away like any ride.
- No taker by the window's end means the order cancels (no fallback to normal dispatch).
- Daily Driver cascade, 14:00 auto-live and batch assign stay in the code, just not used for `low_fare` orders.
- Max 7 days ahead, max 12 h window, discount capped at 50%.

## Questions only the owner can answer
1. Should Low Fare replace the Daily Driver offer flow for new next-day orders (my default), or should Daily Drivers still get the first offer before the order opens to everyone?
2. After a driver accepts at the window time, does the customer want the pickup to happen right then (my default), or is there a separate pickup time the customer sets?
3. If no driver accepts by the end of the window: cancel the order (my default), or hand it to the normal automatic driver search?
