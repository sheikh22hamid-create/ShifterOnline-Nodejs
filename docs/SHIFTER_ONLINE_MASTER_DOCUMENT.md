# Shifter Online — Master Project Document

> **Last verified against code: 2026-10-07 (branch `main`, after commit `9ec5830`).**
> **How it was verified.** The API tables (Part 7), socket events, background jobs, settings keys/defaults, constants, pricing/dispatch/accept/completion/cancellation logic, plan and referral rules, and the repo/admin/app structure were read **directly from the source**. The deeper internals of the newest features — Payment Settlement, Receiver Pays, Receiver Tracking, Free Booking, Booking Guarantee, Daily Driver settlement maths, Trial Mode, Training gate and the Android-side behaviour — are described from their design specs, **cross-checked against the code only for routes, settings keys, constants, table names and file existence**, not by tracing every line. Mobile-app screen lists come from file names, not from running the apps. Nothing was executed against a database.
> Where the code and an older spec disagree, the code wins and the disagreement is listed in [Part 14](#part-14--corrections-to-older-docs).
> Companion files: per-feature design specs and plans live in [docs/superpowers/specs](superpowers/specs) and [docs/superpowers/plans](superpowers/plans); test cases in [docs/testing](testing).

## Contents

1. [Product overview](#part-1--product-overview)
2. [Architecture and repository layout](#part-2--architecture-and-repository-layout)
3. [Core order flow, A to Z](#part-3--core-order-flow-a-to-z)
4. [Pricing, commission and money rules](#part-4--pricing-commission-and-money-rules)
5. [Feature catalogue (every feature, how it works)](#part-5--feature-catalogue)
6. [Plans, rewards and referrals](#part-6--plans-rewards-and-referrals)
7. [REST API reference](#part-7--rest-api-reference)
8. [Socket.io events](#part-8--socketio-events)
9. [Background jobs](#part-9--background-jobs)
10. [Data model](#part-10--data-model)
11. [Admin panel](#part-11--admin-panel)
12. [Mobile apps, website and WhatsApp bot](#part-12--mobile-apps-website-and-whatsapp-bot)
13. [Settings catalogue, environment, deployment state](#part-13--settings-environment-deployment-state)
14. [Corrections to older docs](#part-14--corrections-to-older-docs)
15. [Known gaps and risks](#part-15--known-gaps-and-risks)

---

## Part 1 — Product overview

**Shifter Online** is an on-demand goods-delivery / mini-truck / bike-courier marketplace for India. A **customer** books a vehicle (Bike, Scooter, Mini 3-wheeler, E-Loader, 3-wheeler, 4-wheeler), nearby **drivers** (partners) get a popup, the first to accept wins, the customer tracks the trip live, pays, and rates. A back-office team runs the whole thing from an **admin panel**.

### Who uses what

| Actor | Surface | What they do |
|---|---|---|
| Customer (the *booker*) | Flutter app `ShifterOnline/` (package `com.shifter.online`, v1.0.20+20) | Book, track, pay, wallet, plans, referrals |
| Receiver (drop contact) | No app. WhatsApp messages + two public web pages `/track/<token>` and `/pay/<token>` | Follow the delivery live, optionally pay, rate |
| Driver (partner) | Native Android app `ShifterDriver/` (package `com.shifter.driver`, v1.0.25) | Go online, accept orders, run the trip, collect cash, wallet, plans, KYC |
| Staff | React admin panel `frontend/` | Operate: orders, drivers, KYC, pricing, plans, settlements, CMS |
| Anyone | Marketing website `Website code Shifter online/Shifter-Online-Website` | Landing page, sign-up leads |
| Anyone on WhatsApp | AI WhatsApp bot (in the backend process) | Support, fare info, tracking, wallet, driver onboarding |

### Vehicle categories and "Models"

- A **category** (`pkg_category`) is a vehicle type (Bike, Scooter, Mini 3W, E-Loader, 3 Wheeler, 4 Wheeler …).
- Each category has several **packages** (`tbl_package`), shown to customers as **Models** ordered by `sort_order`. They are the price tiers: **Model 1 (cheapest, "Super Saver") … Model 5 (highest)**. Package ids 6, 7, 21, 33, 34 are Models 1–5 for Bike; other categories have their own ids.
- Default customer-facing names (`user_title`): Model 1 *Super Saver*, Model 2 *Saver Plus*, Model 3 *Comfort*, Model 4 *Express*, Model 5 *Priority*. Default driver-facing names (`driver_title`): *Standard Tier*, *Silver Tier*, *Prime Tier*, *Gold Beast*, *Earning Beast*. Both are editable per package in Rate Cards.
- A driver switches Models on/off in their app (`tbl_rider_delivery_type`). A customer picks which Models they accept for an order (stored as `pkg_order.allowed_delivery_types`).
- **No Model number is hard-coded in core logic** (rule from the Booking Guarantee spec): a new Model 6/7 in `tbl_package` works with no code change. The one exception is `MODEL_1_PACKAGE_ID = 6` used for the Model 1 reliability suspension.

### Booking types

| `booking_type` | Name | Behaviour |
|---|---|---|
| 1 | Instant | Dispatched immediately |
| 2 | Scheduled | Customer picks a date/time (min lead time admin-set, default 45 min, up to 7 days). Drivers can mark interest; goes live at the scheduled time |
| 3 | Next Day | Priced at Model 1 only, never auto-dispatched; admin assigns drivers manually next day, optionally as a route-sequenced batch |

---

## Part 2 — Architecture and repository layout

```
Shifter Online/
├── backend/                  Node.js + Express 5 + Prisma 6 (MySQL) + Socket.io + WhatsApp bot
│   ├── src/{app.js,server.js}
│   ├── src/controllers/      79 controllers (REST handlers)
│   ├── src/services/         69 services (business logic: pricing, dispatch, lifecycle, plans, settlement…)
│   ├── src/routes/           user.routes, orderRoutes, riderRoutes, adminRoutes, whatsappRoutes, locationRoutes, receiverPayRoutes, trackRoutes
│   ├── src/sockets/          socketServer, orderSocket, trackingSocket, adminSocket
│   ├── src/whatsapp/         client.js (Baileys), groq/gemini AI, handlers/{customer,driver}Handler, notifications.js
│   ├── src/middleware/       auth (admin JWT), authorize, scopeFilter, appKeyAuth, rateLimiter, ipRateLimiter
│   ├── prisma/               schema.prisma (108 models) + migrations/
│   ├── sql/                  hand-applied SQL (schema drift catch-ups)
│   ├── scripts/              seed/test/simulation scripts
│   └── data/bot_knowledge.txt  WhatsApp bot knowledge file (admin-editable)
├── frontend/                 React + Vite admin panel (≈51 pages)
├── ShifterOnline/            Flutter customer app (gitignored — `git add -f` exact files only)
├── ShifterDriver/            Native Android (Java) driver app (gitignored — same rule)
├── Website code Shifter online/Shifter-Online-Website/   React+TS+Vite marketing site + its own small Express/MongoDB server
├── docs/                     this document, specs, plans, test cases
├── apk-builds/, release_apks/   built binaries
└── graphify-out/             auto-generated code knowledge graph (dated 2026-08-31, stale)
```

### Tech stack

| Layer | Tech |
|---|---|
| Backend | Node ≥ 18, Express 5, Prisma 6 + MySQL, Socket.io 4, JWT (admin), bcryptjs (admin passwords), multer + Cloudinary (uploads), firebase-admin (FCM push), Razorpay (payments), 2Factor.in (OTP SMS), Google Maps APIs (distance, ETA, routes, geocode), Baileys (WhatsApp Web), Groq + Gemini (bot AI), mupdf (Aadhaar PDF verification), Jest (tests) |
| Admin panel | React, Vite, lucide-react, role-based navigation |
| Customer app | Flutter, `get`, `socket_io_client`, `razorpay_flutter`, Firebase (FCM + Firestore), OneSignal, Google Maps |
| Driver app | Native Android/Java, Retrofit (`NodeApiClient`), `NodeSocketManager`, foreground `LocationUpdateService`, `OrderOverlayService` (full-screen popup), ExoPlayer (training video) |
| Public pages | Server-rendered inline HTML from the backend (`/pay/:token`, `/track/:token`), Leaflet + MapTiler tiles for the map |

### How the pieces talk

- **Apps → backend directly** over REST and Socket.io. There is **no PHP layer any more**: a "PHP↔Node bridge" was designed (2026-09-01) and later removed; both apps call Node. Some legacy paths (old buy-anything order history, legacy image folders) still exist for backwards compatibility (see `/api/order/legacy/*`, `LEGACY_IMAGES_DIR`).
- **Base URLs:** customer app `https://dev-api.shifteronline.com` (`ShifterOnline/lib/Api/config.dart`); driver app uses `BuildConfig.API_BASE_URL` — `https://dev-api.shifteronline.com/` for the dev flavour and `productionApiBaseUrl` (default `https://srv1984796.hstgr.cloud/`) for production. Backend is hosted on a Hostinger VPS via CloudPanel + PM2 (`~/deploy.sh` = `git pull` + `npm ci` + `prisma generate` + PM2 restart). Older comments mention Render; that was the previous host.
- **Real-time:** dispatch popups, trip status, live driver location and admin alerts use Socket.io rooms (`customer_<uid>`, `driver_<rider_id>`, `order_<order_id>`, `admins_all`, `admin_super`, `admin_city_<id>`). FCM push is the fallback when a socket is not connected.
- **Auth model today:** the admin panel uses JWT (`/api/v1/admin/auth/login`, roles `superadmin | admin | executive`, `admin`/`executive` hard-scoped to their `city_id` by `scopeFilter`). **Customer and driver REST/socket calls trust the `uid` / `rider_id` they send — there is no per-user session token.** This is a known, deliberately deferred gap (see Part 15). Customer/driver *login* does exist in Node (OTP via 2Factor.in), contrary to what older docs say.
- **Uploads:** all files live in Cloudinary; the DB stores relative paths like `images/vehicle/x.jpg` and `/images/*` redirects to Cloudinary (`utils/cloudinaryStorage.js`).

### Roles in the admin panel

| Role | Scope | Typical rights |
|---|---|---|
| `superadmin` | All cities (optional `?city_id=` filter) | Everything incl. Settings, staff, bot file, WhatsApp account |
| `admin` ("City Admin") | Own city only | Manage riders, orders, plans, free-booking in own city |
| `executive` | Own city only | Mostly read + day-to-day ops |

`authorize(...)` gates each route; `scopeFilter` injects `req.scopedCityId`.

---

## Part 3 — Core order flow, A to Z

### 3.0 Status codes

| `order_status` | `o_status` | Meaning |
|---|---|---|
| 0 | `Pending` | Created, no driver yet (`rid = 0`) |
| 1 | `Processing` | Driver accepted, heading to pickup |
| 2 | `Pickup` | Driver arrived at pickup, waiting for the customer's OTP |
| 3 | `On Route` | Goods picked up, going to drop (driver-side `driver_flow_id = 4` once drop arrival is recorded) |
| 5 | `Completed` | Delivered |
| 4 | `Cancelled` | Cancelled by anyone |

### 3.1 Booking (customer app → `POST /api/order/create`)

1. **Pick locations** — pickup + drop (+ up to *N* extra stops, admin setting `max_extra_stops`, default 2). Address search via `/api/location/search`.
2. **Pick category** — `GET /api/order/categories`; per-vehicle detail screen (dimensions, max load, notes) comes from `availableVehicles`.
3. **Fare estimate** — `POST /api/order/fare-estimate` (and `/api/order/packagelist`) returns every Model's price for the route; `POST /api/order/available-vehicles` shows which vehicles have drivers nearby.
4. **Choose Models** (which tiers to try), booking type, search radius, optional goods type, optional "Receiver pays", optional coupon / referral points, payment method (cash, wallet, online), optional "Free booking".
5. **Create** — `createOrderCore` validates, then:
   - blocks if the customer has a *pending/owed* settlement (`SETTLEMENT_PENDING`),
   - validates receiver-pay and goods type, enforces stop limit,
   - computes distance server-side when there are stops (client distance is ignored then), otherwise trusts a positive client distance (see Part 15),
   - prices the first (cheapest) selected Model, applies customer-plan discount, coupon, referral-point discount,
   - stores stops in `pkg_order_stops`, goods type snapshot, receiver-pay row, free-booking row,
   - for wallet-paid orders debits the wallet immediately,
   - **`booking_type` 1** → `dispatchManager.startDispatch`; **2** → waits for its go-live time; **3** → never dispatched,
   - notifies the admin dashboard live (`admin:new_order`).
6. **Photos** — `POST /api/order/upload-photo`.

### 3.2 Dispatch (instant orders) — `services/dispatchManager.js`

The engine is a **tier-exhaustion cascade** (one pass only):

- The order's selected Models are sorted by `sort_order` into *tiers*. Every "turn" queries **exactly one tier** (the cursor), starting with the cheapest. A turn locks up to 4 eligible drivers and sends them popups. The cursor moves to the **next tier only when the current tier has no more eligible drivers** beyond this batch (or none could be locked); otherwise the same tier keeps serving the next batch as popups expire and drivers free up. Turns are spaced `BATCH_GAP_MS` apart. When the cursor would wrap to tier 1 a second time the cascade stops making offers — **each driver/tier gets one chance per order**.
- **Eligible drivers** for a tier (single raw-SQL query, `selectEligibleDrivers`): online (`a_status=1`), active (`status=1`), vehicle = order category, body type matches (open/covered/half or "any"; bikes always match), that Model enabled for the driver, fresh GPS (`rloc_updated_at` within 2 min), not in this order's reject list, **not blocked by this customer**, **not already on an unfinished order**, no settlement pending past the grace window (customer-payer only), wallet not below `-driver_max_due_limit`, not Model-1-suspended (for Model 1), Monthly drivers only get Model 1 while on duty with an empty queue, and within `radius_range` km (default 10) of the pickup.
- **Ranking:** drivers with an active *priority* plan first, then the customer's **favourite drivers**, then nearest. If Favorite Routes is on for the city, drivers whose saved routes match the trip are matched/boosted.
- Up to **4 drivers per batch** (`MAX_DRIVERS_PER_BATCH`). Each gets a **15 s popup** (`POPUP_TIMEOUT_MS`) over the socket (`order:request`) plus FCM. `BATCH_GAP_MS = 3 s` is the spacing between turns (tuned so it lands ~5 s apart in the real world given DB/push latency). A driver can hold only one popup at a time (`lockManager`), and a driver already holding a popup for *this* order in another tier blocks cursor advance until it resolves. When a popup expires, the driver's request row becomes `timeout`, they are released, and the next batch runs immediately.
- The popup shows the **per-driver price** (priced for that driver's real distance to the pickup — see radius charge), customer rating, stops, goods type.
- Small contended-pool top-ups: up to `MAX_TOPUP_ROUNDS = 2` extra selection rounds.
- **Accept** (`order:accept`): one transaction marks the driver's request `accepted` *only if still `sent` and not expired*, then sets `rid`, `order_status=1`, `o_status='Processing'` on the order *only if unassigned and not cancelled*. First writer wins; everyone else gets "Order already taken or cancelled" and an `order:dismiss`.
- **Reject** (`order:reject`) / timeout: request marked, driver unlocked; Model 1 misses are counted (see Model 1 suspension).
- **No driver found:** when every tier is exhausted, the **Free Booking** fallback runs first (re-dispatch to everyone), then the **Booking Guarantee** holds the order for an admin window instead of cancelling (Part 5.5). Without a guarantee case the order is cancelled, prepaid fare and referral points refunded, customer gets `order:no_driver_found`.
- **Restart safety:** on boot `reconcileStaleOffersOnStartup` cleans orphaned offers (orders older than 120 s, skipping orders held by a guarantee case).

### 3.3 After accept (`finalizeAcceptedOrder`)

- Re-prices the order for the **accepting driver's real distance** to pickup (`d_charge`, `total_dcharge`, `driver_earning` = gross fare, `commission` %), copies the accepted package's waiting charge/free-wait onto the order.
- Reconciles referral-point discount if the fare came out lower.
- Stops the rest of the cascade and dismisses other popups; closes any Booking Guarantee case.
- **Advance payment** = `cancellation_charge_customer` of the accepted package + radius charge. Customer must pay within **2 minutes** (`ADVANCE_PAYMENT_TIMEOUT_MS`, admin-overridable via `advance_payment_timeout_minutes`) or the order auto-cancels (sweep every 5 s). Waived (advance = 0) when the customer has a plan with `no_advance_payment`, or the order was wallet-paid. If the customer's **wallet covers it, it is auto-debited** with no payment screen (feature `walletAdvanceService`), and every cancel path refunds it.
- Pickup **ETA**: Google driving ETA + 10-minute buffer (`pickup_eta_buffer_minutes`) is shown to the customer. If the driver is later than that and not at the pickup, the customer may cancel **free** — no penalty for either side. (Auto-cancel by ETA was removed.)
- Customer gets `order:assigned` with driver details, vehicle number, OTP; scheduled orders accepted close to the pickup time get an extra "may run late" push.

### 3.4 Trip (`driverTripService.progressTrip`, `POST /api/order/trip-progress`)

Actions: `sync`, `arrived`, `pickup`, `arrived_stop_N`, `complete_stop_N`, `arrived_drop` (plus legacy `verify_otp`). Everything is row-locked and idempotent.

| Step | Trigger | Effect |
|---|---|---|
| Arrive at pickup | **Automatic**: ≥ 3 readings over ≥ 25 s, gaps ≤ 20 s, accuracy ≤ 35 m, speed ≤ 2.5 m/s, distance+accuracy ≤ 100 m (`tripArrivalPolicy`). Manual fallback exists. | `order_status=2`, pickup wait timer starts, `first_arrival_at` set once, customer notified (push + WhatsApp) |
| Customer OTP | Driver types the 4-digit OTP the customer reads out | OTP verified; **billable loading wait** starts (OTP → "Pickup Complete"); mismatch flag if verified > 500 m from the confirmed pickup point (informational only) |
| Pickup complete | Auto-complete within `pickup_complete_auto_distance_m` or manual button | `order_status=3` (On Route) |
| Stops | Automatic arrival per stop, manual "complete stop" | Stop timers do **not** add billing |
| Arrive at drop | Automatic, or manual | Drop wait timer starts. New app builds *require* recorded drop arrival before completion |
| Complete | Driver confirms handover/payment | See 3.6 |

- **OTP timeout:** if the customer doesn't give the OTP within `pickup_otp_timeout_minutes` (default 7) after arrival, the sweep auto-cancels the order (customer no-show). A hard ceiling `pickup_relocate_ceiling_minutes` (default 35) from first arrival force-resolves it regardless of pauses. The driver can be compensated a fixed `pickup_timeout_driver_compensation` (default 0) when this happens.
- **Timer auto-pause** if the driver leaves the pickup (`pickup_timer_auto_pause_distance_m`).
- **Live tracking:** driver app pings `driver:location_ping` (~every 3–5 s); the server fans it out to `order_<id>` as `driver:location_stream`, keeps an in-memory copy for the public tracking page, and throttles DB writes to once per 5 s.
- Driver gets local notifications; customer gets a live banner + push (transactional outbox with retry, flushed every 15 s).

### 3.5 Changes after booking (customer app)

| Change | Endpoints | Rules |
|---|---|---|
| Change **drop** | `/destination-change/preview`, `/destination-change/confirm` | Re-prices route; allowed until drop; fare recomputed |
| Change **pickup** | `/pickup-change/preview`, `/pickup-change/confirm` | Mirrors drop change. If done while the driver is already waiting (status 2): a **small move** (≤ `pickup_small_move_threshold_m`, default 200 m) keeps the OTP timer running; a **large move** banks the elapsed wait, reverts to status 1 and the driver must re-arrive. |
| **Add a stop** | `/stops/preview`, `/stops/confirm` | Extra stop after booking (limit and per-stop charge from admin settings); repriced |
| Change receiver number | `settlement/receiver-phone` (+ admin order edit) | Rotates the tracking/pay link to the new number |
| Early drop | Driver-side at completion | If the driver completes ≥ 300 m from the booked drop, the driver must confirm "early drop"; the trip ends at the driver's GPS point and the fare is recomputed for the distance actually travelled |

### 3.6 Completion, commission and settlement (`tripLifecycle.updateStatus('complete')`)

1. **Waiting charge** = (loading wait + drop wait − free wait minutes × 60) / 60 × waiting rate. `finalTotal = total_dcharge + waitingCharge`.
2. **Commission** = package commission %, or the driver's best premium-plan benefit (lowest deduction wins; plan benefits never stack).
3. **Prepaid** = advance actually captured + referral-point discount + coupon (capped at the fare). Advance is the customer's own money, points/coupon are absorbed by the platform.
4. For a **cash** order from a regular driver, with settlement **enabled**: *no wallet movement yet* — a settlement row is created (Part 5.1). With settlement **disabled** (or Monthly/Daily driver, or creation failed): legacy behaviour — driver wallet debited `commission + per-trip charge − prepaid`, or credited the unused advance; customer advance debited from their wallet (`advance_apply`).
5. Non-cash orders: driver wallet credited the net earning.
6. Side effects: Monthly Driver `CASH_COLLECTED` ledger row, Daily Driver exemption, trial-order counter, plan ride counters/incentives, referral reward on first completed order, ride milestones/amount rewards, free-booking credit hook, invoice, rating prompt, WhatsApp "delivered" message to sender and receiver.

### 3.7 Cancellation

| Who / when | Result |
|---|---|
| Customer, before any driver | Free; wallet-paid fare and referral points refunded |
| Customer, after a driver is assigned | Package `cancellation_charge_customer` applies, **unless**: advance unpaid/timeout, driver missed the pickup ETA, or the customer's plan has free cancellations left (`cancellation_enabled`, `free_cancellations`, window). Driver may get compensation (`cancellation_charge_driver` / compensation split) |
| Driver | `driverCancel` (transaction, row-locked, idempotent); advance refunded; driver may be charged `cancellation_charge_driver`; counts as a Model 1 miss when relevant |
| Auto: OTP no-show, advance not paid, relocation ceiling, guarantee expiry | Run by background sweeps |
| Admin | `POST /orders/:id/cancel`; closes any guarantee case |

---

## Part 4 — Pricing, commission and money rules

### 4.1 Fare formula (`services/pricingEngine.js`, `slabPricingService.js`)

Two modes per package (`tbl_package.use_linear_pricing`):

1. **Slab pricing (default for every real vehicle category).** A per-vehicle table of ₹/km by distance band: 0–1, 1–5, 5–10, 10–15, 15–20, 20–25, 25–30, 30–40, 40–50, 50–60, 60+ km, plus a minimum charge. `calculateBaseSlabFare` walks the bands. Defaults in code (admin can override via the Rate Cards → Slab pricing screen, stored in `app_settings.pricing_slab_rates`):

   | Vehicle (category id) | Min charge ₹ | 0–1 | 1–5 | 5–10 | 10–15 | 15–20 | 20–25 | 25–30 | 30+ |
   |---|---|---|---|---|---|---|---|---|---|
   | Bike (8) | 42 | 1.0 | 4.0 | 9.4 | 7.2 | 7.4 | 11.2 | 8.8 | 14.1 |
   | Scooter (16) | 48 | 2.0 | 4.5 | 10.8 | 8.2 | 8.6 | 12.8 | 10.2 | 16.3–16.4 |
   | Mini 3W (9) | 103 | 5.0 | 8.5 | 18.6 | 13.4 | 12.4 | 20.8 | 16.4 | 18.8 |
   | E-Loader (23) | 143 | 8.0 | 10.75 | 20.0 | 12.6 | 12.2 | 20.4 | 15.8 | 18.3 |
   | 3 Wheeler (24) | 195 | 10.0 | 21.5 | 23.6 | 18.2 | 15.4 | 25.2 | 19.8 | 22.8–22.9 |
   | Tata Ace / 4W | see `DEFAULT_SLAB_RATES.four_wheeler` (30–50 km ≈ ₹36.5–36.7/km) | | | | | | | | |

   The base fare is multiplied by the **anchor markup** (default +10%, anchored on Model 3) and by a **Model offset**: Model 1 −10 %, Model 2 −5 %, Model 3 0, Model 4 +10 %, Model 5 +20 % (`DEFAULT_MODEL_MULTIPLIERS`, editable as `pricing_model_multipliers`). Rate-card "Generate models / sync" tools create the tier rows from these slabs.

2. **Linear pricing:** `min_charge + per_km_charge × distance`.

Then, in both modes:

```
d_charge        = base fare  +  radius charge
service charge  = d_charge × service_charge_percent / 100
night charge    = night_charge_percent  (flat ₹, added only inside the package's night window, IST)
total           = d_charge + service + night + extra_mile_charge (incl. extra-stop charges) + body-type charge
result          = rounded to whole rupees
```

- **Radius (pickup-distance) charge:** the first 1 km of the *driver's real distance to the pickup* is free; beyond that `(km − 1) × pickup_per_km_charge` (falls back to `per_km_charge`, then ₹4/km). It bills each driver's **actual** distance, never the customer's chosen search radius.
- **Body-type charge:** covered body `covered_body_charge`, half body `half_body_charge` (admin settings) added for those vehicles.
- **Extra stops:** `stops × extra_stop_charge`, carried in `extra_mile_charge` so accept-time re-pricing keeps it.
- **Customer plan discount:** `discount_percent` of the base fare, capped at `discount_max_cap`.
- **Distance** comes from Google road distance with a haversine fallback (× 1.3 fudge in the fallback); multi-stop distance sums every leg.

### 4.2 Driver earning

`calculateDriverEarning`: if `driver_per_trip` (flat) is meaningful (≥ min charge or ≥ 40 % of fare) use it; else a percentage split from `driver_per_percent` (≤ 50 ⇒ treated as *admin commission %*, > 50 ⇒ *driver share %*, empty ⇒ 90 % driver share). The driver popup shows the **gross fare**; commission is clawed back at completion/settlement.

### 4.3 Wallet rules

- **Customer wallet (`tbl_user.wallet`) is spend-only.** Top-up via Razorpay (cap `customer_wallet_max_topup`, default ₹50,000); `POST /wallet/withdraw` for a customer is rejected ("can only be used for rides"). Credits arise from: top-ups, refunds, receiver-pay commission/advance refunds, free-booking credit, no-driver compensation, admin adjustment, plan wallet bonus.
- **Driver wallet (`tbl_rider.wallet_balance`)**: no self top-up. Earns net earnings; pays commission; can **withdraw** a positive balance immediately (`min withdrawal` setting `driver_min_withdrawal_amount`; atomic debit). A **negative balance = outstanding dues**: driver can still receive rides until `-driver_max_due_limit` (default ₹100), and clears dues by exact-amount Razorpay (`/wallet/clear-due/*`) or with referral points. The old admin-approved withdrawal flow (`driver_withdraw_requests`, `/rider/payout/withdraw-request`) is deprecated but still wired.
- **Idempotency:** every wallet movement writes `tbl_wallet_history` with a unique `payment_id` key (e.g. `commission_debit:<orderId>`, `settle_<orderId>_<effect>`, `receiver_markup_credit:<orderId>`, `free_booking_credit:<orderId>`), so retries never double-credit.
- All amounts are whole rupees for fares; wallet amounts keep 2 decimals.

---

## Part 5 — Feature catalogue

Status legend: **Live** = built and in `main`; **Dark** = built but off by default behind an admin switch; **Pending** = needs a DB migration / config before it works in an environment.

### 5.1 Payment Settlement  *(Dark — `settlement_enabled`)*

**Why:** an order used to become `Completed` and the commission was clawed back immediately, assuming the driver really received the cash. Now the money step is explicit.

**How it works**
1. Driver completes the drop → for a **cash order from a regular driver** with `amount_due > 0` a row in `order_settlement` is created, status `pending`. (Monthly/Daily drivers, non-cash orders, and orders fully covered by advance/points/coupon get no settlement.)
2. Customer app opens a **Payment sheet**: *Pay driver directly (cash/UPI)* or *Pay online (Razorpay)*. Driver app opens a **Trip Payment screen** with a big "Collect ₹X" and **Received ₹X**.
3. Outcomes: `cash_received` (driver tapped Received) → `wallet_effect = cash` (driver wallet debited commission − prepaid, exactly as the legacy flow); `paid_online` (Razorpay signature **and** amount verified) → `wallet_effect = online` (driver credited `fare − commission − per-trip charge`); `disputed` (either side raises a problem; blocks both actions until an admin resolves).
4. Admin resolves: `cash_received | paid_online | waived | customer_owes` with a mandatory note. Changing outcome **reverses** the previously applied effect with its own unique keys, then applies the new one.
5. Every transition runs in one DB transaction with `SELECT … FOR UPDATE`; every change is appended to `order_settlement_event`; `settlement:updated` is pushed over the socket to both sides.
6. **Reminders / escalation sweep (every 60 s):** reminders to both at `settlement_reminder_minutes` (default 10,30), flagged "Unsettled" at `settlement_escalate_after_minutes` (60), and the driver is **skipped by dispatch** after `settlement_driver_block_grace_minutes` (10) of pending (not for receiver-mode settlements, not while disputed).
7. A customer with a `pending` or `customer_owes` settlement **cannot book** (`SETTLEMENT_PENDING`); `disputed` does not block.
8. After the driver confirms, the customer can dispute for `settlement_dispute_window_hours` (48).

**APIs:** customer `/api/order/settlement/{state,choose-driver,pay-online/create,pay-online/verify,dispute,take-over,resend-link,receiver-phone}`; driver `/api/rider/settlement/{state,received,dispute,pending,receiver-refused,resend-link}`; admin `/api/v1/admin/settlements{,/:id,/:id/resolve,/:id/convert-to-customer}`. Settings are plain `app_settings` keys edited on the admin Settings page.
**Rollout rule:** enable only after the new customer and driver builds that contain the screens are out.

### 5.2 Receiver Pays + booker commission  *(Dark — `receiver_pay_enabled`, requires settlement on)*

- At booking (cash orders only, valid 10-digit drop number) the booker can tick **Receiver pays** and choose a **commission %** (0 … `receiver_commission_max_percent`, default 5; optional ₹ cap `receiver_commission_max_amount`).
- Booker still pays the **advance** at accept — in receiver mode it is a **refundable deposit** that is *not* netted off the fare.
- At completion a receiver-mode settlement is created (`payer = receiver`, `amount_due = fare − coupon − points`, `receiver_markup = round(amount × pct)`), a 32-byte token is minted (only its SHA-256 is stored, TTL `receiver_pay_link_ttl_hours` = 24) and the receiver gets a **WhatsApp link** `…/pay/<token>`.
- The public **pay page** (`GET /pay/:token`, server-rendered, Razorpay Checkout) shows the breakup (fare + service fee + commission). `POST /api/pay/:token/{order,verify,decline}`; IP + token rate limited.
- When the receiver pays online, or the driver confirms cash: driver wallet effect applies as normal, and the **booker's wallet gets the advance refund + the commission** (`receiver_advance_refund:<id>`, `receiver_markup_credit:<id>`). Cash commission: the driver collects `amount_due + markup` and is debited the markup, so the platform stays neutral.
- Decline (receiver on the page, driver "Receiver refused", booker "I'll pay myself"): converts to normal customer mode; markup 0; advance is applied to the fare.
- Reversals never push a booker wallet negative; any shortfall is stored in `reversal_shortfall` for admin.
- **Customer wallet is spend-only**, so the commission can only be spent on rides. GST classification of the commission is a **launch-checklist item for the CA** before enabling in production.

### 5.3 Receiver Live Tracking  *(Live; `receiver_tracking_enabled` default on)*

- Every order with a drop contact number gets a **public tracking page** `GET /track/<token>` (no app, no login), linked in WhatsApp messages (driver assigned, reached pickup, trip started, reached drop). Table `order_track_link`; token is stored plain (it must be resendable), expiry is derived: `expired` 24 h after completion, `cancelled` immediately on cancel, `invalid` if the order's `dmobile` changed.
- Page polls `GET /api/track/:token` every 5 s: 5-step timeline, driver card (first name, vehicle no., call button), ETA + distance (only on the way), Leaflet map with route and animated, heading-rotated driver marker (MapTiler tiles; page still works without the map), stale-GPS greying after 2 min.
- **Privacy is enforced in the snapshot builder:** never the OTP, booker name/phone, fare or payment data; live position and route appear **only at status 3**; addresses cut to 80 chars; `no-store`/`noindex` headers.
- ETA/route via Google (cached 60 s, recomputed only if the driver moved > 150 m), with straight-line fallback. Live positions come from an in-memory map fed by `driver:location_ping`.
- **Delivered experience:** light app-orange theme; trip summary, the **actual GPS route driven**, a **Pay now** card for receiver-pays orders (`POST /api/track/:token/pay-link` hands over to the `/pay` page), a **review form** (`POST /api/track/:token/review`, 1–5 stars for driver and delivery, whitelisted tags, 500-char comment, one per order → table `order_receiver_feedback`), help buttons (call / WhatsApp), and an app-download button.
- Admin: Trip Feedback page has Driver / Customer / **Receiver** tabs.

### 5.4 Free Booking Offer  *(Dark until a city is enabled — no row ⇒ OFF)*

A **premium customer** gets a **wallet credit equal to the full invoice** of one trip served by an **offer-pool vehicle**; after one credit the benefit **locks** until the customer brings one successful referral.
- **Eligibility** (re-checked server-side at create; 409 `free_booking_unavailable` if it no longer holds): active customer premium plan; not locked; no other open free booking; city enabled and inside the start/end window; at least one pool driver in range with the right vehicle type; booking type = instant.
- **Check endpoints:** `POST /api/order/free-booking/check` → `eligible | no_free_vehicle | locked | not_premium | offer_off`; `POST /api/order/free-booking/status`. `no_free_vehicle` shows a popup (paid vehicle, **no refund**) — the customer may continue as a normal booking.
- **Dispatch:** a confirmed free booking is offered **only to pool drivers** (`free_booking_pool`, valid-date ranges). If the pool yields nobody, the row becomes `NOT_ELIGIBLE (pool_unavailable)`, the customer is told, and dispatch re-runs for everyone.
- **Credit:** `freeBookingService.onOrderSettled/markCompleted` — in one transaction (user row locked) credits the final invoice total (key `free_booking_credit:<orderId>`), marks `REWARD_CREDITED`, and **locks** the user. Fails (no credit, no lock) if cancelled, vehicle changed, pool driver didn't do the trip, or payment failed.
- **Unlock:** automatically when one of the user's referrals turns `completed` (`referralRewardService` → `unlockForReferral`); admin can lock/unlock manually. Setting `referrals_required` per city.
- **Admin page "Free Booking Offer":** Settings (per-city ON/OFF + timeline), Offer Pool (add/remove riders + dates), Bookings & Users (audit, lock/unlock, void order).
- **Pending:** migration `20261006030000_add_free_booking_offer` and `20261007010000_free_booking_referrals_required` — per project notes not applied on any DB yet; verify with `prisma migrate status`.

### 5.5 Booking Guarantee  *(Live code; Pending migration `20261007020000_add_booking_guarantee`)*

If **every Model the customer turned on finds no driver**, instead of cancelling instantly the order is **held for an admin window** (default 10 min, setting `booking_guarantee_assign_minutes`):
1. Exhausted cascade (after the free-booking fallback) → `booking_guarantee_case` opens (UNIQUE per order), freezing the selected Models, the **compensation** (the `tbl_package.no_driver_compensation` of the **highest `sort_order`** Model the customer selected) and `deadline_at`.
2. Customer gets `order:guarantee_pending`; admins get a high-priority banner "BOOKING GUARANTEE – MANUAL DRIVER ASSIGNMENT REQUIRED" and an orders-list badge with a live countdown.
3. **Admin assigns a driver in time** → case `resolved_assigned`, ₹0 paid. **Customer/admin cancels** → `cancelled`, ₹0.
4. **Deadline passes** (sweeper every 15 s, also at boot) → one transaction: case → `expired_compensated`, order cancelled, prepaid fare + referral points refunded, **compensation credited to the customer wallet** (once), audit rows; then `order:no_driver_found` with `compensation_amount`.
- `POST /api/order/guarantee-quote` shows "If no driver is found you get ₹X" on the booking screen; order details carry `guarantee {state: none|pending|paid|not_paid, amount, deadline_at}`.
- Admin: Rate Cards field "No Driver Found Compensation (₹)", **Booking Guarantee** page (assignment-time setting + case history with audit trail).
- **After deploy:** run the migration on prod, then set each package's compensation (intent: lowest Model ₹0, then ₹100 / ₹500 / ₹1000 / ₹2000 by `sort_order`) and the assignment time.

### 5.6 Scheduled Orders (`booking_type = 2`) with driver priority  *(Live)*

- Customer picks date/time in the app (lead time `scheduled_min_advance_minutes`, default 45 min; up to 7 days). Customer gets a **confirm popup** `scheduled_confirm_popup_minutes` (default 30) before pickup (`order:schedule_confirm`, `/api/order/schedule-confirm[s]`); `GET /api/order/scheduled-settings` exposes the limits to the app.
- Drivers see **Scheduled Trips** (`POST /api/rider/scheduled-trips`), can mark/unmark **interest** (`/interest`, `/interest/remove`) — table `pkg_order_interest`.
- **Go-live** is exactly the scheduled time (`SCHEDULED_ORDER_GO_LIVE_LEAD_MS = 0`; the old 30-minute advance dispatch was removed). If anyone marked interest they get a **priority offer** — sent as a normal `order:request` event whose payload carries `schedule_date_time` so the driver app can show the real pickup time — with a **2-minute exclusive window** (the popup itself stays 60 s; no per-driver lock); otherwise/after that the normal radius cascade runs. First accept wins via the same atomic claim.
- Customer pushes: "order is live", "driver assigned", extra "may arrive a few minutes late" if accepted < 10 min before pickup.
- Admin: **Scheduled Orders** page (with "N interested" column) + manual pre-assign modal as a safety net.

### 5.7 Next Day Booking (`booking_type = 3`)  *(Live)*

Priced at **Model 1 only**, no radius charge, **never auto-dispatched**; `schedule_date_time` is set server-side to tomorrow. Admin (**Next Day Orders** page) multi-selects orders, picks a driver, hits **Suggest Sequence** (greedy nearest-neighbour: next pickup nearest to the previous drop, haversine only), can reorder, then **Assign All** (`next_day_sequence`). The driver gets one forced notification + `order:next_day_assigned` (no accept/reject) and sees the orders in sequence.

### 5.8 Add Stop / multi-stop  *(Live)*

Up to `max_extra_stops` (default 2) extra drops. Stops live in `pkg_order_stops` (no change to `pkg_order`). Distance is the sum of road legs, **always computed server-side** for multi-stop orders; fare adds `extra_stop_charge` per stop through `extra_mile_charge`. Driver app lists the stops and records arrival/completion per stop; admin order drawer shows them. **Stops can also be added after booking** (preview/confirm endpoints), plus drop/pickup changes — see 3.5.

### 5.9 Pickup relocation + OTP timeout  *(Live)*
See 3.4/3.5. Admin settings: `pickup_otp_timeout_minutes` (7), `pickup_relocate_ceiling_minutes` (35), `pickup_small_move_threshold_m` (200), `pickup_otp_mismatch_flag_m` (500), `pickup_timeout_driver_compensation` (0), `pickup_complete_auto_distance_m`, `pickup_timer_auto_pause_distance_m`, `pickup_eta_buffer_minutes`, `pickup_eta_geofence_m`.

### 5.10 Goods type, restricted items, booking guidelines  *(Live)*
- **Goods types** (`tbl_goods_type`, admin CRUD): customer optionally picks one (or "Other" free text ≤ 100 chars); stored as id + name snapshot + other text on the order; drivers see `Goods: …`. Soft-delete when in use.
- **Restricted items** and **Booking guidelines**: admin-managed lists shown to customers (`/api/order/restricted-items`, `/api/order/booking-guidelines`).

### 5.11 Driver onboarding, KYC and approval  *(Live)*
- Registration: mobile check → OTP (2Factor.in) → register; KYC document uploads (`/api/rider/kyc/*`: address, licence, residence, bank, vehicle detail), government verification endpoints (DL with captcha, RC, Aadhaar PDF, with Aadhaar name check via `aadharPdfVerify`), optional PUC/Bima images, emergency contact, rider kit, one-time **verification payment** (Razorpay).
- **Auto-approval rule** (`driverApproval.js`): approved only when documents are verified (Aadhaar + residence + licence; for bicycles residence + Aadhaar/PAN; **PAN optional**) **and** `payment_complete = 1`; approval sets `a_status=1`, `status=1` and assigns the default delivery types. Admin can approve/reject manually (KYC Approval Dock, `kyc-decision`).
- **Test mode** for development: `ENABLE_OTP_TEST_MODE=true` lets test numbers use OTP `123456`; never set in production.
- **Single-device login:** each login registers the device and force-logs-out the account's other devices with an FCM push (`deviceSessionService`).
- **Incomplete registrations** (`tbl_registration_lead`) are tracked and admin can send reminders.
- **Driver Training video gate:** admin pastes a video URL (`training_video_url`/`title`); the driver app blocks Home until the video is watched to the end (no seeking; resume position synced to `driver_training_progress`); completion only on real playback end; admin sees % per driver and can reset. Empty URL ⇒ no gate. *(The reminder-push job described in the original spec was never built.)*

### 5.12 Trial Drivers  *(Live)*
Admin adds a driver by name + phone with N allowed trial orders: `trial_status=active`, `a_status=1` without KYC. Completed trial orders are counted (`trialOrderTracker`); at the limit the driver becomes `exhausted` and is switched off until KYC. Admin can block, remove, or **upgrade to verified**. **Payouts are held** while trial/exhausted and not approved. Driver app shows an "Unverified – Trial Mode X/N" banner and a Trial Ended screen.

### 5.13 Daily Driver system  *(Live — replaces Monthly Driver for new enrolments)*
- Admin creates **plans** (`daily_driver_plan`): price, duty window, required hours, free km, extra-km rate, shortfall hourly deduction, overtime hourly pay, `max_drivers` capacity, optional geofence zone, cities, package categories.
- Driver enrols per **calendar day** (`daily_driver_enrollment`): status `enrolled` if capacity remains, else `pending_approval` (admin approves/rejects); optional **auto-enrol** (hourly job creates tomorrow's enrolment); one plan per driver per day.
- **Duty:** punch-in/out + location pings (zone minutes count if the plan has a zone). Commission is **exempt** while an enrolment is active today.
- **Settlement when the duty window closes:** zero rides ⇒ eligible amount 0; else `eligible = price − shortfall_hours × shortfall_rate`; overtime pay and extra-km charge are separate credits; `diff = eligible − ride_earnings` ⇒ company pays the driver, or the company retains the excess (wallet debit). Everything is written to `daily_driver_ledger` and a snapshot in `daily_driver_duty_log`.
- **Force assign:** admin can assign a pending scheduled order straight to a driver (cancels all other offers/interest, notifies others to close their popups, audited).
- Driver app: Daily Driver plans list/detail, duty punch, ledger. Admin page **Daily Drivers**.
- The old **Monthly Drivers** system (`monthly_driver_contract`, duty log, ledger, early-start requests, queue, attendance report) still exists and still works for already-enrolled drivers; no auto-migration.

### 5.14 Favorite Routes  *(Dark — `FAVORITE_ROUTES_ENABLED` / per-city setting)*
A driver saves 2–8 map points as a route with coverage radius (1–20 km), mode `prefer` or `only`, optional forward-only direction and expiry; up to `max_routes` (5). When enabled, dispatch matches candidate drivers to the order's pickup→drop against their routes (`favoriteRouteService`). Admin: Favorite Routes page (list, metrics, settings, disable, diagnose).

### 5.15 Custom Orders ("Buy Anything" bidding)  *(Live)*
Customer posts a custom order (pickup, drop, description, base price, category) → open drivers place **bids** → customer sees bids and converts the winner into a real order (`/api/user/custom-order/{create,bids,convert}`, `/api/rider/custom-order/{open,bid}`). Admin: Custom Orders page lists orders/bids and can convert. Legacy "buy-order" endpoints (`/api/order/buy/*`, `/api/order/legacy/*`) remain for the older store-order flow.

### 5.16 Favourites, blocked drivers, favourite orders  *(Live)*
- Customers can **favourite a driver** (boosts ranking in dispatch) and **block a driver** (`tbl_user_blocked_driver`; excluded from that customer's dispatch; `max_blocked_drivers_per_user` limit).
- Customers can **favourite a past order** to re-book it.

### 5.17 Driver Contact-Referral leads  *(Live)*
Driver app **Refer via Contacts** uploads contacts → `tbl_driver_lead` (unique phone, first submitter wins; rejects already-registered numbers) → ops verify by phone in the admin **Driver Leads Queue** (verify/reject/send-invite) → verified leads get a window (`lead_verification_window_days`, 45; hourly expiry sweep) → if the person signs up with that number, a `source: lead` referral is created, and on their **first completed ride** the driver earns `lead_referral_points` and is auto-added as the customer's **favourite driver**. Customer app has the symmetrical **User contact referral** (`/api/user/leads`, admin **User Contact Referrals**, CSV export).

### 5.18 Driver Model tier info popup  *(Live)*
Admin-editable text on each package: `driver_card_subtitle`, `driver_info_subtitle`, and an ordered list of `{heading, body}` sections (≤ 12 sections, 120/2000 chars). The driver app shows a labelled "ⓘ Details" chip on each tier card and a popup built from those sections; per-km and minimum fare are no longer shown on the cards. No content is seeded — admins must fill it in per package row.

### 5.19 Vehicle detail specs  *(Live)*
Per category: `max_load_kg`, length/width/height + unit, `detail_image`; global `vehicle_detail_notes` (list). Customer app shows a **Details** screen from the vehicle card. Replaced the old hard-coded spec table.

### 5.20 Driver wallet, dues, withdrawals  *(Live)* — see 4.3. Endpoints: `/api/user/wallet/{add,history,points-history,withdraw,create-order,clear-due/create-order,clear-due/verify,clear-due/points}`; `wallet/history` for drivers also returns `outstanding_due`, `max_due_limit`, `can_withdraw`, `can_clear_due`, `due_limit_reached`.

### 5.21 Wallet & Referral history ledger (admin)  *(Live)*
Admin page **Wallet Adjustments** and per-person history drawers read `tbl_wallet_history` (with `performed_by_admin_id`) and `tbl_referral_point_log`; admins can adjust customer and **driver** wallets (credit/debit, audited) and referral points.

### 5.22 Ride-discount with referral points  *(Live)*
Customer can redeem referral points against a ride (admin `ride_discount_percent` cap, `point_value`); points are refunded if the order cancels and reconciled if the fare drops (`referralPointsRefund`). Points can also pay the advance (`/advance-payment/redeem-points`), part of a plan purchase (`plan_points_max_percent`) and driver dues.

### 5.23 Notifications  *(Live)*
FCM push (`firebase-admin`) for drivers and customers, in-app notification lists (`tbl_notification`, `tbl_rnoti`, customer inbox), admin **Push Notifications** page (send to segments; history; recipient preview), WhatsApp templates for order milestones to sender and receiver, OneSignal in the customer app.

### 5.24 Trip feedback  *(Live)*
Customers rate drivers (`/api/order/rate`, `/customer-feedback`); drivers rate customers (`/driver-feedback`); receivers rate via the tracking page. Admin **Trip Feedback** page with three tabs and filters.

### 5.25 Invoice  *(Live)*
`POST /api/order/invoice-url` returns a signed link (`INVOICE_SECRET_KEY`); `GET /api/order/invoice?…` renders it.

### 5.26 Driver wallet-credit incentives from plans  *(Live)* — see 6.1 (incentives, guarantees, activity protection, minimum-ride guarantee).

### 5.27 Model 1 reliability suspension  *(Live)*
A driver who rejects or times out `model1_miss_limit` (default 5) Model-1 offers in a row is **excluded from Model 1 offers for `model1_suspension_hours` (default 24)** and gets a push. Accepting resets the streak. Admin sees suspended riders and can un-suspend (`/riders/model1-suspended`, `/riders/:id/model1-unsuspend`).

### 5.28 Service zones / geofence  *(Live)*
Admin draws zones (`service_zone`, `tbl_geofence_zones`); used by Daily/Monthly duty tracking and city scoping.

### 5.29 Admin search, analytics, finance, fleet  *(Live)*
Global search; dashboard KPIs; sales report, month and city comparison; **Profit & Revenue ledger** (overview, party breakdown, CSV export); **Live Mission Control** (live driver pings, active trips), **Driver Duty Logs**; Reports.

### 5.30a Completed-order route map (GPS trail)  *(Live)*
While a trip runs the driver app already sends location samples with trip-progress; `tripRouteService` stores a thinned trail per trip (ignores jitter < 10 m, fixes with accuracy > 100 m, stale/future samples, and draws **no solid line across offline gaps > 10 min**). `POST /api/user/orders/route` returns the polyline plus start / pickup / OTP / drop points for the customer's order screen; old orders without a trail fall back to a straight line with "route not recorded". The receiver tracking page reuses the same trail.

### 5.30b Languages and driver-app alerts  *(Live)*
- **Customer app:** English plus Indian languages (`ShifterOnline/lib/Language/` — `language_indian.dart`, language picker screen).
- **Driver app:** Hindi, Marathi, Gujarati, Bengali, Kannada, Malayalam, Punjabi, Tamil, Telugu string sets (`res/values-*`); missing keys fall back to English.
- **Incoming-order and cancellation alerts:** `OrderOverlayService` shows the full-screen popup with ringtone and wake lock on any screen; a customer cancellation pops an alert once and stops when dismissed; without overlay permission it falls back to a heads-up notification.
- **Live-location vehicle icon** on the customer tracking map (`vehicle_marker.dart`).
- **Driver earnings screen:** selected-day net earnings, cash collected and Shifter deductions shown separately, wallet balance, pending withdrawal reservation and available amount (see `docs/earnings-ui-review/README.md`).

### 5.30 CMS  *(Live)*
Cities, vehicle types, package categories, banners, coupons, cancel reasons, FAQs, legal pages, dynamic driver questions/surveys (`tbl_question`/`tbl_option`), customer-care number/hours, app config (`/api/user/app-config`), how-to-use video.

---

## Part 6 — Plans, rewards and referrals

All plans live in **one table**, `tbl_premium_plan` (admin page *Marketing → Premium Plans*), and purchases in `tbl_user_plan_subscription` (with a frozen `plan_snapshot` JSON so deleting/editing a plan never changes what a buyer already owns). `plan_for` = `USER` (customer) or `DRIVER`. Every plan has: name, `price`, `validity_days` (or `lifetime_enabled`), `expire_date`, `city` (`all` or CSV of ids), `package_categories` (`all` or CSV of vehicle names/ids), `sort_order`, `is_popular`, `status`.

Purchase paths (both customer and driver): **pay** with Razorpay (signature verified server-side), and/or **redeem referral points** against the price (`referral_point_value` and the global cap `plan_points_max_percent`, switch `plan_purchase_enabled`). Admin can also **grant** a plan for free (`rewardPlanService.activatePlan`, `payment_method = admin_grant`).

### 6.1 Customer Premium plans (`plan_type = CUSTOMER_PREMIUM`)

| Benefit (plan field) | How it works |
|---|---|
| Fare discount (`discount_enabled`, `discount_percent`, `discount_max_cap`) | Applied to the **base fare** at pricing (`getActivePlanDiscount`); respects the ₹ cap |
| No advance payment (`no_advance_payment`) | Advance after driver-accept is waived (`advance = 0`, `payment_status = 1`) |
| Free cancellations (`cancellation_enabled`, `free_cancellations` (−1 = unlimited), `cancellation_window_min`) | Customer cancellation charge becomes ₹0 while allowance remains; `cancellations_used` counted on the subscription. A driver-caused free cancel never burns the allowance |
| Wallet bonus (`wallet_bonus_enabled`, `wallet_bonus_amount`) | Credited to the customer wallet on purchase |
| Priority matching / support, special offers, "guarantee driver" flags | Informational / hooks used by the apps (`priority_enabled`, `priority_support`, `special_offers`, `guarantee_driver`) |
| Referral activation (`referral_enabled`, `number_of_referrals`, `auto_activate_on_referrals`) | Plan can auto-activate after N successful referrals |
| **Free Booking Offer eligibility** | Requires an **active** customer premium plan (Part 5.4) |

APIs: `POST /api/user/premium-plans`, `POST /api/user/premium-plans/purchase` (Node port; the older `tbl_joining_plan` system is separate and unrelated). The Flutter screen is `premium_plans_screen.dart`; the status chip is `free_booking_status_card.dart`.

### 6.2 Driver plans

Two types (`plan_type`):

**`DRIVER_PREMIUM` — commission-discount plan**
- `commission_percent` and `per_trip_charge` replace the rate-card commission for the driver's trips.
- **Incentive per trip** (`incentive_enabled`, `incentive_type` flat|percent, `incentive_value`, `incentive_min_fare`, `incentive_monthly_cap`) — reduces the deduction (net bonus) on qualifying fares.
- `priority_enabled` → the driver ranks **first** in dispatch (`has_priority_plan DESC`).
- `wallet_bonus_*` on purchase; `lifetime_enabled`.
- **Activity protection** (`activity_protection_enabled`, 3/6/12-month amounts, `activity_min_online_hours`, optional requirements: Model 1 on, zero request, service zone, request ends day) protects a lifetime plan from lapsing for inactivity (SQL `20260909_driver_lifetime_activity_protection.sql`).
- **Minimum-ride guarantee** (`min_ride_guarantee_enabled`, `min_ride_guarantee`): the subscription stays active past `end_date` until the driver completes that many rides (`is_extended`).

**`DRIVER_SECOND` — Guaranteed Rides plan**
- `guaranteed_rides_per_month`, `rides_carry_forward`, `guaranteed_compensation` (`wallet_credit`) and the `compunsation_charge` per shortfall ride; priced with `initial_price` + `subscription_price`.

**Rules that apply to both**
- A driver may hold several subscriptions, but **benefits never stack**: for each completed ride `resolveBestBenefit` picks the **single** plan that gives the lowest deduction; if every plan is worse than the rate-card terms, the normal terms apply.
- Plans can be limited to vehicle types via `package_categories`.
- Per-ride bookkeeping: `tbl_plan_benefit_log` (fare, discount applied, commission, incentive), counters on the subscription.
- APIs: `POST /api/rider/premium-plans`, `POST /api/rider/premium-plans/purchase`; Java screens `PremiumPlansActivity`, `PlanDetailActivity`.
- Admin: *Premium Plans* CRUD plus **Plan Purchase History** (`/marketing/premium-plans/purchases`).

### 6.3 Daily Driver plans — see Part 5.13 (a different system from `tbl_premium_plan`).
### 6.4 Joining plan / kit — `tbl_joining_plan`, `tbl_kit` and `/api/rider/joining-plan`, `/kit-details`: the one-time driver registration/verification fee and rider kit. Not part of premium plans.

### 6.5 Referral system

| Piece | Behaviour |
|---|---|
| Referral code | Every customer/driver has a code; a new user enters it at signup (`referral_code`, plus legacy aliases `refferal_code`, `reffer_code`, `refer_code`). `tbl_referral` row is created `pending` |
| Reward trigger | On the referred person's **first completed order** (`processReferralRewardsForCompletedOrder`): atomic claim `pending → completed` (so it can never be paid twice), points credited to the **referrer** |
| Points amount | `user_points_per_referral` / `driver_points_per_referral` (default 100), `lead_referral_points` for contact-lead referrals, all in `tbl_referral_setting`; `referral_enabled` master switch |
| Sign-up bonus | `signup_bonus_points` to the new user |
| Point value | `point_value` (₹ per point). Points can: discount a ride (`ride_discount_percent` cap), pay the advance, pay part of a plan, clear driver dues |
| Ledger | Every movement in `tbl_referral_point_log` (`source`, `txn_type`, `balance_after`, `note`); admin can adjust points (`/referrals/adjust-points`) |
| Side effects | Completing a referral **unlocks** the referrer's Free Booking benefit (Part 5.4); lead-source referrals also create a favourite-driver link (Part 5.17) |

### 6.6 Reward plans, milestones and amount rewards  *(admin: Referral Network, Ride Milestones)*

- **Assign now / set pending** (`/reward-plans/*`): admin gives a plan to a user immediately, or stores a *pending reward plan* that is **applied automatically on the user's next completed order** (`applyPendingRewardPlanIfAny`).
- **Ride milestones** (`tbl_ride_milestone_reward`): "complete N rides → get plan P"; claims listed per milestone.
- **Ride amount rewards** (`tbl_ride_amount_reward`): "spend ≥ ₹X in total → get plan P", with `max_customers` cap; `getActiveAmountRewardForCustomer` drives the customer-app progress bar.
- Evaluated on every order completion (`applyRideMilestoneRewardsIfAny`, `applyRideAmountRewardsIfAny`); spend uses `total_dcharge` (the real final fare).

### 6.7 Coupons
`tbl_coupon` (admin CRUD). Customer checks a code (`/api/user/coupons/check`), the discount is computed **server-side** at booking (`couponService`), stored as `cou_amt` and is **absorbed by the platform** (driver's net is unaffected).

---

## Part 7 — REST API reference

**449 endpoints** across 10 routers. The tables below are **generated from the route files and handler source** (`backend/src/routes/*.js` + the controller each route calls), so paths, HTTP methods, access rules and the *input fields the handler actually reads* match the code as of 2026-10-07. "Purpose" is derived from the handler name; the narrative above (Parts 3–6) explains behaviour. Re-generate rather than hand-edit if routes change (the generator is a ~150-line script; ask for it).

### 7.0 Conventions

- **Base URL:** `https://<host>` (dev: `https://dev-api.shifteronline.com`). JSON bodies (`Content-Type: application/json`, 50 MB limit). `GET /health` → `{status:"ok"}`.
- **Two response shapes coexist** (legacy PHP compatibility):
  1. `{ "ResponseCode": "200", "Result": "true", "ResponseMsg": "…", …data }` — `Result` is the **string** `"true"/"false"`.
  2. `{ "Result": true, "msg": "…", …data }` — boolean `Result`.
  Always check which style an endpoint uses. Errors carry an HTTP 4xx/5xx plus `msg`/`ResponseMsg`; unhandled errors return `{Result:false,msg:"Internal server error"}`.
- **Identity (customer/driver apps):** the caller sends `uid` (customer id) or `rider_id` (driver id) in the body. There is **no token** — see Part 15. Some driver KYC/survey/content routes additionally require the static app key header (`appKeyAuth`, env `APP_REST_KEY`).
- **Identity (admin):** `POST /api/v1/admin/auth/login` → JWT (`JWT_EXPIRES_IN`); send `Authorization: Bearer <jwt>`. `authorize(roles)` and `scopeFilter` (city lock) are noted in the *Access* column. Writes are mostly `superadmin`/`admin`; reads often include `executive`.
- **Order-creation error codes** (`POST /api/order/create`): `VALIDATION` 400, `INVALID_COUPON` 400, `INVALID_GOODS_TYPE` 400, `INVALID_PACKAGES` 400, `PREMIUM_PLAN_REQUIRED` 403, `RECEIVER_PAY_UNAVAILABLE` 400, `FREE_BOOKING_UNAVAILABLE` 409 (+`outcome`), `SETTLEMENT_PENDING` 403.
- **Rate limits:** public pay/track endpoints are limited per IP (page 60/min, tracking API 120/min, track actions 10/min, pay verify stricter); WhatsApp control endpoints 10/min.

### 7.0.1 Key payloads (the endpoints every integration needs)

**`POST /api/order/fare-estimate`** — `{uid, cat_id, plat, plong, dlat, dlong, extra_mile_charge?, radius_km?, stops?[], body_type?}` → `{Result:true, distance_km, duration_min, packages:[{package_id,title,min_charge,per_km_charge,estimated_fare,is_night,…breakdown}]}` (one entry per active Model of the category; customer plan discount already applied).

**`POST /api/order/create`** — `{uid, category, delivery_type:[packageIds], booking_type(1|2|3), plat, plong, paddress, pick_name, pmobile, pick_type, dlat, dlong, daddress, drop_name, dmobile, drop_type, package_weight, package_cost, description, p_method_id, transaction_id, extra_mile_charge, cou_id, cou_amt, radius_km, city_id, photos, schedule_date_time (type 2), use_referral_points, stops:[{lat,lng,address,hno,landmark,contact_name,contact_number}], body_type(any|open|covered|half), goods_type_id, goods_type_other, receiver_pays, receiver_commission_percent, free_booking}` → `{ResponseCode:"200", Result:"true", order_id, booking_type, referral_points_used, referral_points_amount, body_type, covered_charge, receiver_pay, free_booking, ResponseMsg}`.

**`POST /api/order/details`** — `{uid, order_id}` → `OrderProductList[0]`: order + driver block (name, phone, vehicle no., live `rider_lats/rider_longs`), `Order_Status`/`o_status`, `Order_flow_id`, `trip_progress`, `waiting` (free minutes, rate, billable-wait clock), `settlement`, `receiver_pay`, `guarantee {state, amount, deadline_at}`, `free_booking`, `pickup_otp_timeout_minutes`, `advance_payment_timeout_minutes`, `otp`, `total_Delivery_charge`/`grand_total`/`Delivery_charge`, `advance_payment`, `payment_status`, `advance_payment_timer`, `referral_points_*`, `cou_amt`, `goods_type`, `photos`, pickup/drop names, addresses, mobiles and coordinates, `stops[]`, `body_type`, `covered_charge`.

**`POST /api/order/trip-progress`** (driver app) — `{order_id, rider_id, device_id, action, otp?, samples?[], lat?, lng?}`; `action` ∈ `sync | arrived | pickup | arrived_stop_N | complete_stop_N | arrived_drop | verify_otp`. Returns the trip-progress snapshot (statuses, OTP-remaining seconds, `otp_verified`, `pickup_load_wait_start`, stop progress). Completion itself goes through the `order:status_update` socket event (`status:"complete"`, optional `lat/lng`, `early_drop`).

**Customer cancel** `POST /api/order/customer-cancel {uid, order_id, comment}`; **driver cancel** `POST /api/order/driver-cancel {rider_id, order_id, reason}`; **rate** `POST /api/order/rate {uid, order_id, rider_id, star, comment}`.


### 7.1 `/api/user` — Customer app — auth, profile, wallet, content, plans, leads  (also mounted at `/api/users` and `/user`)

_50 endpoints · source: `backend/src/routes/user.routes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| POST | `/api/user/mobile-check` | Mobile check | public / identified by mobile | `mobile`, `ccode` |
| POST | `/api/user/send-otp` | Send otp | public / identified by mobile | `mobile` |
| POST | `/api/user/verify-otp` | Verify otp | public / identified by mobile | `mobile`, `otp`, `device_id` |
| POST | `/api/user/login` | Login | public / identified by mobile | `mobile`, `password`, `ccode`, `device_id`, `fcm_token`, `platform`, `device_name`, `app_version` |
| POST | `/api/user/login-by-otp` | Login by otp | public / identified by mobile | `mobile`, `ccode`, `device_id`, `fcm_token`, `platform`, `device_name`, `app_version` |
| POST | `/api/user/register` | Register | public / identified by mobile | `fname`, `email`, `mobile`, `ccode`, `password`, `city_id`, `device_id`, `fcm_token`, `referral_code`, `refferal_code`, `reffer_code`, `refer_code`, `platform`, `device_name` … |
| POST | `/api/user/forgot-password` | Forgot password | public / identified by mobile | `mobile`, `password` |
| POST | `/api/user/delete-account` | Delete account | id in body, no token | `uid` |
| GET | `/api/user/country-codes` | Country code list | public / identified by mobile | — |
| POST | `/api/user/profile/overview` | Profile overview | id in body, no token | `uid`, `?uid` |
| GET | `/api/user/profile/overview` | Profile overview | id in body, no token | `uid`, `?uid` |
| POST | `/api/user/profile/update` | Update profile | id in body, no token | `uid`, `fname`, `email`, `mobile`, `password` |
| POST | `/api/user/profile/image` | Update profile image | id in body, no token | `uid`, `img` |
| POST | `/api/user/address/list` | Address list | id in body, no token | `uid` |
| POST | `/api/user/address/save` | Save address | id in body, no token | `uid`, `aid`, `address`, `type`, `lat_map`, `long_map`, `houseno`, `landmark`, `c_name`, `c_number`, `is_tracking` |
| POST | `/api/user/address/delete` | Delete address | id in body, no token | `uid`, `aid` |
| POST | `/api/user/wallet/add` | Add wallet | public / identified by mobile | `mobile`, `amount`, `wallet_type`, `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` |
| POST | `/api/user/wallet/history` | Wallet history | public / identified by mobile | `mobile`, `wallet_type`, `from_date`, `to_date`, `txn_type` |
| POST | `/api/user/wallet/points-history` | Points history | public / identified by mobile | `mobile`, `wallet_type`, `page`, `limit` |
| POST | `/api/user/wallet/withdraw` | Withdraw wallet | public / identified by mobile | `mobile`, `amount`, `wallet_type`, `remark`, `payout_method`, `upi_id`, `account_name`, `account_number`, `ifsc_code`, `bank_name` |
| POST | `/api/user/wallet/create-order` | Create razorpay order | public / identified by mobile | `amount` |
| POST | `/api/user/wallet/clear-due/create-order` | Create clear due order | public / identified by mobile | `mobile` |
| POST | `/api/user/wallet/clear-due/verify` | Clear outstanding due | public / identified by mobile | `mobile`, `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` |
| POST | `/api/user/wallet/clear-due/points` | Clear due with points | public / identified by mobile | `mobile` |
| POST | `/api/user/favorites/toggle` | Toggle favorite driver | id in body, no token | `user_id`, `rider_id` |
| POST | `/api/user/blocked-drivers/toggle` | Toggle blocked driver | id in body, no token | `user_id`, `rider_id` |
| POST | `/api/user/blocked-drivers/list` | List blocked drivers | id in body, no token | `user_id` |
| POST | `/api/user/favorites/list` | List favorite drivers | id in body, no token | `user_id` |
| POST | `/api/user/coupons/list` | Coupon list | id in body, no token | `uid` |
| POST | `/api/user/coupons/check` | Check coupon | id in body, no token | `uid`, `cid`, `coupon_code`, `code` |
| POST | `/api/user/notifications` | Notification list | id in body, no token | `uid` |
| GET | `/api/user/cities` | City list | public / identified by mobile | — |
| GET | `/api/user/pages` | Page list | public / identified by mobile | — |
| POST | `/api/user/faqs` | Faq list | id in body, no token | `uid` |
| GET | `/api/user/payment-gateways` | Payment gateway list | public / identified by mobile | — |
| POST | `/api/user/home` | Home data | id in body, no token | `uid`, `device_id`, `search` |
| POST | `/api/user/orders/history` | Pkg history customer | id in body, no token | `uid`, `type` |
| POST | `/api/user/orders/route` | Order route | id in body, no token | `uid`, `order_id` |
| POST | `/api/user/orders/favorite/toggle` | Toggle favorite order | id in body, no token | `user_id`, `uid`, `order_id` |
| POST | `/api/user/cancel-reasons` | Cancel reason list | public / identified by mobile | `type` |
| GET | `/api/user/app-config` | App config | public / identified by mobile | — |
| GET | `/api/user/customer-care` | Get customer care | public / identified by mobile | — |
| POST | `/api/user/customer-care` | Get customer care | public / identified by mobile | — |
| POST | `/api/user/custom-order/create` | Create custom order | id in body, no token | `user_id`, `pickup`, `drop`, `description`, `price`, `category` |
| POST | `/api/user/custom-order/bids` | List bids | id in body, no token | `order_id`, `user_id` |
| POST | `/api/user/custom-order/convert` | Convert order | id in body, no token | `order_id`, `rider_id` |
| POST | `/api/user/premium-plans` | List | id in body, no token | `uid`, `city_id` |
| POST | `/api/user/premium-plans/purchase` | Purchase | id in body, no token | `uid`, `plan_id`, `use_points`, `points_to_use`, `razorpay_payment_id`, `payment_txn_id`, `payment_method`, `razorpay_order_id`, `razorpay_signature` |
| POST | `/api/user/leads` | Submit leads | id in body, no token | `uid`, `user_id`, `id`, `lead_type`, `type`, `contacts` |
| GET | `/api/user/leads` | List my leads | id in body, no token | `?uid`, `?user_id`, `?id` |

### 7.2 `/api/order` — Orders — booking, trip, payment, settlement (customer **and** driver apps)

_65 endpoints · source: `backend/src/routes/orderRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| POST | `/api/order/trip-progress` | Sync progress | id in body, no token | `rider_id`, `order_id`, `device_id`, `action`, `otp`, `samples`, `lat`, `lng` |
| GET | `/api/order/categories` | Get categories | public / identified by mobile | — |
| POST | `/api/order/fare-estimate` | Fare estimate | id in body, no token | `cat_id`, `plat`, `plong`, `dlat`, `dlong`, `uid`, `extra_mile_charge`, `radius_km`, `stops`, `body_type` |
| POST | `/api/order/distance` | Distance estimate | public / identified by mobile | `pickup_lat`, `pickup_lng`, `drop_lat`, `drop_lng` |
| POST | `/api/order/packagelist` | Package list estimate | id in body, no token | `uid`, `cat_id` |
| POST | `/api/order/create` | Create order | id in body, no token | `uid`, `category`, `delivery_type`, `booking_type`, `plat`, `plong`, `paddress`, `pick_name`, `pmobile`, `pick_type`, `dlat`, `dlong`, `daddress`, `drop_name` … |
| POST | `/api/order/free-booking/check` | Check | id in body, no token | `uid`, `plat`, `plong`, `category`, `radius_km`, `city_id`, `booking_type` |
| POST | `/api/order/free-booking/status` | Status | id in body, no token | `uid` |
| POST | `/api/order/guarantee-quote` | Quote | public / identified by mobile | `package_ids` |
| POST | `/api/order/details` | Get order details | id in body, no token | `uid`, `order_id` |
| POST | `/api/order/customer-cancel` | Customer cancel | id in body, no token | `uid`, `order_id`, `comment` |
| POST | `/api/order/schedule-confirmations` | Get pending schedule confirmations | id in body, no token | `uid` |
| POST | `/api/order/schedule-confirm` | Respond schedule confirmation | id in body, no token | `uid`, `order_id`, `action` |
| POST | `/api/order/driver-cancel` | Driver cancel | id in body, no token | `rider_id`, `order_id`, `reason` |
| POST | `/api/order/destination-change/preview` | Preview destination change | id in body, no token | `uid`, `order_id`, `new_dlat`, `new_dlong`, `new_daddress` |
| POST | `/api/order/destination-change/confirm` | Confirm destination change | id in body, no token | `uid`, `order_id`, `new_dlat`, `new_dlong`, `new_daddress` |
| POST | `/api/order/pickup-change/preview` | Preview pickup change | id in body, no token | `uid`, `order_id`, `new_plat`, `new_plong`, `new_paddress` |
| POST | `/api/order/pickup-change/confirm` | Confirm pickup change | id in body, no token | `uid`, `order_id`, `new_plat`, `new_plong`, `new_paddress` |
| POST | `/api/order/stops/preview` | Preview add stop | id in body, no token | `uid`, `order_id`, `lat`, `lng`, `address`, `hno`, `landmark`, `contact_name`, `contact_number` |
| POST | `/api/order/stops/confirm` | Confirm add stop | id in body, no token | `uid`, `order_id`, `lat`, `lng`, `address`, `hno`, `landmark`, `contact_name`, `contact_number` |
| POST | `/api/order/verify-pickup-otp` | Verify pickup otp | public / identified by mobile | `order_id`, `otp` |
| POST | `/api/order/check-pickup-amount` | Check pickup amount | id in body, no token | `oid`, `order_id` |
| POST | `/api/order/cancel-reasons` | Get cancel reasons | public / identified by mobile | `type` |
| POST | `/api/order/status-change` | Order status change legacy | id in body, no token | `oid`, `rid`, `status`, `comment` |
| POST | `/api/order/buy/status-change` | B order status change legacy | id in body, no token | `oid`, `rid`, `status`, `comment` |
| POST | `/api/order/buy/item-list` | Buy order item list | public / identified by mobile | `orderid` |
| POST | `/api/order/buy/item-unavailable` | Mark buy order item unavailable | public / identified by mobile | `itmeid`, `order_id` |
| POST | `/api/order/buy/item-upload` | Buy order item upload | id in body, no token | `rider_id`, `item_id`, `order_id`, `item_total` |
| POST | `/api/order/rate` | Rate order | id in body, no token | `uid`, `order_id`, `rider_id`, `star`, `comment` |
| POST | `/api/order/driver-feedback` | Submit driver feedback | id in body, no token | `order_id`, `rider_id`, `no_entry_zone`, `customer_type`, `goods_type_id`, `goods_type_other` |
| POST | `/api/order/customer-feedback` | Submit customer feedback | id in body, no token | `order_id`, `uid`, `rider_id`, `feedback_tags`, `comment` |
| POST | `/api/order/next-day-eligibility` | Check next day eligibility | id in body, no token | `uid`, `?uid` |
| POST | `/api/order/upload-photo` | Upload order photo | public / identified by mobile | — |
| POST | `/api/order/available-vehicles` | Available vehicles | id in body, no token | `pickup_lat`, `pickup_lng`, `booking_type`, `scheduled_at`, `category`, `uid`, `customer_id`, `radius_km` |
| POST | `/api/order/payment-status` | Payment method status | public / identified by mobile | — |
| POST | `/api/order/invoice-url` | Generate invoice url | id in body, no token | `uid`, `order_id` |
| GET | `/api/order/invoice` | Render invoice | id in body, no token | `?order_id`, `?uid`, `?exp`, `?token` |
| POST | `/api/order/map-info` | Get map info | id in body, no token | `orderid`, `uid` |
| POST | `/api/order/advance-payment` | Advance payment | public / identified by mobile | `order_id`, `amount`, `remark`, `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` |
| POST | `/api/order/advance-payment/redeem-points` | Redeem advance with points | public / identified by mobile | `order_id` |
| POST | `/api/order/advance-payment/wallet` | Advance payment from wallet | id in body, no token | `order_id`, `uid` |
| GET | `/api/order/referral-discount-info` | Referral discount info | id in body, no token | `uid`, `?uid` |
| GET | `/api/order/scheduled-settings` | Scheduled booking settings | public / identified by mobile | — |
| POST | `/api/order/settlement/state` | Customer state | public / identified by mobile | — |
| POST | `/api/order/settlement/choose-driver` | Customer choose driver | public / identified by mobile | — |
| POST | `/api/order/settlement/pay-online/create` | Customer pay online create | public / identified by mobile | — |
| POST | `/api/order/settlement/pay-online/verify` | Customer pay online verify | public / identified by mobile | — |
| POST | `/api/order/settlement/dispute` | Customer dispute | public / identified by mobile | — |
| POST | `/api/order/settlement/take-over` | Customer take over | public / identified by mobile | — |
| POST | `/api/order/settlement/resend-link` | Customer resend link | public / identified by mobile | — |
| POST | `/api/order/settlement/receiver-phone` | Customer change receiver phone | public / identified by mobile | — |
| GET | `/api/order/receiver-pay/config` | Receiver pay config | public / identified by mobile | — |
| GET | `/api/order/goods-types` | List active goods types | public / identified by mobile | — |
| GET | `/api/order/restricted-items` | List active restricted items | public / identified by mobile | — |
| GET | `/api/order/booking-guidelines` | List active booking guidelines | public / identified by mobile | — |
| POST | `/api/order/history` | Pkg history | id in body, no token | `uid`, `type` |
| POST | `/api/order/legacy/history` | Buy history | id in body, no token | `uid`, `type` |
| POST | `/api/order/legacy/detail` | Buy order detail | id in body, no token | `uid`, `order_id` |
| POST | `/api/order/legacy/map-info` | Buy map info | id in body, no token | `orderid`, `uid` |
| POST | `/api/order/legacy/rate` | Buy rate | id in body, no token | `uid`, `rate`, `order_id`, `comment` |
| POST | `/api/order/legacy/cancel` | Buy cancel | id in body, no token | `uid`, `order_id` |
| POST | `/api/order/legacy/pay-bill` | Pay bill | id in body, no token | `uid`, `order_id`, `p_method_id`, `trans_id`, `amt` |
| POST | `/api/order/legacy/create` | Buy order create | id in body, no token | `uid`, `title`, `pick_address`, `pick_lat`, `pick_long`, `drop_address`, `drop_lat`, `drop_long`, `d_charge`, `p_method_id`, `transaction_id`, `ProductData`, `pick_type`, `drop_type` … |
| POST | `/api/order/legacy/confirm-item` | Confirm item | id in body, no token | `uid`, `itmeid`, `order_id` |
| POST | `/api/order/legacy/item-remove` | Item remove | public / identified by mobile | `itmeid`, `order_id` |

### 7.3 `/api/rider` — Driver app — auth, KYC, status, plans, duty, wallet payouts (also mounted at `/rider`)

_89 endpoints · source: `backend/src/routes/riderRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| POST | `/api/rider/favorite-routes` | Driver | id in body, no token | `rider_id`, `device_id` |
| POST | `/api/rider/auth/mobile-check` | Mobile check | public / identified by mobile | `mobile` |
| POST | `/api/rider/auth/send-otp` | Send otp | public / identified by mobile | `mobile` |
| POST | `/api/rider/auth/verify-otp` | Verify otp | public / identified by mobile | `mobile`, `otp`, `device_id`, `fcm_token`, `platform`, `device_name`, `app_version` |
| POST | `/api/rider/auth/login` | Login | public / identified by mobile | `mobile`, `password`, `device_id`, `fcm_token`, `platform`, `device_name`, `app_version` |
| POST | `/api/rider/auth/register` | Register | public / identified by mobile | — |
| POST | `/api/rider/auth/logout` | Logout | id in body, no token | `rid` |
| POST | `/api/rider/verification-payment/create-order` | Create order | id in body, no token | `rider_id` |
| POST | `/api/rider/verification-payment/verify` | Verify payment | id in body, no token | `rider_id`, `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`, `device_id`, `fcm_token` |
| GET | `/api/rider/test-drivers` | List test drivers | public / identified by mobile | — |
| GET | `/api/rider/:riderId/delivery-types` | Get delivery types | public / identified by mobile | — |
| POST | `/api/rider/delivery-type` | Set delivery type | id in body, no token | `rider_id`, `package_id`, `enabled` |
| POST | `/api/rider/body-type` | Set body type | id in body, no token | `rider_id`, `body_type` |
| POST | `/api/rider/package-list` | Package list for driver | id in body, no token | `uid` |
| POST | `/api/rider/scheduled-trips` | List scheduled trips | id in body, no token | `uid` |
| POST | `/api/rider/scheduled-trips/interest` | Mark interest | id in body, no token | `uid`, `order_id` |
| POST | `/api/rider/scheduled-trips/interest/remove` | Remove interest | id in body, no token | `uid`, `order_id` |
| POST | `/api/rider/status` | Set status | id in body, no token | `rider_id`, `a_status`, `device_id` |
| POST | `/api/rider/location` | Update location | id in body, no token | `rider_id`, `lat`, `lng`, `device_id` |
| POST | `/api/rider/isolate-test-drivers` | Isolate test drivers | public / identified by mobile | `keep_ids` |
| POST | `/api/rider/premium-plans` | List | id in body, no token | `driver_id`, `rider_id`, `city_id` |
| POST | `/api/rider/premium-plans/purchase` | Purchase | id in body, no token | `plan_id`, `driver_id`, `rider_id`, `use_points`, `points_to_use`, `payment_txn_id`, `payment_method`, `amount_paid` |
| POST | `/api/rider/profile` | Get profile | id in body, no token | `rider_id`, `?rider_id` |
| POST | `/api/rider/profile/update` | Update profile | id in body, no token | `rider_id`, `full_name`, `email`, `dob`, `nationality`, `full_address`, `know_language`, `vehicle_no`, `body_type` |
| POST | `/api/rider/check-referral` | Check referral | public / identified by mobile | `referral_code`, `refferal_code`, `reffer_code`, `?code` |
| POST | `/api/rider/apply-referral` | Apply referral | id in body, no token | `rider_id`, `rid`, `referral_code`, `refferal_code`, `reffer_code` |
| POST | `/api/rider/claim-referral-reward` | Claim referral reward | id in body, no token | `rider_id`, `rid`, `?rider_id` |
| POST | `/api/rider/leads` | Submit leads | id in body, no token | `rider_id`, `rid`, `lead_type`, `type`, `contacts` |
| GET | `/api/rider/leads` | List my leads | public / identified by mobile | `?rider_id`, `?rid` |
| POST | `/api/rider/training/status` | Get status | id in body, no token | `rider_id` |
| POST | `/api/rider/training/progress` | Save progress | id in body, no token | `rider_id`, `video_url`, `watch_progress`, `current_position_seconds`, `total_duration_seconds` |
| POST | `/api/rider/training/complete` | Complete | id in body, no token | `rider_id`, `video_url` |
| POST | `/api/rider/settlement/state` | Driver state | public / identified by mobile | — |
| POST | `/api/rider/settlement/received` | Driver received | public / identified by mobile | — |
| POST | `/api/rider/settlement/dispute` | Driver dispute | public / identified by mobile | — |
| POST | `/api/rider/settlement/pending` | Driver pending | public / identified by mobile | — |
| POST | `/api/rider/settlement/receiver-refused` | Driver receiver refused | public / identified by mobile | — |
| POST | `/api/rider/settlement/resend-link` | Driver resend link | public / identified by mobile | — |
| GET | `/api/rider/duty/status/:riderId` | Get duty status | public / identified by mobile | `?riderId` |
| POST | `/api/rider/duty/punch-in` | Punch in | id in body, no token | `rider_id`, `lat`, `lng` |
| POST | `/api/rider/duty/punch-out` | Punch out | id in body, no token | `rider_id` |
| GET | `/api/rider/queue/:riderId` | Get driver queue | public / identified by mobile | `?riderId` |
| POST | `/api/rider/daily-driver/plans` | List plans | public / identified by mobile | `city_id`, `?city_id` |
| POST | `/api/rider/daily-driver/enroll` | Enroll | public / identified by mobile | `plan_id` |
| POST | `/api/rider/daily-driver/enrollment/cancel` | Cancel enrollment | public / identified by mobile | `enrollment_id` |
| POST | `/api/rider/daily-driver/auto-enroll` | Set auto enroll | public / identified by mobile | `plan_id`, `until_date` |
| POST | `/api/rider/daily-driver/auto-enroll/cancel` | Cancel auto enroll | public / identified by mobile | — |
| GET | `/api/rider/daily-driver/duty/status/:riderId` | Get duty status | public / identified by mobile | — |
| POST | `/api/rider/daily-driver/duty/punch-in` | Punch in | public / identified by mobile | `lat`, `lng` |
| POST | `/api/rider/daily-driver/duty/punch-out` | Punch out | public / identified by mobile | — |
| POST | `/api/rider/daily-driver/duty/ping` | Location ping | public / identified by mobile | `lat`, `lng` |
| POST | `/api/rider/kyc/address-document` | Upload address document | app-key | — |
| POST | `/api/rider/kyc/license-document` | Upload license document | app-key | — |
| POST | `/api/rider/kyc/residence-document` | Upload residence document | app-key | — |
| POST | `/api/rider/kyc/bank-account` | Save bank account | app-key | `rider_id`, `account__name`, `a_name`, `account_number`, `iban_num`, `ifsc_code`, `bank_name`, `branch_name`, `vat_id` |
| POST | `/api/rider/kyc/vehicle-detail` | Save vehicle detail | app-key | — |
| POST | `/api/rider/vehicle/update` | Update rider vehicle | id in body, no token | `rider_id`, `vehicle_type` |
| POST | `/api/rider/vehicle/type-list` | Vehicle type list | public / identified by mobile | — |
| GET | `/api/rider/vehicle/list` | Vehicle list | app-key | — |
| POST | `/api/rider/payout/list` | Payout list | id in body, no token | `rid` |
| POST | `/api/rider/payout/request` | Request payout | id in body, no token | `rid`, `amt`, `r_type`, `acc_number`, `bank_name`, `acc_name`, `ifsc_code`, `upi_id`, `paypal_id` |
| POST | `/api/rider/payout/withdraw-request` | Withdraw request | id in body, no token | `rider_id`, `amount` |
| GET | `/api/rider/survey/dynamic-questions` | Dynamic question list | app-key | — |
| POST | `/api/rider/survey/dynamic-answer` | Save dynamic answer | app-key | `rider_id`, `type`, `id_num` |
| POST | `/api/rider/survey/list` | Survey list | app-key | `rider_id` |
| POST | `/api/rider/survey/answer` | Save survey answers | app-key | `rider_id`, `surveydata` |
| POST | `/api/rider/custom-order/open` | List open orders for driver | public / identified by mobile | `category` |
| POST | `/api/rider/custom-order/bid` | Place bid | id in body, no token | `order_id`, `rider_id`, `amount` |
| POST | `/api/rider/home` | Home data | id in body, no token | `rid`, `device_id` |
| GET | `/api/rider/cities` | City list | app-key | — |
| GET | `/api/rider/country-codes` | Country code list | app-key | — |
| POST | `/api/rider/pages` | Page list | id in body, no token | `rid` |
| POST | `/api/rider/notifications` | Notification list | app-key | `rid` |
| POST | `/api/rider/emergency-contact` | Save emergency contact | app-key | `name`, `relation`, `mobile`, `rider_id` |
| POST | `/api/rider/is-bicycle` | Set is bicycle | app-key | `is_bycle`, `rider_id` |
| POST | `/api/rider/registration-settings` | Registration settings | id in body, no token | `mobile`, `rid` |
| GET | `/api/rider/joining-plan` | Joining plan | app-key | — |
| POST | `/api/rider/kit-details` | Save kit details | app-key | — |
| POST | `/api/rider/orders/history` | Pkg history driver | id in body, no token | `rid`, `type` |
| POST | `/api/rider/orders/legacy/history` | Buy history driver | app-key | `rid`, `type` |
| POST | `/api/rider/orders/legacy/detail` | Buy order detail driver | app-key | `orderid`, `rid` |
| POST | `/api/rider/orders/legacy/bill-upload` | Bill upload | app-key | `rider_id`, `order_id` |
| POST | `/api/rider/kyc/document-check` | Document check | app-key | `rider_id` |
| POST | `/api/rider/kyc/verify-document` | Verify driver document | app-key | `rider_id`, `mobile`, `city_id` |
| GET | `/api/rider/kyc/dl/captcha` | Generate captcha | public / identified by mobile | `?raw` |
| POST | `/api/rider/kyc/dl/verify` | Verify driving licence | public / identified by mobile | — |
| POST | `/api/rider/kyc/rc/verify` | Verify rc | public / identified by mobile | — |
| POST | `/api/rider/kyc/aadhar/verify` | Verify aadhar | public / identified by mobile | `aadhar_base64`, `aadhar_pdf`, `aadharBase64`, `full_name`, `fullName`, `dob`, `date_of_birth`, `dateOfBirth` |
| GET | `/api/rider/kyc/dynamic-config` | Get dynamic kyc config | app-key | — |

### 7.4 `/api/location` — Address search

_1 endpoints · source: `backend/src/routes/locationRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| GET | `/api/location/search` | (inline) | public | — |

### 7.5 `/pay` — Public receiver pay **page**

_1 endpoints · source: `backend/src/routes/receiverPayRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| GET | `/pay/:token` | Page | token in URL; rate-limited | — |

### 7.6 `/api/pay` — Public receiver pay **API** (token authenticated)

_4 endpoints · source: `backend/src/routes/receiverPayRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| GET | `/api/pay/:token` | State | token in URL; rate-limited | — |
| POST | `/api/pay/:token/order` | Create order | token in URL; rate-limited | — |
| POST | `/api/pay/:token/verify` | Verify | token in URL; rate-limited | — |
| POST | `/api/pay/:token/decline` | Decline | token in URL; rate-limited | — |

### 7.7 `/track` — Public receiver tracking **page**

_1 endpoints · source: `backend/src/routes/trackRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| GET | `/track/:token` | Page | token in URL; rate-limited | — |

### 7.8 `/api/track` — Public receiver tracking **API** (token authenticated)

_3 endpoints · source: `backend/src/routes/trackRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| GET | `/api/track/:token` | Snapshot | token in URL; rate-limited | — |
| POST | `/api/track/:token/pay-link` | Pay link | token in URL; rate-limited | — |
| POST | `/api/track/:token/review` | Review | token in URL; rate-limited | — |

### 7.9 `/api/v1/admin` — Admin panel (JWT `Authorization: Bearer …`)

_228 endpoints · source: `backend/src/routes/adminRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| POST | `/api/v1/admin/upload-image` | Upload admin image | JWT | `folder` |
| GET | `/api/v1/admin/favorite-routes` | List | JWT, roles:all-staff | — |
| GET | `/api/v1/admin/favorite-routes/metrics` | Metrics | JWT, roles:all-staff | — |
| PUT | `/api/v1/admin/favorite-routes/settings` | Settings | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/favorite-routes/:id/disable` | Disable | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/favorite-routes/:id/diagnose` | Diagnose | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/auth/login` | Login | — | `username`, `password` |
| GET | `/api/v1/admin/auth/me` | Me | JWT | — |
| PUT | `/api/v1/admin/auth/profile` | Update profile | JWT | `name`, `email`, `mobile`, `current_password`, `new_password` |
| GET | `/api/v1/admin/search` | Global search | JWT, roles:all-staff, city-scoped | `?q`, `?search` |
| GET | `/api/v1/admin/service-zones` | List zones | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/service-zones` | Create zone | JWT, roles:superadmin,admin | `name`, `city_id`, `center_lat`, `center_lng`, `radius_km`, `polygon_geojson` |
| PUT | `/api/v1/admin/service-zones/:id` | Update zone | JWT, roles:superadmin,admin | `name`, `city_id`, `center_lat`, `center_lng`, `radius_km`, `polygon_geojson`, `status` |
| DELETE | `/api/v1/admin/service-zones/:id` | Delete zone | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/monthly-drivers` | List monthly drivers | JWT, roles:all-staff, city-scoped | — |
| POST | `/api/v1/admin/monthly-drivers/promote` | Promote driver | JWT, roles:superadmin,admin, city-scoped | `rider_id`, `assigned_zone_id`, `shift_start_time`, `shift_end_time`, `target_shift_hours`, `monthly_base_salary`, `overtime_hourly_rate`, `allowed_break_minutes` |
| POST | `/api/v1/admin/monthly-drivers/demote` | Demote driver | JWT, roles:superadmin,admin, city-scoped | `rider_id` |
| GET | `/api/v1/admin/monthly-drivers/early-start-requests` | List early start requests | JWT, roles:all-staff | `?status` |
| POST | `/api/v1/admin/monthly-drivers/early-start-requests/:id/decision` | Decide early start request | JWT, roles:superadmin,admin | `decision` |
| GET | `/api/v1/admin/monthly-drivers/attendance` | Get attendance report | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/monthly-drivers/:riderId/duty` | Get duty status | JWT, roles:all-staff | `?riderId` |
| GET | `/api/v1/admin/monthly-drivers/:riderId/ledger` | Get monthly driver ledger | JWT, roles:all-staff | `?riderId` |
| POST | `/api/v1/admin/monthly-drivers/:riderId/ledger-adjustment` | Add ledger adjustment | JWT, roles:superadmin,admin | `entry_type`, `amount`, `balance_effect`, `notes`, `rider_id` |
| GET | `/api/v1/admin/monthly-drivers/:riderId/queue` | Get driver queue | JWT, roles:all-staff | `?riderId` |
| POST | `/api/v1/admin/monthly-drivers/queue/assign` | Assign order to queue | JWT, roles:superadmin,admin, city-scoped | `order_id`, `rider_id`, `position` |
| DELETE | `/api/v1/admin/monthly-drivers/queue/:queue_id` | Remove order from queue | JWT, roles:superadmin,admin, city-scoped | — |
| GET | `/api/v1/admin/daily-driver/plans` | List plans | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/daily-driver/plans` | Create plan | JWT, roles:superadmin,admin | `plan_name` |
| PUT | `/api/v1/admin/daily-driver/plans/:planId` | Update plan | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/daily-driver/plans/:planId/status` | Set plan status | JWT, roles:superadmin,admin | `status` |
| GET | `/api/v1/admin/daily-driver/enrollments` | List enrollments | JWT, roles:all-staff | — |
| GET | `/api/v1/admin/daily-driver/requests/pending` | List pending requests | JWT, roles:all-staff | `?plan_id` |
| POST | `/api/v1/admin/daily-driver/requests/:enrollmentId/approve` | Approve enrollment | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/daily-driver/requests/:enrollmentId/reject` | Reject enrollment | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/daily-driver/:riderId/ledger` | Get ledger | JWT, roles:all-staff | — |
| GET | `/api/v1/admin/daily-driver/scheduled-orders/pending` | List assignable scheduled orders | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/daily-driver/force-assign` | Force assign | JWT, roles:superadmin,admin, city-scoped | `order_id`, `rider_id` |
| GET | `/api/v1/admin/free-booking/settings` | Get settings | JWT, roles:all-staff | — |
| PUT | `/api/v1/admin/free-booking/settings` | Save settings | JWT, roles:superadmin,admin | `enabled`, `offer_start`, `offer_end`, `referrals_required` |
| GET | `/api/v1/admin/free-booking/pool` | List pool | JWT, roles:all-staff | — |
| GET | `/api/v1/admin/free-booking/pool/candidates` | List candidates | JWT, roles:all-staff | `?q` |
| POST | `/api/v1/admin/free-booking/pool` | Add to pool | JWT, roles:superadmin,admin | `rider_id`, `valid_from`, `valid_to` |
| PUT | `/api/v1/admin/free-booking/pool/:id` | Update pool | JWT, roles:superadmin,admin | — |
| DELETE | `/api/v1/admin/free-booking/pool/:id` | Remove from pool | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/free-booking/orders` | List orders | JWT, roles:all-staff | `?status` |
| POST | `/api/v1/admin/free-booking/orders/:id/void` | Void order | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/free-booking/users/:userId/lock` | Lock user | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/free-booking/users/:userId/unlock` | Unlock user | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/booking-guarantee/settings` | Get settings | JWT, roles:all-staff | — |
| PUT | `/api/v1/admin/booking-guarantee/settings` | Save settings | JWT, roles:superadmin,admin | `assign_minutes` |
| GET | `/api/v1/admin/booking-guarantee/cases` | List cases | JWT, roles:all-staff, city-scoped | `?limit`, `?status` |
| GET | `/api/v1/admin/booking-guarantee/cases/:orderId/audit` | Case audit | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/staff` | List | JWT, roles:superadmin,admin | `?role`, `?city_id`, `?search` |
| POST | `/api/v1/admin/staff` | Create | JWT, roles:superadmin,admin | `username`, `password`, `name`, `role`, `city_id`, `email`, `mobile` |
| PUT | `/api/v1/admin/staff/:id` | Update | JWT, roles:superadmin,admin | `name`, `email`, `mobile`, `status`, `city_id`, `role`, `password` |
| DELETE | `/api/v1/admin/staff/:id` | Remove | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/cities` | List cities | JWT | — |
| POST | `/api/v1/admin/cities` | Create city | JWT, roles:superadmin | `title`, `lat`, `lng`, `status` |
| PUT | `/api/v1/admin/cities/:id` | Update city | JWT, roles:superadmin | `title`, `lat`, `lng`, `status` |
| DELETE | `/api/v1/admin/cities/:id` | Delete city | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/vehicles` | List vehicles | JWT | — |
| POST | `/api/v1/admin/vehicles` | Create vehicle | JWT, roles:superadmin | `title`, `v_rquired`, `status` |
| PUT | `/api/v1/admin/vehicles/:id` | Update vehicle | JWT, roles:superadmin | `title`, `v_rquired`, `status` |
| DELETE | `/api/v1/admin/vehicles/:id` | Delete vehicle | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/categories` | List categories | JWT | — |
| POST | `/api/v1/admin/categories` | Create category | JWT, roles:superadmin | `cat_name`, `cat_img`, `cat_status`, `city_id`, `sort_order`, `other_image`, `max_load_kg`, `dim_length`, `dim_width`, `dim_height`, `dim_unit`, `detail_image`, `allowed_body_types`, `driver_body_types` … |
| PUT | `/api/v1/admin/categories/:id` | Update category | JWT, roles:superadmin | `cat_name`, `cat_img`, `cat_status`, `city_id`, `sort_order`, `other_image`, `max_load_kg`, `dim_length`, `dim_width`, `dim_height`, `dim_unit`, `detail_image`, `allowed_body_types`, `driver_body_types` … |
| DELETE | `/api/v1/admin/categories/:id` | Delete category | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/rate-cards` | List | JWT | `?cat_id`, `?status`, `?city_id` |
| GET | `/api/v1/admin/rate-cards/slabs` | Get slabs | JWT | — |
| PUT | `/api/v1/admin/rate-cards/slabs` | Update slabs | JWT, roles:superadmin | `vehicle_slabs`, `model_multipliers`, `anchor_model`, `slabRates`, `modelMultipliers` |
| POST | `/api/v1/admin/rate-cards/slabs/simulate` | Simulate fare | JWT | `vehicle_key`, `distance_km` |
| POST | `/api/v1/admin/rate-cards/slabs/sync` | Sync models from slabs | JWT, roles:superadmin | — |
| POST | `/api/v1/admin/rate-cards/generate-models` | Generate models | JWT, roles:superadmin | `baseRateCardId`, `base_package_id`, `base_id`, `models` |
| GET | `/api/v1/admin/rate-cards/:id` | Get one | JWT | — |
| POST | `/api/v1/admin/rate-cards` | Create | JWT, roles:superadmin | `type`, `no_driver_compensation`, `driver_info_sections`, `driver_card_subtitle`, `driver_info_subtitle`, `cat_id`, `title`, `user_title`, `driver_title`, `city_id`, `min_charge`, `per_km_charge`, `use_linear_pricing`, `driver_per_trip` … |
| PUT | `/api/v1/admin/rate-cards/:id` | Update | JWT, roles:superadmin | `type`, `no_driver_compensation`, `cat_id`, `driver_card_subtitle`, `driver_info_subtitle`, `use_linear_pricing`, `city_id`, `driver_per_trip`, `commission_percent`, `driver_share_percent`, `driver_per_percent`, `free_waiting_time`, `start_time`, `end_time` … |
| DELETE | `/api/v1/admin/rate-cards/:id` | Remove | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/riders` | List | JWT, roles:all-staff, city-scoped | `?status`, `?a_status`, `?verification_status`, `?search` |
| POST | `/api/v1/admin/riders` | Create | JWT, roles:all-staff, city-scoped | `full_name`, `fmobile`, `smobile`, `email`, `dob`, `nationality`, `full_address`, `city_id`, `vehicle`, `vehicle_no`, `aadhar_id`, `pan_id`, `lic_id`, `rc_number` … |
| GET | `/api/v1/admin/riders/model1-suspended` | List model1 suspended | JWT, roles:all-staff, city-scoped | — |
| PATCH | `/api/v1/admin/riders/:id/model1-unsuspend` | Unsuspend model1 | JWT, roles:superadmin,admin, city-scoped | — |
| GET | `/api/v1/admin/riders/:id` | Get one | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/riders/:id/wallet-history` | Wallet history | JWT, roles:all-staff, city-scoped | — |
| POST | `/api/v1/admin/riders/:id/wallet-adjust` | Wallet adjust | JWT, roles:superadmin,admin, city-scoped | `amount`, `type`, `remark` |
| PATCH | `/api/v1/admin/riders/:id/profile` | Update profile | JWT, roles:superadmin,admin, city-scoped | `rc_owner_name`, `rc_owner_aadhar_number`, `aadhar_id`, `pan_id`, `lic_id`, `rc_number`, `reg_num` |
| PUT | `/api/v1/admin/riders/:id/models/:packageId/toggle` | Toggle model | JWT, roles:superadmin,admin, city-scoped | `enabled` |
| POST | `/api/v1/admin/riders/:id/kyc-decision` | Kyc decision | JWT, roles:all-staff, city-scoped | `document_type`, `record_id`, `is_approve`, `rejection_reason` |
| PATCH | `/api/v1/admin/riders/:id/status` | Toggle status | JWT, roles:superadmin,admin, city-scoped | `status`, `reason` |
| PATCH | `/api/v1/admin/riders/:id/payment` | Set payment complete | JWT, roles:superadmin,admin, city-scoped | `payment_complete` |
| DELETE | `/api/v1/admin/riders/:id` | Remove | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/trial-drivers` | List | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/trial-drivers` | Create | JWT, roles:superadmin,admin, city-scoped | `full_name`, `fmobile`, `vehicle`, `city_id`, `trial_orders_allowed` |
| POST | `/api/v1/admin/trial-drivers/:id/block` | Block | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/trial-drivers/:id/remove` | Remove | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/trial-drivers/:id/upgrade` | Upgrade | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/training/config` | Get config | JWT | — |
| PUT | `/api/v1/admin/training/config` | Update config | JWT, roles:superadmin,admin | `video_url`, `video_title` |
| GET | `/api/v1/admin/training/progress` | List progress | JWT, roles:all-staff | `?status`, `?search` |
| POST | `/api/v1/admin/training/progress/:riderId/reset` | Reset progress | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/orders/scheduled` | List scheduled | JWT, roles:all-staff, city-scoped | `?date`, `?status` |
| POST | `/api/v1/admin/orders/scheduled/:id/assign-driver` | Assign scheduled driver | JWT, roles:all-staff, city-scoped | `rider_id`, `notify_driver_now` |
| GET | `/api/v1/admin/orders/next-day` | List next day | JWT, roles:all-staff, city-scoped | `?date`, `?status` |
| POST | `/api/v1/admin/orders/next-day/suggest-sequence` | Suggest next day sequence | JWT, roles:all-staff, city-scoped | `rider_id`, `order_ids` |
| POST | `/api/v1/admin/orders/next-day/assign-batch` | Assign next day batch | JWT, roles:all-staff, city-scoped | `rider_id`, `sequence`, `notify_driver_now` |
| GET | `/api/v1/admin/orders` | List | JWT, roles:all-staff, city-scoped | `?status`, `?date`, `?page`, `?limit` |
| GET | `/api/v1/admin/orders/:id` | Get one | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/orders/:id/invoice` | Invoice | JWT, roles:all-staff, city-scoped | — |
| POST | `/api/v1/admin/orders/:id/assign-rider` | Assign rider | JWT, roles:all-staff, city-scoped | `rider_id` |
| PUT | `/api/v1/admin/orders/:id` | Update | JWT, roles:superadmin,admin, city-scoped | — |
| POST | `/api/v1/admin/orders/:id/cancel` | Cancel | JWT, roles:superadmin,admin, city-scoped | `comment`, `apply_cancellation_fee` |
| GET | `/api/v1/admin/customers` | List | JWT, roles:all-staff, city-scoped | `?status`, `?search`, `?page`, `?limit` |
| GET | `/api/v1/admin/customers/:id` | Get one | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/customers/:id/wallet-history` | Wallet history | JWT, roles:all-staff, city-scoped | — |
| PATCH | `/api/v1/admin/customers/:id/status` | Toggle status | JWT, roles:superadmin,admin, city-scoped | `status`, `reason` |
| POST | `/api/v1/admin/customers/:id/wallet-adjust` | Wallet adjust | JWT, roles:superadmin,admin, city-scoped | `amount`, `type`, `remark` |
| GET | `/api/v1/admin/wallet-adjustments` | List | JWT, roles:superadmin | `?wallet_type`, `?type`, `?from`, `?to`, `?page`, `?limit` |
| DELETE | `/api/v1/admin/customers/:id` | Remove | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/payouts` | List | JWT, roles:superadmin,admin, city-scoped | `?status` |
| POST | `/api/v1/admin/payouts/:id/approve` | Approve | JWT, roles:superadmin,admin | `transaction_reference`, `payment_proof_url` |
| POST | `/api/v1/admin/payouts/:id/reject` | Reject | JWT, roles:superadmin,admin | `rejection_reason` |
| GET | `/api/v1/admin/settlements` | List | JWT, roles:superadmin,admin, city-scoped | `?status`, `?rider_id`, `?user_id`, `?page`, `?limit` |
| GET | `/api/v1/admin/settlements/:id` | Detail | JWT, roles:superadmin,admin, city-scoped | — |
| POST | `/api/v1/admin/settlements/:id/resolve` | Resolve | JWT, roles:superadmin,admin, city-scoped | `outcome`, `note` |
| POST | `/api/v1/admin/settlements/:id/convert-to-customer` | Convert to customer | JWT, roles:superadmin,admin, city-scoped | — |
| GET | `/api/v1/admin/custom-orders` | List | JWT, roles:all-staff, city-scoped | `?status` |
| GET | `/api/v1/admin/custom-orders/:id/bids` | Get bids | JWT, roles:all-staff, city-scoped | — |
| POST | `/api/v1/admin/custom-orders/:id/convert` | Convert | JWT, roles:superadmin,admin, city-scoped | `rider_id`, `final_agreed_price` |
| GET | `/api/v1/admin/marketing/banners` | List banners | JWT | `?city_id` |
| POST | `/api/v1/admin/marketing/banners` | Create banner | JWT, roles:superadmin,admin | `img`, `city_id`, `status` |
| PUT | `/api/v1/admin/marketing/banners/:id` | Update banner | JWT, roles:superadmin,admin | `img`, `status` |
| DELETE | `/api/v1/admin/marketing/banners/:id` | Delete banner | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/marketing/coupons` | List coupons | JWT | — |
| POST | `/api/v1/admin/marketing/coupons` | Create coupon | JWT, roles:superadmin | `c_title`, `ctitle`, `c_value`, `c_desc`, `c_img`, `min_amt`, `ulimit`, `cusefor`, `city`, `status`, `cdate` |
| PUT | `/api/v1/admin/marketing/coupons/:id` | Update coupon | JWT, roles:superadmin | `c_title`, `ctitle`, `c_value`, `c_desc`, `c_img`, `min_amt`, `ulimit`, `cusefor`, `city`, `status` |
| DELETE | `/api/v1/admin/marketing/coupons/:id` | Delete coupon | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/marketing/premium-plans` | List premium plans | JWT | `?plan_for`, `?city`, `?status` |
| GET | `/api/v1/admin/marketing/premium-plans/purchases` | List plan purchases | JWT, roles:all-staff, city-scoped | `?page`, `?limit`, `?plan_for`, `?status`, `?from`, `?to`, `?q` |
| POST | `/api/v1/admin/marketing/premium-plans` | Create premium plan | JWT, roles:superadmin | `plan_name`, `plan_for`, `price` |
| PUT | `/api/v1/admin/marketing/premium-plans/:id` | Update premium plan | JWT, roles:superadmin | — |
| DELETE | `/api/v1/admin/marketing/premium-plans/:id` | Delete premium plan | JWT, roles:superadmin | — |
| POST | `/api/v1/admin/notifications/send` | Send | JWT, roles:superadmin,admin | `target_type`, `city_id`, `target_id`, `target_identifier`, `title`, `message`, `image_url`, `notification_type` |
| GET | `/api/v1/admin/notifications/history` | History | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/notifications/recipients` | Get recipients | JWT, roles:superadmin,admin | `?type` |
| GET | `/api/v1/admin/referrals/settings` | Get settings | JWT | — |
| PUT | `/api/v1/admin/referrals/settings` | Update settings | JWT, roles:superadmin | `user_point`, `driver_point`, `min_trip_unlock`, `point_value`, `referral_enabled`, `share_message`, `ride_discount_percent`, `lead_referral_points`, `lead_verification_window_days`, `signup_bonus_points`, `plan_purchase_enabled`, `plan_points_max_percent` |
| GET | `/api/v1/admin/referrals/users` | List user referrals | JWT, roles:all-staff, city-scoped | `?page`, `?limit`, `?search` |
| GET | `/api/v1/admin/referrals/point-log` | List point log | JWT, roles:all-staff, city-scoped | `?page`, `?limit`, `?source`, `?user_type` |
| GET | `/api/v1/admin/referrals/search-target` | Search target | JWT, roles:superadmin,admin, city-scoped | — |
| POST | `/api/v1/admin/referrals/adjust-points` | Adjust points | JWT, roles:superadmin,admin | `user_id`, `user_type`, `points`, `type`, `reason` |
| POST | `/api/v1/admin/reward-plans/assign-now` | Assign now | JWT, roles:superadmin,admin | `user_id`, `user_type`, `plan_id` |
| POST | `/api/v1/admin/reward-plans/set-pending` | Set pending | JWT, roles:superadmin,admin | `user_id`, `plan_id` |
| DELETE | `/api/v1/admin/reward-plans/pending/:id` | Cancel pending | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/reward-plans/pending/:userId` | Get pending | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/ride-milestones` | List milestones | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/ride-milestones/:id/claims` | List milestone claims | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/ride-milestones` | Create milestone | JWT, roles:superadmin,admin | `rides_required`, `plan_id` |
| PUT | `/api/v1/admin/ride-milestones/:id` | Update milestone | JWT, roles:superadmin,admin | `rides_required`, `plan_id`, `status` |
| DELETE | `/api/v1/admin/ride-milestones/:id` | Delete milestone | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/ride-amount-rewards` | List amount rewards | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/ride-amount-rewards/:id/claims` | List amount reward claims | JWT, roles:superadmin,admin | — |
| POST | `/api/v1/admin/ride-amount-rewards` | Create amount reward | JWT, roles:superadmin,admin | `min_amount`, `plan_id`, `max_customers` |
| PUT | `/api/v1/admin/ride-amount-rewards/:id` | Update amount reward | JWT, roles:superadmin,admin | `min_amount`, `plan_id`, `max_customers`, `status` |
| DELETE | `/api/v1/admin/ride-amount-rewards/:id` | Delete amount reward | JWT, roles:superadmin,admin | — |
| GET | `/api/v1/admin/driver-leads` | List leads | JWT, roles:all-staff | `?status`, `?type`, `?lead_type` |
| POST | `/api/v1/admin/driver-leads/:id/verify` | Verify lead | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/driver-leads/:id/reject` | Reject lead | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/driver-leads/:id/send-invite` | Send invite | JWT, roles:all-staff | — |
| GET | `/api/v1/admin/registration-leads` | List leads | JWT, roles:all-staff | `?status` |
| POST | `/api/v1/admin/registration-leads/:id/send-reminder` | Send reminder | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/registration-leads/:id/status` | Update status | JWT, roles:all-staff | `status` |
| GET | `/api/v1/admin/user-leads` | List user leads | JWT, roles:all-staff | `?status`, `?type`, `?lead_type`, `?user_id`, `?search` |
| POST | `/api/v1/admin/user-leads/:id/verify` | Verify lead | JWT, roles:all-staff | — |
| POST | `/api/v1/admin/user-leads/:id/reject` | Reject lead | JWT, roles:all-staff | — |
| GET | `/api/v1/admin/user-leads/export` | Export user leads | JWT, roles:all-staff | `?status`, `?type`, `?lead_type`, `?user_id` |
| GET | `/api/v1/admin/settings` | Get settings | JWT, roles:superadmin | — |
| PUT | `/api/v1/admin/settings` | Update settings | JWT, roles:superadmin | `flags` |
| DELETE | `/api/v1/admin/settings/flags/:key` | Delete flag | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/settings/payment-gateways` | List payment gateways | JWT, roles:superadmin | — |
| PUT | `/api/v1/admin/settings/payment-gateways/:id` | Update payment gateway | JWT, roles:superadmin | `title`, `img`, `attributes`, `status`, `subtitle`, `p_show` |
| GET | `/api/v1/admin/analytics/overview` | Overview | JWT, roles:superadmin,admin, city-scoped | — |
| POST | `/api/v1/admin/analytics/sales-report` | Sales report | JWT, roles:superadmin,admin | `start_date`, `end_date`, `city_id`, `status` |
| GET | `/api/v1/admin/analytics/month-comparison` | Month comparison | JWT, roles:superadmin,admin | `?year`, `?city_id` |
| GET | `/api/v1/admin/analytics/city-comparison` | City comparison | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/finance/ledger` | Get ledger overview | JWT, roles:superadmin,admin, city-scoped | `?city_id` |
| GET | `/api/v1/admin/finance/ledger/parties` | Get party breakdown | JWT, roles:superadmin,admin, city-scoped | `?city_id` |
| GET | `/api/v1/admin/finance/ledger/export` | Export ledger csv | JWT, roles:superadmin,admin, city-scoped | `?city_id` |
| GET | `/api/v1/admin/fleet/live-tracking` | Live tracking | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/fleet/driver-activity` | Driver activity | JWT, roles:all-staff, city-scoped | `?rider_id`, `?date` |
| GET | `/api/v1/admin/fleet/active-trips` | Active trips | JWT, roles:all-staff, city-scoped | — |
| GET | `/api/v1/admin/trip-feedback` | List | JWT, roles:all-staff, city-scoped | `?page`, `?limit`, `?no_entry`, `?rating`, `?from`, `?to`, `?search` |
| GET | `/api/v1/admin/customer-feedback` | List customer feedback | JWT, roles:all-staff, city-scoped | `?page`, `?limit`, `?rating`, `?from`, `?to`, `?search` |
| GET | `/api/v1/admin/receiver-feedback` | List receiver feedback | JWT, roles:all-staff, city-scoped | `?page`, `?limit`, `?rating`, `?from`, `?to`, `?search` |
| GET | `/api/v1/admin/cancel-reasons` | List cancel reasons | JWT | `?type` |
| POST | `/api/v1/admin/cancel-reasons` | Create cancel reason | JWT, roles:superadmin | `reason`, `type` |
| PUT | `/api/v1/admin/cancel-reasons/:id` | Update cancel reason | JWT, roles:superadmin | `reason`, `type`, `status` |
| DELETE | `/api/v1/admin/cancel-reasons/:id` | Delete cancel reason | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/goods-types` | List goods types | JWT | — |
| POST | `/api/v1/admin/goods-types` | Create goods type | JWT, roles:superadmin | `name`, `sort_order` |
| PUT | `/api/v1/admin/goods-types/:id` | Update goods type | JWT, roles:superadmin | `name`, `status`, `sort_order` |
| DELETE | `/api/v1/admin/goods-types/:id` | Delete goods type | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/restricted-items` | List restricted items | JWT | — |
| POST | `/api/v1/admin/restricted-items` | Create restricted item | JWT, roles:superadmin | `name`, `sort_order`, `description` |
| PUT | `/api/v1/admin/restricted-items/:id` | Update restricted item | JWT, roles:superadmin | `name`, `description`, `status`, `sort_order` |
| DELETE | `/api/v1/admin/restricted-items/:id` | Delete restricted item | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/booking-guidelines` | List booking guidelines | JWT | — |
| POST | `/api/v1/admin/booking-guidelines` | Create booking guideline | JWT, roles:superadmin | `text`, `sort_order` |
| PUT | `/api/v1/admin/booking-guidelines/:id` | Update booking guideline | JWT, roles:superadmin | `text`, `status`, `sort_order` |
| DELETE | `/api/v1/admin/booking-guidelines/:id` | Delete booking guideline | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/pages` | List pages | JWT | — |
| POST | `/api/v1/admin/pages` | Create page | JWT, roles:superadmin | `title`, `description`, `status` |
| PUT | `/api/v1/admin/pages/:id` | Update page | JWT, roles:superadmin | `title`, `description`, `status` |
| DELETE | `/api/v1/admin/pages/:id` | Delete page | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/faqs` | List faqs | JWT | — |
| POST | `/api/v1/admin/faqs` | Create faq | JWT, roles:superadmin | `question`, `answer`, `status` |
| PUT | `/api/v1/admin/faqs/:id` | Update faq | JWT, roles:superadmin | `question`, `answer`, `status` |
| DELETE | `/api/v1/admin/faqs/:id` | Delete faq | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/questions` | List questions | JWT, roles:superadmin | — |
| POST | `/api/v1/admin/questions` | Create question | JWT, roles:superadmin | `question`, `type`, `status` |
| PUT | `/api/v1/admin/questions/:id` | Update question | JWT, roles:superadmin | `question`, `type`, `status` |
| DELETE | `/api/v1/admin/questions/:id` | Delete question | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/questions/:id/options` | List options | JWT, roles:superadmin | — |
| POST | `/api/v1/admin/questions/:id/options` | Create option | JWT, roles:superadmin | `title` |
| PUT | `/api/v1/admin/questions/:id/options/:optionId` | Update option | JWT, roles:superadmin | `title`, `status` |
| DELETE | `/api/v1/admin/questions/:id/options/:optionId` | Delete option | JWT, roles:superadmin | — |
| GET | `/api/v1/admin/bot-file` | Get bot file | JWT, roles:superadmin,admin | — |
| PUT | `/api/v1/admin/bot-file` | Update bot file | JWT, roles:superadmin | `content` |
| POST | `/api/v1/admin/bot-file/upload` | Upload bot file | JWT, roles:superadmin | — |

### 7.10 `/api/v1/whatsapp` — WhatsApp bot control (superadmin only)

_7 endpoints · source: `backend/src/routes/whatsappRoutes.js`_

| Method | Path | Purpose (from handler) | Access | Inputs detected in code |
|---|---|---|---|---|
| GET | `/api/v1/whatsapp/status` | (inline) | JWT, roles:superadmin | — |
| POST | `/api/v1/whatsapp/request-pairing-code` | (inline) | JWT, roles:superadmin, rate-limited | — |
| POST | `/api/v1/whatsapp/request-qr` | (inline) | JWT, roles:superadmin, rate-limited | — |
| POST | `/api/v1/whatsapp/send-notification` | (inline) | JWT, roles:superadmin,admin, rate-limited | — |
| POST | `/api/v1/whatsapp/switch-account` | (inline) | JWT, roles:superadmin, rate-limited | — |
| POST | `/api/v1/whatsapp/logout` | (inline) | JWT, roles:superadmin | — |
| POST | `/api/v1/whatsapp/calculate-fare` | (inline) | rate-limited | — |

---

## Part 8 — Socket.io events

One Socket.io server on the same host/port as REST (CORS `*`). Rooms: `driver_<rider_id>`, `customer_<uid>`, `order_<order_id>`, `admins_all`, `admin_super`, `admin_city_<city_id>`. On reconnect, `driver:join` / `customer:join` automatically re-join the user's active order room.

### Client → server

| Event | Sender | Payload | Effect |
|---|---|---|---|
| `driver:join` | Driver | `{rider_id}` | Join `driver_<id>` (+ active order room); caches the rider's city for admin pings |
| `driver:leave` | Driver | `{rider_id}` | Leave the room |
| `customer:join` | Customer | `{user_id, order_id?}` | Join `customer_<uid>` and, if given (or an active order exists), `order_<id>` |
| `admin:join` | Admin panel | `{token}` | Verifies the admin JWT; joins `admins_all` plus `admin_super` or `admin_city_<id>`; replies `admin:join:ack` |
| `order:accept` | Driver | `{rider_id, order_id}` | Atomic claim → `order:accept:ack` `{Result,msg,…order data}`; customer gets `order:assigned`; others `order:dismiss` |
| `order:reject` | Driver | `{rider_id, order_id, package_id}` | Marks the request rejected, releases the driver lock, advances the cascade |
| `order:driver_cancel` | Driver | `{rider_id, order_id, reason}` | → `order:driver_cancel:ack` |
| `order:status_update` | Driver | `{rider_id, order_id, status, lat?, lng?, early_drop?}` | `status` = arrived / pickup / complete … → `order:status_update:ack`; fans out `order:status_changed` or `order:completed` to `order_<id>` |
| `driver:location_ping` | Driver | `{rider_id, order_id, lat, lng, heading}` | Broadcast `driver:location_stream` to `order_<id>`; updates in-memory live position; throttled DB write |

### Server → driver

`order:request` (popup; payload has order/package ids, addresses + coordinates, stops, goods type, **per-driver fare**, customer rating/orders, `popup_duration`, `expires_at`, `schedule_date_time` for scheduled priority offers) · `order:dismiss` `{order_id, reason: accepted_by_other | timeout | cancelled_by_user, package_id}` · `order:direct_assign` (admin/force assign, no accept) · `order:next_day_assigned` `{orders}` · `queue:update` (Monthly-driver queue changed) · `order:customer_cancelled` · `order:scheduled_cancelled` · `order:destination_updated` / `order:pickup_updated` / `order:stop_added` · `settlement:updated` · acks (`order:accept:ack`, `order:status_update:ack`, `order:driver_cancel:ack`).

### Server → customer

`order:assigned` (driver, vehicle, OTP, live position) · `order:status_changed` · `order:completed` · `order:no_driver_found` (+`compensation_amount`) · `order:guarantee_pending` `{order_id, amount, deadline_at}` · `order:driver_cancelled` · `order:schedule_confirm` · `order:destination_updated` / `order:pickup_updated` / `order:stop_added` · `order:next_day_assigned` · `order:trip_progress` (automation milestones) · `driver:location_stream` · `settlement:updated`.

### Server → admin

`admin:new_order`, `admin:order_status_update`, `admin:dispatch_alert` (no-driver / guarantee alerts), `admin:driver_kyc_submitted`, `admin:driver_kyc_update`, `admin:driver_status_update` (online/offline, socket connected), `admin:custom_order_update`, `admin:payout_request`, `admin:payout_update`, `admin:dashboard_refresh`, `admin:live_driver_ping`.

**Fallback:** every driver/customer event that matters also goes out as an **FCM push** (`pushNotifier`) so a killed app still reacts (e.g. a driver tapping Accept on the notification opens the app and claims the order).

---

## Part 9 — Background jobs

All jobs are `setInterval`s in `backend/src/server.js` (single Node process; DB-anchored so a restart never loses state).

| Job | Interval | What it does |
|---|---|---|
| Trip event outbox flush (`tripEventNotifier.flushTripEvents`) | 15 s | Re-sends unsent live-update pushes (at-least-once) |
| Startup reconciliation (`reconcileStaleOffersOnStartup`) | once at boot | Closes orphaned offers/orders older than 120 s, skipping guarantee-held orders |
| Booking Guarantee sweep (`bookingGuaranteeService.expireDue`) | 15 s (+5 s after boot) | Expire overdue cases: cancel, refund, compensate |
| Advance-payment timeout (`sweepExpiredAdvancePayments`) | 5 s | Cancel orders whose 2-minute advance window passed (credits wallet if payment lands late) |
| OTP no-show (`sweepOverduePickups`) | 60 s | Auto-cancel orders where the customer didn't give the OTP in time |
| Relocation ceiling (`sweepPickupRelocationCeiling`) | 60 s | Force-resolve pickups strung out beyond the ceiling |
| Settlement sweep (`settlementSweep.sweepSettlements`) | 60 s | Reminders, "Unsettled" escalation (idempotent via `last_reminder_at`/`reminders_sent`) |
| Scheduled orders (`sendScheduledOrderReminders` + `dispatchDueScheduledOrders`) | 30 s | Customer confirm/reminder pushes; go-live → priority offer → cascade |
| Lead expiry (`driverLeadService.expireStaleLeads`) | 1 h | Expire verified driver leads past their window |
| Daily Driver auto-enrol (`runAutoEnrollJob`) | 1 h | Create tomorrow's enrolments (idempotent) |
| WhatsApp bot start | at boot | Unless `DISABLE_WHATSAPP_BOT=true` |

Daily Driver settlement is computed lazily when the duty window closes (first ping/read after `duty_end_time`, or punch-out), not by a cron.

---

## Part 10 — Data model

MySQL via Prisma (`backend/prisma/schema.prisma`, **108 models**). Naming is legacy-mixed (`tbl_*` from the old PHP system, newer tables un-prefixed). The live DB drifts from `schema.prisma` in places (some columns such as `pkg_order.advance_payment` exist in MySQL but not in Prisma, so they are read/written with raw SQL). **Always apply new SQL by hand on production** — see Part 13.

| Domain | Tables |
|---|---|
| **Orders** | `pkg_order` (central), `pkg_order_stops`, `pkg_order_wait_timer`, `pkg_order_interest`, `order_status_history`, `Pkg_tracking`, `tbl_order_requests` (per-driver popup rows: sent/accepted/timeout/rejected), `tbl_order_items`, `buy_order`, `buy_order_item`, `make_list_item`, `tbl_custom_order`, `tbl_custom_order_bid`, `tbl_user_favorite_order`, `reject_rider_list` |
| **Trip automation** | `driver_trip_progress`, `driver_trip_location`, `driver_trip_event` (+ outbox) |
| **Pricing & catalog** | `tbl_package` (Models/rate cards), `pkg_category`, `tbl_vechicle`, `tbl_vehicle_details`, `tbl_city`, `service_zone`, `tbl_geofence_zones`, `tbl_goods_type`, `tbl_restricted_item`, `tbl_booking_guideline`, `tbl_cancel_reason`, `setting` (singleton), `app_settings` (key/value flags), `payout_setting` |
| **Customers** | `tbl_user`, `tbl_address`, `tbl_user_device`, `tbl_otp`, `tbl_fav_driver`, `tbl_favorite_driver`, `tbl_user_blocked_driver`, `tbl_notification`, `tbl_notification_logs`, `tbl_code` (country codes), `tbl_banner`, `tbl_coupon`, `tbl_page`, `tbl_faq` |
| **Drivers** | `tbl_rider`, `tbl_rider_delivery_type`, `tbl_rider_location`, `tbl_personal_doc` (KYC), `tbl_bank_account`, `tbl_eme_contact`, `tbl_kit`, `tbl_rnoti`, `driver_activity`, `driver_training_progress`, `driver_withdraw_requests`, `tbl_survery_answer`, `tbl_text_answer`, `tbl_question`, `tbl_option`, `tbl_dynamic`, `tbl_payment_list`, `tbl_joining_plan`, `tbl_plan_payment` |
| **Money** | `tbl_wallet_history` (single ledger for customer+driver wallets), `order_settlement`, `order_settlement_event`, `order_receiver_pay`, `order_track_link`, `order_receiver_feedback`, `order_driver_feedback`, `order_customer_feedback` |
| **Plans & rewards** | `tbl_premium_plan`, `tbl_user_plan_subscription`, `tbl_plan_benefit_log`, `tbl_pending_reward_plan`, `tbl_ride_milestone_reward(_applied)`, `tbl_ride_amount_reward(_applied)` |
| **Referrals & leads** | `tbl_referral`, `tbl_referral_point_log`, `tbl_referral_setting`, `tbl_user_referrals`, `user_referal_manage`, `tbl_driver_lead`, `tbl_registration_lead` |
| **Daily / Monthly drivers** | `daily_driver_plan`, `daily_driver_enrollment`, `daily_driver_auto_enroll`, `daily_driver_duty_log`, `daily_driver_ledger`; legacy `monthly_driver_contract`, `driver_duty_log`, `monthly_driver_ledger`, `driver_order_queue`, `duty_early_start_request` |
| **Favorite routes** | `driver_favorite_route`, `driver_favorite_route_state`, `favorite_route_settings`, `favorite_route_audit` |
| **Free booking / guarantee** | `free_booking_setting`, `free_booking_pool`, `free_booking_order`, `booking_guarantee_case`, `booking_guarantee_audit` |
| **Admin** | `admin` (staff accounts: username, bcrypt hash, role, city_id, status) |

Important columns on `pkg_order`: `uid`, `rid`, `o_status`, `order_status`, `booking_type`, `schedule_date_time`, `category`, `delivery_type` (accepted package), `allowed_delivery_types` (JSON), `plat/plong/dlat/dlong`, `distance`, `d_charge`, `total_dcharge`, `driver_earning`, `commission`, `radius_charge`, `extra_mile_charge`, `wating_charge`, `free_waiting_time`, `otp`, `p_method_id`, `trans_id`, `payment_status`, `advance_payment` (raw), `cou_amt`, `referral_points_used/amount`, `goods_type_*`, `body_type`, `next_day_sequence`, `priority_notify_sent`, `driver_notify_sent`, `pickup_otp_mismatch_flag`, `city_id`.

Important columns on `tbl_rider`: `a_status` (online), `status` (active/blocked), `verification_status`, `all_verify`, `payment_complete`, `vehicle`, `body_type`, `rlats/rlongs` + `rloc_updated_at` (live position + freshness), `wallet_balance`, `fcm_token`, `monthly_plan`, `trial_status/trial_orders_allowed/trial_orders_completed`, `model1_miss_streak`, `model1_suspended_until`.

---

## Part 11 — Admin panel

React + Vite SPA in `frontend/`. Left navigation (`frontend/src/config/navigation.js`) filters by role; real-time alerts arrive over the admin socket (toasts + a persistent Booking Guarantee banner in `AppShell`).

| Group | Page (route) | What it does |
|---|---|---|
| **Operations** | Dashboard `/dashboard` | KPIs, live counters |
| | Live Mission Control `/fleet/live-tracking` | Live drivers on a map + active trips |
| | Live Orders `/orders` | Search/filter all orders, order drawer (stops, goods type, invoice), assign rider, edit, cancel; guarantee countdown badge |
| | Scheduled Orders `/orders/scheduled` | Upcoming scheduled orders, interested-driver counts, manual pre-assign |
| | Next Day Orders `/orders/next-day` | Multi-select, suggest sequence, assign batch |
| | Custom Orders (Bidding) `/custom-orders` | View custom orders + bids, convert |
| | Drivers Fleet `/drivers` | Driver list/detail: KYC, wallet adjust + history, Models toggle, block, payment flag, training status |
| | Favorite Routes `/favorite-routes` | Routes, metrics, per-city settings |
| | Monthly Drivers `/monthly-drivers` | Legacy salaried-driver contracts, early-start requests, ledger, queue |
| | Daily Drivers `/daily-drivers` | Plans, enrolments, pending-approval queue, ledger, force-assign |
| | Free Booking Offer `/free-booking` | Settings, offer pool, audit, lock/unlock |
| | Booking Guarantee `/booking-guarantee` | Assignment time setting + case history/audit |
| | Driver Duty Logs `/fleet/driver-activity` | Online/duty history |
| | Trip Feedback `/trip-feedback` | Driver / Customer / Receiver ratings |
| | Driver Training `/driver-training` | Video completion % per driver, reset |
| | Driver Leads Queue `/driver-leads` | Verify/reject/invite contact referrals |
| | Incomplete Registrations `/registration-leads` | Remind / update status |
| | Trial Drivers `/trial-drivers` | Add/block/remove/upgrade |
| | User Contact Referrals `/user-leads` | Customer contact leads + CSV export |
| | KYC Approval Dock `/kyc` | Review documents, approve/reject |
| | Customers `/customers` | Profile, wallet adjust/history, block, delete |
| **Fleet & Pricing** | Service Zones `/service-zones` | Geofence polygons |
| | Rate Cards `/rate-cards` | Packages/Models, slab pricing editor, simulate fare, generate/sync models, driver info sections, no-driver compensation |
| | Package Categories / Vehicle Types / Operational Cities | Master data CRUD (category specs, stop limits, allowed body types) |
| **Financials & Growth** | Profit & Revenue `/profit-revenue` | Ledger overview, by party, CSV |
| | Monthly Duty & Salary `/monthly-attendance` | Attendance report |
| | Withdrawal Requests `/payouts` | Approve/reject (legacy path) |
| | Trip Settlements `/settlements` | List, detail timeline, resolve, convert to customer mode |
| | Wallet Adjustments `/wallet-adjustments` | Audit of manual adjustments (superadmin) |
| | Premium Plans `/marketing/premium-plans` | Customer + driver plans, purchase history |
| | Promo Coupons / App Banners / Push Notifications | Marketing |
| | Referral Network `/referrals` | Settings, per-user referrals, point log, adjust points, reward plans |
| | Ride Milestones `/ride-milestones` | Milestone + amount rewards and claims |
| **CMS & Settings** | Reports `/reports` | Sales/month/city comparisons |
| | FAQs, Legal Pages, Cancellation Reasons, Goods Types, Restricted Items, Booking Guidelines | CMS lists |
| | Bot File `/cms/bot-file` (superadmin) | Edit/upload the WhatsApp bot knowledge file |
| | WhatsApp Account `/cms/whatsapp-account` (superadmin) | Status, QR / pairing code, switch account, logout |
| | Dynamic Questions (superadmin) | Driver survey questions + options |
| | Platform Settings / Payment Gateways `/settings` (superadmin) | All `app_settings` flags + the singleton `setting` row + gateway toggles |
| | Staff Management `/staff` | Create admins/executives, city assignment |

---

## Part 12 — Mobile apps, website and WhatsApp bot

### 12.1 Customer app — `ShifterOnline/` (Flutter, v1.0.20+20, `com.shifter.online`)

Auth: `authscreen/` (sign-in, sign-up with referral code, OTP verification, forgot password, joining fee). Home & booking: `home.dart`, `location_search_screen.dart`, `confirm_order_map.dart`, `add_stops_screen.dart`, `select_vehicle.dart` (Models, goods type, receiver-pays, coupon, free-booking and guarantee lines, schedule picker), `vehicle_details_screen.dart`, `route_review.dart`, `waiting_screen.dart` (searching / guarantee-held), `ordersuccess.dart`, live tracking (`trackingview.dart`, `trackingpoliyline.dart`, `live_driver_tracking.dart`), `chatscreen.dart`, custom/buy-anything (`custom_order_screen.dart`, `custom_order_bid_list.dart`, `my_custom_orders.dart`, `buyanythingselect.dart`, `selectastore.dart`), `wallet_page.dart`, `referral_points_screen.dart`, `free_booking_dialogs.dart`. My orders: `myorder.dart` + tabs, `customer_settlement_sheet.dart`, `change_receiver_number_dialog.dart`, `customer_feedback_sheet.dart`, `order_route_map.dart`. Profile: edit profile, addresses, favourite/blocked drivers, FAQ, premium plans, `LeadReferralScreen.dart`, `free_booking_status_card.dart`. Services: `booking_guarantee_api_service.dart`, `free_booking_api_service.dart`, `settlement_api_service.dart`. Stack: GetX, `socket_io_client`, Razorpay, FCM/OneSignal, Google Maps.

### 12.2 Driver app — `ShifterDriver/ShifterDriver/` (native Android/Java, v1.0.25, `com.shifter.driver`)

Entry/gating: `FirstActivity` (splash routing: approved → training gate → Home; pending payment → let in; trial → Home with banner; exhausted → `TrialEndedActivity`), `LoginActivity`, `SendOTPActivity`, `NewRegistrationActivity`, `ChooseVerificationMethodActivity`, `LiveFaceVerificationActivity`, `VerificationCompleteActivity`, `UnderReviewActivity`, `TrainingVideoActivity`. Core: `HomeActivity` + `HomeFragment` (online toggle, Model toggles with tier cards, earnings), `OrderDetailsActivity` (the trip screen: auto-arrival, OTP entry, waiting timers, stops, navigation), `TripPaymentActivity` (settlement "Received"), `OrderActivity`/`OrderPDFragment` history, `NextDayOrdersActivity`, `OrderItleListActivity`/scheduled trips, `CustomOrderListActivity` (bidding), `FavoriteRoutesActivity`, `EarningsActivity`/`EarningTripActivity`, `WalletActivity`/`PointsHistoryActivity`/`ClearDueSuccessActivity`/`AutoPaymentActivity`/`PaymentActivity`, `PremiumPlansActivity`/`PlanDetailActivity`, `DailyDriverPlansActivity`/`DailyDriverPlanDetailActivity`, `LeadReferralActivity`, `ProfileActivity`/`AccountFragment`, `BankAccountActivity`, `EmergencyContactActivity`, `RiderKitActivity`, `VehicleDetailsActivity`, `EngagementQuestionActivity`/`QustionFragment` (survey), `NotificationActivity`, `DriverTripFeedbackDialog`, `DemoRideActivity` (training demo).
Services: `LocationUpdateService` (foreground GPS + trip arrival observations), `OrderOverlayService` (full-screen incoming-order popup with wake lock), `NodeSocketManager` + `SocketOrderRouter` (socket → UI), Retrofit `NodeApiClient`.

### 12.3 Marketing website — `Website code Shifter online/Shifter-Online-Website/`
React 19 + TypeScript + Vite + Tailwind 4 + framer-motion + Leaflet. Pages: Home (hero, how it works, services, benefits, tracking preview, reviews, FAQ, CTA, app download), Privacy Policy, Terms & Conditions, and an `/admin` login + dashboard. Its **own small Express + MongoDB server** (`server/`, Node ≥ 22.5): `POST /auth/signup|login`, `GET /auth/me`, and admin `login`, `me`, `stats`, `users` CRUD + status. This is **separate from the main backend and database** (it holds website sign-ups/leads only).

### 12.4 WhatsApp bot (inside the backend)
- **Transport:** Baileys (WhatsApp Web multi-device) started with the server; link via QR or pairing code from the admin *WhatsApp Account* page; auth state in `.wa_auth/`; duplicate-message guard (5 min); per-chat **pause/resume** with `/stop` & start commands (persisted in `data/paused_chats.json`); 15-minute conversation sessions.
- **Understanding:** Gemini (multi-key, multi-model cascade) → Groq (`GROQ_MODEL`, multi-key) → keyword classifier fallback, parsing Hindi/Hinglish/English into intents `DRIVER_SUPPORT, CUSTOMER_SUPPORT, CANCEL_RESET, DRIVER_ONBOARDING, CALCULATE_FARE, BOOK_TRIP, TRACK_ORDER, CHECK_WALLET, FAQ_QUERY, UNKNOWN`. Knowledge comes from `data/bot_knowledge.txt` (editable in admin *Bot File*; `.docx` upload supported via mammoth).
- **Handlers:** `customerHandler` (fare question → directs to the app; tracking query; wallet balance; support), `driverHandler` (driver support/onboarding).
- **Outbound notifications** (`notifications.js`): order booked, driver assigned (with **Track live** link for the receiver), reached pickup, trip started, reached drop, delivered — to sender and receiver, de-duplicated per milestone; receiver-pay link; scheduled reminders.
- **Admin API:** `/api/v1/whatsapp/{status,request-pairing-code,request-qr,send-notification,switch-account,logout}` (superadmin; rate limited) and a public rate-limited `calculate-fare`.

---

## Part 13 — Settings, environment, deployment state

### 13.1 Admin settings (Settings page → `app_settings` key/value + the `setting` singleton)

`PUT /api/v1/admin/settings` upserts **any** key under `flags`, and the Settings page renders every flag as an editable field, so a new feature can add a setting with zero admin-UI work. Known keys and defaults (code defaults apply when a key is absent or invalid):

| Area | Key | Default | Meaning |
|---|---|---|---|
| Trip / pickup | `pickup_otp_timeout_minutes` | 7 | Customer no-show auto-cancel window after arrival |
| | `pickup_relocate_ceiling_minutes` | 35 | Hard limit from first arrival |
| | `pickup_small_move_threshold_m` | 200 | Pickup edits within this do not pause the timer |
| | `pickup_otp_mismatch_flag_m` | 500 | Flag order if OTP verified this far from confirmed pickup |
| | `pickup_timeout_driver_compensation` | 0 | ₹ to driver on OTP-timeout cancel |
| | `pickup_complete_auto_distance_m`, `pickup_timer_auto_pause_distance_m` | — | Auto "Pickup Complete" / timer pause distances |
| | `pickup_eta_buffer_minutes`, `pickup_eta_geofence_m` | 10 / — | Free-cancel ETA deadline buffer and arrival geofence |
| | `advance_payment_timeout_minutes` | 2 | Window to pay the advance |
| Scheduling | `scheduled_min_advance_minutes` | 45 | Earliest a scheduled ride may be booked |
| | `scheduled_confirm_popup_minutes` | 30 | When the customer gets the confirm popup/reminder |
| Stops & body | `max_extra_stops`, `extra_stop_charge` | 2, 0 | Multi-stop limits/charge |
| | `covered_body_charge`, `half_body_charge` | 0 | ₹ added for covered/half-body vehicles |
| Pricing | `pricing_slab_rates`, `pricing_model_multipliers` | code defaults | JSON overrides of slab ₹/km and Model offsets |
| Dispatch | `default_search_radius`, `model1_miss_limit`, `model1_suspension_hours` | 10 km, 5, 24 | |
| Driver wallet | `driver_max_due_limit`, `driver_min_withdrawal_amount` | 100, 0 | |
| Customer wallet | `customer_wallet_max_topup` | 50000 | |
| Blocking | `max_blocked_drivers_per_user` | — | |
| Settlement | `settlement_enabled`, `settlement_reminder_minutes`, `settlement_escalate_after_minutes`, `settlement_driver_block_grace_minutes`, `settlement_dispute_window_hours` | off, "10,30", 60, 10, 48 | Part 5.1 |
| Receiver pay | `receiver_pay_enabled`, `receiver_commission_max_percent`, `receiver_commission_max_amount`, `receiver_pay_link_ttl_hours` | off, 5, 0, 24 | Part 5.2 |
| Tracking | `receiver_tracking_enabled` | on | Part 5.3 |
| Guarantee | `booking_guarantee_assign_minutes` | 10 | Part 5.5 |
| Training | `training_video_url`, `training_video_title` | empty (= no gate) | Part 5.11 |
| Vehicle notes | `vehicle_detail_notes` | — | JSON list shown on vehicle Details |
| Support | `customer_care_number`, `customer_care_hours`, `how_to_use_*` | 9109114515 (receiver support default) | |
| Misc | `app_url`, `acko_session_cookie`, `sarathi_state_id`, `auto_verification_charge`, `kilo_limit`, `working_hours` … | — | Legacy / integration values |

Per-city settings live in their own tables (`free_booking_setting`, `favorite_route_settings`).

### 13.2 Environment variables (`backend/.env`; never commit)

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DB_*` | MySQL connection (**`.env` points at the DEV database**) |
| `PORT` (5000), `PUBLIC_BASE_URL` | Server port; public origin used in WhatsApp pay/track links |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Admin JWT |
| `APP_REST_KEY` | Static app key for `appKeyAuth` routes |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Payments |
| `TWOFACTOR_API_KEY` | OTP SMS (template `ShifterOnlineNEWOTP`); `ENABLE_OTP_TEST_MODE` (**dev only**) |
| `GOOGLE_MAPS_API_KEY` | Distance, ETA, routes, geocode |
| `MAPTILER_KEY`, `MAPTILER_STYLE` (`streets-v2`) | Tracking-page map tiles (restrict the key to the production domain) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` / `_JSON` / `_BASE64` | FCM |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`, `CLOUDINARY_FOLDER_PREFIX` | File storage |
| `INVOICE_SECRET_KEY` | Signs invoice links |
| `GEMINI_API_KEY(S)`, `GEMINI_MODEL`, `GROQ_API_KEY(S)`/`_2`/`_3`/`_FALLBACK`, `GROQ_MODEL` | WhatsApp bot AI |
| `DISABLE_WHATSAPP_BOT`, `PAIRING_NUMBER` | Bot control |
| `USER_APP_DOWNLOAD_URL`, `DRIVER_APP_DOWNLOAD_URL` | Links in WhatsApp messages |
| `FAVORITE_ROUTES_ENABLED` | Global switch for Favorite Routes |
| `LEGACY_IMAGES_DIR` | Fallback folder for old PHP document images |

### 13.3 Running and deploying

- **Local:** `cd backend && npm install && npm run dev` (needs MySQL + `.env`). Tests: `npm test` (Jest; 154 test files under `src/**/__tests__`). Admin panel: `cd frontend && npm install && npm run dev`.
- **Deploy (VPS):** SSH → `~/deploy.sh` (`git pull`, `npm ci`, `prisma generate`, PM2 restart in place). The server is a **single Node process** — in-memory state (driver locks, live positions, active dispatches) is not shared across processes.
- **Database changes:** `prisma/migrations/*` are **hand-applied SQL** on each database (`prisma migrate resolve --applied` records them); there are also loose scripts in `backend/sql/`. The dev DB drifts from the schema, which can cause `P2022` (missing column) 500s — always run the new SQL on prod **before** deploying the code that needs it.
- **Mobile apps:** `ShifterOnline/` and `ShifterDriver/` are in `.gitignore`; commit changes with `git add -f <exact files>` only. Built artifacts are in `apk-builds/` and `release_apks/`.

### 13.4 What is and isn't deployed (per project notes, 2026-10-07 — re-verify with `npx prisma migrate status` on each DB)

| Item | State |
|---|---|
| Migrations applied to **dev** only | The 2026-10-01 catch-up group (manager-list work) — **prod needs it before deploying that work** |
| `20261004*` settlement & customer-feedback & ride-amount, `20261005010000` receiver pay, `20261006010000/020000` tracking + receiver feedback | Written; confirm applied on each DB |
| `20261006030000` + `20261007010000` Free Booking Offer | **Not applied anywhere** (per notes) |
| `20261007020000` Booking Guarantee | **Not applied anywhere**; smoke test **not run**; after deploy set per-package compensation + assignment time |
| Settlement + Receiver Pays | Built; **dark by default**. Enable settlement only after the new customer + driver builds ship; get the CA's GST classification before enabling receiver-pay in prod |
| Training reminder push | Designed, **never built** |

---

## Part 14 — Corrections to older docs

Where the code and an older document disagree, this document follows the code. The older files now carry a "Status & corrections" banner pointing here. Substantive corrections:

| Older doc | What it said | What is true now |
|---|---|---|
| `backend/API_INTEGRATION_GUIDE.md` §1 | "There is NO login/auth API here… login stays on PHP" | Customer and driver **auth is on Node** (`/api/user/*`, `/api/rider/auth/*`, OTP via 2Factor.in, single-device login). Only the missing per-request token remains a gap |
| `backend/ORDER_FLOW_NODEJS_SPECIFICATION.md` | 5 s overlapping batch per Model; 35 s total; 10 km | **Tier-exhaustion**, 4 drivers/batch, 15 s popup, `BATCH_GAP_MS = 3 s`, **one lap only**; then Free-Booking fallback → Booking Guarantee hold instead of instant cancel. Eligibility also excludes blocked drivers, stale GPS, settlement-blocked drivers, negative wallets beyond the due limit. The file's section 2.1 exposed the real DB host/name (now replaced with placeholders) |
| `backend/README.md` | Minimal setup | Rewritten pointer to this document |
| `php-node-order-flow-bridge` spec/plan (2026-09-01) | Keep PHP apps, bridge to Node | **Superseded and removed.** Both apps call Node directly. Do not recreate the bridge |
| `customer-app-node-socket-integration`, `driver-app-node-socket-integration` | Migration to-do | **Done** |
| `add-stop` spec (2026-09-11) | Stops fixed at booking; no editing | Stops can also be **added after booking** (`/stops/preview|confirm`); drop and pickup can be changed too |
| `scheduled-order-priority-dispatch` spec | 30-min go-live, 15-min priority window, new event `order:scheduled_priority_offer`, endpoints `/driver/scheduled-trips/:id/interest` | Go-live **at** scheduled time (lead 0); priority window **2 min** (popup 60 s); sent as `order:request` with `schedule_date_time`; endpoints are `POST /api/rider/scheduled-trips`, `/interest`, `/interest/remove`; min advance 45 min is admin-configurable; customer **confirm popup** added |
| `payment-settlement` spec | Endpoints `/api/order/settlement/:orderId`, `/pay-online`, `/api/admin/settlement-settings`; setting names `reminder_minutes` … | Real endpoints are the `POST /api/order/settlement/*` and `/api/rider/settlement/*` family; settings are `settlement_*` keys in the generic Settings page; receiver-mode settlements are exempt from the driver dispatch block |
| `free-booking-offer` spec | "Status: draft"; endpoint `/api/customer/free-booking/check` | Built and merged; endpoints are `/api/order/free-booking/{check,status}`; `referrals_required` per-city setting added; `PREMIUM_PLAN_REQUIRED` error code; migrations pending |
| `driver-wallet-outstanding-dues` spec | Any negative balance excludes a driver from dispatch | Dispatch allows balances down to `-driver_max_due_limit` (default ₹100); below that the driver is excluded |
| `driver-training-video-gate` spec | Daily reminder push via node-cron | Reminder job **not implemented**; rest built |
| `daily-driver-system` spec | "Admin panel and driver app are separate sub-projects" | Both built (admin *Daily Drivers*, driver `DailyDriver*Activity`) |
| `receiver-pays` spec | Commission not applied to cash | Superseded by its own "Cash commission (2026-10-06)" section: commission **does** apply to cash; this document reflects that |
| `system-audit-2026-09-16` | 15 findings | Snapshot. Re-checked 2026-10-07: customer wallet withdrawal now blocked entirely; `forgot-password` now requires a recently verified OTP (but not bound to the caller). **Still present:** unauthenticated caller identity (#1), negative driver withdrawal amount only checked for truthiness (#2, driver path), driver plan purchase has no gateway verification in the controller or service (#3), monthly-driver city scoping (#13). Others not re-verified |
| `docs/driver-trip-automation.md`, `pickup-relocate-otp-timeout`, `order-goods-type`, `vehicle-detail-specs`, `driver-tier-info`, `wallet-referral-history-ledger`, `driver-contact-referral`, `trial-mode`, `next-day-booking`, `receiver-live-tracking`, `booking-guarantee` | — | Match the code; marked "Built" with a pointer here |

---

## Part 15 — Known gaps and risks

1. **No per-user authentication on customer/driver APIs and sockets** (identity = `uid`/`rider_id` in the body; socket rooms trust `rider_id`/`user_id`). Anyone who knows an id can act as that user. Deliberately deferred; fix before real traffic: issue a session token at login, verify on every REST/socket call, check resource ownership.
2. **Passwords for customers and drivers are stored and compared in plain text** (`tbl_user.password`, `tbl_rider.password`; inherited from the PHP system, noted as a "plaintext-password decision" in code). Admin accounts use bcrypt. Hash them.
3. **Client-trusted fare inputs:** for single-drop orders a positive client `distance` is trusted at creation (re-priced at accept using that stored distance), and client `total_dcharge`/`d_charge` fields are accepted. Use a server quote.
4. **Driver plan purchase is not gateway-verified server-side** (a payment-method string is accepted); customer plan payments can be replayed because `payment_txn_id` isn't unique. (Audit #3, #4.)
5. **Advance-payment verification** compares the gateway amount to the body amount, not the order's required advance (audit #6). **Trip state machine** does not fully enforce previous-state/OTP/payment prerequisites for legacy clients (audit #7).
6. **Payout approval** (legacy admin path) is not concurrency-safe and accepts negative amounts on the driver request path (audit #9).
7. **Monthly-driver admin routes** do not fully city-scope reads/writes (audit #13).
8. **Aadhaar name check** historically accepted a single matching word (audit #14).
9. **Single-process design:** driver locks, active dispatches, live positions are in memory; running two backend processes would break dispatch isolation.
10. **Schema drift** between code, dev and prod databases (raw-SQL columns, hand-applied migrations) is the most common cause of production 500s.
11. **Pending launch items:** GST on receiver commission, notification/KYC content entry, per-package compensation values, MapTiler key domain restriction, prod migrations (Part 13.4).
12. **Test debt:** a documented failing Android demo-ride unit test and 2 backend tests at the audit date; run `npm test` before every deploy.

---

## Appendix — Document map

| Need | Go to |
|---|---|
| Why/how a feature was designed | `docs/superpowers/specs/<date>-<feature>-design.md` |
| Step-by-step build history of a feature | `docs/superpowers/plans/<date>-<feature>.md` |
| Manual QA cases | `docs/testing/*` and the `*-qa.md` plans |
| Old, now-superseded integration guides | `backend/API_INTEGRATION_GUIDE.md`, `backend/ORDER_FLOW_NODEJS_SPECIFICATION.md` (carry a status banner) |
| Postman collection | `backend/Shifter-Backend.postman_collection.json` |
| WhatsApp bot company information | `backend/Shifter_Online_WhatsApp_Bot_Company_Information_Updated_v2.docx`, `backend/data/bot_knowledge.txt` |
| Code relationship graph | `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.html` (generated 2026-08-31 — regenerate with `/graphify`) |
