# Main Area title on pickup / drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a recognisable Main Area (locality) for every order's pickup and drop on the backend, store it as `pickup_title` / `drop_title`, and show it prominently in the driver's incoming-request popup, the admin panel and the executive workspace.

**Architecture:** A pure parsing util plus a never-throwing Google reverse-geocode resolver; one order-level helper called from every path that sets `paddress`/`daddress`; the two new columns flow through the existing dispatch payload builder, FCM and admin APIs; React and Android only render them (empty = hidden).

**Tech Stack:** Node/Express/Prisma/MySQL (jest), React admin (`frontend/`), native Android Java in `ShifterDriver/ShifterDriver` (data-binding, gitignored dir).

**Spec:** `docs/superpowers/specs/2026-11-14-driver-popup-main-area-design.md`

## Global Constraints

- Coordinates (`plat/plong/dlat/dlong`) are never rounded, replaced or changed by any title code; title functions return text only.
- Column / payload key names: `pickup_title`, `drop_title`. DB: `VARCHAR(120) NULL` on `pkg_order`. Payload value is `""` when unknown.
- Lookup ceiling 2000 ms, pickup and drop in parallel, never throws, never blocks a booking; no cache.
- Main Area comes only from component types in the code constant `MAIN_AREA_PRIORITY` (default order: `sublocality_level_1`, `neighborhood`, `sublocality_level_2`, `sublocality`; the generic `sublocality` entry matches only components with no `sublocality_level_*` type, since Google tags level components with `sublocality` too). City/district/state/PIN/Plus Code are never a Main Area. No locality → null.
- A failed recompute on a pickup/drop change sets that side's title to NULL (never keeps the old one).
- Stored/sent address strings are not rewritten.
- Migrations are hand-applied SQL (never `migrate deploy`); no DATABASE_URL is available to agents, so the migration is committed but NOT applied; the owner applies it to dev first.
- `ShifterDriver/` is gitignored: commit with `git add -f <exact files>` only.
- Customer app is not changed. Stops are out of scope.

## Review Focus

- Google returns a Plus Code as `results[0]` and the locality only in a later result → title comes from the later result.
- Google error / `ZERO_RESULTS` / `OVER_QUERY_LIMIT` / timeout / invalid JSON → title NULL and the booking still succeeds.
- Title text with control characters, very long or HTML-looking text → sanitised to ≤120 chars; React and Android render it as plain text.
- Old driver payload without `pickup_title`/`drop_title` (Android) and old order rows with NULL titles (React, payloads) → no crash, address shows as today.
- Pickup changed while lookup fails → old title cleared; the unchanged side keeps its title; coordinates stored exactly as sent.

---

## File Structure

- Create `backend/prisma/migrations/20261114020000_add_order_area_titles/migration.sql`; modify `backend/prisma/schema.prisma` (model `pkg_order`).
- Create `backend/src/utils/addressTitle.js` (+ `__tests__/addressTitle.test.js`): parsing + Google resolver.
- Create `backend/src/services/orderAreaTitles.js` (+ test): order-level helper.
- Modify the order creators/changers: `controllers/orderController.js` (~619-631), `services/customiseConvertService.js` (~94), `services/orderPickupService.js` (~164-173, ~278), `services/orderDestinationService.js` (~169-181, ~235), `services/earlyDropService.js` (~168-180).
- Modify payload/API surfaces: `services/dispatchManager.js` (`buildOrderRequestPayload` ~309, payload ~1634), `controllers/orderController.js` (~1123, ~2017), `controllers/adminOrderController.js` (~97), `controllers/fleetController.js` (~175), `controllers/orderQueueController.js` (~34), `services/guaranteeQueueService.js` (~591), `services/lowFareService.js` (~19).
- Create `frontend/src/components/orders/AreaTitle.jsx`; modify the admin pages listed in Task 5.
- Modify Android: `res/layout/dialog_new_order.xml`, `service/OrderOverlayService.java`, `utility/OrderDialogHelper.java`, `activity/BaseActivity.java`, `activity/HomeActivity.java`, `MyFirebaseMessagingService.java` (paths under `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/`).

---

### Task 1: Schema and migration

**Files:**
- Create: `backend/prisma/migrations/20261114020000_add_order_area_titles/migration.sql`
- Modify: `backend/prisma/schema.prisma` (model `pkg_order`, next to `paddress`/`daddress` ~259)

**Interfaces:**
- Produces: Prisma fields `pickup_title String? @db.VarChar(120)`, `drop_title String? @db.VarChar(120)` on `pkg_order`.

