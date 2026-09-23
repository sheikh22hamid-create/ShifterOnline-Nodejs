# Driver Tier Cards & Admin-Driven Info Popup — Design

Date: 2026-09-23

## Purpose

Three changes to the driver app's delivery-tier UI, plus the backend and
admin support they need:

1. Make the per-tier info button prominent — a labelled "ⓘ Details" chip
   instead of a bare icon drivers routinely miss.
2. Stop showing per-km rate and minimum fare on the tier cards.
3. Make the tier info popup's content admin-editable instead of hardcoded
   in the app: the admin defines the sections (heading + body), how many
   there are, and their order.

Today every word of that popup — and each card's one-line description — is
a Java string literal selected by an if/else chain matching on the tier's
title, so changing copy requires an app release.

## Current state

### Driver app (`ShifterDriver/ShifterDriver/app/src/main/`)

There is no Activity/Fragment/RecyclerView for this list: cards are
inflated manually into a `LinearLayout`.

- `java/com/shifter/driver/utility/DeliveryPreferencesBottomSheet.java`
  - `show(...)` (~L42) inflates `bottom_sheet_delivery_preferences`, loops
    the package list and inflates one `item_delivery_type_card` per tier.
  - `bindTierCard(...)` (~L89) is `public static` and **shared**: the home
    screen calls it too (`HomeFragment.updateDeliveryTypesUI()` ~L966-1015).
  - Rate binding ~L136-148: `"₹" + perKm + " / km"` and `"Min ₹" + minCharge`
    (hardcoded literals, no strings.xml).
  - Card icon + one-line subtitle come from an if/else chain on the title
    (~L104-133); the else branch is "Regular deliveries, steady earnings".
  - Info click ~L151-153 → `ModelInfoBottomSheet.show(context, packageData)`.
- `res/layout/item_delivery_type_card.xml` — `txt_model_title` (~L52),
  `btn_model_info` FrameLayout (~L62-78), `txt_model_subtitle` (~L83),
  `txt_model_rate` (~L102), `txt_model_base_fare` (~L111),
  `switch_model_status` (~L122).
- `java/com/shifter/driver/utility/ModelInfoBottomSheet.java` (108 lines,
  read in full) — inflates `bottom_sheet_model_info` (L23), binds six fixed
  body TextViews (L30-35), sets the title from `packageData.getTitle()`
  (L39-40), then a five-branch if/else chain on `title.toLowerCase()`
  (L44-100) sets the tier icon, icon tint/background, the subtitle and all
  six bodies as literals.
- `res/layout/bottom_sheet_model_info.xml` (~415 lines) — header
  (`icon_container`, `img_tier_icon`, `txt_tier_title`, `txt_tier_subtitle`,
  `btn_close_sheet`) then six fixed section cards, each with a **hardcoded
  heading in XML** and a bindable body: "What is it?", "Earnings", "Typical
  Distance", "Suitable For", "Example", "How it works"; `btn_got_it` at the
  end.
- `java/com/shifter/driver/utility/TierTheme.java` (tracked; read in full) —
  already centralizes tier identity: `resolve(packageId, modelName,
  packageTitle)` (L136-154) returns a `TierTheme` carrying `tierName`,
  `headerIconRes`, colours, etc. for STANDARD / SILVER / PRIME / GOLD_BEAST /
  EARNING_BEAST. This is the existing home for tier icon/colour mapping and
  should replace the two ad-hoc chains above.
- `java/com/shifter/driver/model/PackageData.java` — `getTitle()` prefers
  `driver_title`; `getPerKmCharge()`, `getMinCharge()`.
- `java/com/shifter/driver/retrofit/NodeService.java` (~L72-73) —
  `@POST("api/rider/package-list")`.

### Backend

- `backend/src/routes/riderRoutes.js:38` → `riderController.packageListForDriver`.
- `backend/src/controllers/riderController.js` `packageListForDriver`
  (~L129-186): resolves the rider's vehicle → `pkg_category` → `tbl_package`
  rows (`status=1`, ordered by `sort_order`), joins `tbl_rider_delivery_type`
  for the enabled flags, and maps a response of `id`, `title`, `driver_title`,
  `user_title`, `driver_detail_image`, `user_detail_image`, `per_km_charge`,
  `min_charge`, `rate`, `km`, `driver_active`, `status` inside a
  `{ PackageData, ResponseCode, Result, ResponseMsg }` envelope.
  - **Latent bug to fix while here:** `user_title` is referenced in the
    response map (~L165) but is *not* in the Prisma `select` (~L145-153), so
    it is always `undefined` and silently falls back to `title`.
