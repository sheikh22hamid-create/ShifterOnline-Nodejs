# Manager Task List — Remaining 8 Points Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT (8 manager points).** Delivered: driver vehicle icon on the live map, referral-point gaps, OTP-timeout fix, cancellation popup + ringtone, completed-order GPS route map, Indian languages in both apps. Prod needs the 2026-10-01 catch-up SQL. Current code-verified description: [Master Document sections 5.30a, 5.30b and 13.4](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining points (#3, #4, #5, #8, #11, #12, #13, #14) from the manager's 17-point list, plus a device test for #16.

**Architecture:** Three codebases share one Node/Express/Prisma/MySQL backend (`backend/`): the customer Flutter app (`ShifterOnline/`), the driver native-Android app (`ShifterDriver/ShifterDriver/`), and the React admin panel (`frontend/`). Each task is independently shippable. Backend changes ship with a Prisma migration + a hand-applied SQL copy in `backend/sql/`, and Jest tests. Flutter/Android changes are verified with `flutter analyze` / Gradle build plus a manual device checklist.

**Tech Stack:** Node 18 + Express + Prisma (MySQL), Jest; Flutter (GetX, google_maps_flutter); Android Java (FCM, WindowManager overlay, MediaPlayer); React + Vite admin.

**Spec:** The manager's task list quoted in the conversation of 2026-10-01 (points 1–17). Points already closed: #1, #2, #6, #7, #9, #10, #15, #17 (see commits 1b88a3d, 787555f, 93ae8b9, aaeba08, 7d5befa). #16 needs only a rebuild test.

## Global Constraints

- Git: `ShifterOnline/` and `ShifterDriver/` are gitignored — commit with `git add -f <exact files>` only.
- Dev DB is `.env` `DATABASE_URL`; schema changes are hand-applied. Every migration also gets a copy in `backend/sql/` and must be re-applied to prod by the user (never touch prod).
- Customer endpoints under `/api/users` have no auth/session (known, deliberately deferred gap). Follow the existing `uid`-in-body convention; do not build auth here.
- Ledger/wallet times are IST wall-clock labelled UTC; serialize with `formatLedgerTime` (`backend/src/utils/istTime.js`).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Backend test command: `cd backend && npx jest <path>`. Known pre-existing failure: `aadharPdfVerify.test.js` (2 tests) — ignore.
- Flutter check: `cd ShifterOnline && flutter analyze <files>` must show no `error`.

## Review Focus

