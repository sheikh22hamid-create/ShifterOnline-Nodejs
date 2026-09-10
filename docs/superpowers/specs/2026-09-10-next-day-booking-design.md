# Next Day Booking — Design Spec

Date: 2026-09-10
Status: Approved by user, pending implementation plan

## 1. Goal

Add a "Next Day Booking" option to the customer app that is priced only
at the Model 1 (cheapest tier) rate, never automatically dispatched,
and instead centrally managed by admin the next day: admin manually
assigns any pending next-day order to any driver at any time, with a
tool that suggests an efficient pickup→drop→pickup route sequence when
bundling several next-day orders onto one driver. The assigned driver
gets a forced (non-dismissible-choice) notification — no accept/reject.

## 2. Hard constraint (non-negotiable)

**The existing Current Booking (`booking_type=1`) flow must not
change.** Every change in this feature is additive and gated behind
`booking_type === 3`. No shared function used by the live automatic
dispatch/accept/radius-charge path
(`dispatchManager.js`, `tripLifecycle.acceptOrder`/
`finalizeAcceptedOrder`, `orderSocket`) is modified. New behavior lives
in new functions/files, called only from the new next-day code paths.
Testing must explicitly confirm Current Booking and Schedule Booking
(`booking_type=2`) are unaffected (existing test suite green + manual
smoke test of a normal order end to end).

## 3. Why pricing/radius work needs almost no new code

Two facts already true in the codebase make most of the "only Model 1
rate, no radius charge" requirement free:

- `createOrderCore` (`backend/src/controllers/orderController.js:210-216`)
  always prices the order off `firstPkg` — the cheapest tier
  (`sort_order` ascending, i.e. "Model 1") — at creation time, with
  `radiusRangeKm` hardcoded to `1` (zero chargeable radius). Model 2-5
  pricing and the real per-driver radius charge are only ever applied
  later, inside the automatic-dispatch cascade
  (`dispatchManager.runBatchInner`) and at accept time
  (`tripLifecycle.finalizeAcceptedOrder`).
- Next-day orders never enter that automatic-dispatch/accept path (see
  §5). So they structurally never reach the code that would apply a
  higher-tier price or a real radius charge — no special-case pricing
  logic is needed beyond stopping dispatch from starting.

## 4. Customer app (ShifterOnline / Flutter)

File: `ShifterOnline/lib/screens/home/pickupdrop.dart`.

- Uncomment the existing `{'type': 3, 'label': 'Next Day\nBooking', ...}`
  entry in `_buildBookingTypeSelector()` (currently commented at line
  5403).
- User still picks a vehicle category normally (unchanged UI/flow) —
  only the *rate shown/charged* is Model 1's, which happens for free
  per §3.
- No date/time picker for type 3 (unlike type 2's
  `_pickScheduleDateTime`) — next-day has no fixed time. Do not show
  the "Schedule Date & Time" field when `selectedBookingType == 3`.
- On submit, when `selectedBookingType == 3`, send `booking_type: 3`
  and no `schedule_date_time` (backend computes it, see §5).
- Show a short static note in the UI: pickup will happen sometime
  10 AM–8 PM the next day, exact time is not guaranteed.

## 5. Backend: order creation guard

File: `backend/src/controllers/orderController.js`, function
`createOrderCore`.

- When `Number(bookingType) === 3`:
  - Compute `schedule_date_time` server-side as tomorrow's date
    (`odate` + 1 day, date-only, e.g. `"2026-09-11"`) — ignore any
    client-sent value, so admin's list can sort/filter by it exactly
    like `ScheduledOrders.jsx` already does for type 2.
  - **Do not call `dispatchManager.startDispatch(...)`** (line ~269).
    This is the one line that changes for existing code — guarded by
    an `if (bookingType !== 3)` so type 1 and type 2 behavior is
    byte-for-byte unchanged.
  - Still call `adminSocket.notifyNewOrder(order)` so the admin
    dashboard sees it arrive live (existing behavior, unconditional).
- Order sits with `rid = 0`, `o_status = 'Pending'` until admin assigns
  it (§7).

## 6. Data model change

`backend/prisma/schema.prisma`, `pkg_order` model: add one nullable
field, via a normal Prisma migration:

```prisma
next_day_sequence Int?
```

Stores the driver's stop position (1, 2, 3…) once admin assigns a
batch of next-day orders to one driver (§7). `null` until assigned.
No existing column is touched.

## 7. Backend: admin API (new functions only)

