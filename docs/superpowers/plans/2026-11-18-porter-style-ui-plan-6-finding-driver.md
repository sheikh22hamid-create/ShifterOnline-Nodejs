# Porter-Style UI — Plan 6: "Finding your driver" redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the countdown screen with the approved animated design: an orange road hero with a 3D vehicle, a progress bar with steps, stage messages, a trip card, guarantee and reassurance cards, and a quiet "Cancel booking" link. Search behaviour stays exactly as it is.

**Architecture:**
- **Pure timing logic** (`search_progress.dart`): it turns the search window into a fraction, a stage and an eased bar value, and is unit-tested.
- **Presentational widgets** (`finding_driver_widgets.dart`): `FindingDriverHero`, `SearchProgressCard`, `StageMessage`, `WaitingTripCard`.
- **`waiting_screen.dart`** keeps every timer, socket listener and dialog. It only:
  - records `_searchStartedAt` / order info from the order-details response it already fetches
  - swaps its `build` body
  - gives `_buildGuaranteeCard` a `late` flag

**Tech Stack:** Flutter (Dart), flutter_test. Package `goParcel`.

**Spec:** `docs/superpowers/specs/2026-11-18-finding-driver-screen-design.md`. Mockup: https://claude.ai/artifact/V1pwTeQvwcRrAdd3V1kVq9 (boards "New (A) — searching, live" and "New (A) — long wait").

## Global Constraints

- **UI only.** These stay unchanged:
  - `pksCancleOrder`, `_showCancelDialog`, `_navigateBackToHome`
  - the socket listeners, `_startTimeout` / `_timeoutTimer` / safety close, `_recoverActiveOrder`'s flow logic
  - the guarantee pending/locked states
  - `_persistWaitingOrder`
- **Copy:**
  - The stage messages are exactly the spec's four lines. Late-stage title: "Still finding your driver". Guarantee late headline: "You are covered".
  - Every new string goes through `.tr` with an English key in `lib/Language/language_string.dart`.
  - No invented numbers.
- **Colours:** v2 tokens via `AppPalette.current`. The hero band is `p.brand`; text on it uses `p.onBrand`, never white. Skyline `#3A1A0B` at 28% is allowed only as `AppPalette.current.onBrand.withValues(alpha: .28)`.
- **Guard:** `waiting_screen.dart` is already in `test/theme/legacy_colors_test.dart` `_swept`, and the new widgets file is added to it. All four guards must pass.
- **Reduce motion:** `MediaQuery.disableAnimationsOf(context)` true means no repeating animation runs.
- **Commits:** `git add -f <exact files>`, one commit per task, never push. Tests: `cd ShifterOnline && flutter test` green, and project `flutter analyze` warnings+errors ≤ 46.

## Review Focus

