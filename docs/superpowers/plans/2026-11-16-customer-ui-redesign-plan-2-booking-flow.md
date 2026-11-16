# Customer UI Redesign — Plan 2: Booking Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the five booking screens (location search, confirm drop details, choose vehicle, review & pay, finding driver) in the approved look, with every existing behaviour unchanged.

**Architecture:** Same rules as Plan 1. These screens already split their UI into private builders (`_routeSummary`, `_vehicleCard`, `_buildPaymentOptionCard`, `_buildGuaranteeCard`, …) that sit next to the state and handlers, so they are **restyled in place** using Plan 1 tokens/components. Only clean, reusable presentational pieces are extracted into tested widgets (`lib/theme/widgets/` for app-wide pieces, `lib/screens/home/widgets/` for booking-only ones). No screen's layout order, conditions or handlers change.

**Tech Stack:** Flutter, GetX, Provider, `flutter_test`. No new packages.

**Spec:** `docs/superpowers/specs/2026-11-16-customer-app-ui-redesign-design.md` §6 items 2–6, §7, §8. Mockups: boards "1. Location search" … "5. Finding driver" at https://claude.ai/artifact/N6W3fokfpJBwhrXFGhpwhb. Builds on Plan 1 (`lib/theme/app_tokens.dart`, `lib/theme/widgets/*`).

## Global Constraints

- UI-only: no change to API calls, socket events, `GetStorage` keys, navigation targets/arguments, validations, timers or state transitions. Every restyled tappable keeps its exact existing `onTap`/`onPressed` expression.
- No feature removed or made unreachable — every conditional section keeps its condition (e.g. `_freeRideChanceLocked`, `_isAvailable(...)`, `_selectedModel != null`, receiver-pays availability, pending settlement, Low Fare window, schedule, body-type rules, guarantee amount > 0).
- Brand `#FF6B35`, text on orange `#1A0B04`, orange text `#B83C0C`; Gilroy; no emojis, gradients or new Lottie; touch targets ≥ 44; `.tr` on all copy; no overflow at width 320 / textScale 1.3 / RTL; dark palette via `AppPalette.current`; reduce motion respected.
- Maps (`GoogleMap`) keep their controllers, markers, polylines and camera logic untouched; only overlays around them are restyled.
- Commits: `git add -f <exact files>`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.
- Tests: `cd ShifterOnline && flutter test <file>`; analyzer must show no new issues in touched files.

## Review Focus

1. Vehicle with `availability` false / no drivers → card shows unavailable state and is not selectable exactly as today (test in Task 4).
2. Long Indian-language strings on payment options and guideline rows → wrap, no overflow (tests in Tasks 1, 5).
3. Receiver-pays card states (unavailable / on / off with commission field) keep their visibility rules (manual check Task 7; code untouched).
4. Cancel pressed twice quickly on Finding driver → still guarded by `_isCancelling` (Task 6 keeps the expression).
5. Dark mode on map overlays (sheet, chips) → dark surface, readable text (test in Task 1 components).

---

### Task 1: Booking-wide components (+ Plan 1 segmented fix)

**Files:**
- Create: `ShifterOnline/lib/theme/widgets/app_top_bar.dart`, `app_sheet.dart`, `app_radio_tile.dart`, `app_info_banner.dart`
- Modify: `ShifterOnline/lib/theme/widgets/app_segmented.dart` (labels `maxLines: 2`, `textAlign: center` — Plan 1 deferred minor)
- Test: `ShifterOnline/test/theme/app_booking_widgets_test.dart`

**Interfaces (Produces):**
- `AppTopBar({required String title, String? subtitle, VoidCallback? onBack, List<Widget> actions = const []})` implements `PreferredSizeWidget` (height 64); 44×44 round back button (`semanticLabel` "Back".tr), title `AppText.section`, subtitle `AppText.caption(inkSubtle)`; surface background; `onBack == null` → `Get.back`.
- `AppSheet({required Widget child, EdgeInsets padding = const EdgeInsets.fromLTRB(16, 8, 16, 16), bool showHandle = true})` — surface, top radius 24, top shadow, 40×4 handle.
- `AppRadioTile({required IconData icon, required String title, String? subtitle, String? badge, required bool selected, required VoidCallback? onTap, Color? iconColor, bool enabled = true})` — min height 64, selected = brand border 1.5 + brandTint, radio dot on the end side; `enabled == false` → 45% opacity, no tap; `Semantics(selected: selected)`.
- `enum AppBannerTone { info, success, warning, danger, brand }` and `AppInfoBanner({required AppBannerTone tone, required IconData icon, required String text, String? title, String? actionLabel, VoidCallback? onAction})` — tint background from tone, icon + text (wraps), optional action text button (≥44 high).

