# Customer UI Redesign — Plan 1: Foundation + Home

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared design tokens and components, find why Home janks, and rebuild the Home tab and bottom nav in the approved "Home V3 light" look — with every existing Home behaviour unchanged.

**Architecture:** New `lib/theme/` holds tokens (colours, radius, spacing, text styles) and small reusable widgets. Home's visual sections move out of the 4,201-line `home.dart` into small presentational widgets under `lib/screens/home/widgets/` that take data + callbacks only; `home.dart` keeps all state, API calls and handlers and passes its existing methods in as callbacks. The bottom nav becomes a presentational `AppBottomNav` fed by `bottombar.dart`'s existing `_selectTab`.

**Tech Stack:** Flutter (Dart >=3.2.6), GetX, Provider (`ColorNotifier`), `flutter_test` widget tests. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-16-customer-app-ui-redesign-design.md` (mockups: https://claude.ai/artifact/N6W3fokfpJBwhrXFGhpwhb, board "Home V3 — light (app theme)")

**Plan series:** Plan 1 (this) foundation + Home · Plan 2 booking flow (search, confirm drop, vehicle, review & pay, finding driver) · Plan 3 live tracking + trip complete · Plan 4 orders, wallet, account, login (incl. replacing the AI images in `signup.dart` / `myprofile.dart`). Plans 2–4 are written after Plan 1 ships, reusing its components.

## Global Constraints

- UI-only: no change to any API call, socket event, `GetStorage` key, navigation target/arguments, validation or state transition. Every new tappable calls the **same existing method** the old widget called.
- No existing feature removed or made unreachable.
- Brand `#FF6B35`; text/icons on orange = `#1A0B04` (never white); orange text on white = `#B83C0C`.
- Font: bundled Gilroy (`Gilroy_Regular`, `Gilroy_Medium`, `Gilroy_Bold`). No new fonts/packages.
- No emojis in UI strings; no gradient fills; no new Lottie files.
- All user-facing strings use `.tr`; every new English string is added to `en_US` in `lib/Language/language_string.dart`.
- Layouts must not overflow at text scale 1.3, width 320, or RTL.
- Dark mode (`notifier.getIsDark`) must render with dark token values.
- Touch targets ≥ 44 logical px. Animations off when `MediaQuery.disableAnimations` is true.
- Commits: `git add -f <exact files>` (`ShifterOnline/` is gitignored); message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.
- Run tests from `ShifterOnline/`: `flutter test <file>`; analyzer: `flutter analyze lib/theme lib/screens/home/widgets`.

## Review Focus

1. Long translations / big system font (textScale 1.3, width 320) on the route card and feature grid → text wraps or ellipsizes, no overflow stripes. (Tests in Tasks 4, 5, 6.)
2. RTL languages (Arabic via `rtl_wrapper.dart`) → route card dots/lines mirror, no overflow. (Test in Task 5.)
3. Pickup not detected yet / no drop chosen → route card shows "Detecting current location..." / "Where is it going?" and no "Choose vehicle" button. (Test in Task 5.)
4. Dark mode on → new widgets use the dark palette, no white-on-white. (Tests in Tasks 1 and 2.)
5. "Reduce motion" on → header truck and fade-ups don't animate. (Test in Task 4.)

## Owner answers (2026-11-16)

- **Wallet balance chip on Home: YES.** Home reuses the existing wallet-history call (`ApiWrapper.dataPostNode(Config.nodeWalletHistory, {mobile, wallet_type: 'user', from_date: '', to_date: '', txn_type: <wallet_page default>})`, reading `wallet_balance`) — see Task 4. Fails quietly: chip hidden when the call fails.
- **Booking Guarantee strip on Home: NO** (quote needs vehicle `package_ids`); guarantee stays on vehicle + finding-driver screens.
- **Buy Anything: stays out for now.** Offers & Coupons not answered → also stays out (both screens unreachable today).

---

### Task 1: Design tokens

**Files:**
- Create: `ShifterOnline/lib/theme/app_tokens.dart`
- Create: `ShifterOnline/lib/theme/contrast.dart`
- Test: `ShifterOnline/test/theme/app_tokens_test.dart`

