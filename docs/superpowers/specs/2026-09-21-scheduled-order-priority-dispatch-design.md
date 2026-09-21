# Scheduled Order (booking_type=2) — Date/Time Picker + Driver Priority Dispatch — Design Spec

Date: 2026-09-21
Status: Approved by user, pending implementation plan

## 1. Goal

Turn `booking_type=2` ("Schedule Booking" — customer picks a future
date/time, up to 7 days ahead) from a half-built, currently-hidden
feature into a working end-to-end flow:

- Customer picks a real date/time (today or up to 7 days ahead) when
  booking.
- Drivers can browse upcoming scheduled orders in a new "Scheduled
  Trips" section and mark themselves **interested** ahead of time
  (non-binding — no lock, no commitment, just a signal).
- 30 minutes before the scheduled pickup time, the order "goes live":
  interested drivers get a priority popup first (15-minute exclusive
  window). If none accept, it falls back to the existing radius-based
  cascade (`dispatchManager`) that instant orders already use, so
  every eligible driver within the customer's search radius gets a
  normal shot at it.
- Customer gets pushed updates: order went live/searching, a driver
  was assigned, and (if the accepting driver has little travel-time
  buffer left) a heads-up that pickup may run a few minutes late.

This is **Phase B**. **Phase A** (the date/time picker itself) is a
small precursor covered in §4 — it has to land first because Phase B
has nothing to show drivers or dispatch without real
`schedule_date_time` values coming from real orders.

## 2. Hard constraints (non-negotiable)

Same posture as the existing Next Day Booking feature
(`booking_type=3`), which this design deliberately does not touch:

- **`booking_type=1` (instant) and `booking_type=3` (next-day) flows
  must not change.** No shared function on the live automatic
  dispatch/accept path (`dispatchManager.js`, `tripLifecycle.acceptOrder`
  / `finalizeAcceptedOrder`, `orderSocket`) is modified in a way that
  changes behavior for type 1 or type 3 — only new, additively-gated
  code paths are added, or existing `booking_type=2`-only code
  (`dispatchDueScheduledOrders`, `sendScheduledOrderReminders`) is
  changed.
- The existing radius-based cascade (`dispatchManager.startDispatch`)
  is **reused as-is** for the fallback round — not reimplemented. The
  fallback round is just a normal call to `startDispatch(order)`,
  exactly like an instant order gets today, just triggered later (at
  `scheduled_time − 30min` instead of at order-creation time).
- Final billed fare (`d_charge`/`total_dcharge`/`advance_payment`) is
  already priced off whichever driver actually accepts, at accept time
  (`tripLifecycle.finalizeAcceptedOrder`) — untouched by this feature.
  Nothing here changes pricing.

## 3. Timeline (the core mechanic)

Example: scheduled pickup 3:00 PM, customer's search radius 10km.