- [ ] **Step 1: Failing tests:** top bar back calls `onBack`; sheet shows handle only when `showHandle`; radio tile tap calls `onTap`, disabled tile ignores taps, selected tile has brand border, long title+subtitle at width 320 textScale 1.3 no overflow; banner action calls `onAction`, banner without action has no button, each tone uses its palette tint (`success` → `successTint`, `danger` → `dangerTint`); dark palette surface for sheet when `notifier.setIsDark = true`; segmented "Low Fare" not ellipsized at width 320 textScale 1.3 (`tester.widget<Text>(find.text('Low Fare')).maxLines == 2`).
- [ ] **Step 2: Run** `flutter test test/theme/app_booking_widgets_test.dart` — FAIL.
- [ ] **Step 3: Implement** the four widgets and the segmented change.
- [ ] **Step 4: Run** the new test file and `test/theme` + `test/home` — PASS.
- [ ] **Step 5: Commit** `feat(customer-ui): top bar, sheet, radio tile, info banner components`.

---

### Task 2: Location search (`location_search_screen.dart`)

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/place_list_tile.dart`
- Modify: `ShifterOnline/lib/screens/home/location_search_screen.dart` (`build` 557–955, `_buildPredictionsList` 955, `_buildRecentSearchesList` 1029)
- Test: `ShifterOnline/test/home/place_list_tile_test.dart`

**Interfaces:** `PlaceListTile({required String title, String? subtitle, required IconData icon, String? highlight, String? trailingText, required VoidCallback onTap, Widget? trailing})` — 36 px round neutral icon, title bold with the `highlight` substring (case-insensitive) in `brandText`, subtitle muted, min height 64.

**Mapping:** scaffold → `AppTopBar` (same back behaviour); search field(s) restyled (pickup filled / active field brand border + tint ring), voice button → `_toggleListening` (keep its listening state indicator); action chips row: "Use current location" → `_useCurrentLocation`, "Pick on map" → `_selectOnMap`, "Paste map link" → `_importFromWhatsApp` (labels stay the screen's existing strings where they exist); predictions and recents → `PlaceListTile` with the same `onTap` bodies; empty/loading states → `AppSkeleton` rows / existing messages.

- [ ] **Step 1: Failing tests:** tile tap calls `onTap`; highlight renders matching text in `brandText` (find `RichText` span colour); no highlight when substring absent; width 320 textScale 1.3 long address no overflow.
- [ ] **Step 2: Run** `flutter test test/home/place_list_tile_test.dart` — FAIL.
- [ ] **Step 3: Implement** `PlaceListTile`, then restyle the screen per Mapping. Before editing, list every `onTap`/`onPressed` in the file (`grep -n "onTap\|onPressed" location_search_screen.dart`) and confirm each survives.
- [ ] **Step 4: Run** tile test — PASS; `flutter analyze lib/screens/home/location_search_screen.dart` — no new issues.
- [ ] **Step 5: Commit** `feat(customer-ui): restyle location search`.

---

### Task 3: Confirm drop details (`location_confirm_map_screen.dart`)

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/pin_drop_marker.dart`; add `InputDecoration appInputDecoration({String? label, String? hint, bool focused = false})` to `ShifterOnline/lib/theme/app_tokens.dart`
- Modify: `ShifterOnline/lib/screens/home/location_confirm_map_screen.dart` (`build` 405–936, `_buildTagChip` 936)
- Test: `ShifterOnline/test/home/pin_drop_marker_test.dart`

**Interfaces:** `PinDropMarker({required Color color, bool animate = true})` — 40×52 pin with white dot, drops and settles once (1 s) when `animate` and motion allowed; shadow ellipse below. `appInputDecoration` — radius 12, `line` border, `brand` focused border, label `AppText.caption(inkMuted)`.

**Mapping:** centre pin overlay → `PinDropMarker` (same position logic); recenter button → `_recenterToGps` (44×44 round, shadow); bottom panel → `AppSheet` containing the address block, house/floor field, receiver name/number fields (same controllers/validators), "Choose from phone book" → `_pickFromPhoneBook`, the WhatsApp opt-in checkbox (same value/handler), tag chips (`_buildTagChip`, same handlers) restyled as pills, confirm button → `AppPrimaryButton` with the existing `_isSavingAddress ? null : <existing handler>` expression.

