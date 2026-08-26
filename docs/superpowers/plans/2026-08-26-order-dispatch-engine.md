# Order & Dispatch Microservice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-time Order & Dispatch microservice (REST + Socket.io) inside `backend/` that replaces polling with a 5s-overlapping / 15s-popup dispatch cascade against the existing live MySQL schema.

**Architecture:** Clean layered architecture — `controllers/` (thin HTTP handlers) → `services/` (all business logic: pricing, dispatch cascade, driver locking, trip lifecycle) → Prisma (`src/lib/prisma.js`, the existing singleton client) for persistence, with raw `$queryRaw`/`$executeRaw` used only where atomicity or geo-radius SQL requires it. `sockets/` owns all Socket.io wiring and room management and is the only layer allowed to call `io.to(room).emit(...)`; services return data and call injected emit callbacks rather than importing `io` directly, except `dispatchManager`, which is handed the `io` instance once at boot because it owns server-side timers that must emit on their own schedule.

**Tech Stack:** Node.js, Express 5, Socket.io 4, Prisma 6 (MySQL), Jest (new devDependency, for pure-logic unit tests), existing `mysql2` transitively via Prisma.

**Spec:** `backend/ORDER_FLOW_NODEJS_SPECIFICATION.md`

## Global Constraints

- `POPUP_TIMEOUT_MS = 15000`, `BATCH_GAP_MS = 5000`, `MAX_DRIVERS_PER_BATCH = 4`, `SEARCH_RADIUS_KM = 10` (spec §3, §4.7).
- Driver acceptance MUST go through the atomic conditional `UPDATE pkg_order ... WHERE id=? AND rid=0 AND order_status=0 AND o_status != 'Cancelled'` and branch on `affectedRows` (spec §4.5).
- One driver = one active popup at any time, tracked in an in-memory `Map` (spec §4.1) — no Redis dependency introduced.
- Zero polling: all state changes after order creation reach clients via Socket.io rooms `customer_<uid>`, `driver_<rid>`, `order_<order_id>` (spec §6.1).
- Reuse the existing Prisma client singleton (`backend/src/lib/prisma.js`) — do not instantiate a second `PrismaClient`, since Prisma's connection pool is per-instance and a second client doubles DB connections against the shared Hostinger MySQL server.
- `tbl_package.driver_per_trip` / `driver_per_percent` are stored as `VarChar` in the live schema (legacy PHP quirk) — always `parseFloat` with a `|| 0` fallback, never assume numeric type.
- No Firebase/FCM service-account credentials exist in this environment. `config/firebase.js` must initialize only if `FIREBASE_SERVICE_ACCOUNT_JSON` (or `FIREBASE_SERVICE_ACCOUNT_PATH`) is set; otherwise it exports a no-op `sendPushNotification()` that logs a warning instead of throwing, so the service boots without those secrets.

---

## File Structure

```
backend/src/
├── config/
│   ├── db.js                 # thin re-export of lib/prisma.js + graceful shutdown hook
│   ├── constants.js          # timing/radius constants
│   └── firebase.js           # guarded FCM init (no-op fallback)
├── controllers/
│   ├── orderController.js    # fare-estimate, create, details, customer-cancel, rate
│   └── riderController.js    # rider online/offline toggle, REST location fallback
├── services/
│   ├── pricingEngine.js      # fare estimate math + driver earning calc
│   ├── lockManager.js        # driver popup lock map + selection mutex
│   ├── dispatchManager.js    # batch cascade scheduler/state machine
│   └── tripLifecycle.js      # accept / status transitions / cancel / rate
├── sockets/
│   ├── socketServer.js       # io init, room join handlers, wiring other socket modules
│   ├── orderSocket.js        # order:accept / order:reject / order:status_update handlers
│   └── trackingSocket.js     # driver:location_ping -> driver:location_stream
├── routes/
│   ├── orderRoutes.js
│   └── riderRoutes.js
├── utils/
│   ├── geoDistance.js        # haversine + Google Distance Matrix optional upgrade
│   └── logger.js             # timestamped console logger
├── app.js                    # MODIFY: mount new routes
├── server.js                 # MODIFY: wrap app in http.Server, init socket layer
└── lib/prisma.js             # unchanged, reused everywhere

backend/
├── jest.config.js            # NEW
└── src/**/__tests__/*.test.js
```