| Time | What happens |
|---|---|
| Order creation → 2:30 PM | Order sits `Pending`, `rid=0`. Visible in driver app's "Scheduled Trips" list (any driver in the matching category/city can see it and tap "I'm Interested" any time in this window, or un-mark). Visible in admin's `ScheduledOrders.jsx` as today. |
| **2:30 PM** (`scheduled_time − 30min`) | Order "goes live". If ≥1 driver marked interested: priority popup sent to exactly those drivers, each showing the real scheduled pickup time prominently (visually distinct from an instant-order popup). If 0 drivers marked interested: skip straight to the fallback round below. |
| 2:30–2:45 PM | 15-minute interested-only window. First interested driver to accept wins (same atomic accept path as every other order type — see §6). Others are told the order's no longer available. |
| **2:45 PM** (no accept in the priority window) | Fallback: normal `dispatchManager.startDispatch(order)` — the same nearest-first, tier-based cascade instant orders already use, searching within `order.radius_range` (the customer's own search radius, untouched by this feature). Interested drivers who didn't accept during their window are eligible here too, same as any other driver. |
| Anytime before/after 3:00 PM, if still unassigned | Existing safety net: admin can manually pre-assign from `ScheduledOrders.jsx` (`AssignScheduledDriverModal`, already built, unchanged). |
| On accept (whenever it happens) | If `accept_time` leaves the driver less than a configurable buffer (default 10 min) before `schedule_date_time`, send the customer an extra "driver may arrive a few minutes late" push, in addition to the normal "driver assigned" notification every order already gets. |

## 4. Phase A — Customer date/time picker (`ShifterOnline`)

- `home.dart`: flip `_scheduleBookingEnabled` to `true`.
- `select_vehicle.dart` (or a small new sheet, following the existing
  bottom-sheet pattern the radius picker uses): when
  `_selectedBookingType == 2`, show a date/time picker before order
  submission — date range today .. +7 days, any time of day. Store the
  chosen value as an ISO 8601 string.
- Order-create request already has a `schedule_date_time` field
  wired end-to-end in the backend (`orderController.js`) — today the
  app just never populates it (confirmed: currently null for every
  `booking_type=2` order). Send the picked value in that field.
- No backend change needed for this part alone — `finalScheduleDateTime`
  in `createOrderCore` already uses `scheduleDateTime` when
  `bookingType !== 3` (`orderController.js:270-272`).
- Minimum picker constraint: reject times less than 45 minutes from
  now client-side (matches §3's 30+15 min mechanic — a pickup with
  less than 45 minutes' notice has no room for the priority window
  before the fallback would need to fire immediately anyway). Keep
  this a simple client-side validation, no new backend validation.

## 5. Data model change

`backend/prisma/schema.prisma` — one new table, one new field:

```prisma
model pkg_order {
  // ...existing fields...
  priority_notify_sent  Boolean? @default(false)
}

model pkg_order_interest {
  id         Int      @id @default(autoincrement())
  order_id   Int
  rider_id   Int
  created_at DateTime @default(now())

  @@unique([order_id, rider_id])
  @@index([order_id])
  @@index([rider_id])
}
```

- `priority_notify_sent` mirrors the existing `driver_notify_sent`
  gate pattern — marks "the interested-only popup already went out for
  this order", so the sweep doesn't re-send it. `driver_notify_sent`
  itself continues to mean "the fallback cascade has been started" —
  same meaning it has today for `booking_type=2`, just now fired later
  (§6) instead of exactly at `schedule_date_time`.
- `pkg_order_interest` is a plain many-to-many "who's interested in
  what" table. No lock, no state machine — a row just means "notify
  this rider first if this order goes live." Deleting a row (driver
  un-marks interest) is a plain delete, no soft-delete needed.

## 6. Backend: dispatch timing (`tripLifecycle.js`)

Replace `dispatchDueScheduledOrders`'s single-stage "due now → dispatch"
check with a two-stage sweep, still run on the same periodic interval
`server.js` already wires it into:

```
for each order where booking_type=2, o_status='Pending', driver_notify_sent=false:
  leadMs = schedule_date_time - now

  if leadMs > 30min: skip (not live yet)

  if !priority_notify_sent:
    interested = query pkg_order_interest for this order_id, join tbl_rider (online, eligible category/city)
    if interested.length > 0:
      send priority popup to interested riders only (new function, §7)
      mark priority_notify_sent = true, priority_started_at = now
      continue to next order (don't fall through same tick)
    else:
      // nobody interested — go straight to fallback, no 15-min wait to burn
      dispatchManager.startDispatch(order, ...)
      mark driver_notify_sent = true
      continue

  // priority_notify_sent is already true from an earlier tick
  if now >= priority_started_at + 15min and order still Pending:
    dispatchManager.startDispatch(order, ...)
    mark driver_notify_sent = true
```

- `sendScheduledOrderReminders` (the existing customer "10 minutes
  left" push) is untouched — it already runs off `schedule_date_time`
  independently of this dispatch timing.
- New customer push at the "goes live" moment (`priority_notify_sent`
  or immediate-fallback branch above, whichever fires first) — new
  function alongside `pushNotifier.notifyCustomerScheduleReminder`,
  e.g. `notifyCustomerOrderLive(order)`. Fire-and-forget, same pattern
  as every other customer push in this file.
- New "driver may be late" push: added at the end of the existing
  accept success path (`finalizeAcceptedOrder`), gated on
  `Number(order.booking_type) === 2` and `scheduleMs - Date.now() <
  LATE_ACCEPT_BUFFER_MS` (new constant, default 10 min, in
  `config/constants.js`). Purely additive — no existing accept
  behavior changes for any booking type.

## 7. Backend: priority popup mechanism

New function, e.g. `dispatchManager.offerToInterestedRiders(order, riderIds)`:

- For each rider still eligible (online, not already mid-popup on
  another order, same category match `selectEligibleDrivers` already
  enforces), price the order for that rider's own distance (reuses
  `pricingEngine.priceForPackage`, same per-driver pricing pattern
  `runBatchInner` already uses) and emit a **new** socket event
  `order:scheduled_priority_offer` to `driver_${riderId}` — deliberately
  a new event name, not `order:scheduled_assigned` or
  `order:next_day_assigned`, so the driver app can render it with its
  own "priority scheduled pickup" popup copy (§8) without touching
  either existing event's handling.
