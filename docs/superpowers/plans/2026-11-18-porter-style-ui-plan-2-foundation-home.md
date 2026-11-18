# Porter-Style UI — Plan 2: Foundation + Home + Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 look (tokens, card, button, flat 4-tab nav) and the Porter-sparse Home with the solid-orange header, keeping every Home feature reachable.

**Architecture:** Retune v1 tokens/widgets in `ShifterOnline/lib/theme/`, add three small Home widgets in `lib/screens/home/widgets/` (header v2, pickup card, service tiles) plus an asset-or-placeholder image widget, then rewire `Home.build` to the new section order. All taps call the same `_HomeState` methods they call today. Reward Points gets an Account row because the Home grid that held it goes away.

**Tech Stack:** Flutter (Dart), GetX navigation, flutter_test. Package name `goParcel`. Font Gilroy (`Gilroy_Regular/_Medium/_Bold`).

**Spec:** `docs/superpowers/specs/2026-11-18-customer-app-porter-style-ui-design.md` (§5, §6.1, §6.9 Reward Points row). Mockups: https://claude.ai/artifact/1da6CdHakdNLknLW959LfP (board "Home (orange header)").

## Global Constraints

- UI only: no change to API calls, sockets, GetX controllers, validation or business rules; each new tap calls the existing method.
- `ShifterOnline/` is gitignored → commit with `git add -f <exact files>`.
- Brand `#FF6B35`; on orange use dark `#1A0B04` (never white). Light canvas `#F3F5F9`.
- Cards: white, radius 16, no border, shadow `Color(0x0F101828)` blur 8 offset (0,2); selected card keeps brand 1.5 border + `brandTint` fill.
- Primary button: height 52, radius 12, no glow shadow.
- Nav: plain white bar, 4 tabs Home·Orders·Wallet·Account, active = brand 3px top bar + bold label; no centre Book button.
- Home header: solid `#FF6B35`, 216 logical px tall + status-bar inset, bottom radius 24; logo/title `#1A0B04`, sub `#3A1A0B`; wallet chip + bell are white pills.
- Free Ride wording chance-based, never "first booking free" (existing `FreeRideBannerCopy` rules stay).
- Keep dark mode working through `AppPalette.current`.
- Tests: `cd ShifterOnline && flutter test` must stay green (update only tests that assert v1 layout).

## Review Focus