- [ ] **Step 1:** Confirm the real MySQL table name of `pkg_order` from existing migrations (`grep -rn "pkg_order" backend/prisma/migrations | head`) and write the migration as `ALTER TABLE <table> ADD COLUMN pickup_title VARCHAR(120) NULL, ADD COLUMN drop_title VARCHAR(120) NULL;` in the style of the newest hand-applied migrations in that folder.
- [ ] **Step 2:** Add the two fields to the model and run `npx prisma generate` in `backend/` (offline is fine; use a dummy `DATABASE_URL` if required).
- [ ] **Step 3:** Run `npx jest src/controllers/__tests__/orderController.test.js` — expected: same pass/fail as before the change (no regression).
- [ ] **Step 4: Commit** `feat(orders): pickup_title/drop_title columns (migration unapplied)`; note in the report that the migration is NOT applied anywhere.

### Task 2: Address parsing and Google resolver

**Files:**
- Create: `backend/src/utils/addressTitle.js`
- Test: `backend/src/utils/__tests__/addressTitle.test.js`

**Interfaces:**
- Produces (all exported):
  - `MAIN_AREA_PRIORITY: string[]`
  - `isPlusCode(text: string): boolean`
  - `sanitizeTitle(value: any): string | null` — trims, strips control characters, collapses whitespace, max 120 chars, `null` if empty or non-string
  - `parseGoogleAddressComponents(components: Array<{long_name, short_name, types}>): { mainArea: string, route: string, premise: string, city: string, district: string, state: string, pin: string, plusCode: string }` — all strings, `""` when absent
  - `pickMainAreaFromResults(results: Array<{address_components}>): string` — first result (in order) whose components yield a `mainArea`; `""` if none
  - `formatAddressForDisplay({ components?, rawAddress? }): { mainArea: string, formattedAddress: string }` — the spec's formatter; raw-only input strips a leading Plus Code from `formattedAddress` and returns `mainArea: ""`
  - `resolveLocationTitle(lat: number|string, lng: number|string, opts?: { fetchImpl?, apiKey?, timeoutMs? = 2000 }): Promise<string | null>` — reverse-geocodes `latlng` (language `en`), applies `pickMainAreaFromResults` then `sanitizeTitle`; returns `null` (never throws) on missing key, HTTP error, bad JSON, non-OK status, timeout, or no Main Area. It only reads `lat`/`lng` to build the request.

- [ ] **Step 1: Write failing tests** (fixtures are hand-written Google-shaped objects, no network): `parseGoogleAddressComponents` picks `sublocality_level_1` "Khajrana" over `sublocality_level_2` "Asharfi Colony"; `neighborhood` used when level_1 missing; city/state/pin extracted and never returned as `mainArea`; no locality type → `mainArea ""`; `isPlusCode("pwd40+")` and `"7JMH+4X Indore"` true, `"Khajrana"` false; `pickMainAreaFromResults` skips a Plus-Code-only `results[0]` and returns the locality from `results[1]`; `formatAddressForDisplay({rawAddress:"pwd40+, Asharfi Colony, Khajrana, Indore"})` returns `mainArea ""` and `formattedAddress` without the leading `pwd40+,`; `sanitizeTitle` handles 300-char, control-char, whitespace-only, non-string input; `resolveLocationTitle` with fake `fetchImpl` returns "Khajrana" for a good response and `null` for: no apiKey, rejected fetch, `{status:"ZERO_RESULTS"}`, `{status:"OVER_QUERY_LIMIT"}`, invalid JSON, a fetch that never resolves (use `timeoutMs: 20`), and asserts the request URL contains the exact `latlng=<lat>,<lng>` it was given.
- [ ] **Step 2:** Run `cd backend && npx jest src/utils/__tests__/addressTitle.test.js` — expected FAIL (module missing).
- [ ] **Step 3:** Implement the module (reuse the logger and `GOOGLE_MAPS_API_KEY` pattern from `utils/googleMapsLocation.js`; do not reuse its `reverseGeocodeLocation`).
- [ ] **Step 4:** Run the test file — expected all PASS.
- [ ] **Step 5 (live check, report only):** With the dev key from `backend/.env`, in a throwaway script outside the repo, forward-geocode "Khajrana, Indore", "Malviya Nagar, Indore", "Kakkad, Indore", "Vijay Nagar, Indore", "Bhawarkua, Indore", "Rajendra Nagar, Indore", "Sudama Nagar, Indore" to coordinates, then run `resolveLocationTitle` on each. Put the table (locality → returned title, or null) in the task report. If any of the seven returns null or a wrong area, adjust `MAIN_AREA_PRIORITY` only if a different order fixes it without breaking the others; otherwise leave it and list the failures in the report (do not add city/district types).
- [ ] **Step 6: Commit** `feat(orders): main-area parser and resolver`.

