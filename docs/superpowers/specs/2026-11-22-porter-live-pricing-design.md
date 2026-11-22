# Porter Live Pricing (Indore) — Design

Date: 2026-11-22 · Status: draft, awaiting owner approval

## Intent / why

Owner's pricing goal: **Model 3 = Porter's price, Model 1 = admin-set % below Porter**, other models follow.
Today we hand-calibrate slab rates to Porter (see 2026-11-01/02 calibration). Porter keeps changing its rates,
so our Model 1 sometimes ends up *above* Porter. Hand calibration also can't fix route-level gaps: Porter bills
its own route distance, and our Google distance is longer on ~46% of routes.

Permanent fix: for every fare, ask Porter's quotation API for the live fare of that exact route, use it as the
Model 3 base, and derive the other models from it. Our existing rate card stays as the fallback.

## Goals

- Instant fare estimate in **Indore** shows Model 3 = Porter's live web-quote fare for the same vehicle + route.
- Model 1/2/4/5 derived from Porter's fare with the **existing rate-card model offsets** (owner decision 2026-11-22: no separate % for Porter mode).
- Any Porter failure (token expired, block/422, timeout, bad data) → silently use today's rate-card pricing.
- The order's money paths (create, dispatch model upgrades, accept, assignment, edits, early drop) stay
  consistent with the Porter-based fare the customer was shown.
- Admin can switch it on/off and choose cities.

## Non-goals

- Cities other than Indore (switch is city-wise, so they can be added later once bot accounts exist there).
- Auto-recalibrating the fallback rate card from Porter (approach B; possible later).
- Matching Porter's *mobile-app* price (API returns the web price; app is ~₹50 lower on 3W, ~₹100 on Tata Ace).
- Predicting Porter's price for a future time (scheduled / next-day bookings use the quote taken at estimate time).
- Any customer-app or driver-app change. Response shape stays the same.

## Anti-goals (failure even if it "works")

- A Porter outage makes booking slow or impossible. Fallback must be fast (hard timeout) and automatic.
- Hammering Porter so the driver-search bot accounts get flagged (422 / compliance cooldown).
- The fare jumping between what the customer saw and what is billed because one path uses Porter and another
  the rate card.

## Constraints / facts

- Porter quote endpoint: `POST https://website-api-gateway-prod-ktor.porter.in/customers/on_demand/quotations`,
  needs a logged-in customer account token (`auth-token`, `mobile`), Indore `geo_region_id: 13`. One call returns
  all 6 Indore vehicles (`vehicle_wise_quotations[].fare_info.fare`), plus `route_polyline`. Code already exists
  in `Porter Driver Scraping Bot/rates.js`. Request has `waypoints_attributes` (stop format unverified).
- Porter vehicle id → our vehicle: 97 Bike, 133 Scooter, 1139 Mini 3W, 126 E-Loader, 91 3 Wheeler, 1 Tata Ace.
  Backend already maps vehicles by family (`vehicleFamily`, `FAMILY_VEHICLE_ID` in the outside-driver code).
- Porter's fare already contains its time-of-day add-on (night). Porter accounts live in the bot on the VPS
  (`rider.shifteronline.com`, `x-api-key` auth via `OUTSIDE_DRIVER_API_URL` / `OUTSIDE_DRIVER_API_KEY`).
  The bot directory is not in git; it is deployed by hand.
- Sending a quote means sending the customer's **real** pickup/drop to Porter (unlike driver search, which uses
  fake nearby points). Accepted by the owner by choosing this approach.
- Fare is repriced in many places: `orderController.createOrderCore`, `dispatchManager` (710, 912, 1293),
  `tripLifecycle.acceptOrder`, `orderAssignmentService`, `orderDestinationService`, `orderPickupService`,
  `orderStopsService`, `driverTripService`, `earlyDropService`. All go through `pricingEngine.priceForPackage(Id)`.

## Approaches considered

- **A. Live Porter quote per fare estimate, rate card fallback — CHOSEN.** Exact Porter price per route,
  includes Porter's distance and night add-on. Cost: live dependency on Porter, more calls, real addresses go to Porter.
- B. Periodic auto-calibration of our rate card from sample routes. No live dependency, but our distance ≠ Porter's,
  so Model 1 can still land above Porter on many routes — doesn't fix the actual problem.
- C. A + B. Most robust, most work. Deferred; B can be added later if Porter failures turn out frequent.

## Design

### 1. Bot: quote endpoint (VPS)

`POST /api/porter-quote` on the bot server, `x-api-key` protected like the other partner endpoints.
Body: `{ pickup:{lat,lng}, drop:{lat,lng}, stops:[{lat,lng}] }`. Response:
`{ ok:true, quotes:[{ porter_vehicle_id, vehicle_name, fare }], porter_distance_km, quoted_at }` or `{ ok:false, error }`.

- Uses the existing account rotation, but **prefers a dedicated quote account** if one is configured, so quote
  traffic doesn't push driver-search accounts into cooldown. On 401/403 (expired token) or 422, mark that account
  (existing cooldown helpers) and return `ok:false`. No retry with another account inside the same request (keeps it fast).
- Own 2.5 s timeout to Porter.
- Stops: v1 sends no waypoints. Requests with stops return `ok:false, error:"stops_unsupported"` until the
  waypoint format is verified (then remove that guard).

