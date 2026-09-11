# Add Stop (Multi-Stop Booking) — Design Spec

Date: 2026-09-11
Status: Approved by user, pending implementation plan

## 1. Goal

Let a customer add up to N extra drop points to an order at booking time
(N is admin-configurable). Fare accounts for the full multi-leg route
distance plus a flat, admin-configurable charge per extra stop. The
driver app shows the extra stops as an address list on the existing
order screen — no new driver-side completion flow. Admin can see the
stop list on an order's detail view.

## 2. Correcting an earlier wrong assumption

An earlier pass at this codebase found UI text ("Add Stop Location") in
`pickupdrop.dart` and concluded the feature was "already built, just
needs verification." A full trace proved that wrong:

- The entire stops UI block (`pickupdrop.dart:2048-2415`, including the
  "Add Stop Location" button) is wrapped in a Dart block comment — it
  never renders today.
- The underlying state/functions it would call
  (`dropLocations`/`addNewDropLocation`/`selectDropLocation`/
  `removeDropLocation`, `pickupdrop.dart:5896-5981`) are real, working
  code (the address-picker integration is genuine, not a stub) but have
  zero live call sites.
- Even if the UI were uncommented, `orderParcelApi`
  (`pickupdrop.dart:5664-5693`) never reads `dropLocations` when building
  the order-creation payload — only the single main drop
  (`lat2`/`lon2`/`daddress`) is ever sent.
- The backend (`pkg_order` schema, `createOrderCore`, `pricingEngine.js`,
  `geoDistance.js`) has zero concept of multiple drop points — no field,
  no distance-summation logic, no charge. The legacy PHP backend never
  had this either (checked `pks_order.php` — single pickup/drop pair,
  matching the current schema field-for-field). This is a greenfield
  feature, not a partially-finished one.

This spec treats it as new work end to end.

## 3. Requirements (confirmed with user)

