# Admin-Configurable Vehicle Detail Specs — Design Spec

Date: 2026-09-17
Status: Approved by user, pending implementation plan

## 1. Goal

Replace the hardcoded per-category vehicle specs (`getVehicleSpecs()` in
`backend/src/controllers/orderAvailabilityController.js`, a static
string-matching lookup table for `max_weight_kg`/`max_dimensions`) with
admin-configurable fields, and add a "Details" screen in the customer
app (ShifterOnline) that a vehicle card on the Select Vehicle screen
links to — showing dimensions, max load, a vehicle image, and a fixed
list of policy notes, matching four reference infographics the user
supplied (4 Wheeler, 2 Wheeler/Bike, E-loader/3-wheeler designs).

## 2. Scope decisions (from brainstorming)

- **Per-category, not per-package.** Bike's "Super Saver"/"Saver Plus"
  tiers share one set of specs — the vehicle doesn't change between
  delivery-option tiers, only the price does. Specs live on
  `pkg_category`, matching how the Select Vehicle screen already groups
  package tiers under one vehicle card per category.
- **Policy notes and the three badges (Safe & Secure / Fast Delivery /
  Affordable) are global, not per-category.** All four reference
  images show identical text for points 1-4 ("Fare doesn't include
  labour charges…", "amount shown is an estimate…", "Parking charges…",
  "toll and permit charges…") — this is boilerplate policy text, not
  vehicle data. One admin-edited list applies to every category's
  detail screen. The three badges are cosmetic (icon + fixed label, no
  real data behind them) and stay hardcoded in the Flutter screen —
  not admin-editable.
- **Images are a path/URL text field, not a file upload.** Confirmed:
  every existing image field in the admin panel (`CategoryFormModal`,
  banners, vehicles) is a plain text input pointing at an
  already-hosted path (e.g. `images/category/bike.png`) — there is no
  upload-to-server capability anywhere in this codebase. The new
  `detail_image` field follows the same convention. Building real file
  upload is out of scope (no precedent, materially larger effort).
- **Point 5 in the reference images ("Loading capacity: Max Load: X ")
  is not separately stored** — it's a restatement of `max_load_kg`/
  dimensions already shown above it on the same screen. The Flutter
  screen renders it as a 5th note built from those fields.

## 3. Database schema (`pkg_category`)

Four new nullable columns, additive only (existing rows unaffected,
existing `cat_img`/`other_image` untouched — `cat_img` stays the small
icon used on the category selector chips, `detail_image` is the new
larger photo for the detail screen):

```prisma
model pkg_category {
  ...
  max_load_kg   Decimal? @db.Decimal(10, 2)
  dim_length    Decimal? @db.Decimal(10, 2)
  dim_width     Decimal? @db.Decimal(10, 2)
  dim_height    Decimal? @db.Decimal(10, 2)
  dim_unit      String?  @db.VarChar(4)   // "ft" or "cm", admin's choice per category
  detail_image  String?  @db.Text
}
```

Raw SQL migration file (matching the `backend/sql/` convention already
in use — see `20260916_driver_min_ride_guarantee.sql` for the exact
pattern to follow) adds these via `ALTER TABLE pkg_category ADD COLUMN
...`. All nullable with no default required — a category with no specs
set simply omits that section on the detail screen (no fake zeros).

### Global settings (`setting` table, singleton row)

```prisma
model setting {
  ...
  vehicle_detail_notes String? @db.LongText   // JSON array of strings
}
```

Stored as a JSON-encoded string array (`["Fare doesn't include labour
charges for loading & unloading.", "..."]`), parsed/serialized in the
controller — same pattern the codebase already uses for other
JSON-in-Text settings columns (confirm exact existing convention during
implementation; reuse it rather than inventing a new one).

## 4. Backend

- **`masterDataController.js`** (`createCategory`/`updateCategory`):
  add the five new fields to both, following the existing
  destructure-and-conditionally-assign pattern already there for
  `other_image` — no new validation beyond what numeric/nullable
  Prisma fields already enforce.