- **No deadline known yet** (System 1, or the screen reopened cold before order-details returns): the bar and stages still move, using time on screen over a 5-minute nominal window, and never show 100%. Test in Task 1.
- **Deadline already passed or `order_date` after the deadline** (clock skew): the fraction is clamped to [0,1], the stage is late, the bar stays ≤ 96%. Test in Task 1.
- **Missing order fields** (no `grand_total`, empty addresses): those rows are hidden and the card never shows "null" or "₹". Test in Task 2.
- **Missing 3D image** (owner hasn't sent V1–V4): `VehicleBookingAnimation` shows on the road, with no error box. Test in Task 2.
- **Reduce motion / widget tests:** with `disableAnimations: true`, `pumpAndSettle()` completes (no infinite animation is left running). Test in Task 2.

---

### Task 1: Search progress logic

**Files:**
- Create: `ShifterOnline/lib/screens/home/search_progress.dart`
- Test: `ShifterOnline/test/home/search_progress_test.dart`

**Interfaces:**
- Produces:
  - `const Duration kNominalSearchWindow = Duration(minutes: 5);`
  - `double searchFraction({DateTime? start, DateTime? deadline, required DateTime screenOpenedAt, required DateTime now})`: when both `start` and `deadline` are known and `deadline` is after `start`, it is `(now − start) / (deadline − start)`. Otherwise it is `(now − screenOpenedAt) / kNominalSearchWindow`. Always clamped to 0..1.
  - `int searchStage(double fraction)`: 0 for <0.20, 1 for <0.50, 2 for <0.80, else 3 (late).
  - `double searchBar(double fraction)`: `min(0.96, 0.04 + 0.92 * (1 − exp(−3 * fraction)))`.
  - `const List<String> kSearchStageMessages`: the spec's 4 lines, in order.

- [ ] **Step 1: Write the failing tests**
  - `fraction uses the order window when both ends are known`: start T, deadline T+10min, now T+5min → 0.5
  - `fraction falls back to time on screen over 5 minutes when no deadline`: screenOpenedAt T, now T+150s → 0.5
  - `fraction is clamped`: now after deadline → 1.0; start after deadline → falls back (not negative)
  - `stages switch at 20/50/80%`: 0.19→0, 0.2→1, 0.49→1, 0.5→2, 0.8→3, 1.0→3
  - `bar starts at 4%, rises fast, never passes 96%`: `searchBar(0) == 0.04`, `searchBar(0.2) > 0.4`, `searchBar(1) <= 0.96`, monotonic over 0..1 in 0.1 steps
  - `messages are the four approved lines`: `kSearchStageMessages.length == 4`, `[3] == 'Still looking. Your order stays active, no need to book again.'`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/search_progress_test.dart`. It should fail because the file does not exist.
- [ ] **Step 3: Implement** the four members.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/search_progress.dart ShifterOnline/test/home/search_progress_test.dart
git commit -m "feat(customer-ui): finding-driver search progress + stage logic"
```

### Task 2: Finding-driver widgets

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/finding_driver_widgets.dart`
- Modify: `ShifterOnline/test/theme/legacy_colors_test.dart` (add the new file to `_swept`)
- Test: `ShifterOnline/test/home/finding_driver_widgets_test.dart`

**Interfaces:**
- Consumes: `bookedVehicleKindFor`, `BookedVehicleKind`, `VehicleBookingAnimation` (`vehicle_booking_animation.dart`); `RouteMarker`.
- Produces:
  - `String vehicleArtFor(BookedVehicleKind kind)`: `assets/v2/vehicle_bike.png` / `vehicle_e_loader.png` / `vehicle_three_wheeler.png` / `vehicle_four_wheeler.png`.
  - `FindingDriverHero({required String vehicleName, required VoidCallback onBack, required VoidCallback onHome})`:
    - a 318-high `p.brand` band, bottom radius 28
    - white 44 back circle (`aria`/semantic "Back") + white "Go to Home" pill
    - 3 clouds, a skyline, a road with a dashed lane, and the vehicle with 3 speed lines and a ground shadow
    - one `AnimationController` per loop (cloud 14 s, skyline 18 s, lane 0.6 s, drive 0.9 s), all disposed
    - no `repeat()` when `MediaQuery.disableAnimationsOf(context)`
    - vehicle = `Image.asset(vehicleArtFor(kind), height: 116, errorBuilder: → VehicleBookingAnimation(vehicleName: vehicleName, height: 110, showLabel: false))`
  - `StageMessage({required String text})`: an `AnimatedSwitcher` (500 ms, fade + 8 px slide up) keyed by `text`.
  - `SearchProgressCard({required double progress, required bool notified})`:
    - white card, 8 px bar filled to `progress` (0..1), with a looping shimmer unless reduce motion is on
    - 3 steps: "Order placed" (always ✓), "Drivers notified" (✓ when `notified`, popped in with a scale bounce), "Driver accepts"
  - `WaitingTripCard({String? vehicle, required String orderId, String? fare, String? pickup, String? drop})`:
    - header: vehicle + "Order #id · fare" (fare part omitted if null/empty)
    - pickup row with `RouteMarker.pickup(size: 20)` and drop row with `RouteMarker.drop(size: 20)`, each hidden if null/empty, maxLines 1 ellipsis

- [ ] **Step 1: Add the new widgets path to `_swept`.** Then write the failing tests:
  - `vehicleArtFor maps each kind`
  - `hero shows the 3D art when present, else the existing animation`: in tests no PNG exists, so `find.byType(VehicleBookingAnimation)` findsOneWidget after pump
  - `hero back and Go to Home call back`
  - `with reduce motion, pumpAndSettle completes`: wrap in `MediaQuery(data: MediaQueryData(disableAnimations: true))` around hero + progress card, `await tester.pumpAndSettle()` does not time out
  - `progress card fills to the given fraction and ticks notified`: progress 0.5 → the fill's `FractionallySizedBox.widthFactor == 0.5`; `notified: false` → one check icon; `true` → two
  - `stage message swaps text`: pump 'A' then 'B', `pumpAndSettle` (reduce motion on), find 'B'
  - `trip card hides missing fare and addresses, never shows null`: fare null, pickup '' → no '₹', no 'null', no `Icons.arrow_upward_rounded`
  - `no overflow at textScale 1.3 on 360dp`: hero + progress + trip with long addresses inside a scroll view
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/finding_driver_widgets_test.dart`.
- [ ] **Step 3: Implement the widgets.** The skyline is a fixed list of 24 building rects (widths 22–39, heights from `[38,56,30,64,44,52,28,60,40,48,34,58]`) laid out twice for a seamless loop.
- [ ] **Step 4: Run, expect PASS.** Also run `flutter test test/theme/legacy_colors_test.dart` and expect it green.
- [ ] **Step 5: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/finding_driver_widgets.dart ShifterOnline/test/home/finding_driver_widgets_test.dart ShifterOnline/test/theme/legacy_colors_test.dart
git commit -m "feat(customer-ui): finding-driver hero, progress, stage message and trip widgets"
```

### Task 3: Wire the screen

**Files:**
- Modify: `ShifterOnline/lib/screens/home/waiting_screen.dart` (`build`, `_buildGuaranteeCard`, order-details capture, state fields)
- Modify: `ShifterOnline/lib/Language/language_string.dart`

**Interfaces:**
- Consumes: Task 1 (`searchFraction`, `searchStage`, `searchBar`, `kSearchStageMessages`), Task 2 widgets.
- Produces (state):
  - `final DateTime _screenOpenedAt = DateTime.now();`
  - `DateTime? _searchStartedAt` (parsed from order-details `order_date`)
  - `String? _tripFare` (`₹` + `grand_total` when non-empty)
  - `String? _tripPickup` (`customer_paddress`), `String? _tripDrop` (`customer_daddress`)

**Steps:**
- [ ] **Step 1: Capture order info.** In `_recoverActiveOrder`, right after `order` is known, set the four fields with `setState` when mounted. Nothing else in that method changes.
- [ ] **Step 2: Keep the 1-second refresh.** `_startCountdown` already ticks `setState` each second. Also start that ticker in `initState` when no deadline exists yet, so the no-deadline fallback moves: `_startCountdown(null)` is safe, because `_timerDeadline` stays null.
- [ ] **Step 3: Add `late` to `_buildGuaranteeCard({bool late = false})`.** When `late && _guaranteeAmount > 0 && _searchGuarantee != 'locked'`, the bold lines become `"You are covered".tr` and then the existing amount sentence. The border is removed (v2 card: no border). Other states are unchanged.
- [ ] **Step 4: Replace the `build` body** inside the existing `WillPopScope` / `AnnotatedRegion` / `Scaffold(backgroundColor: p.canvas)`. Keep `SocketStatusBanner` at the top. The body is a `Column`:
  1. `FindingDriverHero(vehicleName: _vehicleName, onBack: _navigateBackToHome, onHome: _navigateBackToHome)`
  2. An `Expanded` `SingleChildScrollView` (padding 16) with, in order (each block in a staggered rise-in, 150 ms apart, skipped under reduce motion):
     - the title row: pulsing 10 px `p.brand` dot + `(stage == 3 ? 'Still finding your driver' : 'Finding your driver').tr`, then `StageMessage(text: kSearchStageMessages[stage].tr)`
     - `SearchProgressCard(progress: searchBar(f), notified: stage >= 1)`
     - `WaitingTripCard(vehicle: _vehicleName, orderId: widget.orderId, fare: _tripFare, pickup: _tripPickup, drop: _tripDrop)`
     - `_buildGuaranteeCard(late: stage == 3)`
     - the reassurance row: `Icons.notifications_none_rounded` + `"You can leave this screen. We'll let you know when a driver accepts.".tr`
  3. A centred `TextButton` "Cancel booking" (`p.inkMuted`, underlined, 44 min height) → `_showCancelDialog` (disabled while `_isCancelling`, which shows a small spinner).

  Where `f = searchFraction(start: _searchStartedAt, deadline: _timerDeadline, screenOpenedAt: _screenOpenedAt, now: DateTime.now())` and `stage = searchStage(f)`.

  Remove `pill(...)`, `_formatRemaining` and the old radar block. Keep `_remainingSeconds` only if still referenced; otherwise remove it and its writes.
- [ ] **Step 5: Add keys:** `Finding your driver`, `Still finding your driver`, the 4 stage messages, `Go to Home`, `Order placed`, `Drivers notified`, `Driver accepts`, `You are covered`, `You can leave this screen. We'll let you know when a driver accepts.`, `Cancel booking`.
- [ ] **Step 6: Verify.**
  - Run `cd ShifterOnline && flutter analyze` and expect ≤ 46.
  - Run `flutter test` and expect all green (guards included).
  - Run `grep -n "pksCancleOrder\|_showCancelDialog\|_navigateBackToHome\|_startTimeout\|onOrderAssigned" lib/screens/home/waiting_screen.dart` and expect every name still present.
  - Run `git diff` on the socket/timeout methods and expect them byte-identical.
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/waiting_screen.dart ShifterOnline/lib/Language/language_string.dart
git commit -m "feat(customer-ui): animated Finding-your-driver screen — progress instead of countdown, quiet cancel"
```

### Task 4: Device check

- [ ] **Step 1: Build and install** the debug APK.
- [ ] **Step 2: Owner places a real DEV booking** and checks:
  1. the hero animates and the vehicle matches the booked type
  2. messages change and the bar never fills before acceptance
  3. the trip card shows fare + addresses
  4. guarantee card / "You are covered" late
  5. Go to Home keeps the order alive
  6. Cancel booking opens the old dialog
  7. a driver accepting moves to tracking
  8. reduce motion (Android "Remove animations") stops the movement

  The result is recorded in the ledger.