- [ ] **Step 1: Failing tests:** marker with reduce motion → no scheduled frame; `animate: false` → no animation; marker paints in `color`.
- [ ] **Step 2: Run** `flutter test test/home/pin_drop_marker_test.dart` — FAIL.
- [ ] **Step 3: Implement** marker + decoration helper, restyle the screen per Mapping (grep `onTap|onPressed|onChanged|validator` first and confirm each survives).
- [ ] **Step 4: Run** — PASS; analyzer clean for the file.
- [ ] **Step 5: Commit** `feat(customer-ui): restyle confirm drop details`.

---

### Task 4: Choose vehicle (`select_vehicle.dart`)

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/vehicle_option_card.dart`
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (`build` 1484, `_freeRideChanceLockedBanner` 1595, `_loadingVehicles` 1637, `_routeSummary` 1639, `_vehicleCard` 1944, `_selectedVehicleSection` 2019, `_twoWheelerBodyTypeNotice` 2176, `_bodyTypeSelector` 2204, `_bodyTypeChip` 2275, `_noDriversAvailableCard` 2320, `_emptyState` 2368, `_bottomCta` 2369)
- Test: `ShifterOnline/test/home/vehicle_option_card_test.dart`

**Interfaces:** `VehicleOptionCard({required String name, String? imageUrl, String? caption, String? tag, required bool selected, required bool available, required VoidCallback onTap})` — 136 wide, image area 82 (`cacheWidth: 300`, placeholder icon), name bold, caption muted (capacity/ETA text the screen already computes), optional tag pill; `available == false` → 45% opacity, "Not available".tr caption, `onTap` still called (today's card decides selection inside `_vehicleCard`'s handler — keep that).

**Mapping:** `AppBar` → `AppTopBar(title: 'Select vehicle'.tr, subtitle: 'Choose the best option for your delivery'.tr)` — the old help icon (`onPressed: () {}`, does nothing) is not carried over; no behaviour is lost (record as a ruling). Search-area pill → `AppSecondaryButton`-style chip, `onTap: _openSearchAreaSheet`, text "Search area: @km km". `_freeRideChanceLockedBanner` → `AppInfoBanner(tone: warning)` with its existing text/action. `_loadingVehicles` → two `AppSkeleton` cards. `_vehicleCard` → `VehicleOptionCard` (same onTap body). `_selectedVehicleSection` internals → `AppCard` groups; model toggles keep `_toggleModel`; Low Fare date/time pickers keep `_pickLowFareDate` / `_pickLowFareTime`; schedule picker keeps `_pickScheduleDateTime`; coupon, referral points toggle, goods type, GST section keep their widgets/handlers, only container styling changes; guarantee line → `AppInfoBanner(tone: success)` shown only when `guaranteeLine(_guaranteeAmount) != null`. Body-type chips → pills (same handler). `_noDriversAvailableCard` / `_emptyState` → `AppInfoBanner`/empty card with the same `_refreshAvailability` / radius actions. `_bottomCta` → `AppPrimaryButton(label: <existing label>, trailing: <existing fare text>, onPressed: <existing expression>)` on an `AppSheet`-styled bar, plus "View fare details" → `_showFareBreakdown(...)` (same args).

- [ ] **Step 1: Failing tests:** tap calls `onTap`; selected → brand border + brandTint; unavailable → opacity 0.45 and "Not available" shown; tag pill shown only when `tag != null`; width 320 textScale 1.3 no overflow.
- [ ] **Step 2: Run** `flutter test test/home/vehicle_option_card_test.dart` — FAIL.
- [ ] **Step 3: Implement** card; restyle builders one at a time, running `flutter analyze lib/screens/home/select_vehicle.dart` after each; grep `onTap|onPressed|onChanged` before/after and diff the handler lists (they must be identical except the removed no-op help action).
- [ ] **Step 4: Run** card test + full `flutter test` — PASS.
- [ ] **Step 5: Commit** `feat(customer-ui): restyle choose vehicle`.

---

### Task 5: Review & pay (`confirm_order_map.dart`)

**Files:**
- Modify: `ShifterOnline/lib/screens/home/confirm_order_map.dart` (`build` 465–904, `_buildReceiverPayCard` 904, `_buildPaymentOptionCard` 1034, `_buildGuidelineRow` 1120)
- Create: `ShifterOnline/lib/screens/home/widgets/booking_guidelines.dart`
- Test: `ShifterOnline/test/home/booking_guidelines_test.dart`

**Interfaces:** `BookingGuidelines({required String title, required List<({IconData icon, String text})> items})` — `warningTint` card, title row with info icon, rows wrap.

**Mapping:** top → `AppTopBar` ("Review booking".tr, same back); map stays; route/stops/receivers summary → `AppCard`; `_buildPaymentOptionCard` → `AppRadioTile` with the same selection value/handler, enabled flag (wallet insufficient keeps today's message "Insufficient wallet balance. Please add money or choose Cash."), wallet "Available: @value" subtitle and add-money link (`Get.to(() => const WalletPage())`) unchanged; `_buildReceiverPayCard` restyled inside (commission field, WhatsApp-link note, availability rules untouched); `_buildGuidelineRow`s → `BookingGuidelines` with the same four texts; confirm button → `AppPrimaryButton` with the existing expression.

- [ ] **Step 1: Failing tests:** guidelines render every item text; long texts at width 320 textScale 1.3 no overflow; uses warning tint.
- [ ] **Step 2: Run** `flutter test test/home/booking_guidelines_test.dart` — FAIL.
- [ ] **Step 3: Implement** + restyle per Mapping (handler grep before/after).
- [ ] **Step 4: Run** — PASS; analyzer clean for the file.
- [ ] **Step 5: Commit** `feat(customer-ui): restyle review and pay`.

---

### Task 6: Finding driver (`waiting_screen.dart`)

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/radar_pulse.dart`
- Modify: `ShifterOnline/lib/screens/home/waiting_screen.dart` (`_cancelBenefit` 220, `_buildGuaranteeCard` 462, `build` 531)
- Test: `ShifterOnline/test/home/radar_pulse_test.dart`