- **Who adds stops:** the customer, at booking time only (matches the
  existing dead UI's scope). Stops are fixed once the order is created —
  no mid-trip stop addition by the driver (that would be a separate,
  much larger feature: live order mutation, driver-side UI, mid-trip
  consent/re-pricing — explicitly out of scope here).
- **Pricing:** a flat, admin-configurable charge per extra stop, on top
  of the fare for the full multi-leg route distance (pickup → stop 1 →
  stop 2 → ... → final drop, not just pickup → final drop).
- **Driver-side tracking:** none. The driver's existing single
  "trip complete" flow is unchanged. Stops appear only as an address
  list for reference.
- **Max stops:** admin-configurable (not hardcoded).

## 4. Data model — one new table, zero changes to `pkg_order`

Given the schema-drift risk already hit once in this codebase (a
pre-existing DB has columns absent from `schema.prisma`, making
`prisma db push` on `pkg_order` unsafe — see the Next Day Booking
spec/plan for the full story), this feature adds a **brand-new table**
instead of touching `pkg_order`'s columns at all. A new table has no
drift risk — nothing pre-existing can collide with it.

```prisma
model pkg_order_stops {
  id             Int      @id @default(autoincrement())
  order_id       Int
  sequence       Int
  lat            String   @db.Text
  lng            String   @db.Text
  address        String?  @db.Text
  hno            String?  @db.Text
  landmark       String?  @db.Text
  contact_name   String?  @db.Text
  contact_number String?  @db.Text
  created_at     DateTime @default(now())
}
```

No Prisma `@relation` to `pkg_order` — matches this codebase's existing
style of flat tables linked by a plain `Int` id column (e.g. `pkg_order`
itself has no declared relations to `tbl_rider`/`tbl_user`).

Apply via `npx prisma db push` (safe here — pure table creation, not an
`ALTER` on a drifted table) or a manual
`CREATE TABLE pkg_order_stops (...)` if `db push` is ever avoided
entirely per the standing caution from the Next Day Booking feature.

## 5. Admin-configurable settings — zero new schema, zero new endpoint

The backend already has a generic key-value settings table,
`app_settings` (`setting_key`, `setting_value`), and
`settingsController.js`'s existing `getSettings`/`updateSettings`
already read/write **any** key in it via a `flags` object
(`updateSettings`, `backend/src/controllers/settingsController.js:73-90`
upserts `req.body.flags` entries into `app_settings` with no allowlist).
The admin frontend's `Settings.jsx` already renders **every** key present
in `flags` as an editable text input in an "Other Feature Flags" section
(`frontend/src/pages/Settings.jsx:296-311`) and saves it back through the
same generic mechanism — with zero code changes needed on either side.

So: seed two new rows into `app_settings` —

- `max_extra_stops` (default `"2"`)
- `extra_stop_charge` (default `"0"`)

— and they immediately become visible and editable in the existing
Settings page, no new UI code required. (If a friendlier label than the
auto-generated "max extra stops"/"extra stop charge" is wanted later,
that's a small follow-up to `Settings.jsx`, not part of this feature.)

## 6. Backend: order creation

File: `backend/src/controllers/orderController.js`, function
`createOrderCore`.

- New optional parameter: `stops` — an array of
  `{ lat, lng, address, hno, landmark, contactName, contactNumber }`,
  0 to N entries (N = the `max_extra_stops` setting, read at request
  time and validated: reject with `VALIDATION` if `stops.length` exceeds
  it).
- **Distance**: when `stops.length > 0`, ignore any client-sent
  `distance` override (the existing single-stop path already trusts a
  client-sent `distance` if positive — extending that trust to a
  multi-leg client-computed total would make stop-charge evasion via a
  lowballed distance easier, so multi-stop orders always compute
  server-side). Compute total route distance via a new helper (§7) over
  the ordered point sequence `[pickup, ...stops, finalDrop]`, summing
  each consecutive leg.
- **Fare**: after the existing `pricingEngine.priceForPackage(...)` call
  produces `fare`/`driverEarning`, add
  `extraStopsCharge = stops.length * extraStopChargeSetting` into the
  value that becomes the order's stored `extra_mile_charge` column —
  i.e. `extra_mile_charge: (Number(extraMileCharge) || 0) + extraStopsCharge`.
  This is a deliberate reuse of an existing column rather than a new one:
  `extra_mile_charge` is already the codebase's "flat additive charge on
  top of the distance fare" carrier, and — critically — it's the value
  `tripLifecycle.finalizeAcceptedOrder` reads back out and re-feeds into
  `pricingEngine.priceForPackageId` when a driver actually accepts
  (`tripLifecycle.js:184-190`). Storing the stops charge anywhere else
  (a new column pricingEngine doesn't know about) would show correctly
  in the initial dispatch popup but silently disappear at accept time —
  the exact "two different fares for the same order" bug class this
  codebase has hit before (see `pricingEngine.js`'s own radius-charge
  comments). Reusing `extra_mile_charge` means zero changes to
  `pricingEngine.js` or `tripLifecycle.js` are needed at all — the
  existing plumbing already carries it through correctly.
  - Tradeoff accepted: an order's `extra_mile_charge` column will mix
    "real" extra-mile charges with the stops surcharge if a future
    feature ever sends both non-zero — today nothing does, and the
    stored `pkg_order_stops` rows (§4) let admin/support reconstruct the
    breakdown (stop count × the `extra_stop_charge` setting at order
    time) if ever needed. Not worth a new column for the drift risk it
    would add to `pkg_order` (see §4).
- **Persistence**: after `prisma.pkg_order.create(...)` succeeds, if
  `stops.length > 0`, insert them via
  `prisma.pkg_order_stops.createMany({ data: stops.map((s, i) => ({ order_id: order.id, sequence: i + 1, ... })) })`.
  A failure here is logged (`logger.error`), not thrown — matches this
  function's existing tolerance for non-critical side effects (e.g. the
  `adminSocket.notifyNewOrder` call is similarly best-effort).

## 7. Backend: multi-leg distance helper

File: `backend/src/utils/geoDistance.js`. New function:

```js
async function getMultiStopDistanceKm(points) {
  // points: [{lat, lng}, {lat, lng}, ...], length >= 2
  const legs = await Promise.all(
    points.slice(0, -1).map((p, i) =>
      getRoadDistanceKm(Number(p.lat), Number(p.lng), Number(points[i + 1].lat), Number(points[i + 1].lng))
    )
  );
  return {
    distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    source: legs.every((leg) => leg.source === "google") ? "google" : "mixed",
  };
}
```

Reuses the existing two-point `getRoadDistanceKm` per leg (which already
falls back to haversine per-leg on any Google API failure) — no new
routing-API integration needed. Exported alongside `haversineKm` and
`getRoadDistanceKm`.

## 8. Admin frontend: display only

- `adminOrderController.getOne` (single-order fetch): add a
  `prisma.pkg_order_stops.findMany({ where: { order_id: id }, orderBy: { sequence: "asc" } })`
  alongside the existing order fetch, included in the response as
  `stops`.
- `OrderDetailDrawer.jsx`: right after the existing "Delivery Location"
  field (`:335`), render the stop list (if any) as a simple numbered
  address list — no map, no editing, matches the read-only nature of
  every other field in this drawer.
- `NextDayOrders`/`ScheduledOrders`/`Orders` list pages: no change — a
  stop count badge is a nice-to-have, not required for v1.

## 9. Customer app (Flutter)

- Uncomment the stops UI block (`pickupdrop.dart:2048-2415`) — it's
  already functionally correct (real address-picker integration via
  `Traking(type: "Drop", ...)`), just needs to actually render.
- Fetch `max_extra_stops` from the existing `packagelist` response
  (`Config.nodePackageList`, already called when the booking screen
  loads categories/vehicle rates) — add `max_extra_stops` and
  `extra_stop_charge` as two new top-level keys to
  `pricingEngine.getPackageListForCategory`'s return object
  (`backend/src/services/pricingEngine.js:418-425`), read from
  `app_settings` the same way `getSettings` already does. Gate the
  "Add Stop Location" button so tapping it past the limit shows a toast
  instead of adding another entry (no button removal — simplest UX for
  "you've hit the limit").
- In `orderParcelApi`'s payload (`pickupdrop.dart:5664-5693`), add a
  `stops` array built from `dropLocations.skip(1)` (index 0 is the main
  drop, already sent as `dlat`/`dlong`/`daddress` — only indices 1+ are
  the "extra" stops), each entry
  `{ lat, lng, address, hno, landmark, contact_name, contact_number }`.
  Only include the key when there's at least one extra stop (keeps the
  payload identical to today for orders with no stops).

## 10. Non-goals (v1)

- No mid-trip stop addition by the driver.
- No per-stop delivery confirmation/tracking in the driver app.
- No editing stops after the order is created.
- No map-based route preview showing all stops at once (the existing
  single pickup→drop map view is unchanged).
- No dedicated `extra_stop_charge` line item in the customer-facing fare
  breakdown beyond what already surfaces via `extra_mile_charge` (see
  §6's tradeoff).

## 11. Testing plan

- Backend unit tests: `createOrderCore` with 0, 1, and N stops — assert
  `getMultiStopDistanceKm` (mocked) is called with the right point
  sequence, `extra_mile_charge` includes the stops surcharge, and
  `pkg_order_stops.createMany` is called with the right rows in
  sequence order. A test asserting a `stops.length > max_extra_stops`
  request is rejected with `VALIDATION`.
- Backend unit test: requesting `createOrderCore` with `stops` present
  and a client-sent `distance` confirms the client value is ignored
  (server-computed multi-leg distance is used instead).
- `getMultiStopDistanceKm` unit tests with mocked `getRoadDistanceKm`
  legs, confirming summation.
- Manual smoke test: place one normal (no-stops) order end-to-end to
  confirm zero regression (same as every prior feature's regression
  check in this codebase), then one order with 2 stops, confirm the
  fare includes the stops charge, the driver sees the stop list, and the
  admin order detail view shows the stops.