**Interfaces:**
- Produces:
  - `double contrastRatio(Color a, Color b)` — WCAG 2.x ratio (relative luminance, sRGB linearisation).
  - `class AppPalette` with `final Color` fields: `brand, brandTint, onBrand, brandText, canvas, surface, ink, inkMuted, inkSubtle, line, divider, success, successText, successTint, danger, dangerTint, warning, warningTint, navShadow`; `static AppPalette of(bool isDark)`; `static AppPalette get current => of(notifier.getIsDark == true)` (uses global `notifier` from `utils/colors.dart`).
  - `class AppRadius { static const double chip = 8, input = 12, card = 16, hero = 20, sheet = 24; }`
  - `class AppSpace { static const double xs = 4, s = 8, m = 12, l = 16, xl = 20, xxl = 24; }`
  - `class AppText { static TextStyle hero(Color c) /*27 bold*/, title(Color c) /*22 bold*/, section(Color c) /*17 bold*/, body(Color c) /*15 medium*/, bodyStrong(Color c) /*15 bold*/, caption(Color c) /*12 medium*/, navLabel(Color c, {required bool selected}) /*11, bold when selected*/; }` — Gilroy families.

- [ ] **Step 1: Write the failing tests**

```dart
test('light palette values match the spec', () {
  final p = AppPalette.of(false);
  expect(p.brand, const Color(0xFFFF6B35));
  expect(p.onBrand, const Color(0xFF1A0B04));
  expect(p.brandText, const Color(0xFFB83C0C));
  expect(p.canvas, const Color(0xFFF7F7F7));
  expect(p.surface, const Color(0xFFFFFFFF));
  expect(p.ink, const Color(0xFF15171C));
  expect(p.brandTint, const Color(0xFFFFF0E8));
});
test('text pairs pass WCAG AA 4.5:1', () {
  for (final dark in [false, true]) {
    final p = AppPalette.of(dark);
    expect(contrastRatio(p.onBrand, p.brand), greaterThanOrEqualTo(4.5));
    expect(contrastRatio(p.ink, p.surface), greaterThanOrEqualTo(4.5));
    expect(contrastRatio(p.inkMuted, p.surface), greaterThanOrEqualTo(4.5));
    expect(contrastRatio(p.brandText, p.surface), greaterThanOrEqualTo(4.5));
  }
});
test('dark palette differs from light on surfaces and ink', () {
  expect(AppPalette.of(true).surface, isNot(AppPalette.of(false).surface));
  expect(AppPalette.of(true).ink, isNot(AppPalette.of(false).ink));
});
test('contrastRatio black on white is 21', () {
  expect(contrastRatio(Colors.black, Colors.white), closeTo(21, 0.01));
});
```

