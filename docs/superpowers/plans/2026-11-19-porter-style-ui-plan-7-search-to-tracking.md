# Porter-Style UI — Plan 7: searching → tracking feels like one screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Searching for a driver and tracking the driver should look like one screen, as in Porter. The four extras seen in Porter's searching screen are added.

Porter's behaviour (observed on device 2026-11-19): when a driver accepts, the same map + sheet changes into "Driver on the way to pickup". Our app opens TrackingWay instead, with:
- a different header
- a different sheet height
- different pins
- a slide transition

**Owner approval:** "okay" (2026-11-19) to "1 + 2 together".

**Spec:**
- Porter observation: `.superpowers/sdd/2026-11-18-porter-style-ui-plan-6-finding-driver/progress.md`, owner-feedback lines.
- Base design: `docs/superpowers/specs/2026-11-18-finding-driver-screen-design.md`. Its non-goals and anti-goals still bind: no fake facts, Cancel is never hidden, UI only.

## Global constraints
- **UI only.** Socket listeners, timeouts, cancel, payment, recovery and backend are unchanged. The only exception is the `transition:` argument of the two `Get.off(() => TrackingWay…)` calls in `waiting_screen.dart`.
- **Copy and theme:**
  - New strings go through `.tr` with an English key.
  - Colours come from `AppPalette.current`.
  - Both files stay in the legacy-colour guard `_swept` list.
- **Reduce motion:** nothing repeats.
- **Commits and checks:**
  - One commit per task, using `git add -f` with exact files. Never push.
  - `flutter test` must be green.
  - Analyzer warnings plus errors must stay at 46 or fewer.

## Task 1: Stepper bug + one shared step index
- New file `lib/screens/myorder/tracking_steps.dart`: `int heroStepIndex(String? status, {required bool searching})`.
  - `searching` → 0, so no step is active and "Assigned" is not lit.
  - Otherwise, the same mapping as `_getCurrentStepIndex` (completed → 5 for the hero).
- `_buildHeroCard` uses it.
- **Tests** (`test/myorder/tracking_steps_test.dart`):
  - pending while searching → 0
  - processing → 1
  - pickup → 2
  - on route → 3
  - completed → 5

## Task 2: Same look on both screens
- `search_map.dart`: export `routePinIcons()`, a cached `Future<(BitmapDescriptor, BitmapDescriptor)>`. TrackingWay's pickup and drop markers use it, so the pins match.
- **WaitingScreen header:** same style as TrackingWay `_buildModernHeader`:
  - round 44 px canvas buttons
  - "Order #id" plus the subtitle "Finding a driver for your order"
  - right-hand button: Home
- **Sheet:** both screens use `initialChildSize` 0.5.
- **Transition:** assignment uses `Transition.fadeIn`, 350 ms, instead of the default slide.
- **Test:** `routePinIcons` returns the same future when called twice (cache).

## Task 3: Porter's extras on the searching screen
- **(a) Booking confirmed.**
  - New `WaitingScreen(justBooked: true)`, passed only by `select_vehicle.dart` (not by splash recovery).
  - It shows `BookingConfirmedOverlay`: a green ✓ that scales in, confetti for 1.4 s, then it fades out. Text: "Booking placed".
  - It never claims a saving.
  - It ignores taps.
  - Under reduce motion it shows the ✓ without confetti for 0.8 s.
- **(b) Recenter button** on `SearchRouteMap`, bottom-right above the sheet. It re-fits to the route.
- **(c) Animated search icon:** the lens shows a map, then a driver (person) inside it, switching every 1.2 s. It stays static under reduce motion.
- **(d) Fare + help card** under the trip card:
  - "Total fare ₹X".
  - "You saved ₹cou_amt" only when `cou_amt > 0`.
  - A "Need help?" row. Tapping it fetches `Config.nodeCustomerCare` and calls that number through `makePhoneCall`. If the fetch fails, it shows a toast. The number is never hard-coded.
- **Share is left out on purpose.** The tracking link exists only after a driver is assigned (`getTrackLink` says so). Share already shows on the tracking screen.
- **Tests:**
  - The overlay shows "Booking placed", then is gone after 2 s.
  - Under reduce motion `pumpAndSettle` completes.
  - The saved line is hidden when `cou_amt` is 0 or missing.
  - Segment and recenter: the existing map widget tests are not possible (platform view), so the recenter is checked on device.

## Task 4: Device check
- A DEV booking:
  - confirm overlay → map searching screen
  - on accept, a crossfade to tracking with the same header, sheet and pins
  - the stepper shows no "Assigned" while searching
- Dark mode, and reduce motion.
