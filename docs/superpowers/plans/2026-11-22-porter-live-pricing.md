# Porter Live Pricing (Indore) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In switched-on cities (Indore first), price every fare off Porter's live quote for the same route and vehicle (Model 3 = Porter, other models by the existing rate-card offsets), with the current rate card as automatic fallback.

**Architecture:** The VPS bot gets a `/api/porter-quote` endpoint that calls Porter's quotation API. The backend's new `porterQuoteService` calls it (cache, timeout, circuit breaker, sanity guard) and returns a "Porter anchor". `pricingEngine` takes an optional `porterAnchor`, which replaces slab base + night charge. The anchor is saved on `pkg_order.porter_quote` so every later repricing path stays on the Porter level.

**Tech Stack:** Node.js (CommonJS) backend + Prisma/MySQL + Jest; React admin (`frontend/`); bot is ESM Node (`Porter Driver Scraping Bot/`, not in git, hand-deployed to VPS).

**Spec:** `docs/superpowers/specs/2026-11-22-porter-live-pricing-design.md`

## Global Constraints

- Work on a new branch `feature/porter-live-pricing` cut from `main` (not from `feature/porter-style-ui`).
- Without an anchor, every pricing function must return exactly what it returns today (existing tests stay green unchanged).
- Model factor = `(1 + offset[X]/100) / (1 + offset["Model 3"]/100)` from `pricing_model_multipliers`; no separate Porter %.
- Porter mode: slab/linear base, our night charge, time-band charge and `service_charge_percent` are NOT added; radius, extra-mile, extra-stop, body-type charges and plan discount ARE (discount on the base, same cap rule as the slab branch).
- Setting key `porter_live_pricing` (JSON): `{ enabled:false, city_ids:[], timeout_ms:3000, cache_minutes:10 }`. Default OFF. Read errors → treated as OFF.
- Cache key: city + lat/lng rounded to 4 decimals (+ stops). One entry holds all vehicles. Circuit breaker: 5 consecutive failures → skip Porter 5 min. Sanity guard: Porter-derived fare must be within 0.5×–2× of the rate-card fare of the same package.
- Porter vehicle ids: bike 97, scooter 133, mini_3w 1139, e_loader 126, three_wheeler 91, four_wheeler 1. Indore `geo_region_id` 13.
- Orders/estimates with stops: no Porter call (rate card), until the waypoint format is verified.
- Migration is created but NOT applied to any DB; record it in memory as unapplied. Commit each task; never push or deploy unasked.

## Review Focus

- Porter returns a fare for some vehicles but not the requested one → that vehicle falls back to rate card, others still use Porter (test in Task 3).
- Same route requested concurrently by many customers → exactly one bot call (in-flight dedupe; test in Task 3).
- Order created after the 10-min cache expired and Porter now down → order gets `porter_quote = null` and is rate-card priced for life, never half-and-half (test in Task 5).
- Malformed `porter_quote` JSON on an old/edited row → treated as no anchor, no crash (test in Task 6).
- Admin saves the setting with a non-numeric city or timeout → rejected with 400, stored config unchanged (test in Task 2).

---

### Task 1: `pricingEngine` Porter anchor support

**Files:**
- Modify: `backend/src/services/pricingEngine.js` (`calculateFare` ~159, `calculateFareBreakdown` ~220, `priceForPackage` ~497, `priceForPackageId` ~545, exports ~844)
- Test: `backend/src/services/__tests__/pricingEngine.test.js`

**Interfaces:**
- Produces:
  - `porterModelFactor(pkg, modelMultipliers) -> number` (exported)
  - `porterAnchor` type: `{ fare:number, porter_distance_km?:number, quoted_at:string, porter_vehicle_id?:number }`
  - New trailing param `porterAnchor = null` on `calculateFare(..., now, porterAnchor)`, `calculateFareBreakdown(..., now, porterAnchor)`, `priceForPackage(..., now = new Date(), porterAnchor = null)`, `priceForPackageId(packageId, distanceKm, radiusRangeKm, extraMileCharge, uid, slabConfig, modelMultipliers, porterAnchor = null)`
  - `priceForPackage` return gains `priceSource: "porter" | "rate_card"`.