- [ ] **Step 2: Run** `flutter test test/theme/app_tokens_test.dart` — Expected: FAIL (files don't exist).

- [ ] **Step 3: Implement** both files. Light values from spec §5 (`inkMuted #4B515E`, `inkSubtle #636977`, `line #E8E8E8`, `divider #F0F0F0`, `success #16A34A`, `successText #15803D`, `successTint #ECFDF3`, `danger #B42318`, `dangerTint #FFF4F2`, `warning #9A6700`, `warningTint #FFFBEB`). Dark: `canvas #030303` and `surface #252525` (today's `lightBgColor`/`getBgColor`), `ink #FFFFFF`, `inkMuted #C9CDD4`, `inkSubtle #A7ADB8`, `line #414141`, `divider #323233`, `brandText #FF8A5C`, `brandTint #3A2216`; brand/onBrand unchanged.

- [ ] **Step 4: Run** the test — Expected: PASS.

- [ ] **Step 5: Commit** `feat(customer-ui): design tokens with contrast-checked palette`.

---

### Task 2: Shared components

**Files:**
- Create: `ShifterOnline/lib/theme/widgets/pressable_scale.dart`, `app_buttons.dart`, `app_card.dart`, `app_segmented.dart`, `app_skeleton.dart`, `section_header.dart`
- Test: `ShifterOnline/test/theme/app_widgets_test.dart`

**Interfaces:**
- Consumes: `AppPalette`, `AppRadius`, `AppSpace`, `AppText` (Task 1).
- Produces:
  - `PressableScale({required Widget child, VoidCallback? onTap, String? semanticLabel})` — scales to 0.97 while pressed (100 ms); no scale when `MediaQuery.disableAnimations`.
  - `AppPrimaryButton({required String label, VoidCallback? onPressed, String? trailing, bool expand = true})` — height 54, radius 14, `brand` fill, `onBrand` Gilroy_Bold 16 label; `trailing` text right-aligned (e.g. fare); `onPressed == null` → 40% opacity, not tappable.
  - `AppSecondaryButton({required String label, VoidCallback? onPressed, Widget? icon})` — height 44, surface fill, 1px `line` border.
  - `AppCard({required Widget child, EdgeInsets padding = const EdgeInsets.all(16), VoidCallback? onTap, bool selected = false})` — radius 16, 1px `line` border; selected → 1.5px `brand` border + `brandTint` fill.
  - `class AppSegment<T> { final T value; final String label; final IconData icon; final Color? iconColor; }` and `AppSegmented<T>({required List<AppSegment<T>> segments, required T? value, required ValueChanged<T> onChanged})` — equal-width pills, height 44, selected = brand border + brandTint.
  - `AppSkeleton({double? width, required double height, double radius = 12})` — shimmer via one `AnimationController`; static grey when reduce motion.
  - `SectionHeader({required String title, String? actionLabel, VoidCallback? onAction})` — title `AppText.section`, action in `brandText`.

- [ ] **Step 1: Write the failing tests** (pump each inside `MaterialApp`):

```dart
testWidgets('primary button: label colour is onBrand, tap fires once', ...)  // find.text('Book'), style.color == Color(0xFF1A0B04); tap → counter == 1
testWidgets('primary button: null onPressed ignores taps', ...)              // tap → counter stays 0
testWidgets('primary button height is at least 44', ...)                     // tester.getSize(...).height >= 44
testWidgets('segmented: tapping a segment reports its value', ...)           // 3 segments, tap 'Schedule' → onChanged(2)
testWidgets('card selected shows brand border', ...)                         // BoxDecoration border colour == brand
testWidgets('skeleton does not animate with reduce motion', ...)             // MediaQuery(disableAnimations: true); pump; expect(tester.binding.hasScheduledFrame, isFalse)
testWidgets('components use dark palette when notifier is dark', ...)        // notifier.setIsDark = true; AppCard fill == AppPalette.of(true).surface; reset after
```

- [ ] **Step 2: Run** `flutter test test/theme/app_widgets_test.dart` — Expected: FAIL.
- [ ] **Step 3: Implement** the six files per the Interfaces block. Read colours via `AppPalette.current` inside `build`.
- [ ] **Step 4: Run** the tests — Expected: PASS. Run `flutter analyze lib/theme` — Expected: "No issues found!".
- [ ] **Step 5: Commit** `feat(customer-ui): shared button, card, segmented, skeleton components`.

---

### Task 3: Find the Home jank (investigation, no UI change)

**Files:**
- Create: `docs/superpowers/notes/2026-11-customer-home-jank.md`

- [ ] **Step 1: Static scan.** In `lib/screens/home/home.dart` and `lib/bottombar.dart` list every `setState`, `Timer`, socket listener and stream subscription, and which part of the tree each one rebuilds (the whole `build()` at line ~3195 unless scoped). Note `Provider.of(context, listen: true)` at the top of `build()`.
- [ ] **Step 2: Profile.** On a real Android phone: `flutter run --profile` from `ShifterOnline/`, open DevTools → Performance. Record: cold open to Home, scroll Home top→bottom, choose pickup, choose drop, open vehicle selection, return. Note frames > 16 ms and the widgets/rasterizer cost behind them.
- [ ] **Step 3: Write the notes file:** top causes ranked by frame cost, each with file:line and the fix that stays UI-only (e.g. scope a rebuild with a smaller widget/`ValueListenableBuilder`, `RepaintBoundary` around animations, cache network images with `cacheWidth`, stop rebuilding on location ticks). Mark any cause that needs a logic change as "out of scope — owner decision".
- [ ] **Step 4: Commit** the notes `docs(customer-ui): Home jank investigation`. Fixes that land in Home are applied in Task 8.

---

### Task 4: Home header

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/home_header.dart`
- Test: `ShifterOnline/test/home/home_header_test.dart`

**Interfaces:**
- Consumes: Task 1–2 tokens/widgets.
- Also create `ShifterOnline/lib/services/wallet_balance_service.dart`: `double? parseWalletBalance(dynamic response)` (null unless `Result` is true/"true" and `wallet_balance` parses) and `class WalletBalanceService { static Future<double?> fetch(); }` (reads `UserLogin.mobile` from `GetStorage`, same body as `wallet_page.dart` ~151–157; any error → null). Tests: `parseWalletBalance({'Result': true, 'wallet_balance': '240.5'}) == 240.5`; `{'Result': 'false', ...}` → null; `null` → null; `{'Result': true, 'wallet_balance': 'abc'}` → null.
- Produces: `HomeHeader({required String? address, required VoidCallback onLocationTap, required VoidCallback onNotificationTap, double? walletBalance, VoidCallback? onWalletTap})` — wallet chip ("₹240" style, `rupeesText`-like formatting, wallet icon in brand) shown left of the bell only when `walletBalance != null`; `brandTint` band; label "Picking up from".tr; address (null/empty → "Location".tr) with pin + chevron, max 1 line ellipsis; 44×44 notification button (`semanticLabel` "Notifications".tr); heading "What are we moving today?".tr (`AppText.hero`); animated truck on a dashed road inside its own `RepaintBoundary` (7 s loop; static when reduce motion). Bottom padding 92 so the route card can overlap by 72.

- [ ] **Step 1: Failing tests:**

```dart
testWidgets('tapping the address calls onLocationTap', ...)
testWidgets('tapping notifications calls onNotificationTap', ...)
testWidgets('null address shows "Location"', ...)
testWidgets('long address at width 320, textScale 1.3 does not overflow', ...) // expect(tester.takeException(), isNull)
testWidgets('reduce motion: truck does not animate', ...)                      // disableAnimations → hasScheduledFrame false after pump
testWidgets('wallet chip hidden when walletBalance is null; shown and tappable when set', ...)
```

- [ ] **Step 2: Run** `flutter test test/home/home_header_test.dart` — FAIL.
- [ ] **Step 3: Implement** `HomeHeader`; truck drawn with `CustomPainter` (body `brand`, cab `#FF8A5C`, window `#CFE4F5`, wheels `#15171C`) like the mockup.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(customer-ui): Home header`.

---

### Task 5: Home route card

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/home_route_card.dart`
- Test: `ShifterOnline/test/home/home_route_card_test.dart`

**Interfaces:**
- Produces:

```dart
class HomeRouteCard extends StatelessWidget {
  const HomeRouteCard({
    required this.pickupAddress,      // String? — null → 'Detecting current location...'.tr
    required this.dropAddress,        // String? — null → 'Where is it going?'.tr (muted)
    required this.stops,              // List<String> stop addresses, in order
    required this.canAddStop,         // bool — false hides the + Stop button
    required this.bookingType,        // int: 1 = Now, 2 = Schedule, 3 = Low Fare
    required this.scheduleEnabled,    // bool — false hides the Schedule segment
    required this.onPickupTap, required this.onDropTap,
    required this.onStopTap,          // ValueChanged<int>
    required this.onStopDelete,       // ValueChanged<int>
    required this.onAddStop,
    required this.onNow, required this.onSchedule, required this.onLowFare,
    required this.onChooseVehicle,    // shown as AppPrimaryButton 'Choose vehicle'.tr only when dropAddress != null
  });
}
```

Layout: white card, radius 20, soft shadow; pickup row (green dot), dashed connector, each stop row (hollow dot, label "Stop @n".trParams, delete icon), drop row (orange square) with "+ Stop"; bottom tray with `AppSegmented` Now ("Now".tr, bolt) / Schedule ("Schedule".tr, calendar) / Low Fare ("Low Fare".tr, green down-arrow); rows ≥ 64 px tall.

- [ ] **Step 1: Failing tests:**

```dart
testWidgets('null pickup shows detecting text, null drop shows placeholder and no Choose vehicle', ...)
testWidgets('drop set shows Choose vehicle and tapping it calls onChooseVehicle', ...)
testWidgets('each row calls its own callback', ...)              // pickup, drop, stop #2 → onStopTap(1), delete stop #1 → onStopDelete(0), + Stop → onAddStop
testWidgets('canAddStop false hides + Stop', ...)
testWidgets('scheduleEnabled false hides Schedule segment', ...)
testWidgets('segments call onNow / onSchedule / onLowFare', ...)
testWidgets('selected segment follows bookingType', ...)         // bookingType 3 → Low Fare pill has brand border
testWidgets('RTL, width 320, textScale 1.3 with 3 stops does not overflow', ...)
```

- [ ] **Step 2: Run** `flutter test test/home/home_route_card_test.dart` — FAIL.
- [ ] **Step 3: Implement** `HomeRouteCard`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(customer-ui): Home route card`.

---

### Task 6: Home content sections

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/home_vehicle_row.dart`, `home_more_grid.dart`, `home_active_order_strip.dart`
- Modify: `ShifterOnline/lib/screens/home/home_option_tiles.dart` — restyle `FreeRideChanceTile` build output only (state, API calls, dialogs untouched) into the orange banner: tag "FREE RIDE CHANCE".tr, existing title/subtitle texts, progress bar, "Invite friends".tr white button wired to the tile's existing tap handler; restyle `CustomiseOrderTile` to a `HomeMoreItem`-compatible look (or expose its `onTap` as a static method `CustomiseOrderTile.open()` used by the grid).
- Test: `ShifterOnline/test/home/home_sections_test.dart`

**Interfaces:**
- Produces:
  - `class HomeVehicle { final String name; final String? imageUrl; final String? subtitle; }` and `HomeVehicleRow({required List<HomeVehicle> vehicles, required VoidCallback onTap})` — horizontal cards 136 wide; network image with `cacheWidth: 300` and grey placeholder; empty list → `SizedBox.shrink()`. Every card calls `onTap` (the existing `_openVehicleSelection`; no pre-selection — that would be new behaviour).
  - `class HomeMoreItem { final String label; final IconData icon; final Color tint; final Color iconColor; final VoidCallback onTap; }` and `HomeMoreGrid({required List<HomeMoreItem> items})` — 4-column grid, 52×52 tinted icon squares, 2-line centered labels, title "More on Shifter".tr.
  - `HomeActiveOrderStrip({required String orderId, required String status, String? message, required VoidCallback onTrack})` — pulsing green dot (static on reduce motion), "Order #@id".trParams, status, optional message (2 lines), "Track".tr pill (brand fill, onBrand text).

- [ ] **Step 1: Failing tests:**

```dart
testWidgets('vehicle row: empty list renders nothing; card tap calls onTap', ...)
testWidgets('more grid: each tile calls its own onTap', ...)              // 6 items, tap 'Premium Plans' → only that callback
testWidgets('more grid: width 320 textScale 1.3 no overflow', ...)
testWidgets('active order strip: Track calls onTrack; message hidden when empty', ...)
```

- [ ] **Step 2: Run** `flutter test test/home/home_sections_test.dart` — FAIL.
- [ ] **Step 3: Implement** the three widgets and the two tile restyles. Before restyling `home_option_tiles.dart`, run `flutter test` for any existing test touching it (none today) and keep every `onTap` body byte-identical.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(customer-ui): Home vehicle row, feature grid, active order strip, Free Ride banner`.

---

### Task 7: Bottom navigation

**Files:**
- Create: `ShifterOnline/lib/theme/widgets/app_bottom_nav.dart`
- Modify: `ShifterOnline/lib/bottombar.dart:264-380` (`_buildBottomBar`, `_navItem`, `_bookAction`) to render `AppBottomNav`
- Test: `ShifterOnline/test/theme/app_bottom_nav_test.dart`

**Interfaces:**
- Produces: `AppBottomNav({required int selectedIndex, required ValueChanged<int> onTabSelected, required VoidCallback onBookTap})` — floating white bar (margin 12, radius 22, soft shadow), five slots: Home(0), Orders(1), centre **"Book now".tr** round brand button (kept from today; `onBrand` icon `assets/package_box_file.svg`), Wallet(2), Account(3). Selected tab: `brandTint` pill behind icon, bold `ink` label. Respects bottom safe-area padding.
- `bottombar.dart` passes `_selectedIndex`, `_selectTab`, and `() => _selectTab(0)` (today's Book action) — no other change.

- [ ] **Step 1: Failing tests:** tap each tab → `onTabSelected(0..3)`; tap Book now → `onBookTap`; selected tab label is bold; no overflow at width 320 textScale 1.3.
- [ ] **Step 2: Run** `flutter test test/theme/app_bottom_nav_test.dart` — FAIL.
- [ ] **Step 3: Implement** `AppBottomNav` and switch `bottombar.dart` to it.
- [ ] **Step 4: Run** — PASS; `flutter analyze lib/bottombar.dart lib/theme` — no new issues.
- [ ] **Step 5: Commit** `feat(customer-ui): floating bottom nav keeps Book now action`.

---

### Task 8: Wire the new Home into `home.dart`

**Files:**
- Modify: `ShifterOnline/lib/screens/home/home.dart` (`build()` ~3195–3420 and the builders it calls: `_buildActiveOrderCard` 2592, `_buildDeliveryOptionsRow` 1454, `_buildRouteSelectionCard` 2194, `_buildQuickLocations` 331, `_buildRewardMilestoneCard` 793, How-to-use bar, "Buy anything Last Order" and My custom orders rows; strings at 1529, 666, 3180–3186)
- Modify: `ShifterOnline/lib/Language/language_string.dart` (`en_US` additions)

**Interfaces:**
- Consumes: Tasks 4–7 widgets.
- Mapping (old handler → new widget prop; handlers are passed, never rewritten):
  - `HomeHeader.address` ← `homeAddress`; `onLocationTap` ← `_changePickupLocation`; `onNotificationTap` ← `() => Get.to(Notifications())`; `walletBalance` ← new state `double? _walletBalance` loaded once in `initState` (and on return from the wallet page) via `WalletBalanceService.fetch()`; `onWalletTap` ← open the existing wallet page the same way the app already does elsewhere (if none, `Get.to` the wallet page class), then refresh `_walletBalance`.
  - `HomeRouteCard`: `pickupAddress` ← `_confirmedPickupAddress`; `dropAddress` ← `_confirmedDropAddress`; `stops` ← `_extraStops` addresses; `canAddStop` ← `_extraStops.length < _maxExtraStops`; `onPickupTap` ← `_changePickupLocation`; `onDropTap` ← the current drop row handler (line ~2328); `onStopTap` ← `_editExtraStop`; `onStopDelete` ← `(i) => setState(() => _extraStops.removeAt(i))`; `onAddStop` ← `_addExtraStop`; `bookingType` ← `_selectedBookingType`; `scheduleEnabled` ← `_scheduleBookingEnabled`; `onNow` ← `() => setState(() => _selectedBookingType = 1)`; `onSchedule` ← `_handleScheduleBookingTap`; `onLowFare` ← `_handleNextDayDeliveryTap`; `onChooseVehicle` ← `_openVehicleSelection`.
  - `HomeActiveOrderStrip` ← data and Track body from `_buildActiveOrderCard` (keep `save('OrderID', orderId)` + `Get.to(() => TrackingWay(...))` exactly).
  - `HomeVehicleRow.vehicles` ← existing `wheelerItems` / `wheelerImages`; `onTap` ← `_openVehicleSelection`.
  - `HomeMoreGrid` items: Customise Order (existing tile tap), Premium Plans (`Get.to(() => const PremiumPlansScreen())`), Refer & Earn (same call as the Refer & Earn row in `myprofile.dart` ~254 — move that body into a top-level function in `lib/utils/refer_and_earn.dart` and call it from both places), Favourite Drivers (`Get.to(() => const FavoriteDriversScreen())`), Reward Points (`Get.to(() => const ReferralPointsScreen())`), Help & Support (same call as myprofile's Customer Care row ~961).
  - Kept and restyled in place (logic untouched): reward milestone card (tap → `_showRewardMilestoneDetails`), How-to-use bar (neutral `AppCard` with play icon; same `launchUrl` body), saved places (`_buildQuickLocations` handlers), "Buy anything Last Order", My custom orders row, `_buildNoVehicleState`, `_buildPickupFirstPrompt`, `_buildConfirmedPickup`.
  - Section order: header → route card (overlapping) → active order strip → reward milestone card → vehicle row → Free Ride banner → More on Shifter → How-to-use bar → saved places → my custom orders / buy-anything last order.
- Remove emojis: `_getWelcomeText` (`\u{1F44B}`) no longer shown (heading replaces it); `"\u{2B50} VIP"` → `"VIP".tr`; `"\u{2B50} Premium Exclusive Feature"` → `"Premium Exclusive Feature".tr`.
- Scaffold: `backgroundColor` → `AppPalette.current.canvas`; drop the orange `AppBar`; keep the `isLoding` branch but show `AppSkeleton` blocks instead of the spinner.
- Apply the in-scope fixes from Task 3's notes (e.g. move `Provider.of(..., listen: true)` so only token-dependent widgets rebuild, `RepaintBoundary` around the header).

- [ ] **Step 1: Write the handler-mapping checklist** as a comment-free table at the top of the commit message draft (old builder → new widget → handler), and grep the old builders for every `onTap`/`onPressed` so none is missed: `grep -n "onTap\|onPressed" lib/screens/home/home.dart`.
- [ ] **Step 2: Replace the sections** in `build()` per the mapping; delete the old private builders only after their handlers are wired into the new widgets.
- [ ] **Step 3: Add new strings** to `en_US`: "Picking up from", "What are we moving today?", "Where is it going?", "Now", "Low Fare", "Choose vehicle", "More on Shifter", "Customise Order", "Premium Plans", "Refer & Earn", "Favourite Drivers", "Reward Points", "Help & Support", "FREE RIDE CHANCE", "Invite friends", "VIP", "Premium Exclusive Feature", "Stop @n", "Order #@id", "Track".
- [ ] **Step 4: Static checks:** `flutter analyze lib/screens/home lib/bottombar.dart lib/theme` — no new issues; `flutter test` — all tests pass (existing + new).
- [ ] **Step 5: Manual run on a phone** (`flutter run`), light and dark mode, English and one RTL/Indian language; tick each:
  - Pickup row, header address → pickup change flow opens.
  - Drop row → drop selection opens; after drop is set, Choose vehicle → vehicle screen with the same route.
  - Add stop, edit stop, delete stop; + Stop hidden at the admin max.
  - Now / Schedule (date-time picker as before) / Low Fare (non-Premium account → "Premium Exclusive Feature" sheet; Premium account → next-day flow).
  - Active order (with a live order) → Track opens tracking for that order.
  - Reward milestone card (if enabled for the account) → details sheet.
  - Free Ride banner → same dialogs as before for locked/unlocked/claimed accounts.
  - Every More-grid tile opens its screen; How-to-use opens the video link; saved places select drop; Buy-anything last order and custom orders rows open as before.
  - Bottom nav: four tabs + Book now; back button double-press exit still works.
  - Profile run: repeat Task 3's recording — no frame > 16 ms on scroll; compare with the notes.
- [ ] **Step 6: Commit** `feat(customer-ui): new Home and bottom nav (UI-only, handlers unchanged)` with the mapping table in the body.

---

## Self-review notes

- Spec §5 tokens → Task 1; components → Task 2; §8 jank → Tasks 3 + 8; §6 item 1 Home → Tasks 4–8; §7 Low Fare / Free Ride / conditional states → Task 8 manual checklist; Booking Guarantee strip, wallet chip, Buy Anything, Offers → owner questions above (spec §6 data-source rule).
- Bottom nav keeps the existing centre "Book now" action, which the mockup omitted.
- Names used across tasks: `AppPalette.current`, `AppPrimaryButton`, `AppSegmented/AppSegment`, `AppSkeleton`, `HomeHeader`, `HomeRouteCard`, `HomeVehicle/HomeVehicleRow`, `HomeMoreItem/HomeMoreGrid`, `HomeActiveOrderStrip`, `AppBottomNav`.