- `backend/src/controllers/rateCardController.js` — `serializePackage`
  (~L38-64) spreads `...pkg`, so newly added columns are returned
  automatically; `create` (~L137-188) builds an explicit data object and
  `update` (~L217-244) uses a `directFields` whitelist — **both must be
  extended for any new column**.
- `backend/prisma/schema.prisma` `tbl_package` (~L590-630) — no existing
  description/info/long-text column to reuse.

### Admin panel

- `frontend/src/components/ratecards/RateCardFormModal.jsx` — blank form
  state (~L11-26), load-for-edit mapping (~L306-316), `driver_title` input
  (~L508-512), submit posts the whole `form` object (~L378-385).
- `frontend/src/components/ratecards/SlabPricingModal.jsx` and
  `GenerateModelsModal.jsx` can create/bulk-edit tiers.

### Repository note

`.gitignore:8` ignores `ShifterDriver/`, but 55 app files were force-added
at some point and are tracked (including `HomeFragment.java` and
`TierTheme.java`). The files this work edits are **not** tracked.

## Scope decisions (confirmed)

- **Popup content model: fully dynamic sections.** The admin defines each
  section's heading and body, how many sections exist, and their order. The
  six fixed headings are removed from the layout.
- **No icons on sections.** Sections render as heading + body only. (The
  popup *header's* tier icon stays, sourced from `TierTheme`.)
- **No seeding of existing copy.** The current hardcoded texts are not
  migrated into the database; tiers start empty and the admin fills them in.
  See Risks.
- **Card subtitle is admin-driven too**, not just the popup — it is the same
  hardcoded chain and the same field class.
- **Rates are removed from both places** the tier card renders (home screen
  list and the Delivery Preferences bottom sheet). They share one binder, so
  this is a single change.
- **Info button becomes a labelled chip** ("ⓘ Details") with a tinted
  background, occupying space freed by removing the rate line.
- **Driver app changes stay local-only** — not committed to git, matching
  the user's instruction. Backend and admin-panel changes are committed
  normally.
- Storage is **per `tbl_package` row**, so content is scoped per
  city/category exactly like the rate card it belongs to.

## Design

### 1. Data model

Three nullable, additive columns on `tbl_package` (no existing data is
touched, no backfill):

| Column | Type | Holds |
|---|---|---|
| `driver_card_subtitle` | `VarChar(255)?` | The one-line description on the tier card |
| `driver_info_subtitle` | `VarChar(255)?` | The line under the title in the popup header |
| `driver_info_sections` | `Text?` | JSON array of `{ "heading": string, "body": string }`, in display order |

Array order *is* display order — no separate sort column, since sections are
always read and written as one whole list for one tier.

Rejected alternatives:
- **Child table `tbl_package_info_section`** — relational ordering and
  per-row validation, but sections are never queried independently, so the
  FK plus nested create/update/delete sync logic buys nothing here.
- **A blob in `app_settings`** (the `driver_max_due_limit` precedent) — no
  migration needed, but it divorces the content from the tier row it
  describes. `tbl_package` is per-city and `GenerateModelsModal` creates new
  tier rows, so keyed-by-name global config would break on both.

### 2. Backend

**Migration.** Add the three columns to `tbl_package` in `schema.prisma`
plus the corresponding Prisma migration. All nullable; existing rows become
`NULL`.

**Write path — `rateCardController`:**
- Add the three fields to `create`'s data object and to `update`'s
  `directFields` whitelist.
- Validate `driver_info_sections` at the boundary (admin input is untrusted
  input): accept either a JSON string or an already-parsed array; require an
  array whose every element is an object with string `heading` and `body`;
  trim them; drop entries where both are empty; reject with a 400 if the
  shape is wrong. Cap at **12 sections**, `heading` at **120 chars**, `body`
  at **2000 chars**. Persist the normalized value as a JSON string, or
  `null` when the resulting array is empty.
- `serializePackage` picks up the two subtitle columns automatically via its
  `...pkg` spread, but it must explicitly override `driver_info_sections` to
  the **parsed array** (empty array when null or unparseable) so the admin UI
  never receives a raw JSON string.

**Read path — `riderController.packageListForDriver`:**
- Add `driver_card_subtitle`, `driver_info_subtitle`, `driver_info_sections`
  to the Prisma `select`, and `user_title` alongside them to fix the latent
  bug noted above.
- In the response map, emit `driver_card_subtitle` and
  `driver_info_subtitle` as strings (empty string when null) and
  `driver_info_sections` as a **parsed array** (empty array when null or
  unparseable — a malformed row must not break the whole tier list).

### 3. Admin panel

In `RateCardFormModal.jsx`, a new "Driver info" block immediately after the
`driver_title` input:

- **Card subtitle** — single-line input, mapped to `driver_card_subtitle`,
  with a hint that it is the line shown under the tier name on the card.
- **Popup subtitle** — single-line input, mapped to `driver_info_subtitle`.
- **Info sections** — a repeatable list. Each row: `heading` input, `body`
  textarea, and remove / move-up / move-down controls, plus an
  "Add section" button. Empty list is valid and means "no popup for this
  tier".

Form state holds sections as an array throughout: the API returns them
already parsed, and they are posted back as an array (the server accepts an
array directly — the JSON-string form it also tolerates exists only for
robustness against other callers). Since submit posts the whole `form`
object, the new fields flow through once the server-side whitelist accepts
them.

`SlabPricingModal` and `GenerateModelsModal` need no change: tiers they
create simply start with empty info content, which is the agreed behaviour.

### 4. Driver app (local-only)

**`PackageData.java`** — add `driver_card_subtitle`, `driver_info_subtitle`
and a `List<InfoSection>` for `driver_info_sections`, with a small
`InfoSection` model (`heading`, `body`) and null-safe getters
(`getInfoSections()` returns an empty list rather than null).

**`item_delivery_type_card.xml`** — delete `txt_model_rate` and
`txt_model_base_fare`. Replace the bare `btn_model_info` icon with a chip:
tinted rounded background, info icon plus a "Details" label, sized for a
comfortable tap target, positioned in the space the rate line occupied.

**`DeliveryPreferencesBottomSheet.bindTierCard`** — remove the rate/min-fare
binding entirely. Take the card subtitle from `driver_card_subtitle`, hiding
the TextView when it is empty. Replace the local icon/colour if/else chain
with `TierTheme.resolve(...)`. Hide the Details chip when the tier has
neither a popup subtitle nor any sections, so the chip never opens an empty
sheet.

**`bottom_sheet_model_info.xml`** — replace the six fixed section cards with
a single vertical `LinearLayout` container. Keep the header (icon, title,
subtitle, close) and the "Got it" button.

**`item_model_info_section.xml`** (new) — one section: heading TextView +
body TextView, styled to match the current cards minus the icon.

**`ModelInfoBottomSheet.java`** — delete the five-branch chain. Set the
title from `getTitle()` and the subtitle from `driver_info_subtitle`
(hiding it when empty); resolve the header icon and colours through
`TierTheme.resolve(...)`; loop the sections list, inflating
`item_model_info_section` into the container for each. Skip sections whose
heading and body are both empty.

## Out of scope

- The customer app and any customer-facing tier copy (`user_title`,
  `user_detail_image`) — this is driver-facing content only.
- Seeding or migrating the existing hardcoded copy into the database.
- Per-section icons or colours.
- Rich text / markdown in section bodies — plain text with newlines only.
- Localisation of admin-entered content.
- Any change to how tiers themselves are created, priced, or dispatched.

## Risks and consequences

1. **Day-one content regression.** Because nothing is seeded, every tier's
   card subtitle disappears and every Details chip is hidden until an admin
   fills the content in. This is the agreed behaviour, but it is visible to
   drivers immediately on release, so the admin content should be entered
   before the app build ships.
2. **Per-city duplication.** `tbl_package` rows are scoped per city and
   category, so the same tier present in several cities needs its content
   entered once per row.
3. **App changes are untracked.** They live only on the local disk and are
   not committed, so they are not backed up by git and will not reach any
   other machine. This is the user's explicit instruction.
4. **Malformed stored JSON.** A row edited outside the admin panel could
   hold invalid JSON; both the API read path and the app parse defensively
   and fall back to "no sections" rather than failing the tier list.

## Testing

Backend (jest, existing conventions — `jest.mock("../../config/db", ...)`):
- `rateCardController.create` / `update` persist the three new fields;
  sections accepted both as a JSON string and as an array; normalized and
  trimmed; empty list stored as `null`.
- Validation rejects a non-array, an array of non-objects, and entries with
  non-string `heading`/`body`; enforces the section-count and length caps.
- `serializePackage` returns sections parsed as an array.
- `packageListForDriver` returns the three fields, with sections parsed,
  an empty array for `NULL`, and an empty array (not a thrown error) for
  malformed JSON; and now returns a real `user_title`.

Admin panel: no test harness exists in `frontend/` (no test script, no test
files), so verification is `npx vite build` plus manual check of add /
remove / reorder / save / reload round-tripping.

Driver app: no test harness; verification is a Gradle build plus a manual
pass over a tier with content, a tier without content (chip hidden), and a
tier whose sections are malformed.