- [ ] **Step 1: Write failing tests** in `pricingEngine.test.js`, `describe("porter anchor")`, with multipliers `{ models:[{model:"Model 1",offset_percent:-10},{model:"Model 2",offset_percent:0},{model:"Model 3",offset_percent:8},{model:"Model 4",offset_percent:20},{model:"Model 5",offset_percent:40}] }`:
  - `porterModelFactor({title:"Model 3"}, m)` → `1`; `"Model 1"` → `toBeCloseTo(0.9/1.08, 6)`; `"Model 5"` → `toBeCloseTo(1.4/1.08, 6)`; title with no model → `1`.
  - `priceForPackage({title:"Model 3", ...}, 7, 1, 0, null, slabCfg, m, 0, dayDate, {fare:300})` → `fare === 300`, `priceSource === "porter"`.
  - Model 1, same inputs → `fare === roundMoney(300*0.9/1.08)`.
  - Night time (`now` inside a time band and with `night_charge_percent` set on pkg) → still `300` for Model 3 (no night add).
  - Radius 5 km on a pkg with `pickup_per_km_charge: 10` → `300 + calculateRadiusCharge(pkg,5)`.
  - Discount `{percent:10, maxCap:20}` → `300 - 20`.
  - Body charge 50 → `350`.
  - Same calls with `porterAnchor` omitted → equal to the current outputs (snapshot one existing case) and `priceSource === "rate_card"`.
  - `calculateFareBreakdown` with anchor → `baseFare` = anchor-derived base, `distanceCharge === 0`, `nightCharge === 0`, `total` equals `calculateFare` for the same inputs.

- [ ] **Step 2: Run** `cd backend && npx jest src/services/__tests__/pricingEngine.test.js -t "porter anchor"` → FAIL (`porterModelFactor is not a function`).

- [ ] **Step 3: Implement.** Add `porterModelFactor` next to `timeBandChargeFor` (same title match as `calculateFare`: `pkgTitle.includes(m.model.toLowerCase())`; Model 3 offset looked up by `model === "Model 3"`, missing → 0). In `calculateFare`/`calculateFareBreakdown`, when `porterAnchor?.fare > 0`: `rawBase = porterAnchor.fare * porterModelFactor(pkg, multipliers)`, apply discount like the slab branch, `dCharge = base + radiusCharge`, `servicePercent = 0`, `nightCharge = 0`; everything after stays shared. `multipliers` falls back to `DEFAULT_MODEL_MULTIPLIERS` as today. Thread the param through `priceForPackage` and `priceForPackageId`; in `priceForPackage` with an anchor, `isNight` is `false`.

- [ ] **Step 4: Run** the full `npx jest src/services/__tests__/pricingEngine.test.js src/services/__tests__/slabPricingService.test.js` → all PASS (old tests untouched).

- [ ] **Step 5: Commit** `feat(pricing): optional Porter anchor in fare calculation`.

---

### Task 2: `porterLiveSettings` + admin settings API

**Files:**
- Create: `backend/src/services/porterLiveSettings.js`
- Modify: `backend/src/controllers/rateCardController.js` (add `getPorterLive`, `updatePorterLive`), `backend/src/routes/adminRoutes.js` (next to line ~215)
- Test: `backend/src/services/__tests__/porterLiveSettings.test.js`