### 2. Backend: `porterQuoteService`

`getPorterFare({ cityId, catId, pickup, drop, stops })` → `{ fare, porterDistanceKm, quotedAt } | null`.

- Only when the setting is on and `cityId` is in its city list; `null` otherwise.
- Cache by rounded coordinates (4 decimals) + city, **all vehicles of one route in one entry**, TTL `cache_minutes`
  (default 10). One quote serves every vehicle the customer flips through.
- Calls the bot with a hard timeout `timeout_ms` (default 3000). Concurrent identical requests share one in-flight call.
- **Circuit breaker:** after 5 consecutive failures, skip Porter for 5 minutes (straight to fallback).
- **Sanity guard:** if Porter's fare is < 50% or > 200% of our rate-card Model 3 fare for the same route, treat it
  as a failure (bad data, wrong vehicle mapping).
- Vehicle match by family, same mapping as the outside-driver code (reuse it, don't copy it).
- Keeps small in-memory stats: last success/failure time, last error, success/failure counters, and cache hits.

### 3. Settings (app_settings JSON key `porter_live_pricing`, no migration)

```json
{ "enabled": false, "city_ids": [<Indore id>], "timeout_ms": 3000, "cache_minutes": 10 }
```

Admin UI: a "Porter Live Pricing" section on the Rate Cards page with the on/off switch, cities,
a health line (last success / last error / failures) and a "Test quote" box (two points → per-vehicle Porter
fare + our 5 model fares). Default **OFF**.

### 4. Fare formula in Porter mode

Uses the existing `pricing_model_multipliers` offsets (the ones in the Distance Slabs modal), relative to Model 3
so Model 3 always equals Porter: `base = porterFare × (1 + offset[X]/100) / (1 + offset[Model 3]/100)`.
Model matched by package title like today (`pkgTitle.includes(model)`); no match → factor 1.
With today's offsets −10/0/+8/+20/+40 this gives M1 ≈ 83.3%, M2 ≈ 92.6%, M3 = 100%, M4 ≈ 111.1%, M5 ≈ 129.6% of
Porter — the same gaps between models the rate card has today. Changing offsets in the modal changes both modes.
This **replaces** the slab/linear base **and** our night charge / time-band charge, because Porter's fare already
includes its night add-on. Everything else is added exactly as today: plan discount on the base (same cap rules),
per-driver radius charge, extra-mile charge, body-type charge, extra-stop charge. Rounding, driver earning and
commission rules are unchanged (they work off the final fare).

Implemented as an optional `porterAnchor` input (`{ fare, quotedAt }`) to `calculateFare` /
`calculateFareBreakdown` / `priceForPackage` / `priceForPackageId`. When it's absent, behavior is byte-identical
to today. Fare-estimate breakdown: `base_fare_charge` = Porter-derived base, `distance_charge_amount` = 0,
`night_charge_amount` = 0. Add `price_source: "porter" | "rate_card"` to the estimate response (apps ignore it).

### 5. Carrying the anchor through the order

New nullable JSON column on `pkg_order`: `porter_quote` =
`{ fare, porter_distance_km, quoted_at, porter_vehicle_id }` (fare = Porter's Model-3 fare for the order's vehicle).
Migration with the same "unapplied until owner runs it" process as other features.

- **Create:** `createOrderCore` calls `getPorterFare` for the order's city/vehicle/route (normally a cache hit from
  the estimate a moment ago). If it returns, store it in `porter_quote` and price with it. If not, `porter_quote`
  stays null and the order is rate-card priced for its whole life.
- **Dispatch model upgrades, accept, assignment:** if `order.porter_quote` exists, pass it as `porterAnchor`.
  The same route keeps the same anchor, so upgrades just apply the next model's %.
- **Route changes (destination, pickup, stops, early drop, driver-trip distance change):** try a fresh Porter quote
  for the new route. If it fails (or there are stops, while stops are unsupported), **scale** the old anchor:
  `newAnchor = oldAnchor × rateCardModel3(newRoute) / rateCardModel3(oldRoute)`. Then save the new anchor.
  This keeps the order on the Porter level instead of jumping to rate card.

### 6. City

The fare estimate resolves city from the pickup with the existing `resolvePickupCityId(plat, plong)`, and falls back
to the customer's city. Order creation uses the order's resolved city (the same value it already computes).

## Decisions made by Claude (owner please check)

1. (Owner) Reuse the rate-card model offsets, taken relative to Model 3 so Model 3 = Porter.
2. Porter fare replaces our night / time-band charge (it already includes Porter's).
3. Orders with stops use the rate card at estimate time until Porter's stop format is verified.
4. Scheduled / next-day bookings use the live quote from estimate time (no future-time prediction).
5. Sanity guard 50%–200% of our own Model 3 fare; circuit breaker 5 failures → 5 min pause.
6. A dedicated Porter account for quotes is preferred (owner to provide one; works without it).
7. Default OFF, Indore only. Dev first, prod only when the owner asks.

## Left to the builder

- Exact cache/timeout plumbing, exact admin UI layout, how stats are exposed (admin endpoint).
- Tests: pricingEngine with/without anchor (no-anchor output must equal today's), porterQuoteService
  (cache, timeout, breaker, guard, city gate), repricing paths keep the anchor, route-change scaling.