- **`orderAvailabilityController.js`**: delete `getVehicleSpecs()`
  entirely. `availableVehicles` already loads each package's
  `pkg_category` row (`categoryById`) — read `max_load_kg`/dimensions
  directly off that instead. This is the same object the "Up to X kg"
  text on the Select Vehicle screen already reads
  (`max_weight_kg`/`max_dimensions` in the response) — one source of
  truth for both the card and the new detail screen, closing the gap
  identified in the prior investigation (static lookup table, not
  admin-configurable).
- **Settings controller**: add `vehicle_detail_notes` to whatever
  existing settings read/write endpoint the admin panel already uses
  for singleton settings (reuse, don't add a new endpoint, unless the
  existing settings shape can't hold an array cleanly — confirm during
  implementation).
- **New/extended customer-facing read**: the category detail data
  (dimensions, max load, detail_image, plus the global notes list)
  needs to reach the Flutter detail screen. Likely the cleanest path is
  extending the existing `availableVehicles` response's `categories`
  array with the new fields (already fetches `pkg_category` rows) plus
  a `vehicle_detail_notes` array at the top level — avoids a second
  round-trip since Select Vehicle already calls this endpoint and holds
  the category data in memory when the user taps "Details".

## 5. Admin panel (React, `frontend/`)

- **`CategoryFormModal.jsx`**: add fields for `max_load_kg`,
  `dim_length`, `dim_width`, `dim_height`, `dim_unit` (a 2-option
  select: ft/cm), `detail_image` (text input, same style as the
  existing `cat_img` input — label it "Detail photo path" to
  distinguish from the "Icon path" field it sits next to). All
  optional — no required-field validation added, consistent with them
  being nullable.
- **Settings page**: a new "Vehicle Detail Notes" section — four (or
  however many exist) editable text lines with add/remove, matching
  whatever list-editing pattern the settings page already uses
  elsewhere (check for an existing repeatable-list field before
  inventing a new UI pattern).

## 6. Customer app (ShifterOnline / Flutter)

- **`select_vehicle.dart`**: add a "Details" affordance on each vehicle
  card (icon button or text link — exact placement decided during
  implementation to fit the existing card layout without crowding the
  Select button). Tapping it navigates to a new screen, passing the
  already-fetched category data (no extra API call needed per §4).
- **New file `vehicle_details_screen.dart`**: renders the reference
  layout —
  - Title (category name) + skyline banner (static asset, same for
    every category, matching the reference images' background)
  - Dimensions row (`dim_length` × `dim_width` × `dim_height` +
    `dim_unit`) — omitted entirely if any of the three is null
  - Max load badge (`max_load_kg`) — omitted if null
  - `detail_image` — falls back to the category's existing `cat_img`
    if `detail_image` is unset, so a category configured before this
    feature ships still shows something
  - Three hardcoded badges: Safe & Secure / Fast Delivery / Affordable
  - Numbered notes list: the global `vehicle_detail_notes` array, plus
    one final generated note repeating max load/dimensions (per §2)
  - Footer bar repeating Length/Width/Height (matches reference images'
    bottom strip) — omitted if dimensions are null

## 7. Non-goals

- No file upload capability (see §2).
- No per-package (only per-category) specs.
- No admin control over the three badge icons/labels or their order.
- No change to the existing `cat_img`/`other_image` fields or what
  currently reads them.
- No change to how `max_load_kg` factors into pricing or dispatch — it
  is purely informational display, exactly like the lookup table it
  replaces.

## 8. Testing

- Backend: unit tests for `masterDataController` create/update
  covering the five new fields (present, absent, null), and for
  `availableVehicles`/settings read confirming the new fields surface
  correctly and a category with unset specs doesn't crash or fabricate
  zeros.
- Admin panel: manual smoke test (create/edit a category with the new
  fields, confirm persistence) — this codebase's React admin has no
  existing test suite to extend, consistent with prior work here.
- Flutter: `dart analyze` on the two touched/new files; manual smoke
  test of the Details flow from Select Vehicle, including a category
  with no specs set (confirm graceful omission, not a crash or blank
  screen).
