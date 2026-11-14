# Main Area (locality) title on pickup / drop — design

Date: 2026-11-14. Branch: `feature/main-area-title`.

## Intent and why

Google's address for a selected location often starts with a Plus Code or a colony, e.g. `pwd40+, Asharfi Colony, Khajrana, Indore, Madhya Pradesh`. The driver's incoming-ride popup truncates it, so the driver never sees the area they recognise (Khajrana). The owner wants the recognisable **Main Area** shown prominently, above the full address, for both pickup and drop. The same Main Area should show on the admin panel wherever an order's addresses show, and on the executive panel when a new order is assigned to an executive.

Success: a driver glancing at the popup can tell "Khajrana → Malviya Nagar" without reading the address.

## Goals

- Compute Main Area for pickup and drop from the actual selected location, never hardcoded.
- Store it on the order as `pickup_title` and `drop_title` (names from the owner's spec).
- Send both to the driver (socket + FCM), and show them in the driver popup, admin panel and executive panel.
- Old orders, old apps and failed lookups keep working: empty title means "show the address as today".

## Non-goals

- Multi-stop stops (spec covers only pickup and drop).
- Changing the Customer app (the backend does the work; no customer release needed).
- Rewriting or reformatting the stored/sent address strings. They stay exactly as today; the title is an extra line.
- Backfilling old orders.
- Guessing a locality from a raw address string when Google gives no structured data (see Parsing).

## Anti-goals

- A wrong locality is worse than none: if unsure, leave the title empty.
- Never block, delay noticeably, or fail a booking because of this feature.
- **Never touch coordinates.** `plat/plong/dlat/dlong` are not read for modification, rounded, replaced by geocoded values, or altered in the payload. The title code receives them read-only and returns only text.

## Constraints

- Backend already has `GOOGLE_MAPS_API_KEY` and `utils/googleMapsLocation.js` (`reverseGeocodeLocation` returns only `results[0].formatted_address` and falls back to a fake address string, so it is NOT reused for this; a new util is written).
- Migrations are hand-applied SQL (never `migrate deploy`); dev DB `shifteronlinedev` shares a VPS with prod. Migration must be applied before the backend that selects the new columns (P2022 otherwise).
- Driver app is native Android (Java, data-binding), in the gitignored `ShifterDriver/` dir: `git add -f` exact files only. Popup is `res/layout/dialog_new_order.xml`, driven by `OrderOverlayService` and `OrderDialogHelper`; fields arrive via `BaseActivity` (socket) and `MyFirebaseMessagingService` (FCM).
- Old driver apps ignore unknown payload keys, so the backend can ship first.

## Approaches considered

1. **Compute when the order is created, before saving (chosen).** Pickup and drop geocoded in parallel with a ~2 s timeout; titles saved on the order. Driver gets the title at first dispatch; admin and executive read the same stored value; one Google call per location. Cost: small added booking latency; on timeout/failure the title is empty and the booking proceeds. Recomputed when pickup or drop is changed later.
2. Save the order first, compute in the background. Rejected: dispatch to drivers can go out before the title exists, which is the whole point.
3. Compute whenever something displays it (with a cache). Rejected: every admin list row and driver popup would trigger geocoding; slow and costly.

Also rejected: Customer-app-computed titles (owner picked backend). The backend will still accept optional `pickup_title` / `drop_title` in the create request and use them if present (sanitised: trimmed, max 120 chars, control characters stripped), so a later app change needs no backend work. This is cheap but unused on day one.

## Decisions

**Parsing util** (new `backend/src/utils/addressTitle.js`, pure functions + one async resolver):

- `parseGoogleAddressComponents(components)` → `{ mainArea, route, premise, city, district, state, pin, plusCode }`.
- Main Area = first present of a configurable priority list over component types. Default: `sublocality_level_1`, `neighborhood`, `sublocality_level_2`, `sublocality`. Google tags every `sublocality_level_N` component with the generic `sublocality` type too, so the generic `sublocality` entry matches only a component that has no `sublocality_level_*` type (otherwise it would pick the finest-listed colony ahead of the broader level). City/district/state are never the Main Area when a finer value exists; if none of the four types exists the title is empty (a city name is not a recognisable locality). The default priority is my call and **must be verified against live Google results for the owner's example localities (Khajrana, Malviya Nagar, Kakkad, Vijay Nagar, Bhawarkua, Rajendra Nagar, Sudama Nagar) before the plan is finalised**; Indian results vary between `neighborhood` and `sublocality_level_*`.
- The resolver reverse-geocodes `latlng` and scans **all** returned `results` in order, taking the first that yields a Main Area (the first result is often a Plus Code or a street). Uses `result_type` / language `en` as needed.
- Plus Codes (`pwd40+` style, global/compound codes) are detected and never become a Main Area.
- Raw-string fallback (no structured data): strip a leading Plus Code from the display, leave Main Area empty. No comma-position guessing, no hardcoded locality table.
- `formatAddressForDisplay(...)` from the spec: implemented in the util for tests and future use; the live flow does not rewrite stored/sent addresses.

**Order creation / change:** one shared helper `resolveOrderTitles({plat, plong, dlat, dlong, clientPickupTitle, clientDropTitle})` called from the order creation path(s) and from the pickup/drop change paths. Which creators exist (app create, legacy create, WhatsApp bot, custom-order convert, low-fare, guarantee) is for the builder to enumerate; every path that sets `paddress`/`daddress` must populate or clear the titles. A changed pickup/drop recomputes its title; an unchanged side keeps its title.

**Schema:** `tbl_order` gets `pickup_title VARCHAR(120) NULL`, `drop_title VARCHAR(120) NULL` (hand-applied migration + Prisma fields). NULL means "unknown".

**Payloads:** add `pickup_title` and `drop_title` (empty string when unknown) next to `pickup_address`/`delivery_address` in the dispatch socket payload (`dispatchManager.js`), FCM data (`pushNotifier.js`), the executive/admin sockets and the admin order APIs that already return addresses. Customer-facing and driver-history APIs: only if they already return both addresses and it is trivial; otherwise out.

**Driver app:** in the incoming-request popup and overlay, each of PICKUP and DROP shows: label, title (bold, larger), address (smaller, multi-line). Empty title: show the address as today (no empty bold row). The layout must not grow the popup noticeably and must work on small screens. Applies to every incoming request regardless of booking type. Other screens (scheduled trips list, next-day list) are out unless the builder finds the popup shares code with them.

**Admin and executive panel (React):** wherever an order's pickup/drop address is shown (`Orders`, `OrderDetailDrawer`, `ScheduledOrders`, `NextDayOrders`, `ExecutiveWorkspace`, `MissionHUD`, `ActiveTripsCarousel`, `RecentOrdersTicker`, `DailyDrivers`, global search), show the title as a bold line above the address, hidden when empty. The executive panel shows it on the newly assigned order via the same stored field.

## Testing

- Unit tests with fixture Google responses: neighborhood+sublocality; sublocality_level_1/2 only; Plus Code as first result with locality in a later result; no locality component; garbage/empty/timeout/HTTP error; each priority-list position.
- Coordinates: a test asserts the order created with given `plat/plong/dlat/dlong` stores exactly those values and the title helper never changes them.
- Order creation: succeeds with empty titles when Google is down or times out; changing pickup recomputes only pickup.
- Payload tests: dispatch and FCM payload contain both keys; absent title is `""`.
- Android: build the app; manual check of the popup with long, short and empty titles. Old payload without the keys must not crash.
- Live check (builder, with the dev key): reverse-geocode real Indore coordinates for the example localities and record what the util returns.

## Rollout

1. Apply the migration to dev, then deploy the backend (titles start filling, old apps unaffected).
2. Admin frontend can ship with the backend.
3. Driver app release shows the new popup; drivers on the old app see no change.
4. Prod: same order; the migration is the owner's to run.

## Calls I made (after the builder check; owner may overrule)

- **Executive panel:** no new notification feature. Wherever the executive workspace already shows an assigned order's addresses (`ExecutiveWorkspace.jsx`, fed by the existing admin/executive socket and APIs), show the title the same way. The builder finds the existing event and adds the two fields to its payload.
- **Failed recompute clears the title.** When pickup or drop is changed and the lookup fails or times out, the side's title is set to empty, never left at the old (now wrong) value. All paths that change `paddress`/`daddress` (customer pickup/drop update, add stop if it moves the drop, admin edit, driver-cancel re-live) are covered.
- **Timeout:** one 2 s ceiling for every creation path, pickup and drop in parallel; no cache (each order geocodes its own two points once). Bulk or scheduled creators use the same helper.
- **No locality type found → empty title** (a city name is not a recognisable locality). The priority list is a code constant, not an env var or app setting. The live-result check will show how often Indore results come back without one of the four types; if it is frequent, the builder reports it to the owner before adding other types.
- **Live check is possible:** the dev `backend/.env` has `GOOGLE_MAPS_API_KEY`. The builder forward-geocodes the seven locality names (+ "Indore") to get coordinates, then reverse-geocodes them.
- **"Trivial" serializer bound:** touch only serializers and queries that already select `paddress`/`daddress`. A query with an explicit `select` gets the new columns added; the migration still has to be applied first.
- **Tests:** backend jest (already used); frontend and Android get a build check and manual verification, no new test harness.

## Left to the builder

- Exact list of order creators and change paths; exact admin pages and API serializers to touch.
- Final priority order after the live-result check; timeout value; Android layout details.