**Interfaces:** `RadarPulse({required Color color, double size = 300, int rings = 3})` — expanding rings (2.4 s, staggered) inside `RepaintBoundary`; static single ring when reduce motion.

**Mapping:** header/background → light canvas with `RadarPulse` around the pickup pin (or the existing map if the screen has one — keep it); "Finding your driver" title + indeterminate brand bar; order summary → `AppCard`; `_buildGuaranteeCard` → `AppInfoBanner(tone: success)` (locked → `guaranteeLockedLine`, warning tone) with the same conditions; "Go to Home" → `_navigateBackToHome` (both places); cancel → danger-outlined `AppSecondaryButton` with the existing `_isCancelling ? null : ...` expression; `_cancelBenefit` dialog rows restyled (texts, referral counts and buttons unchanged).

- [ ] **Step 1: Failing tests:** radar animates normally (scheduled frame after pump); no scheduled frame with reduce motion; ring count = `rings`.
- [ ] **Step 2: Run** `flutter test test/home/radar_pulse_test.dart` — FAIL.
- [ ] **Step 3: Implement** + restyle (handler grep before/after).
- [ ] **Step 4: Run** — PASS; analyzer clean.
- [ ] **Step 5: Commit** `feat(customer-ui): restyle finding driver`.

---

### Task 7: Strings, build, device check

**Files:** Modify `ShifterOnline/lib/Language/language_string.dart` (`en_US` additions for every new literal from Tasks 1–6; skip keys that already exist — duplicate literal keys don't compile).

- [ ] **Step 1:** Add strings; `flutter analyze` on all touched files — no new issues; `flutter test` — all pass.
- [ ] **Step 2:** `flutter build apk --debug`; install on the connected phone (`adb -s RZCX624XRVK install -r build/app/outputs/flutter-apk/app-debug.apk`); take `adb shell screencap` screenshots of each booking screen reachable without placing an order and inspect them (overflow stripes, contrast, status bar).
- [ ] **Step 3: Owner checklist (DEV server, real order):** search → voice / current location / pick on map / paste link; confirm drop with receiver + WhatsApp opt-in + save tag; vehicle: search area change, unavailable vehicle, model toggles, body type, goods type, coupon, points, GST, Next Day Saver window, schedule; review: Cash / Wallet (sufficient + insufficient) / Receiver pays with commission; confirm → finding driver; cancel with benefit dialog; Go to Home; light + dark; English + one Indian language.
- [ ] **Step 4: Commit** `feat(customer-ui): booking flow strings`.

## Self-review notes

- Spec §6 items 2–6 → Tasks 2–6; §7 conditional states kept by "same condition" mapping in Tasks 4–6; §8 motion → PinDropMarker, RadarPulse, reduce-motion tests; Plan 1 deferred minor (segment truncation) → Task 1.
- Plan 1 deferred minors not in scope here: More-grid dark tints, Home bottom space, fade-ups, wallet-history call.
- Names: `AppTopBar`, `AppSheet`, `AppRadioTile`, `AppBannerTone`/`AppInfoBanner`, `PlaceListTile`, `PinDropMarker`, `appInputDecoration`, `VehicleOptionCard`, `BookingGuidelines`, `RadarPulse`.