The "Scheduled / next-day bookings" section of
`backend/src/controllers/adminOrderController.js` already anticipated
this — it currently only implements the `booking_type=2` pair
(`listScheduled`, `assignScheduledDriver`). Add three **new** exported
functions alongside them (existing two are not touched):

1. **`listNextDay(req, res)`** — mirrors `listScheduled` but
   `where = { booking_type: 3 }`, same `scopedCityId`/date/status
   filtering conventions.

2. **`suggestNextDaySequence(req, res)`** — `POST` body
   `{ rider_id, order_ids: number[] }`.
   - Loads the rider's current `rlats`/`rlongs` (same fields
     `finalizeAcceptedOrder` reads) and the given orders.
   - Runs a greedy nearest-neighbor chain (new pure function, e.g. in
     `backend/src/utils/geoDistance.js`, using the existing
     `haversineKm` — no new Google API calls):
     ```
     current = driver's (lat, lng)
     remaining = orders
     sequence = []
     while remaining not empty:
       next = the order in remaining whose PICKUP is nearest to current (haversine)
       sequence.append(next)
       remove next from remaining
       current = next's DROP (lat, lng)
     ```
   - Returns the suggested order with each leg's distance, for the
     admin UI to display and let admin manually reorder before
     confirming.

3. **`assignNextDayBatch(req, res)`** — `POST` body
   `{ rider_id, sequence: [{ order_id, position }], notify_driver_now }`.
   - Validates every order is `booking_type === 3` and city-scoped
     like `assignScheduledDriver` does.
   - Updates all given orders in one transaction: `rid = riderId`,
     `next_day_sequence = position`.
   - Does **not** touch fare/`d_charge`/`radius_charge` — those were
     already finalized at Model-1/no-radius pricing when the order was
     created (§3).
   - Sends **one** notification per driver (not one per order) — a
     `tbl_rnoti` row (`type: "next_day_order"`) summarizing the count,
     plus a socket emit `order:next_day_assigned` to
     `driver_${riderId}` with the full order list — same delivery
     mechanism `assignScheduledDriver` already uses, new event name so
     it can't be confused with the accept/reject-bearing schedule-order
     event.

Routes added to `backend/src/routes/adminRoutes.js` (additive):
`GET /orders/next-day`, `POST /orders/next-day/suggest-sequence`,
`POST /orders/next-day/assign-batch`.

## 8. Admin frontend (new page, mirrors `ScheduledOrders.jsx`)

New file `frontend/src/pages/NextDayOrders.jsx`:

- Table of pending (`rid = 0`, `booking_type = 3`) orders with
  checkboxes to multi-select.
- A driver picker + "Suggest Sequence" button → calls
  `suggest-sequence`, shows the proposed order 1, 2, 3… with per-leg
  distance; admin can drag to reorder before confirming.
- "Assign All" button → calls `assign-batch`.
- Wire into the route table (`App.jsx`) and nav, same pattern as
  `ScheduledOrders`.

## 9. Driver app (native Android, `ShifterDriver`)

No existing client code handles `order:scheduled_assigned` either
(checked — it's a backend-only feature so far), so this is new for
both types, built here for next-day:

- `NodeSocketManager`/`SocketOrderRouter` (existing socket-listener
  files) get a new listener for `order:next_day_assigned`.
- On receipt, show a plain notification/overlay (reuse
  `OrderNotificationDedup`/`OrderOverlayService` plumbing where it
  fits) listing the assigned order(s) — informational only, no
  Accept/Reject buttons, matches the "forced assignment" decision.
- Assigned next-day orders appear in the driver's existing order list
  UI, sorted by `next_day_sequence`.

## 10. Testing plan

- Run existing backend test suite
  (`backend/src/controllers/__tests__/orderController.test.js` and any
  dispatch/tripLifecycle tests) unchanged and green — proves type 1
  behavior is untouched.
- New unit tests: `createOrderCore` with `booking_type: 3` asserts
  `dispatchManager.startDispatch` is NOT called, and
  `schedule_date_time` is auto-set to tomorrow.
- New unit tests for the nearest-neighbor sequencing function with a
  small fixed set of coordinates (deterministic expected order).
- Manual smoke test: place one normal (type 1) order end-to-end
  (dispatch → accept → complete) to confirm no regression, then one
  next-day order end-to-end (create → admin assigns → driver
  notification appears).

## 11. Explicit non-goals (v1)

- No driver accept/reject for next-day assignments.
- No automatic re-optimization if admin edits a batch after assigning
  (admin re-runs suggest + assign to change it).
- No road-distance (Google) calls in sequencing — haversine only.
- No cron/scheduled reminder job (matches the existing note in
  `assignScheduledDriver` that no such worker exists yet).