- Large text (textScale 1.3) at 320 px width: tiles, header and pickup card must not overflow — tests in Tasks 3 and 4.
- Missing art files (owner hasn't sent images yet): every `V2Art` slot must render its placeholder, never a red error box — test in Task 3.
- Long pickup address (60+ chars) must ellipsize in one line on the pickup card — test in Task 3.
- Customer with an active order: live-order strip still shows on Home between pickup card and tiles — Task 4 step 3 ordering + device check in Task 6.
- Reward Points stays reachable after the grid is removed — Task 5 row + Task 6 checklist.

---

### Task 1: v2 tokens, card and primary button

**Files:**
- Modify: `ShifterOnline/lib/theme/app_tokens.dart` (light `canvas`, new `AppShadow`)
- Modify: `ShifterOnline/lib/theme/widgets/app_card.dart`
- Modify: `ShifterOnline/lib/theme/widgets/app_buttons.dart:32-40` (`AppPrimaryButton`)
- Test: `ShifterOnline/test/theme/app_tokens_test.dart`, `ShifterOnline/test/theme/app_widgets_test.dart`

**Interfaces:**
- Produces: `AppShadow.card` → `List<BoxShadow>` (`[BoxShadow(color: Color(0x0F101828), blurRadius: 8, offset: Offset(0, 2))]`); `AppPalette.light.canvas == Color(0xFFF3F5F9)`.

- [ ] **Step 1: Update/add tests**

In `app_tokens_test.dart` change the canvas expectation to `const Color(0xFFF3F5F9)` and add `expect(AppShadow.card.single.blurRadius, 8);`. In `app_widgets_test.dart` add:
- `card unselected has no border and a soft shadow` → find the `DecoratedBox` under `AppCard`, assert `(decoration as BoxDecoration).border == null` and `boxShadow == AppShadow.card`.
- `primary button is 52 high with radius 12` → `tester.getSize(find.byType(AppPrimaryButton)).height == 52` and the inner decoration's `borderRadius == BorderRadius.circular(12)`.
Keep `card selected shows brand border`.

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ShifterOnline && flutter test test/theme/app_tokens_test.dart test/theme/app_widgets_test.dart`
Expected: FAIL on canvas value, AppShadow undefined, card border, button height.

- [ ] **Step 3: Implement**

`canvas: Color(0xFFF3F5F9)` in `AppPalette.light` (dark unchanged). Add `class AppShadow { static const card = [...]; }`. `AppCard`: unselected → no border, `boxShadow: AppShadow.card`; selected → unchanged (brand border 1.5, brandTint). `AppPrimaryButton`: height 52, radius 12, remove the glow `boxShadow`.

- [ ] **Step 4: Run, expect PASS**

Run: `cd ShifterOnline && flutter test test/theme`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -f ShifterOnline/lib/theme/app_tokens.dart ShifterOnline/lib/theme/widgets/app_card.dart ShifterOnline/lib/theme/widgets/app_buttons.dart ShifterOnline/test/theme/app_tokens_test.dart ShifterOnline/test/theme/app_widgets_test.dart
git commit -m "feat(customer-ui): v2 tokens — cool canvas, borderless soft-shadow cards, 52px button"
```

### Task 2: Flat 4-tab bottom nav

**Files:**
- Modify: `ShifterOnline/lib/theme/widgets/app_bottom_nav.dart`
- Modify: `ShifterOnline/lib/bottombar.dart:268-278`
- Test: `ShifterOnline/test/theme/app_bottom_nav_test.dart`

**Interfaces:**
- Produces: `AppBottomNav({required List<AppNavTab> tabs, required int selectedIndex, required ValueChanged<int> onTabSelected})` — `onBookTap` removed; `_BookAction` deleted.

- [ ] **Step 1: Rewrite tests**

Drop `onBookTap` from every pump. Tests:
- `tapping each tab reports its index` → taps Home/Orders/Wallet/Account → `[0,1,2,3]`; `expect(find.text('Book now'), findsNothing)`.
- `selected tab label is bold` (unchanged expectations).
- `selected tab shows the brand top indicator` → `find.byKey(const ValueKey('nav-indicator-2'))` findsOneWidget when `selectedIndex: 2`, and `nav-indicator-0` findsNothing.
- `no overflow at width 320, textScale 1.3` (unchanged).

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ShifterOnline && flutter test test/theme/app_bottom_nav_test.dart`
Expected: FAIL (onBookTap still required / indicator key missing).

- [ ] **Step 3: Implement**

Bar: full width, height 64 + bottom inset, `p.surface`, top shadow `BoxShadow(color: p.navShadow, blurRadius: 10, offset: Offset(0,-2))`, no margin, no radius. Row of 4 `Expanded(_NavItem)`. Selected item: `Positioned` top bar `Container(key: ValueKey('nav-indicator-$index'), width: 36, height: 3, color: p.brand, radius bottom 3)`; icon `p.brand` / unselected `p.inkSubtle`; no pill behind icon. `bottombar.dart`: remove `onBookTap:`.

- [ ] **Step 4: Run, expect PASS**

Run: `cd ShifterOnline && flutter test test/theme/app_bottom_nav_test.dart && flutter analyze lib/bottombar.dart lib/theme`
Expected: tests pass; analyzer "No issues found".

- [ ] **Step 5: Commit**

```bash
git add -f ShifterOnline/lib/theme/widgets/app_bottom_nav.dart ShifterOnline/lib/bottombar.dart ShifterOnline/test/theme/app_bottom_nav_test.dart
git commit -m "feat(customer-ui): flat Porter-style 4-tab nav, centre Book now removed"
```

### Task 3: Header v2, pickup card, art slot

**Files:**
- Create: `ShifterOnline/lib/theme/widgets/v2_art.dart`
- Modify: `ShifterOnline/lib/screens/home/widgets/home_header.dart` (rewrite body; keep `pickupLine` static and wallet parsing helpers tested today)
- Create: `ShifterOnline/lib/screens/home/widgets/home_pickup_card.dart`
- Create: `ShifterOnline/assets/v2/.gitkeep`; Modify: `ShifterOnline/pubspec.yaml` (add `- assets/v2/` under `assets:`)
- Test: `ShifterOnline/test/home/home_header_test.dart` (rewrite), `ShifterOnline/test/home/home_pickup_card_test.dart`

**Interfaces:**
- Produces:
  - `V2Art({required String asset, required String placeholderLabel, double? width, double? height, BoxFit fit = BoxFit.contain})` — `Image.asset(asset, errorBuilder: …)` falling back to a rounded dashed-look box (`p.brandTint` fill, `p.inkMuted` caption text = `placeholderLabel`).
  - `HomeHeader({required VoidCallback onNotificationTap, double? walletBalance, VoidCallback? onWalletTap})` — `static const double overlap = 30;` `static String? pickupLine(...)` unchanged. Address/`onLocationTap` move to the pickup card.
  - `HomePickupCard({required String? address, required VoidCallback onTap})` — shows "Pick up from".tr + address (or "Location".tr), green ↑ circle, chevron; one-line ellipsis.
  - Asset paths: `assets/v2/home_header.png` (H1).

- [ ] **Step 1: Write tests**

`home_header_test.dart` keeps: wallet parsing tests, `pickupLine` test, dark status-bar test, notifications tap, wallet chip hidden/shown. New: `header background is brand orange` (find `ColoredBox`/`DecoratedBox` with color `Color(0xFFFF6B35)`); `title text uses onBrand colour` (`find.text('Move anything,\nanywhere'.tr)` style color `Color(0xFF1A0B04)`); `missing H1 art shows placeholder` (pumpAndSettle, `find.text('H1')` findsOneWidget, `tester.takeException()` isNull); `width 320 textScale 1.3 no overflow`. Remove truck tests.
`home_pickup_card_test.dart`: `tap calls onTap`; `null address shows Location`; `70-char address stays on one line` (`Text` widget `maxLines == 1`, `overflow == TextOverflow.ellipsis`); `width 320 textScale 1.3 no overflow`.

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ShifterOnline && flutter test test/home/home_header_test.dart test/home/home_pickup_card_test.dart`
Expected: FAIL (new widgets/props missing).

- [ ] **Step 3: Implement**

Header per Global Constraints: row = "Shifter" (Gilroy_Bold 22, onBrand) + wallet pill (white, existing `rupeesText`) + bell (white circle 44). Below: title "Move anything,\nanywhere" (Gilroy_Bold 22, onBrand) + sub "Trucks, tempos and bikes" (Gilroy_Medium 13, `Color(0xFF3A1A0B)`) and `V2Art(asset: 'assets/v2/home_header.png', placeholderLabel: 'H1', width: 120, height: 86)`. Status bar: `SystemUiOverlayStyle.dark` always (dark icons on orange). Add the two new strings to `lib/Language/language_string.dart` English map only if that file lists every `.tr` key (follow the file's existing pattern).

- [ ] **Step 4: Run, expect PASS**

Run: `cd ShifterOnline && flutter test test/home/home_header_test.dart test/home/home_pickup_card_test.dart`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -f ShifterOnline/lib/theme/widgets/v2_art.dart ShifterOnline/lib/screens/home/widgets/home_header.dart ShifterOnline/lib/screens/home/widgets/home_pickup_card.dart ShifterOnline/assets/v2/.gitkeep ShifterOnline/pubspec.yaml ShifterOnline/test/home/home_header_test.dart ShifterOnline/test/home/home_pickup_card_test.dart
git commit -m "feat(customer-ui): orange Home header, pickup card, art slot with placeholder"
```

### Task 4: Service tiles + Home re-layout

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/home_service_tiles.dart`
- Modify: `ShifterOnline/lib/screens/home/home.dart` (`build` ~2672-2720; remove `_buildHomeRouteCard` call, `HomeVehicleRow`, `HomeMoreGrid`, `_buildQuickLocations` call from the Column; leave the methods' code only if still referenced elsewhere, else delete them and their now-unused imports)
- Modify: `ShifterOnline/lib/screens/home/home_option_tiles.dart` (`_FreeRideBanner` look → white strip, `#FFD3BF` 1.5 border, radius 16, `V2Art(asset: 'assets/v2/free_ride_icon.png', placeholderLabel: 'F1', width: 44, height: 44)`, title + sub from `FreeRideBannerCopy` unchanged, chevron)
- Test: `ShifterOnline/test/home/home_service_tiles_test.dart`; update `ShifterOnline/test/home/home_sections_test.dart` (delete vehicle-row and more-grid tests only if those widgets are deleted)

**Interfaces:**
- Consumes: `V2Art`, `HomeHeader`, `HomePickupCard`, `HomeHeader.overlap` (Task 3); `AppShadow.card` (Task 1).
- Produces: `HomeServiceTiles({required VoidCallback onBookNow, required VoidCallback onSchedule, required VoidCallback onLowFare, required VoidCallback onCustomise, bool scheduleEnabled = true})` — 2×2 grid, tile height 132, art `assets/v2/tile_book_now.png|tile_schedule.png|tile_low_fare.png|tile_customise.png` (placeholders T1–T4), labels 'Book Now'/'Schedule'/'Low Fare'/'Customise Order' (.tr), subs 'Instant pickup'/'Pick date and time'/'Next day, lower price'/'Offer your own fare' (.tr). When `scheduleEnabled` is false the Schedule tile is hidden and the grid shows 3 tiles.

- [ ] **Step 1: Write tests** (`home_service_tiles_test.dart`)

- `each tile calls its own callback` → tap each label, counters `[1,1,1,1]`.
- `schedule hidden when disabled` → `find.text('Schedule')` findsNothing, other 3 present.
- `width 320 textScale 1.3 no overflow` → `takeException()` isNull.
- `labels stay on one line` → each label `Text.maxLines == 1`.

- [ ] **Step 2: Run, expect FAIL**

Run: `cd ShifterOnline && flutter test test/home/home_service_tiles_test.dart`
Expected: FAIL (widget missing).

- [ ] **Step 3: Implement tiles, then re-layout Home**

Home Column order (inside the existing `SingleChildScrollView`, skeleton path unchanged): `HomeHeader(...)` → `Transform.translate(offset: Offset(0, -HomeHeader.overlap))` wrapping padding 16 and: `HomePickupCard(address: HomeHeader.pickupLine(confirmedPickup: _confirmedPickupAddress, gpsAddress: homeAddress), onTap: _changePickupLocation)`, 12, `_buildActiveOrderStrip()`, `HomeServiceTiles(onBookNow: _handleBookNowTap, onSchedule: _handleScheduleBookingTap, onLowFare: _handleNextDayDeliveryTap, onCustomise: CustomiseOrderTile.open, scheduleEnabled: _scheduleBookingEnabled)`, 12, `_buildRewardMilestoneCard()`, `const FreeRideChanceTile()`, 12, `if (showHowToUse) _buildHowToUseCard()`, legacy `_showLegacyVehicleSection` block untouched. Add `Future<void> _handleBookNowTap() async { setState(() => _selectedBookingType = 1); if (_confirmedDropData == null) { await _ensureCurrentPickup(); await _startDropSelection(); } else { await _openVehicleSelection(); } }` — mirrors `_handleScheduleBookingTap`. Pickup-first prompt / not-serviceable / no-vehicle states keep their existing triggers and position.

- [ ] **Step 4: Run whole suite + analyzer**

Run: `cd ShifterOnline && flutter analyze lib/screens/home lib/theme > /tmp/an.txt; tail -3 /tmp/an.txt; flutter test 2>&1 | tail -3`
Expected: no new analyzer errors (pre-existing `optiontraking.dart` error allowed); "All tests passed!".

- [ ] **Step 5: Commit**

```bash
git add -f ShifterOnline/lib/screens/home/widgets/home_service_tiles.dart ShifterOnline/lib/screens/home/home.dart ShifterOnline/lib/screens/home/home_option_tiles.dart ShifterOnline/test/home/home_service_tiles_test.dart ShifterOnline/test/home/home_sections_test.dart
git commit -m "feat(customer-ui): Porter-sparse Home — pickup card, 4 service tiles, Free Ride strip"
```
(Add any deleted widget/test files to the same commit with `git add -f` / `git rm`.)

### Task 5: Reward Points row in Account

**Files:**
- Modify: `ShifterOnline/lib/screens/profile/myprofile.dart` (favourites card ~813-830)

**Interfaces:**
- Consumes: existing `_buildMenuItem(icon, iconColor, iconBgColor, title, subtitle, onTap)` and `ReferralPointsScreen` (import from `../home/referral_points_screen.dart`).

- [ ] **Step 1: Add the row**

Directly above the Favourite Drivers item: `_buildMenuItem(icon: Icons.toll_outlined, iconColor: const Color(0xFF9A6700), iconBgColor: const Color(0xFFFFF6DB), title: "Reward Points", subtitle: "Your points and how to use them", onTap: () => Get.to(() => const ReferralPointsScreen()))`, then `_buildItemDivider()`.

- [ ] **Step 2: Verify**

Run: `cd ShifterOnline && flutter analyze lib/screens/profile/myprofile.dart`
Expected: No issues found (or only pre-existing infos).

- [ ] **Step 3: Commit**

```bash
git add -f ShifterOnline/lib/screens/profile/myprofile.dart
git commit -m "feat(customer-ui): Reward Points row in Account (moved from Home grid)"
```

### Task 6: Device check on the owner's phone

**Files:** none (ledger only).

- [ ] **Step 1: Build and install**

Run: `cd ShifterOnline && flutter build apk --debug && "$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" -s RZCX624XRVK install -r build/app/outputs/flutter-apk/app-debug.apk`
Expected: "Success".

- [ ] **Step 2: Walk the Home checklist**

Open the app; check: orange header with dark text; wallet chip opens Wallet; bell opens Notifications; pickup card opens pickup change; Book Now / Schedule / Low Fare / Customise Order each open what they opened before; Free Ride strip opens its sheet; nav 4 tabs switch; Account shows Reward Points and it opens. Screenshots of the Shifter app come back black (FLAG unknown), so ask the owner to confirm visually and report any issue. Record result in the ledger.