**Interfaces:**
- Produces:
  - `getConfig() -> Promise<{ enabled:boolean, cityIds:number[], timeoutMs:number, cacheMinutes:number }>`
  - `isActiveForCity(cityId) -> Promise<boolean>`
  - `saveConfig({ enabled, cityIds, timeoutMs, cacheMinutes }) -> Promise<config>` (throws `Error` with message on invalid input)
  - Routes: `GET /rate-cards/porter-live` (auth) → `{ config, stats }` (`stats` from Task 3's `getStats()`); `PUT /rate-cards/porter-live` (auth + `authorize("superadmin")`). Register both BEFORE `/rate-cards/:id`.

- [ ] **Step 1: Failing tests** (mock `../config/db` like `lowFareSettings` tests do):
  - No row → `{ enabled:false, cityIds:[], timeoutMs:3000, cacheMinutes:10 }`.
  - Row `{"enabled":true,"city_ids":[7],"timeout_ms":99999}` → `timeoutMs` clamped to `10000`; `timeout_ms: 100` → clamped to `500`; `cache_minutes` clamped 1..60.
  - Invalid JSON or prisma throws → defaults (enabled false).
  - `isActiveForCity(7)` true only when enabled and 7 in list; `isActiveForCity(null)` false.
  - `saveConfig({ cityIds:["x"] })` throws; `saveConfig({ timeoutMs:"abc" })` throws; nothing written (assert `upsert` not called).
  - Valid `saveConfig` upserts key `porter_live_pricing` with snake_case JSON.
- [ ] **Step 2: Run** `npx jest porterLiveSettings` → FAIL.
- [ ] **Step 3: Implement** following `lowFareSettings.js` style (logger.warn on read errors). Controller returns 400 `{ success:false, message }` on `saveConfig` errors.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(pricing): porter_live_pricing setting + admin API`.

---

### Task 3: `porterQuoteService`

**Files:**
- Create: `backend/src/services/porterQuoteService.js`
- Modify: `backend/src/services/outsideDriverService.js` (export `FAMILY_VEHICLE_ID`)
- Test: `backend/src/services/__tests__/porterQuoteService.test.js`

**Interfaces:**
- Consumes: `porterLiveSettings.getConfig/isActiveForCity` (Task 2); `vehicleFamily`, `FAMILY_VEHICLE_ID` from `outsideDriverService`; `OUTSIDE_DRIVER_API_URL` / `OUTSIDE_DRIVER_API_KEY` env (same base URL + `x-api-key` header as `outsideDriverService`).
- Produces:
  - `getPorterAnchor({ cityId, category, pickup:{lat,lng}, drop:{lat,lng}, stops = [] }, { fetchImpl = fetch, now = Date.now } = {}) -> Promise<porterAnchor | null>` — `category` is the category name (e.g. `"3 Wheeler"`).
  - `withinSanityRange(porterBasedFare, rateCardFare) -> boolean` (0.5 ≤ ratio ≤ 2; non-positive input → false).
  - `anchorFromOrder(order) -> porterAnchor | null` (parses `order.porter_quote` string/object; invalid or `fare <= 0` → null).
  - `getStats() -> { lastSuccessAt, lastFailureAt, lastError, successes, failures, cacheHits, breakerOpenUntil }`
  - `_resetForTests()`.
  - `PORTER_PRICING_VEHICLE_ID = { ...FAMILY_VEHICLE_ID, mini_3w: 1139 }`.

- [ ] **Step 1: Failing tests** (inject `fetchImpl`, mock settings to enabled for city 7):
  - City not active → `null`, fetch not called.
  - `stops.length > 0` → `null`, fetch not called.
  - Bot returns `{ ok:true, quotes:[{porter_vehicle_id:91,fare:412.6}], porter_distance_km:6.2, quoted_at:"…" }`, category `"3 Wheeler"` → `{ fare:412.6, porter_distance_km:6.2, porter_vehicle_id:91, quoted_at:"…" }`; POST body is `{ pickup, drop, stops:[] }` to `${BASE}/api/porter-quote`.
  - Second call with coords differing only in the 5th decimal → cache hit, fetch called once; `getStats().cacheHits === 1`.
  - After `cache_minutes` passed (inject `now`) → fetch again.
  - Two concurrent calls same route → fetch called once, both resolve the same anchor.
  - Requested vehicle missing from quotes (category `"Tata Ace"`, only 91 returned) → `null`, but `"3 Wheeler"` on the same cached route still works.
  - Fetch rejects / `ok:false` / slower than `timeoutMs` → `null`; failure counted.
  - 5 consecutive failures → 6th call returns `null` without fetch; after 5 min (inject `now`) fetch resumes.
  - `withinSanityRange(300, 100)` false, `(300, 200)` true, `(0, 200)` false.
  - `anchorFromOrder({porter_quote:"{bad"})` → null; `{porter_quote:{fare:300}}` → `{fare:300}`.
- [ ] **Step 2: Run** `npx jest porterQuoteService` → FAIL.
- [ ] **Step 3: Implement.** Module-level `Map` cache (cap 500 entries, drop oldest) of route → `{ at, quotes, porter_distance_km, quoted_at }`, `Map` of in-flight promises, timeout via `AbortSignal.timeout(timeoutMs)`. Category → family via `vehicleFamily`, → id via `PORTER_PRICING_VEHICLE_ID`. Failures only count fetch/bot errors, not "vehicle missing".
- [ ] **Step 4: Run** → PASS; also `npx jest outsideDriverService` → PASS.
- [ ] **Step 5: Commit** `feat(pricing): porterQuoteService with cache, timeout, breaker`.

---

### Task 4: Fare estimate uses Porter

**Files:**
- Modify: `backend/src/services/pricingEngine.js` (`getFareEstimate` ~579)
- Test: `backend/src/services/__tests__/pricingEngine.fareEstimate.porter.test.js` (new; mock `porterQuoteService`, `pickupCityService`, db)

**Interfaces:**
- Consumes: `getPorterAnchor`, `withinSanityRange` (Task 3), `resolvePickupCityId(plat, plong)` from `services/pickupCityService`, Task 1 anchor params.
- Produces: `getFareEstimate({ ..., cityId })` (new optional input; controller `orderController.fareEstimate` passes `req.body.city_id` if present). Response adds `price_source: "porter" | "rate_card"`.

- [ ] **Step 1: Failing tests:**
  - Anchor `{fare:300}` for city 7, package titled `Model 3` → `estimated_fare === 300`, `night_charge_amount === 0`, `distance_charge_amount === 0`, `price_source === "porter"`.
  - City from `resolvePickupCityId`; when it returns null, falls back to `cityId` input; both null → no Porter call.
  - Anchor null → identical output to today + `price_source: "rate_card"`.
  - Anchor whose Model 3 result is 3× the rate-card Model 3 fare → guard fails → rate-card output, `price_source: "rate_card"`.
  - Stops present → `getPorterAnchor` not called.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Call `getPorterAnchor` in the existing `Promise.all` (category name via the existing `categoryName(cat_id)`). Guard: compare the anchor-priced vs rate-card-priced gross fare of the first package (no discount, radius 1); fail → drop the anchor for all packages. Pass the anchor into both `calculateFareBreakdown` calls.
- [ ] **Step 4: Run** this test + `pricingEngine.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(pricing): fare estimate prices off Porter in enabled cities`.

---

### Task 5: Migration + order creation stores the anchor

**Files:**
- Create: `backend/prisma/migrations/20261122010000_add_pkg_order_porter_quote/migration.sql` → `ALTER TABLE pkg_order ADD COLUMN porter_quote JSON NULL;`
- Modify: `backend/prisma/schema.prisma` (`model pkg_order`: `porter_quote Json?`), `backend/src/controllers/orderController.js` (`createOrderCore` ~434-480; and `lowFareQuote` if it prices through `priceForPackage`)
- Test: `backend/src/controllers/__tests__/` existing createOrderCore test file (find with `grep -l createOrderCore backend/src/**/__tests__`), add a `describe("porter anchor")`

**Interfaces:**
- Consumes: `getPorterAnchor`, `withinSanityRange` (Task 3), Task 1 params.
- Produces: `pkg_order.porter_quote` set at create (JSON of the anchor) or null.

- [ ] **Step 1: Failing tests:**
  - Anchor returned for `orderCityId` → `pkg_order.create` data has `porter_quote` equal to the anchor, and `priceForPackage` received it.
  - Anchor null (cache expired + Porter down) → `porter_quote: null`, fare from rate card.
  - Order with stops → no Porter call, `porter_quote: null`.
  - Guard fails → `porter_quote: null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Fetch the anchor with `orderCityId` and the first package's category; pass it to all three `priceForPackage` branches; store on create. Run `npx prisma generate`. Do NOT run `migrate`.
- [ ] **Step 4: Run** that test file + `npx jest src/controllers` → PASS.
- [ ] **Step 5: Commit** (migration + schema + controller) `feat(pricing): store Porter anchor on order at creation`.

---

### Task 6: Dispatch, accept and assignment keep the anchor

**Files:**
- Modify: `backend/src/services/dispatchManager.js` (~710, ~912, ~1293), `backend/src/services/tripLifecycle.js` (~267), `backend/src/services/orderAssignmentService.js` (~109)
- Test: `dispatchManager.test.js`, plus the existing tripLifecycle / orderAssignmentService tests

**Interfaces:**
- Consumes: `anchorFromOrder(order)` (Task 3), Task 1 params.

- [ ] **Step 1: Failing tests:** an order with `porter_quote:{fare:300}`:
  - dispatch popup fare for Model 3 package at driver distance 1 = `300`; after a model upgrade to Model 4 = `roundMoney(300*1.2/1.08)`.
  - `acceptOrder` final fare = anchor-based + radius charge for the driver's real distance.
  - assignment repricing uses the anchor.
  - `porter_quote: "{bad"` → same fare as today (no crash).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Pass `anchorFromOrder(order)` at each call site. The ~1293 call passes no slab config/multipliers today: load `getSlabPricingConfig()` there once per batch and pass `modelMultipliers` too, so the factor uses real offsets.
- [ ] **Step 4: Run** `npx jest src/services` → PASS.
- [ ] **Step 5: Commit** `feat(pricing): dispatch/accept/assignment reprice off Porter anchor`.

---

### Task 7: Route changes re-anchor

**Files:**
- Modify: `backend/src/services/porterQuoteService.js` (add `anchorForNewRoute`), `orderDestinationService.js` (~80, ~160), `orderPickupService.js` (~91, ~145), `orderStopsService.js` (~82-99), `earlyDropService.js` (~92), `driverTripService.js` (~324)
- Test: `porterQuoteService.test.js` + each service's existing test file

**Interfaces:**
- Produces: `anchorForNewRoute(order, { pickup, drop, stops = [], newDistanceKm }, deps = {}) -> Promise<porterAnchor | null>`:
  - order has no anchor → `null` (order stays rate card).
  - try `getPorterAnchor` for the new route (order's `city_id`, category) → if found, return it.
  - else scale: `fare = old.fare × rateCard(newDistanceKm) / rateCard(order.distance)` where `rateCard(d) = priceForPackageId(order.delivery_type, d, 1, 0, null).fare`; keep other fields, set `quoted_at` = now, add `scaled:true`. Old distance 0 → return the old anchor.
- Each service passes the result as `porterAnchor` to its `priceForPackageId` calls (both the old- and new-route calls in the "zero-radius" pattern use the OLD anchor for old, NEW for new), and writes `porter_quote` in the same `pkg_order.update` that writes the new distance.

- [ ] **Step 1: Failing tests:**
  - `anchorForNewRoute`: no anchor → null; live quote available → live; Porter null + rate card 200→260 → `fare = old × 1.3`, `scaled:true`; stops present → scaled path (no fetch).
  - destination change on an anchored order: preview fare = anchor-based; apply writes `porter_quote` with the new anchor.
  - early drop / stops / pickup change / driver trip: one test each that the anchor is passed and persisted.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest` (whole backend) → PASS.
- [ ] **Step 5: Commit** `feat(pricing): route changes re-anchor Porter fare`.

---

### Task 8: Admin UI section + test quote

**Files:**
- Create: `frontend/src/components/ratecards/PorterLivePricingCard.jsx`
- Modify: `frontend/src/pages/RateCards.jsx` (render the card above the table), `backend/src/controllers/rateCardController.js` + `adminRoutes.js` (`POST /rate-cards/porter-live/test` → body `{ city_id, cat_id, plat, plong, dlat, dlong }` → `{ anchor, porter_based:[{title,fare}], rate_card:[{title,fare}] }` by calling `getFareEstimate` with and without forcing the anchor)

**Interfaces:**
- Consumes: Task 2 routes, Task 3 `getStats()`.

- [ ] **Step 1: Backend test** for the test-quote controller: returns both fare lists; Porter unavailable → `anchor:null` and only `rate_card` filled.
- [ ] **Step 2: Run** → FAIL; **Step 3: implement**; **Step 4: Run** → PASS.
- [ ] **Step 5: UI.** The card shows: switch (enabled), city multi-select (from the existing cities API the page or Settings already uses), timeout/cache inputs, health line (`last success · last error · failures · breaker open until`), a test box (category select + pickup/drop lat,lng) showing Porter vs rate-card fares per model. Save → `PUT /rate-cards/porter-live`. Note under the switch: "Model % comes from Distance Slabs offsets (relative to Model 3)."
- [ ] **Step 6: Verify** `cd frontend && npm run build` → succeeds.
- [ ] **Step 7: Commit** `feat(admin): Porter Live Pricing card on Rate Cards`.

---

### Task 9: Bot quote endpoint (VPS bot, not in git)

**Files:**
- Create: `Porter Driver Scraping Bot/porter_quote.js`
- Modify: `Porter Driver Scraping Bot/server.js` (route next to `/api/find-driver`, behind the existing `x-api-key` check at ~67)

**Interfaces:**
- Produces: `POST /api/porter-quote` body `{ pickup:{lat,lng}, drop:{lat,lng}, stops:[] }` → `{ ok:true, quotes:[{porter_vehicle_id, vehicle_name, fare}], porter_distance_km, quoted_at }` or `{ ok:false, error }` (HTTP 200 for both; 400 on bad coords).
- `getQuote({pickup, drop, stops}) -> Promise<result>` in `porter_quote.js`, reusing headers/payload from `rates.js` (`geo_region_id:13`, `vehicle_ids: INDORE_VEHICLE_IDS`, `calculateDistanceKm(route_polyline)`).

- [ ] **Step 1: Implement.** Account: env `PORTER_QUOTE_MOBILE` → that account from `getAccounts()`, else `getNextAccount()`; skip accounts where `isAccountInComplianceCooldown`. On HTTP 401/403/422 → `markAccountComplianceCooldown(mobile, 15*60*1000)`, return `{ok:false,error:"porter_<status>"}`. axios `timeout: 2500`. `stops.length > 0` → `{ok:false,error:"stops_unsupported"}`. Do not call `markAccountUsed` (quotes are not bookings).
- [ ] **Step 2: Verify locally:** `node server.js` then `curl -s -X POST localhost:<port>/api/porter-quote -H "x-api-key: $KEY" -H "content-type: application/json" -d '{"pickup":{"lat":22.7186,"lng":75.8550},"drop":{"lat":22.7244,"lng":75.8839},"stops":[]}'` → `ok:true` with 6 quotes, fares in the range seen in calibration (3W roughly ₹200-400 for ~4 km by day).
- [ ] **Step 3:** No commit (dir is untracked). Record in memory that the VPS bot needs this file + route deployed (via `vps_deploy.js`) only when the owner asks.

---

### Task 10: End-to-end check on local backend (no deploy)

- [ ] **Step 1:** Run backend locally against DEV DB only if the migration has been applied there by the owner; otherwise stop here and report. With it applied: set `porter_live_pricing` `{enabled:true, city_ids:[<Indore id>]}` via the admin API, point `OUTSIDE_DRIVER_API_URL` at the local bot.
- [ ] **Step 2:** `POST /api/v1/order/fare-estimate` for an Indore route, 3W → Model 3 `estimated_fare` equals the bot's 3W fare (rounded), `price_source:"porter"`; stop the bot → same request returns rate-card fares within ~3 s, `price_source:"rate_card"`.
- [ ] **Step 3:** Set the setting back to `enabled:false`. Update memory `porter_live_pricing.md` (branch, commits, migration unapplied, bot not deployed, flag OFF).

---

## Self-review notes

- Spec coverage: bot endpoint (T9), service + cache/breaker/guard/stats (T3), settings + admin (T2, T8), formula with existing offsets (T1), estimate + city (T4), order anchor create/dispatch/route change (T5-7), stops fallback (T3/T4/T5), default OFF + dev-only (T2/T10).
- Out of scope per spec: other cities, auto-calibration, app changes, Porter app price matching.