**Why this split:** `dispatchManager` and `lockManager` are separated because the lock map is a reusable primitive (also needed by `tripLifecycle.acceptOrder` to release a winning driver's own lock) while `dispatchManager` owns the timer/state-machine complexity — mixing them would make the lock map's concurrency guarantees hard to reason about independently. `pricingEngine` has zero DB-write side effects (read-only queries + math), which is what makes it cleanly unit-testable.

---

## Interfaces (contracts between files)

```js
// utils/geoDistance.js
function haversineKm(lat1, lon1, lat2, lon2): number
async function getRoadDistanceKm(lat1, lon1, lat2, lon2): { distanceKm: number, durationMin: number, source: 'google'|'haversine' }

// services/pricingEngine.js
async function getFareEstimate({ cat_id, plat, plong, dlat, dlong }):
  { distance_km: number, duration_min: number, packages: [{ package_id, title, min_charge, per_km_charge, estimated_fare, is_night }] }
function calculateFare(pkg, distanceKm, isNight): number   // pure
function calculateDriverEarning(pkg, totalFare): number    // pure

// services/lockManager.js
function isLocked(riderId): boolean
function acquireLock(riderId, orderId, durationMs): boolean   // false if already locked
function releaseLock(riderId): void
function getLock(riderId): { orderId, expiresAt } | undefined
async function withSelectionLock(fn: () => Promise<T>): Promise<T>  // global async mutex around driver-selection

// services/dispatchManager.js
function init(io): void                       // called once from server.js
async function startDispatch(order): void      // order = row from pkg_order + allowed_delivery_types parsed array
function stopDispatch(orderId, reason): void   // clears timers, releases locks, marks pending requests

// services/tripLifecycle.js
async function acceptOrder(orderId, riderId): { success: boolean, msg?: string, order?, rider? }
async function rejectOrder(orderId, riderId): void
async function updateStatus(orderId, riderId, status: 'arrived'|'pickup'|'complete'): { success, order_status, o_status }
async function customerCancel(uid, orderId, comment): { success, msg }
async function rateOrder(uid, orderId, riderId, star, comment): { success }

// sockets/socketServer.js
function initSocket(httpServer): io   // sets up connection handler, delegates to orderSocket/trackingSocket, calls dispatchManager.init(io)
function getIO(): io                  // throws if called before initSocket
```

---

## Task 1: Utilities — `geoDistance.js`, `logger.js`, `constants.js`

**Files:**
- Create: `backend/src/utils/geoDistance.js`
- Create: `backend/src/utils/logger.js`
- Create: `backend/src/config/constants.js`
- Test: `backend/src/utils/__tests__/geoDistance.test.js`

**Interfaces:**
- Produces: `haversineKm`, `getRoadDistanceKm` (used by `pricingEngine`, `dispatchManager` driver-radius filtering).

- [ ] Add `jest` devDependency and `jest.config.js` (`testEnvironment: "node"`), add `"test": "jest"` script to `package.json`.
- [ ] Write `geoDistance.test.js`: known-distance assertion (Delhi Rohini → Connaught Place ≈ 12–14 km via haversine), and a 0-distance same-point case.
- [ ] Implement `haversineKm(lat1, lon1, lat2, lon2)` (standard formula, returns km rounded to 2 decimals is NOT done here — return raw float, rounding happens at call sites).
- [ ] Implement `getRoadDistanceKm(...)`: if `process.env.GOOGLE_MAPS_API_KEY` set, call Distance Matrix API via `fetch` (Node 18+ global fetch — confirm Node version supports it, else use `https` module) and return `{distanceKm, durationMin, source:'google'}`; on any error or missing key, fall back to `{distanceKm: haversineKm(...) * 1.3, durationMin: Math.round(haversineKm(...) * 1.3 / 30 * 60), source:'haversine'}` (1.3 = road-vs-straight-line fudge factor, 30 km/h assumed urban average).
- [ ] Implement `logger.js`: exports `{ info, warn, error }`, each prefixing `[ISO-timestamp] [LEVEL]`.
- [ ] Implement `constants.js`: `POPUP_TIMEOUT_MS=15000, BATCH_GAP_MS=5000, MAX_DRIVERS_PER_BATCH=4, SEARCH_RADIUS_KM=10, ROAD_DISTANCE_FUDGE_FACTOR=1.3`.
- [ ] Run `npm test` — expect `geoDistance.test.js` PASS.
- [ ] Commit.

## Task 2: `config/db.js`, `config/firebase.js`

**Files:**
- Create: `backend/src/config/db.js`
- Create: `backend/src/config/firebase.js`

**Interfaces:**
- Consumes: `backend/src/lib/prisma.js` (existing `module.exports = prisma`).
- Produces: `db.js` re-exports the same prisma singleton; `firebase.js` exports `async function sendPushNotification(fcmToken, title, body, data)`.

- [ ] `db.js`: `const prisma = require("../lib/prisma"); process.on("beforeExit", () => prisma.$disconnect()); module.exports = prisma;`
- [ ] `firebase.js`: if `FIREBASE_SERVICE_ACCOUNT_JSON` env var present, `JSON.parse` it and init `firebase-admin` (add as dependency); else log a one-time warning and export a no-op that resolves `{ sent: false, reason: 'not_configured' }`.
- [ ] Add `firebase-admin` to `package.json` dependencies (only used if configured; guarded `require` inside a try/catch so missing install doesn't crash boot — actually since we add it as a real dependency and run `npm install`, no need for try/catch around `require`).
- [ ] Commit.

## Task 3: `pricingEngine.js`

**Files:**
- Create: `backend/src/services/pricingEngine.js`
- Test: `backend/src/services/__tests__/pricingEngine.test.js`

**Interfaces:**
- Consumes: `getRoadDistanceKm` (Task 1), `prisma` (Task 2) for `tbl_package.findMany({ where: { cat_id, status: 1 }, orderBy: { sort_order: 'asc' } })`.
- Produces: `getFareEstimate`, `calculateFare`, `calculateDriverEarning` — consumed by `orderController.fareEstimate`, `orderController.createOrder`, `tripLifecycle.acceptOrder`, `dispatchManager` (per-batch price + driver_earning for the `order:request` payload).

- [ ] Write `pricingEngine.test.js` covering `calculateFare`: `{min_charge: 20, per_km_charge: 5, night_charge_percent: 20}` at `distanceKm=10` → `max(20, 10*5)=50`, then with `isNight=true` → `50 * 1.20 = 60`. Also a distance-under-minimum case (`distanceKm=1` → returns `min_charge`, not `per_km_charge*distance`).
- [ ] Implement `calculateFare(pkg, distanceKm, isNight)`: `base = Math.max(Number(pkg.min_charge), Number(pkg.per_km_charge) * distanceKm)`; if `isNight`, `base *= (1 + Number(pkg.night_charge_percent || 0) / 100)`; round to 2 decimals.
- [ ] Implement `calculateDriverEarning(pkg, totalFare)`: prefer flat `parseFloat(pkg.driver_per_trip)` if it parses to a positive number; else `totalFare * (parseFloat(pkg.driver_per_percent) || 0) / 100`; round to 2 decimals.
- [ ] Implement `isNightTime()` helper: `start_time`/`end_time` are per-package `Time` columns — compare current server time-of-day against them per package (not a single global night flag), returning per-package `is_night` 0/1.
- [ ] Implement `getFareEstimate({ cat_id, plat, plong, dlat, dlong })`: fetch packages for `cat_id`, `getRoadDistanceKm`, map each package through `calculateFare` + `isNightTime`, return the exact shape from spec §5.1.
- [ ] Run `npm test`.
- [ ] Commit.

## Task 4: `lockManager.js`

**Files:**
- Create: `backend/src/services/lockManager.js`
- Test: `backend/src/services/__tests__/lockManager.test.js`

**Interfaces:**
- Produces: `isLocked`, `acquireLock`, `releaseLock`, `getLock`, `withSelectionLock` — consumed by `dispatchManager` (batch driver selection + expiry) and `tripLifecycle.acceptOrder`/`rejectOrder` (release winning/rejecting driver's own lock).

- [ ] Write `lockManager.test.js` using `jest.useFakeTimers()`: `acquireLock('r1', 297, 15000)` returns `true`; a second `acquireLock('r1', 298, 15000)` before expiry returns `false`; after `jest.advanceTimersByTime(15001)`, `isLocked('r1')` returns `false` (lazy-expiry check, no real timer needed inside the map itself — expiry is computed from `Date.now()` vs stored `expiresAt`, so this test only needs `jest.setSystemTime` advancement, not fake timers on the module).
- [ ] Also test `withSelectionLock`: two concurrent calls resolve strictly in sequence, not interleaved (push results into an array from within each callback with an `await new Promise(r=>setTimeout(r,10))` in the middle, assert final array order).
- [ ] Implement as a module-level `const activePopups = new Map()` (rider_id -> `{orderId, expiresAt}`); `isLocked` checks `expiresAt > Date.now()` and auto-deletes stale entries on read.
- [ ] Implement `withSelectionLock` as a minimal promise-chain mutex: `let tail = Promise.resolve(); function withSelectionLock(fn) { const run = tail.then(fn, fn); tail = run.catch(()=>{}); return run; }`.
- [ ] Run `npm test`.
- [ ] Commit.

## Task 5: `dispatchManager.js` (the cascade engine)

**Files:**
- Create: `backend/src/services/dispatchManager.js`
- Test: `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `lockManager` (Task 4), `pricingEngine.calculateDriverEarning` (Task 3), `prisma` (Task 2), `getIO()` is NOT used — `io` is passed into `init(io)` once and closed over.
- Produces: `init(io)`, `startDispatch(order)`, `stopDispatch(orderId, reason)` — consumed by `orderController.createOrder` (kicks off dispatch after insert), `tripLifecycle.acceptOrder`/`customerCancel` (call `stopDispatch`).

- [ ] Write `dispatchManager.test.js` with `jest.useFakeTimers()` and a mocked `prisma` (`jest.mock('../../lib/prisma')`) returning a fixed list of eligible riders per tier and a mocked `io.to().emit()` spy: assert that at `t=0` batch 1 emits to exactly the first 4 mocked riders, at `t=5000` batch 2 emits to the next tier while batch 1's `order:dismiss` has NOT fired yet, and at `t=15000` batch 1's riders receive `order:dismiss` with `reason:'timeout'` and their locks are released (`lockManager.isLocked` false).
- [ ] Implement `selectEligibleDrivers(order, packageId, excludeRiderIds)`: raw SQL via `prisma.$queryRaw` joining `tbl_rider` + `tbl_rider_delivery_type` (`delivery_type = packageId`, `status = 1`) filtered by `a_status=1 AND tbl_rider.status=1`, vehicle matching `order.category`, Haversine-in-SQL radius filter against `SEARCH_RADIUS_KM`, `id NOT IN (excludeRiderIds)`, ordered by: favorite drivers (LEFT JOIN `tbl_favorite_driver`) first, then distance ascending, `LIMIT 4`.
- [ ] Implement `runBatch(orderId, tierIndex)`: inside `withSelectionLock`, re-fetch current order row (bail out silently if `rid != 0` — already accepted), compute `excludeRiderIds` from currently-locked riders (`lockManager`), call `selectEligibleDrivers`, for each selected rider: `lockManager.acquireLock(riderId, orderId, POPUP_TIMEOUT_MS)`, insert `tbl_order_requests` row (`status:'sent'`), `io.to('driver_'+riderId).emit('order:request', {...spec §6.3 shape...})`. If zero drivers found for every tier so far and this was the last tier, emit `order:no_driver_found` to `customer_<uid>` and update `pkg_order.o_status` — but only after the LAST tier's popup timer also expires with no acceptance (spec's T=35s no_driver_found is post-expiry, not post-selection) — so `no_driver_found` logic belongs in the tier's expiry handler, not `runBatch`.
- [ ] Implement `scheduleExpiry(orderId, tierIndex, riderIds)`: `setTimeout(POPUP_TIMEOUT_MS)` that: re-checks order still unassigned, for each `riderId` still locked to this order, releases lock, updates that rider's `tbl_order_requests` row to `'timeout'`, emits `order:dismiss {order_id, reason:'timeout'}` to `driver_<riderId>`; if `tierIndex` was the last configured tier AND order still unassigned, emit `order:no_driver_found` to `customer_<uid>` and set `o_status` appropriately (use existing `Cancelled`... spec doesn't define a new enum value, so record via `order_status_history` + leave `o_status='Pending'`/mark cancelled per product decision — implement as: set `pkg_order.o_status = 'Cancelled'`, `cancel_reason = 'No driver found'` so the order isn't stuck forever, since the enum has no "expired" state).
- [ ] Implement `startDispatch(order)`: parse `order.allowed_delivery_types` (JSON-text column) into an array of package IDs (the tiers, in order); `runBatch(order.id, 0)` immediately; for `i` from 1 to `tiers.length-1`, `setTimeout(() => runBatch(order.id,i), i*BATCH_GAP_MS)`; store all timer handles (batch-start timers + expiry timers, keyed by orderId) in a module-level `Map<orderId, Set<Timeout>>` so `stopDispatch` can `clearTimeout` every one of them.
- [ ] Implement `stopDispatch(orderId, reason)`: clear all stored timers for `orderId`, find all riders currently locked to `orderId` via a reverse scan of `lockManager` (add a `lockManager.getLockedRidersForOrder(orderId)` helper in Task 4 if not already present — go back and add it), release their locks, mark their `tbl_order_requests` rows `'auto_rejected'` (if `reason==='accepted_by_other'`) or leave as `'sent'`→ update to `'timeout'`-equivalent for other reasons, emit `order:dismiss {order_id, reason}` to each.
- [ ] Run `npm test`.
- [ ] Commit.

## Task 6: `tripLifecycle.js`

**Files:**
- Create: `backend/src/services/tripLifecycle.js`
- Test: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `prisma` (raw `$executeRaw` for the atomic accept), `dispatchManager.stopDispatch`, `lockManager.releaseLock`, `pricingEngine.calculateDriverEarning`.
- Produces: `acceptOrder`, `rejectOrder`, `updateStatus`, `customerCancel`, `rateOrder` — consumed by `sockets/orderSocket.js` and `controllers/orderController.js`.

- [ ] Write `tripLifecycle.test.js` mocking `prisma.$executeRaw` to return `1` then `0` on successive calls: assert `acceptOrder` returns `{success:true}` on the first call and `{success:false, msg:'Order already taken or cancelled'}` on the second, and that `dispatchManager.stopDispatch` was called exactly once (only on the success path).
- [ ] Implement `acceptOrder(orderId, riderId)`: run the exact atomic SQL from spec §4.5 via `prisma.$executeRaw` with tagged-template parameters (never string-concatenate `orderId`/`riderId`); if the returned row count is `0`, return `{success:false, msg:'Order already taken or cancelled'}`; if `1`: fetch the order + package (`allowed_delivery_types` current tier) to compute `driver_earning` via `pricingEngine.calculateDriverEarning`, `UPDATE pkg_order SET driver_earning=?`, mark this rider's `tbl_order_requests` row `'accepted'`, call `dispatchManager.stopDispatch(orderId, 'accepted_by_other')` (releases the OTHER pending drivers — this rider's own lock is released separately via `lockManager.releaseLock(riderId)` since they're not in the "other drivers" dismiss set), fetch rider details (`tbl_rider.findUnique`), return `{success:true, order, rider}` for the socket layer to emit `order:assigned`/`order:dismiss`.
- [ ] Implement `rejectOrder(orderId, riderId)`: `lockManager.releaseLock(riderId)`, update that rider's `tbl_order_requests` row to `status:'10'` (matches spec's rejected code), no dismiss needed (driver rejected itself) but the batch should be allowed to immediately try replacement drivers — call a new `dispatchManager.notifyDriverFreed(orderId)` hook is out of scope for this plan (spec doesn't require immediate backfill on explicit reject, only on 15s timeout) — do NOT implement backfill-on-reject; only release + mark status.
- [ ] Implement `updateStatus(orderId, riderId, status)` per spec §6.3: `'arrived'` → `order_status=2, o_status='Pickup'`, upsert `pkg_order_wait_timer` (`pickup_wait_start=NOW()`, unique on `[order_id, rid]`); `'pickup'` → `order_status=3, o_status='On Route'`, compute `pickup_wait_seconds = now - pickup_wait_start` and update the wait-timer row; `'complete'` → `order_status=5, o_status='Completed', ddate=NOW()`, compute chargeable wait time beyond `free_waiting_time`, add `wating_charge` to `total_dcharge`, if `p_method_id` indicates cash (`transaction_id==='cash_payment'`) debit admin commission from `tbl_rider.wallet_balance` via `tbl_wallet_history` insert (`type:'debit', wallet_type:'driver'`). Every branch validates `riderId === order.rid` before mutating (a driver can't update someone else's order) and returns `{success:false, msg:'Not authorized for this order'}` otherwise.
- [ ] Implement `customerCancel(uid, orderId, comment)`: atomic `UPDATE pkg_order SET o_status='Cancelled', cancel_reason=? WHERE id=? AND uid=? AND o_status NOT IN ('Completed','Cancelled')`; check affected rows; if `1` and `rid != 0` (was already assigned) apply `tbl_package.cancellation_charge_customer` as a wallet debit + `tbl_wallet_history` row, call `dispatchManager.stopDispatch(orderId, 'cancelled_by_user')`; if `0`, return `{success:false, msg:'Order cannot be cancelled'}` (covers spec §4.6 lose-the-race case).
- [ ] Implement `rateOrder(uid, orderId, riderId, star, comment)`: `UPDATE pkg_order SET is_rate=1, cust_rate=?, cust_comment=? WHERE id=? AND uid=? AND rid=?`.
- [ ] Run `npm test`.
- [ ] Commit.

## Task 7: Sockets — `socketServer.js`, `orderSocket.js`, `trackingSocket.js`

**Files:**
- Create: `backend/src/sockets/socketServer.js`
- Create: `backend/src/sockets/orderSocket.js`
- Create: `backend/src/sockets/trackingSocket.js`

**Interfaces:**
- Consumes: `tripLifecycle` (Task 6), `dispatchManager.init` (Task 5), `prisma` (rider location debounced writes).
- Produces: `initSocket(httpServer)`, `getIO()` — consumed by `server.js` and `orderController.createOrder` (to call `dispatchManager.startDispatch` after `init` has run).

- [ ] Add `socket.io` to `package.json` dependencies.
- [ ] Implement `socketServer.js`: `initSocket(httpServer)` creates `new Server(httpServer, {cors:{origin:'*'}})`, calls `dispatchManager.init(io)`, on `connection` registers `driver:join` (`socket.join('driver_'+rider_id)`, store `socket.data.riderId`), `customer:join` (`socket.join('customer_'+user_id)`, and `socket.join('order_'+order_id)` if provided), delegates to `registerOrderHandlers(io, socket)` and `registerTrackingHandlers(io, socket)`, module-level `let ioInstance` set on init, `getIO()` throws `Error('Socket.io not initialized')` if called first.
- [ ] Implement `orderSocket.js` `registerOrderHandlers(io, socket)`: `order:accept` → `tripLifecycle.acceptOrder`, on success `io.to('customer_'+order.uid).emit('order:assigned', {...spec §6.3 shape})` and emit `order:dismiss {order_id, reason:'accepted_by_other'}` to the other previously-notified drivers (already handled inside `stopDispatch`, so this handler just acks the calling driver: `socket.emit('order:accept:ack', {success, msg}))`; `order:reject` → `tripLifecycle.rejectOrder`; `order:status_update` → `tripLifecycle.updateStatus`, then `io.to('order_'+order_id).emit('order:status_changed', {...})` or `order:completed` for the complete case.
- [ ] Implement `trackingSocket.js` `registerTrackingHandlers(io, socket)`: `driver:location_ping` → `io.to('order_'+order_id).emit('driver:location_stream', {order_id, lat, lng, heading})` immediately (no DB write on the hot path); maintain a module-level `Map<riderId, lastDbWriteTs>` and fire-and-forget (`.catch(err=>logger.error(...))`, not awaited) a `tbl_rider.update({rlats,rlongs})` at most once every 5s per rider so `dispatchManager`'s nearest-driver query stays reasonably fresh without write-amplifying every ping.
- [ ] Manual verification (no automated test — this is socket wiring): start the server, connect two `socket.io-client` sockets in a scratch script, `driver:join` one and `customer:join` the other, confirm room membership via server-side `io.sockets.adapter.rooms`.
- [ ] Commit.

## Task 8: Controllers + Routes

**Files:**
- Create: `backend/src/controllers/orderController.js`
- Create: `backend/src/controllers/riderController.js`
- Create: `backend/src/routes/orderRoutes.js`
- Create: `backend/src/routes/riderRoutes.js`

**Interfaces:**
- Consumes: `pricingEngine.getFareEstimate`, `tripLifecycle.*`, `dispatchManager.startDispatch`, `sockets/socketServer.getIO` (only for `no_driver_found`-adjacent reads, not emits — emits stay inside services/sockets).
- Produces: Express routers mounted in `app.js`.

- [ ] Implement `orderController.js`:
  - `POST /api/order/fare-estimate` → validate body, call `pricingEngine.getFareEstimate`, return exact response shape from spec §5.1; 400 on missing/non-numeric lat/lng.
  - `POST /api/order/create` → validate body, `prisma.pkg_order.create({...})` filling every NOT-NULL column the spec's request body doesn't supply (`odate: new Date()`, `time_duration: 0` until computed, `radius_range: SEARCH_RADIUS_KM`, `radius_charge: 0`, `package_weight: parseFloat(String(package_weight)) || 0` — the live schema types this column `Float`, so a value like `"5 Kg"` from the spec's sample payload is parsed for its leading number and the unit text is dropped; document this in a code comment since it's a real schema/spec mismatch), compute `distance`/`d_charge`/`total_dcharge` via `pricingEngine` for the FIRST tier in `delivery_type`, then call `dispatchManager.startDispatch(createdOrder)`, respond with spec §5.2 shape (`ResponseCode:"200", Result:"true", order_id, booking_type, ResponseMsg`).
  - `POST /api/order/details` → `prisma.pkg_order.findFirst({where:{id:order_id, uid}})` joined with `tbl_rider` if `rid!=0`, return spec §5.3 shape.
  - `POST /api/order/customer-cancel` → `tripLifecycle.customerCancel`, return spec §5.4 shape or `ResponseCode:"400"` on failure.
  - `POST /api/order/rate` → `tripLifecycle.rateOrder`, return spec §5.5 shape.
  - Every handler wrapped in try/catch logging via `logger.error` and returning `{ResponseCode:"500", Result:"false", ResponseMsg:"Internal server error"}` on unexpected exceptions — never leak stack traces to the client.
- [ ] Implement `riderController.js`: `POST /api/rider/status` (toggle `a_status`), `POST /api/rider/location` (REST fallback for `tbl_rider.rlats/rlongs`, same debounce reasoning as Task 7).
- [ ] Wire both routers in `routes/orderRoutes.js` / `routes/riderRoutes.js` with `express.Router()`.
- [ ] Manual verification: `curl -X POST localhost:5000/api/order/fare-estimate` with the spec's sample body against the live DB, confirm a real `packages` array comes back for an actual `cat_id` present in `pkg_category`.
- [ ] Commit.

## Task 9: Wire `app.js` / `server.js`, boot verification

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/src/server.js`

- [ ] `app.js`: mount `app.use('/api/order', orderRoutes)`, `app.use('/api/rider', riderRoutes)`, add a final Express error-handling middleware `(err,req,res,next)=>{...}` as a safety net beyond per-controller try/catch.
- [ ] `server.js`: replace `app.listen` with `const http = require('http'); const server = http.createServer(app); const { initSocket } = require('./sockets/socketServer'); initSocket(server); server.listen(PORT, ...)`.
- [ ] Run `npm run dev`, confirm boot log shows the port and no unhandled exceptions against the live `DATABASE_URL`.
- [ ] Run `npm test` (full suite from Tasks 1, 3, 4, 5, 6) — all PASS.
- [ ] Commit.

---

## Self-Review Notes

- Spec §4.4 (re-eligibility priority order) is satisfied by `selectEligibleDrivers`'s favorite-first, then-un-notified ordering (Task 5); "previously notified drivers whose timeout has passed" naturally re-enter the pool because `lockManager.isLocked` is false for them again — no separate code path needed.
- Spec §4.7 (fewer than 4 drivers) is satisfied because `LIMIT 4` on a smaller result set just returns fewer rows; `runBatch` loops over whatever count came back.
- Spec §4.8 (app closed / socket dropped) is satisfied by the timer-based expiry in Task 5 being server-authoritative and independent of any client ack.
- FCM push fallback (spec checklist item 8) is deliberately minimal (Task 2's no-op-when-unconfigured) since no credentials exist in this environment — flagged to the user in the final summary, not silently skipped.