### Task 3: Order-level helper

**Files:**
- Create: `backend/src/services/orderAreaTitles.js`
- Test: `backend/src/services/__tests__/orderAreaTitles.test.js`

**Interfaces:**
- Consumes: `resolveLocationTitle`, `sanitizeTitle` from Task 2.
- Produces:
  - `resolveSideTitle(lat, lng, clientTitle?): Promise<string | null>` — a non-empty `sanitizeTitle(clientTitle)` wins without a lookup; otherwise `resolveLocationTitle(lat, lng)`; `null` if lat/lng are not finite numbers.
  - `resolveOrderTitles({ plat, plong, dlat, dlong, clientPickupTitle?, clientDropTitle? }): Promise<{ pickup_title: string|null, drop_title: string|null }>` — the two sides resolved in parallel.

- [ ] **Step 1: Failing tests** (mock `../utils/addressTitle`): parallel resolution (both called once); client title used without a lookup; non-finite coordinates → `null` without a lookup; resolver returning `null` → `null`; the inputs `plat/plong/dlat/dlong` objects/strings are not mutated and are not part of the return value.
- [ ] **Step 2:** Run `npx jest src/services/__tests__/orderAreaTitles.test.js` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat(orders): order-level area title helper`.

### Task 4: Wire into every creator and changer

**Files:**
- Modify: `backend/src/controllers/orderController.js` (create ~619-631), `backend/src/services/customiseConvertService.js` (~94), `backend/src/services/orderPickupService.js` (~164 `updateData`, ~278), `backend/src/services/orderDestinationService.js` (~169 `data`, ~235), `backend/src/services/earlyDropService.js` (~168 `data`)
- Test: existing test files beside each (`__tests__/`), extended

**Interfaces:**
- Consumes: `resolveOrderTitles`, `resolveSideTitle` from Task 3.
- Produces: every `pkg_order` row written by those paths carries `pickup_title`/`drop_title` consistent with its address; nothing else changes.

- [ ] **Step 1:** Enumerate every place that writes `paddress`/`daddress` on `pkg_order` (`grep -rn "pkg_order.create\|pkg_order.update" backend/src | grep -v __tests__` and the WhatsApp bot under `backend/src/whatsapp`); list any creator not named above in the task report and wire it the same way.
- [ ] **Step 2: Failing tests:** (a) create path: with `resolveOrderTitles` mocked, `prisma.pkg_order.create` is called with `data.pickup_title`/`data.drop_title` and with `plat/plong/dlat/dlong` exactly equal to the request strings; (b) create still succeeds with both titles `null` when the helper returns nulls; (c) pickup change: `updateData.pickup_title` set to the new title, `drop_title` not in the data; lookup failure → `pickup_title: null`; (d) destination change and early drop: same for `drop_title`; (e) coordinates in each `update` data equal the inputs unchanged.
- [ ] **Step 3:** Run those test files — FAIL.
- [ ] **Step 4:** Implement: in the create path the helper is awaited before `prisma.pkg_order.create` and accepts optional request fields `pickup_title`/`drop_title` as client titles; in change paths call `resolveSideTitle(newLat, newLng)` before building the update data (outside any open DB transaction where the code already has a transaction open, to avoid holding it during the network call).
- [ ] **Step 5:** Run the extended test files plus `npx jest src/controllers/__tests__/orderController.test.js src/services` — expected: no new failures.
- [ ] **Step 6: Commit** `feat(orders): fill pickup/drop titles on create and on address change`.

### Task 5: Payloads, admin APIs and admin screens

**Files:**
- Modify (backend): `services/dispatchManager.js` (`buildOrderRequestPayload` ~326-329 and the payload ~1637), `controllers/orderController.js` (~1123, ~2017), `controllers/adminOrderController.js` (~97), `controllers/fleetController.js` (~175), `controllers/orderQueueController.js` (~34), `services/guaranteeQueueService.js` (~591), `services/lowFareService.js` (~19)
- Create: `frontend/src/components/orders/AreaTitle.jsx`
- Modify (frontend): `pages/Orders.jsx` (~167), `pages/ScheduledOrders.jsx` (~80), `pages/NextDayOrders.jsx` (~120), `pages/ExecutiveWorkspace.jsx` (~125, ~132), `components/orders/OrderDetailDrawer.jsx` (~460, ~483), `components/tracking/MissionHUD.jsx` (~175, ~180), `components/tracking/ActiveTripsCarousel.jsx` (~44), `components/dashboard/RecentOrdersTicker.jsx` (~73), `components/settlements/SettlementDetailDrawer.jsx` (~275, ~279)
- Test: `backend/src/services/__tests__/` (dispatch payload test file that already covers `buildOrderRequestPayload`; extend)

**Interfaces:**
- Consumes: Prisma fields from Task 1.
- Produces: payload keys `pickup_title`, `drop_title` (string, `""` when unknown) beside `pickup_address`/`delivery_address` in the dispatch payload (socket + FCM both use it; confirm `pushNotifier` forwards it unchanged); the same two fields on the admin/fleet/queue/guarantee/low-fare responses that already return `paddress`/`daddress`; `AreaTitle({ title }): JSX | null` renders a bold small line, nothing when empty.

- [ ] **Step 1: Failing test:** `buildOrderRequestPayload` returns `pickup_title`/`drop_title` equal to the order's columns, and `""` when the columns are null/undefined; `pickup_address`/`delivery_address` and all coordinate keys unchanged.
- [ ] **Step 2:** Run the dispatch payload test — FAIL.
- [ ] **Step 3:** Add the keys to the payload builders and the listed API serializers/`select` lists (only queries that already select `paddress`/`daddress`; leave customer-facing track snapshot untouched). Confirm in the report that the FCM data path carries the keys (FCM data values must be strings).
- [ ] **Step 4:** Create `AreaTitle.jsx` and place it above the address in each listed admin location, hidden when the title is empty (for table cells keep the title in the existing cell, on its own line above the truncated address).
- [ ] **Step 5:** Run the dispatch test (PASS) and `cd frontend && npm run build` (succeeds).
- [ ] **Step 6: Commit** `feat(orders): send and show pickup/drop area titles` (backend and frontend as separate commits if cleaner).

### Task 6: Driver app popup

**Files:**
- Modify: `res/layout/dialog_new_order.xml` (pickup block ~142-155, drop address ~285), `java/com/shifter/driver/service/OrderOverlayService.java` (~297-380), `java/com/shifter/driver/utility/OrderDialogHelper.java` (~113-168), `java/com/shifter/driver/activity/BaseActivity.java` (~233), `java/com/shifter/driver/activity/HomeActivity.java` (~245), `java/com/shifter/driver/MyFirebaseMessagingService.java` (~159)

**Interfaces:**
- Consumes: payload keys `pickup_title`, `drop_title` (Task 5).
- Produces: in the new-order layout, two TextViews `txt_pickup_area` and `txt_drop_area` (bold, larger than the address, `visibility="gone"` by default) above `txt_pickup_address` / `txt_drop_address`; the title is shown and made visible only when the value is non-empty.

- [ ] **Step 1:** Trace how the payload reaches the popup (socket via `BaseActivity`, FCM via `MyFirebaseMessagingService` → intent extras → `OrderOverlayService`, and `OrderDialogHelper`'s `getMapValue(orderData, ...)`), and forward the two new keys along every hop with `""` as the default so an old payload (keys absent) changes nothing.
- [ ] **Step 2:** Edit the layout and both binders (overlay and dialog share `dialog_new_order.xml`); keep the existing design and do not enlarge the popup noticeably (title one line, `ellipsize="end"`; the address may stay multi-line as it is today); confirm on a small-screen width in the layout preview.
- [ ] **Step 3:** Build: from `ShifterDriver/ShifterDriver` run `./gradlew assembleDebug` (or the project's existing build command); expected BUILD SUCCESSFUL.
- [ ] **Step 4:** Manual check (record in the report): popup with title and address; with empty title (no extra row, address as before); with a payload lacking the keys entirely; with a long title; for pickup and drop independently.
- [ ] **Step 5: Commit** with `git add -f` on exactly the changed files: `feat(driver): show pickup/drop main area in incoming request popup`.

---

## Self-review

- **Spec coverage:** parsing util + Plus Code + raw fallback (T2); columns (T1); create/change paths and failure-clears (T4); dispatch socket + FCM payload (T5); admin pages and executive workspace (T5); driver popup (T6); coordinates untouched (T4 tests, Global Constraints); backward compatibility (T5 `""`, T6 old payload); live locality check (T2 step 5). Non-goals respected.
- **Types:** helpers return `string | null`; payload converts to `""`; names `pickup_title`/`drop_title` identical in all tasks.
- **Open risk to report, not decide:** default `MAIN_AREA_PRIORITY` is unverified until T2 step 5.