- No per-rider **lock** the way the tiered cascade's batches use one
  (that locking exists to stagger tiers/rounds against each other —
  irrelevant here, there's only one round). All interested riders get
  the offer at once; whoever's `order:accept` reaches
  `claimOrderForRider` first wins — that function's existing
  transaction (`OfferNotFreshError` / atomic claim, `tripLifecycle.js:57-92`)
  already makes concurrent accepts on the same order safe today for
  every other order type, so this reuses that guarantee rather than
  adding new locking.
- If the 15-minute window elapses with no accept, no explicit
  "cancel" message is needed for the losing riders — the next tick of
  the sweep in §6 starts the normal `dispatchManager.startDispatch`
  cascade, and the driver app's existing "offer expired" handling
  (already used for the live-order popup's own timeout) covers it.

## 8. Driver app ("Scheduled Trips" — native Android, `ShifterDriver`)

New `ScheduledTripsActivity` (+ adapter), added as a new item in
`HomeActivity`'s bottom nav or as an entry point from `HomeFragment`
(final placement is an implementation-time call, not a design
blocker) — follows the existing list pattern `OrderItleListActivity`
already establishes:

- **List view**: `GET /driver/scheduled-trips` — all `booking_type=2`,
  `o_status='Pending'`, `rid=0` orders in the driver's vehicle category
  and city, `schedule_date_time` from now to +7 days, sorted soonest
  first. Each row: pickup/drop address, scheduled date & time,
  estimated fare, and an "I'm Interested" toggle.
- **Mark/unmark interest**: `POST` / `DELETE`
  `/driver/scheduled-trips/:orderId/interest` — writes/deletes the
  `pkg_order_interest` row from §5. Toggle reflects current state on
  load (driver's own interest rows for the listed orders, joined into
  the list response).
- **Priority offer popup**: `NodeSocketManager` gets a new listener for
  `order:scheduled_priority_offer`, routed through the same
  `SocketOrderRouter` → `OrderDialogHelper`/`OrderOverlayService`
  plumbing the live-order popup already uses, but rendered with copy
  that foregrounds the actual scheduled pickup time (e.g. "Scheduled
  pickup — Today, 3:00 PM" instead of "New Order Nearby"). Accept/Reject
  emit the same existing `order:accept` / `order:reject` events — no
  new accept code path.
- The existing fallback round (§6/§7 falling through to
  `dispatchManager.startDispatch`) delivers to drivers via the
  **existing** `order:scheduled_assigned`/live-order popup path,
  unchanged — a driver who wasn't interested sees a normal-looking
  popup, just for an order whose pickup is up to 30 minutes out
  instead of "now". (Copy note: the popup should still surface
  `schedule_date_time` if present, matching §3's requirement that
  drivers always know the real pickup time — small addition to the
  existing popup layout, not a new popup type.)

## 9. Admin frontend (`ScheduledOrders.jsx`)

Minor additive change: add an "Interested" column showing a count
(e.g. "3 interested") sourced from a join/count against
`pkg_order_interest` in the existing `listScheduled` admin endpoint.
Everything else on that page (the table, `AssignScheduledDriverModal`,
the manual pre-assign safety net from §3) is unchanged.

## 10. Testing plan

- Backend unit tests: the two-stage sweep in §6 — (a) order with
  interested riders gets exactly one priority offer at −30min and,
  absent an accept, exactly one fallback `startDispatch` call at
  −15min, never both at once; (b) order with zero interested riders
  skips straight to fallback at −30min; (c) `booking_type=1` and `=3`
  orders are never touched by this sweep (existing behavior for those
  types confirmed unchanged by running the existing test suite green).
- New unit tests for `pkg_order_interest` create/delete (uniqueness
  constraint, city/category filtering on the list endpoint).
- New unit test for the "driver may be late" push gating (accept close
  to `schedule_date_time` fires it; accept with plenty of buffer
  doesn't).
- Manual smoke test end-to-end: place one scheduled order a few
  minutes out (compressed timers for testing), mark it interested from
  a driver account, confirm priority popup timing and copy, let it
  expire unaccepted, confirm fallback cascade fires and looks like a
  normal order popup with the schedule time shown; separately, confirm
  one instant (type 1) and one next-day (type 3) order still work
  end-to-end unmodified.

## 11. Explicit non-goals (v1)

- No per-category lead-time tuning (bike vs truck) — one global 30/15
  minute split for all categories, per the approved decision.
- No re-notification / reminder to interested drivers as the go-live
  moment approaches (they just get the one priority popup at go-live).
- No admin UI to manually adjust or cancel the priority window once
  started — the existing manual pre-assign safety net (§3) already
  covers "order needs a human to intervene."
- No change to how `radius_range` itself is chosen by the customer —
  out of scope per the earlier (separate, shelved) discussion about
  removing the radius picker.