- Driver goes offline/online mid-trip (#3): route trail must not gain a gap-jump line across hours.
- Order cancelled while driver app is killed / screen locked (#8): popup + ringtone must still fire, once, and stop when the driver taps/dismisses.
- Overlay permission not granted (#8): must fall back to a full-screen/heads-up notification with sound, never crash.
- Referral points = 0 or fractional point value (#13/#14): discount/purchase must never go negative or over-deduct.
- Missing translation key in a new language (#11/#12): must fall back to English, never show raw keys.
- Old completed orders with no GPS trail (#3): map must show a straight-line fallback + "route not recorded" text instead of an empty map.

---

## File Structure

| Area | Files |
|---|---|
| #5 vehicle icon | `ShifterOnline/lib/screens/myorder/live_driver_tracking.dart`, new `ShifterOnline/lib/utils/vehicle_marker.dart` |
| #13/#14 referral | `backend/src/controllers/orderController.js`, `backend/src/services/driverPlanService.js`, `frontend/src/pages/Settings.jsx` or `Referrals.jsx`, `frontend/src/pages/Referrals.jsx`, driver `PlanDetailActivity.java` / `WalletActivity.java` |
| #4 OTP timeout | `backend/src/services/tripLifecycle.js`, `backend/src/services/__tests__/tripLifecycle.test.js` |
| #8 cancel popup | `ShifterDriver/.../service/OrderOverlayService.java`, `.../MyFirebaseMessagingService.java`, `.../socket/SocketOrderRouter.java`, `.../utility/OrderAlertPlayer.java` |
| #3 route map | new migration + `driver_trip_location` model, `backend/src/services/tripRouteService.js`, `backend/src/controllers/customerContentController.js`, `ShifterOnline/lib/screens/myorder/order_route_map.dart` |
| #11 user languages | `ShifterOnline/lib/Language/language_screen.dart`, `language_string.dart` |
| #12 driver languages | `ShifterDriver/.../res/values-<lang>/strings.xml`, `.../utility/LocaleHelper.java`, language picker activity |

Execution order (cheapest/lowest-risk first): Task 1 (#5) → Task 2 (#13/#14 audit) → Task 3 (#4) → Task 4 (#8) → Task 5 (#3) → Task 6 (#11) → Task 7 (#12) → Task 8 (#16 + final).

---

### Task 1: Vehicle image for the driver's live location (#5)

**Files:**
- Create: `ShifterOnline/lib/utils/vehicle_marker.dart`
- Modify: `ShifterOnline/lib/screens/myorder/live_driver_tracking.dart:127-136` (driver Marker has no `icon`, so Google shows the default red pin)
- Modify: `ShifterOnline/lib/screens/myorder/trackingway.dart:196-230` (replace private `_loadDriverIcon` body with the shared helper; fallback hue violet → keep)

**Interfaces:**
- Produces: `Future<BitmapDescriptor?> loadVehicleMarker(String categoryName, {int width = 110})` — looks up `pickupiteam` entry whose `cat_name` equals `categoryName` (case-insensitive), downloads `Config.imageURLPath + cat_img`, resizes, returns descriptor or `null` on any failure.

- [ ] **Step 1: Confirm which screen shows the red marker.** Run the app, book an order, wait for driver assign. If the map has a default red pin that moves, it is `live_driver_tracking.dart`. Note the answer in the commit message.
- [ ] **Step 2: Create the helper** — move the download/resize code from `trackingway.dart:_loadDriverIcon` into `vehicle_marker.dart` unchanged apart from taking `categoryName` and returning `BitmapDescriptor?`.
- [ ] **Step 3: Use it in `live_driver_tracking.dart`.** Add `BitmapDescriptor? _driverIcon;` and in `initState` after `_seedOrder`: derive the category name from `widget.initialOrderData?['category']` and `_driverIcon = await loadVehicleMarker(name); if (mounted) setState(() {});`. In the `Marker(markerId: 'driver'...)` add `icon: _driverIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet),` (never red — red means "drop").
- [ ] **Step 4: Point `trackingway.dart` at the helper** so both screens share one implementation.
- [ ] **Step 5: Verify.** `flutter analyze lib/screens/myorder lib/utils/vehicle_marker.dart` → no errors. Device: bike order shows bike image rotating with `_driverBearing`; kill network → falls back to violet pin.
- [ ] **Step 6: Commit** `git add -f ShifterOnline/lib/utils/vehicle_marker.dart ShifterOnline/lib/screens/myorder/live_driver_tracking.dart ShifterOnline/lib/screens/myorder/trackingway.dart` — message `feat(customer): show vehicle image for driver's live location`.

---

### Task 2: Referral points — close the gaps (#13 user, #14 driver)

Audit result (already in code): user booking discount (`orderController.js:374-398`, admin-set percent in `tbl_referral_setting`), user plan purchase with points (`customerPlanService.js purchaseBlock`, `premium_plans_screen.dart`), driver plan purchase with points (`driverPlanService.purchaseDriverPlan`, `PlanDetailActivity.java`), driver due clearing with points (`customerWalletController.clearDueWithPoints`, `WalletActivity.java`), ledger rows in `tbl_referral_point_log`, admin view `GET /referrals/point-log`. The manager says these don't work end-to-end, so this task is **audit by test first, then fix whatever fails**.

**Files:**
- Test: `backend/src/services/__tests__/driverPlanPoints.test.js`, `backend/src/controllers/__tests__/clearDueWithPoints.test.js`, `backend/src/controllers/__tests__/orderReferralDiscount.test.js`
- Modify (only if a test exposes a bug): the file named in the failing assertion.

**Interfaces:**
- Consumes: `purchaseDriverPlan({ driverId, planId, usePoints, ... })` in `driverPlanService.js:283`; `clearDueWithPoints` handler in `customerWalletController.js`; the referral block in `orderController.createOrderCore`.
- Produces: green regression tests; any fix keeps these signatures.

- [ ] **Step 1: Write failing/guard tests for each flow** (mock `../config/db`). Cases that must pass:
  - Driver plan, `usePoints:true`, driver has 40 pts, point value 1, plan price 100 → deducts 40, `pointsAmount` 40, writes `tbl_referral_point_log` row `{user_type:'DRIVER', source:'plan_purchase', points:-40, balance_after:0}`.
  - Same with 0 points → no deduction, no negative log row.
  - Plan has `referral_enabled=false` → points ignored (documented behavior; if manager expects otherwise, see Step 4).
  - `clearDueWithPoints`: wallet −300, points 120, value 1 → points_used 120, `remaining_due` 180, wallet −180, one `tbl_wallet_history` credit row + one `tbl_referral_point_log` debit row.
  - Booking discount: percent 10, fare 200, 500 pts → discount ≤ 20, points used = ceil(20/point_value), never more than available.
- [ ] **Step 2: Run** `npx jest src/services/__tests__/driverPlanPoints.test.js src/controllers/__tests__/clearDueWithPoints.test.js src/controllers/__tests__/orderReferralDiscount.test.js` — note which fail.
- [ ] **Step 3: Fix each failing flow** minimally in its source file.
- [ ] **Step 4: Check the two gaps most likely behind the manager's complaint** and fix if confirmed: (a) driver plans only accept points when the plan has `referral_enabled` — add a per-plan "Allow referral points" toggle visible in `PremiumPlanFormModal.jsx` (field already exists in the model; verify it is editable and defaults ON for driver plans); (b) admin has no single place to see both transaction types — extend `Referrals.jsx` point-log table with `source` filter values `plan_purchase`, `ride_discount`, `due_clearance` and a user-type filter.
- [ ] **Step 5: Device check** (driver app): Plans → plan detail → "Use Points" stepper → pay → points balance and plan active; Wallet with negative balance → Clear Due → Referral Points option → due reduced.
- [ ] **Step 6: Commit** — `git add backend frontend/src` + `git add -f` any driver/user app files touched; message `fix: referral points plan purchase / due clearance / booking discount end to end`.

---

### Task 3: Pickup OTP timeout fires at 2.5 min instead of admin's 5 min (#4)

Findings so far: the sweep (`tripLifecycle.sweepOverduePickups`) and the driver countdown (`driverTripService.snapshot`) both read `app_settings.pickup_otp_timeout_minutes` correctly, no hardcoded 150s anywhere; dev DB has no such row. Elapsed = `(now − pickup_wait_start) + pickup_wait_banked_seconds`. Two timeouts can fire early: the 2-min advance-payment cancel and the relocation ceiling. The cancel text distinguishes them (`cancelOverduePickup` writes "…within X minutes of driver arrival").

**Files:**
- Modify: `backend/src/services/tripLifecycle.js:1209-1216` (cancel_reason + log the real elapsed/limit)
- Test: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `getPickupOtpTimeoutMinutes()`; `pkg_order_wait_timer` rows.
- Produces: `cancelOverduePickup` log line `OTP-timeout cancel order #<id>: elapsed=<s>s limit=<s>s banked=<s>s`.

- [ ] **Step 1: Ask the user for the `cancel_reason` and order id of one 2.5-min cancellation** (pasted from admin order detail). It tells which of the three timers fired.
- [ ] **Step 2: Write failing test** — timer row `pickup_wait_start = now − 150s`, `banked = 0`, setting `5` → `sweepOverduePickups()` must NOT cancel. Second test: `banked = 150`, start `= now − 150s`, setting `5` → cancels (documents banked behavior). Third: setting row missing → default 10 min (`PICKUP_OTP_TIMEOUT_MS`).
- [ ] **Step 3: Run** `npx jest src/services/__tests__/tripLifecycle.test.js -t "OTP"`; if the first test fails there is a real bug — fix it. If it passes, the bug is outside this sweep: use Step 1's `cancel_reason` to fix the right timer.
- [ ] **Step 4: Add the elapsed/limit log line** so the next occurrence is self-explanatory.
- [ ] **Step 5: Commit** — `fix: ...` or `test: pin OTP timeout to admin setting` depending on outcome.

---

### Task 4: Driver cancellation popup + new-order ringtone on any screen (#8)

Existing pieces: `OrderOverlayService` (WindowManager overlay used for new orders over other apps), `OrderAlertPlayer` (plays `R.raw.movigo_ringtone`), `MyFirebaseMessagingService` (routes `order_cancelled`/`advance_timeout_cancel` pushes to `SocketOrderRouter.handleOrderCancelledByCustomer`, which only sends an in-app broadcast), `USE_FULL_SCREEN_INTENT` + overlay already in the manifest. Gap: cancellation never starts the overlay or the ringtone when the app is backgrounded.

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/service/OrderOverlayService.java` (add `cancelled` mode)
- Modify: `.../socket/SocketOrderRouter.java:115-126` (`handleOrderCancelledByCustomer` starts the overlay when the app is not in foreground)
- Modify: `.../MyFirebaseMessagingService.java:70-100` (same trigger for FCM path)
- Modify: `.../utility/OrderAlertPlayer.java` (add `playOnce(Context)` using `R.raw.movigo_ringtone`, `setLooping(false)`)
- Create: `.../res/layout/overlay_order_cancelled.xml`

**Interfaces:**
- Produces: `OrderOverlayService` extra `"mode"="cancelled"` with extras `order_id`, `reason`; `OrderAlertPlayer.playOnce(Context)`; `SocketOrderRouter.showCancelOverlay(Context, String orderId, String reason)`.

- [ ] **Step 1: Layout.** `overlay_order_cancelled.xml`: title "Order Cancelled", order id, reason text, one "OK" button. Match `overlay_order_request` styling.
- [ ] **Step 2: Overlay mode.** In `onStartCommand`, before the existing `dismiss` branch: `if ("cancelled".equals(intent.getStringExtra("mode"))) { showCancelledOverlay(intent); return START_NOT_STICKY; }`. `showCancelledOverlay` inflates the layout via the same `WindowManager` params the order overlay uses (`TYPE_APPLICATION_OVERLAY`), acquires the same 15s wakelock, calls `OrderAlertPlayer.playOnce(this)`, and `removeOverlay()` on OK or after 20s (Handler).
- [ ] **Step 3: Router trigger.** In `handleOrderCancelledByCustomer`, after the existing broadcast: `if (!AppStatus.isAppInForeground()) showCancelOverlay(context, orderId, reason);` where `showCancelOverlay` checks `Settings.canDrawOverlays(context)`; if true `startForegroundService`/`startService(OrderOverlayService)` with mode cancelled; if false, post a high-priority heads-up notification (channel with sound = `movigo_ringtone`, `setFullScreenIntent`) so the driver still hears/sees it. If the app is in foreground, call `OrderAlertPlayer.playOnce` so the in-app dialog also rings.
- [ ] **Step 4: Dedupe.** Both FCM and socket can deliver the same cancel. Keep a `static String lastCancelledOrderId; static long lastCancelledAt;` and ignore a repeat within 10 s.
- [ ] **Step 5: Build.** `cd ShifterDriver/ShifterDriver && ./gradlew assembleDebug` → BUILD SUCCESSFUL.
- [ ] **Step 6: Device checklist** (Android 12+ and one Android 10 device): (a) app foreground on Home → dialog + ring; (b) driver in Google Maps → overlay over Maps + ring once; (c) screen locked → screen wakes + ring; (d) overlay permission revoked → heads-up notification with ring; (e) cancel twice rapidly → one popup.
- [ ] **Step 7: Commit** with `git add -f` for each touched driver file; message `feat(driver): show cancel popup + ringtone over any app`.

---

### Task 5: Completed-order route map with actual GPS trail and total distance (#3)

No per-order GPS trail is stored today (`tbl_rider_location` is one row per rider; `driver_trip_progress` keeps only arrival state). New storage + capture + endpoint + Flutter screen are needed.

**Files:**
- Create: `backend/prisma/migrations/20261001020000_add_driver_trip_location/migration.sql`, same SQL in `backend/sql/20261001_driver_trip_location.sql`
- Modify: `backend/prisma/schema.prisma` (add model below)
- Create: `backend/src/services/tripRouteService.js`
- Modify: `backend/src/services/driverTripService.js:45-52` (call `recordSamples` with the `samples` array already received in `progressTrip`)
- Modify: `backend/src/controllers/customerContentController.js` (new `orderRoute` handler) + `backend/src/routes/user.routes.js`
- Create: `ShifterOnline/lib/screens/myorder/order_route_map.dart`
- Modify: `ShifterOnline/lib/screens/myorder/trackingway.dart` (show "View Route" button for completed orders), `ShifterOnline/lib/Api/config.dart`
- Test: `backend/src/services/__tests__/tripRouteService.test.js`

**Interfaces:**
- Produces (schema): `model driver_trip_location { id BigInt @id @default(autoincrement()); order_id Int; rider_id Int; lat Decimal @db.Decimal(10,7); lng Decimal @db.Decimal(10,7); recorded_at DateTime @db.DateTime(3); phase Int @default(0); @@index([order_id, recorded_at]) }` (`phase`: 0 = to pickup, 1 = pickup→drop, set from `order.order_status`).
- Produces (service): `recordSamples(tx, { orderId, riderId, orderStatus, samples })` — inserts valid, de-duplicated, ≥10 m-apart samples; `buildRoute(orderId)` → `{ points: [{lat,lng,phase}], distance_km, start:{lat,lng}, pickup:{lat,lng}, otp_point:{lat,lng}|null, drop:{lat,lng}, has_trail:boolean }`.
- Produces (API): `POST /api/users/orders/route` body `{ uid, order_id }` → `{ Result, route }`; 404-style `Result:false` if the order isn't the user's.

- [ ] **Step 1: Failing tests** for `recordSamples`: drops samples with non-finite lat/lng, drops points <10 m from the previous kept one, caps at 120, stamps `phase` from status (1 → 0, 2/3 → 1). For `buildRoute`: sums haversine distance between consecutive points; `has_trail=false` + straight-line pickup→drop distance when no rows.
- [ ] **Step 2: Run to fail**, then **implement** `tripRouteService.js` using `haversineKm` from `backend/src/utils/geoDistance.js`; `otp_point` = `pkg_order_wait_timer.otp_verify_lat/lng`, `start` = first sample of phase 0.
- [ ] **Step 3: Migration + generate.** Write SQL (`CREATE TABLE driver_trip_location …`), apply to dev DB, `npx prisma generate`.
- [ ] **Step 4: Hook capture** into `progressTrip` inside the existing transaction right after the `samples` validation. Samples older than the order's `accept_time` are ignored so offline gaps don't draw a jump line (Review Focus 1).
- [ ] **Step 5: Controller + route**, owner check `pkg_order.uid === uid`; run tests.
- [ ] **Step 6: Flutter screen.** `OrderRouteMap(orderId)` calls the endpoint, draws one polyline (phase 0 dashed grey, phase 1 solid brand colour) and markers: Driver Start, Pickup (green), OTP/Final pickup (blue, only when `otp_point` differs from pickup by >50 m), Drop (red); card with `Total distance: X km` and, when `has_trail=false`, the text "Route not recorded for this order". Fit bounds to all points.
- [ ] **Step 7: Entry point.** In `trackingway.dart`, for orders whose status is Completed add a "View Route" button that does `Get.to(() => OrderRouteMap(orderId: orderid))`.
- [ ] **Step 8: Verify** `npx jest src/services/__tests__/tripRouteService.test.js`, `flutter analyze lib/screens/myorder`, device: complete a test trip, open order → route shows and distance ≈ trip distance.
- [ ] **Step 9: Commit** — `feat: record driver GPS trail per trip and show actual route on completed orders`.

---

### Task 6: National (Indian) languages in the user app (#11)

Current picker (`language_screen.dart:18-30`) lists English, Arabic, Hindi, Gujarati and 7 foreign languages. `language_string.dart` is a `Map<String, Map<String,String>>` of `locale → {english key → translation}` (2,440 lines).

**Files:**
- Modify: `ShifterOnline/lib/Language/language_screen.dart`
- Modify: `ShifterOnline/lib/Language/language_string.dart`
- Modify: `ShifterOnline/lib/main.dart` (supported locales / fallback)

**Interfaces:**
- Produces: locale list `en, hi, mr, gu, bn, ta, te, kn, ml, pa` (final list confirmed with the manager — default set above). Fallback locale `Locale('en','US')`.

- [ ] **Step 1: Confirm the language list with the user** (default: the 10 above). Foreign languages (ar, es, fr, de, id, ZA, tr, pt) are removed from the picker; keep their map data only if no code references them.
- [ ] **Step 2: Replace the picker list** with the national set, each shown by native name (हिंदी, मराठी, ગુજરાતી, বাংলা, தமிழ், తెలుగు, ಕನ್ನಡ, മലയാളം, ਪੰਜਾਬੀ, English). Use proper `Locale(languageCode, 'IN')`; remove the invalid `Locale('gu','GUJARATI')`.
- [ ] **Step 3: Generate translations.** For each new locale, add a map with every key present in the `en_US` map; script: `python scripts/gen_lang.py` reading the English keys and writing translations (translated by me, reviewed spot-check by user; keys with `$`/`%` placeholders copied verbatim).
- [ ] **Step 4: Fallback.** In the translations class, `fallbackLocale: const Locale('en','US')` in `GetMaterialApp`; add a unit test (`flutter test test/language_test.dart`) asserting every locale map has the same key set as English (missing keys fail the test).
- [ ] **Step 5: Verify.** `flutter analyze lib/Language lib/main.dart`; `flutter test test/language_test.dart`; device: switch to Marathi → home, booking, wallet screens show Marathi, no raw English keys with underscores.
- [ ] **Step 6: Commit** — `feat(customer): national Indian languages replace international list`.

---

### Task 7: Multiple Indian languages in the driver app (#12)

Driver app has `values/` (625 strings) and `values-hi/` (622); `LocaleHelper.java` exists.

**Files:**
- Create: `ShifterDriver/ShifterDriver/app/src/main/res/values-{mr,gu,bn,ta,te,kn,ml,pa}/strings.xml`
- Modify: `.../utility/LocaleHelper.java`, language picker UI (find with `grep -rn "LocaleHelper" .../activity`)
- Test: `ShifterDriver/ShifterDriver/app/src/test/java/com/shifter/driver/StringsParityTest.java`

**Interfaces:**
- Produces: `LocaleHelper.setLocale(Context, String languageCode)` persisted in `SessionManager`; picker lists the same 10 languages as Task 6 in native script.

- [ ] **Step 1: Parity script/test** — JUnit test parses every `values-*/strings.xml` and asserts keys ⊆ default `values/strings.xml` and `%s/%d` placeholder counts match per key (catches crashes from wrong format args).
- [ ] **Step 2: Create 8 translation files** from `values/strings.xml` (translatable strings only; `translatable="false"` left out), keeping placeholders verbatim; fix the 3 strings missing from `values-hi`.
- [ ] **Step 3: Picker + persistence.** Add/extend the language screen; apply locale in `attachBaseContext` of `BaseActivity` so all activities follow it; restart the task stack after change.
- [ ] **Step 4: Voice announcer.** `OrderVoiceAnnouncer`/`DemoHindiCoach` must not break when locale ≠ hi/en — fall back to English TTS (add a test or guard).
- [ ] **Step 5: Build + test** `./gradlew testDebugUnitTest assembleDebug`; device: switch to Tamil, open Home, Wallet, Order details, plan screens — no clipped text, no crash.
- [ ] **Step 6: Commit** — `feat(driver): add 8 Indian languages with parity test`.

---

### Task 8: WhatsApp import device test (#16) + final regression

- [ ] **Step 1: Rebuild user app**, install on a phone with WhatsApp and one with only WhatsApp Business: Select Drop → Import from WhatsApp → WhatsApp opens directly. On a phone with neither → Play Store (fallback intended). If the Play Store still opens with WhatsApp installed, capture phone model + Android version and inspect `AndroidManifest.xml <queries>`.
- [ ] **Step 2: Full backend run** `cd backend && npx jest` → only the 2 known `aadharPdfVerify` failures.
- [ ] **Step 3: Admin build** `cd frontend && npx vite build` → success.
- [ ] **Step 4: Report** the SQL the user must apply to prod: `20261001000000_add_user_favorite_order`, `20261001010000_add_booking_guideline`, `20261001020000_add_driver_trip_location`.
- [ ] **Step 5: Mark the 17-point list** complete/partial in the final message with commit hashes.
