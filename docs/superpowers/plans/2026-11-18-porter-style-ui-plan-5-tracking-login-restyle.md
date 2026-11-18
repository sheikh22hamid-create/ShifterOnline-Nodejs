# Porter-Style UI — Plan 5: Finding Driver, Tracking, Trip Complete, Login (v2 restyle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the remaining customer screens onto the v2 palette without changing their layout or any feature:
- finding driver (`waiting_screen.dart`)
- live tracking + after-trip (`trackingway.dart`)
- trip-complete widgets
- login (`signin.dart`, `verification.dart`, `complete_profile.dart`)

The changes are: one orange, no blue, dark mode working, and soft cards.

**Architecture:** spec §6.6/§6.10 keeps the v1 map-hero layout and the login flow, and allows only a v2 token restyle. So this plan is a colour-token sweep driven by one mapping table. The mapping lives in `lib/theme/legacy_color_map.dart` so that it is written once and tested. A file-level guard test (`legacy_colors_test.dart`) fails while any swept file still contains an unmapped hard-coded colour or a legacy `notifier.*` colour getter. That test is the TDD gate for each sweep task.

**Tech Stack:** Flutter (Dart), flutter_test, Python 3 for the one-off sweep script (scratchpad, not committed).

**Spec:** `docs/superpowers/specs/2026-11-18-customer-app-porter-style-ui-design.md` (§2 "no blue", §5 tokens, §6.6, §6.10, §7).

## Global Constraints

- **UI only.**
  - No change to sockets, API calls, OTP/login logic, timers, cancel/compensation rules or any tap handler.
  - Layouts stay as they are, except card borders/shadows named in a task.
- **Colours:**
  - Brand `#FF6B35` via `AppPalette.current.brand`. Old orange `#FA4500` becomes brand.
  - No blue anywhere (spec §2): every blue becomes a palette token per the map.
  - No white text on orange (`onBrand` is dark).
- **Kept as literals (allowed list):**
  - WhatsApp green `0xFF25D366`
  - pure black/white overlays and shadows (`Colors.black*`, `Colors.white*`, `0x..000000` alpha blacks)
  - map/polyline colours passed to Google Maps
- **Dark mode:** all swept colours come from `AppPalette.current`, so dark mode follows the app switch.
- **Commits:** `ShifterOnline/` is gitignored, so commit with `git add -f <exact files>`. Auto-commit each task. Never push.
- **Tests:** `cd ShifterOnline && flutter test` green, and project-wide `flutter analyze` warnings+errors ≤ the count before the plan.

## Colour map (the plan's one decision table)

| Legacy | Token (`AppPalette.current.`) |
|---|---|
| `linercolor`, `notifier.appBlueColor`, `0xFFFF6B35`, `0xFFFA4500`, `0xFFFF6D00` | `brand` |
| `notifier.darklinercolor`, `0xFFB83C0C` | `brandText` |
| `litelinercolor`, `0xFFFFF7F2`, `0xFFFFF3E8`, `0xFFFFE3D3` | `brandTint` |
| `notifier.text`, `0xFF15171C`, `0xFF111827`, `0xFF1F2937` | `ink` |
| `0xFF636977`, `0xFF6B7280`, `0xFF4B5563` | `inkMuted` |
| `0xFF94A3B8`, `0xFF9CA3AF` | `inkSubtle` |
| `notifier.getBgColor`, `notifier.getContainer` | `surface` |
| `notifier.lightBgColor`, `notifier.getimag`, `notifier.lightThemColor`, `0xFFF8FAFC`, `0xFFF3F4F6`, `0xFFF9FAFB`, `0xFFFAFAFA` | `canvas` |
| `notifier.bordecolor`, `0xFFE5E7EB`, `0xFFD1D5DB`, `0xFFCFD6DC`, `0xFFE2E8F0` | `line` |
| `0xFF16A34A`, `0xFF059669`, `0xFF1B7F47` | `success` |
| `0xFF15803D`, `0xFF065F46`, `0xFF166534` | `successText` |
| `0xFFECFDF3`, `0xFFECFDF5`, `0xFFF0FDF4`, `0xFFDCFCE7`, `0xFFBBE5C8`, `0xFFA7F3D0` | `successTint` |
| `0xFFB42318` | `danger` |
| `0xFFFFF4F2`, `0xFFF8CFC7` | `dangerTint` |
| `0xFFE08A00`, `0xFFFFC107`, `0xFFFFC857`, `0xFFFFC96E` | `warning` |
| `0xFFFFFBEB`, `0xFFFFF4E5`, `0xFFFFE082`, `0xFFFFCC80` | `warningTint` |
| **blue** `0xFF2979FF`, `0xFF4C8DFF`, `0xFF0D47A1` | `brandText` |
| **blue tints** `0xFFEBF3FF`, `0xFFF2F7FF`, `0xFFD3E3FF` | `brandTint` |
| `0xFF1A0B04` | `onBrand` |

Hex matching ignores case (`0xff…` = `0xFF…`). `greaycolor` already reads `AppPalette.current.inkSubtle` and stays.

## Review Focus

- **Dark mode on tracking:** the bottom panel, OTP card, driver card and status chips stay readable (no light-on-light), because the sweep removes the light-only literals. Guard test in Tasks 2–3 plus a device check in dark mode (Task 5).
- **"On route" status / change-drop option / info boxes that were blue:** they now use `brandText` on `brandTint`, and their text stays legible. Covered by the colour map + guard; checked on device.
- **`const` widgets that held a literal colour:** they must lose `const` instead of keeping the old colour. Analyzer "invalid constant" errors are the signal (Task 3 step 4).
- **Login on a 360dp phone at textScale 1.3:** no overflow after the button/colour swap. Existing `test/delivery_login_hero_test.dart` + `test/complete_profile_test.dart` stay green; device check.
- **Google Maps markers/polylines:** they keep their colours. They are on the allowed list, so the sweep must not touch `BitmapDescriptor` / `Polyline` colour arguments. Checked in Task 3 step 3.

---

### Task 1: Legacy colour map + guard test

**Files:**
- Create: `ShifterOnline/lib/theme/legacy_color_map.dart`
- Create: `ShifterOnline/test/theme/legacy_colors_test.dart`

**Interfaces:**
- Produces:
  - `const Map<int, String> kLegacyHexToToken`: ARGB int → token name, exactly the table above.
  - `const Map<String, String> kLegacyGetterToToken`: e.g. `'notifier.text' → 'ink'`, `'linercolor' → 'brand'`.
  - `const Set<int> kAllowedLiteralColors = {0xFF25D366}`.
  - `List<String> legacyColorViolations(String source)`: every `Color(0x…)` literal whose value is not in `kAllowedLiteralColors` and is not an alpha-black (`0x..000000`) or white (`0x..FFFFFF`), plus every `notifier.<getter>` / `linercolor` / `litelinercolor` occurrence, each as `"line N: <match>"`.
  - The guard test checks the files listed in its `_swept` list, which each later task adds its file(s) to.

- [ ] **Step 1: Write the failing tests** in `legacy_colors_test.dart`:
  - `map covers every colour the plan table names`: spot-check `kLegacyHexToToken[0xFFFA4500] == 'brand'`, `[0xFF2979FF] == 'brandText'`, `[0xFFECFDF3] == 'successTint'`, `kLegacyGetterToToken['notifier.bordecolor'] == 'line'`.
  - `violations finds hex, notifier getters and linercolor; ignores WhatsApp green, alpha black, white`: the source `"Color(0xFF16A34A) Color(0xff25D366) Color(0x28000000) Color(0xFFFFFFFF) notifier.text linercolor"` yields exactly 3 violations.
  - `swept files contain no legacy colours`: for each path in `const _swept = <String>[]` (empty for now), read the file and `expect(legacyColorViolations(src), isEmpty, reason: path)`.
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/theme/legacy_colors_test.dart`. It should fail because the file does not exist.
- [ ] **Step 3: Implement** `legacy_color_map.dart` (regex `Color\(0x([0-9A-Fa-f]{8})\)`; getters from the map keys).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Write the sweep script** `scratchpad/sweep_colors.py <dart file>`, not committed. Its rules:
  - Replace each mapped hex literal (any `.withOpacity(x)` / `.withValues(alpha: x)` suffix stays) with `AppPalette.current.<token>`.
  - Replace each legacy getter with `AppPalette.current.<token>`.
  - Leave allowed literals and anything inside a line containing `BitmapDescriptor`, `Polyline(`, `polylineColor` or `markerColor` untouched.
  - Print the counts.
  - It reads the table from `legacy_color_map.dart`, so there is one source of truth.
- [ ] **Step 6: Commit**
```bash
git add -f ShifterOnline/lib/theme/legacy_color_map.dart ShifterOnline/test/theme/legacy_colors_test.dart
git commit -m "feat(customer-ui): legacy colour map + guard test for the v2 restyle sweep"
```

### Task 2: Finding driver + trip-complete widgets

**Files:**
- Modify: `ShifterOnline/lib/screens/home/waiting_screen.dart` (`AppPalette.light` at :129 and :254 → `AppPalette.current`; the main panel card at :554 → no border, `AppShadow.card`)
- Modify: `ShifterOnline/lib/screens/myorder/widgets/trip_complete_widgets.dart` (card borders → `AppShadow.card`; nothing else)
- Modify: `ShifterOnline/test/theme/legacy_colors_test.dart` (add both paths to `_swept`)

- [ ] **Step 1: Add both paths to `_swept`.** Run `flutter test test/theme/legacy_colors_test.dart`. Expect FAIL only if a file has violations. If it already passes, note it in the ledger; the guard still protects the files from now on.
- [ ] **Step 2: Apply the edits above** (plus the sweep script if the guard listed violations).
- [ ] **Step 3: Verify.** Run `cd ShifterOnline && flutter test` and expect all green, including `test/myorder/trip_complete_widgets_test.dart` and `test/home/radar_pulse_test.dart`. Run `flutter analyze` and expect a count ≤ baseline.
- [ ] **Step 4: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/waiting_screen.dart ShifterOnline/lib/screens/myorder/widgets/trip_complete_widgets.dart ShifterOnline/test/theme/legacy_colors_test.dart
git commit -m "feat(customer-ui): finding-driver + trip-complete on v2 palette (dark mode follows)"
```

### Task 3: Live tracking sweep (`trackingway.dart`)

**Files:**
- Modify: `ShifterOnline/lib/screens/myorder/trackingway.dart` (colours only)
- Modify: `ShifterOnline/test/theme/legacy_colors_test.dart` (add the path)

- [ ] **Step 1: Add the path to `_swept`.** Run the guard and expect FAIL with roughly 500 violations.
- [ ] **Step 2: Run the sweep script on the file.** Save the pre-sweep copy to scratchpad.
- [ ] **Step 3: Check the maps.** Run `grep -n "BitmapDescriptor\|Polyline(" lib/screens/myorder/trackingway.dart` and compare those lines with the pre-sweep copy. They must be byte-identical.
- [ ] **Step 4: Fix const errors.** Run `flutter analyze lib/screens/myorder/trackingway.dart`. For each `const_with_non_const` / `invalid_constant` / `non_constant_*` error, remove the `const` keyword at that widget, never the token. Repeat until the analyzer shows no errors and warnings ≤ the file's pre-sweep count.
- [ ] **Step 5: Run the guard and expect PASS.** Any violation left must be an allowed literal. If not, add it to the map table (and this plan's table) with a ledgered ruling.
- [ ] **Step 6: Verify.**
  - Run `cd ShifterOnline && flutter test` and expect all green, including `test/myorder/tracking_rules_test.dart`.
  - Run `git diff --stat` and expect only trackingway.dart and the test file changed.
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/myorder/trackingway.dart ShifterOnline/test/theme/legacy_colors_test.dart
git commit -m "feat(customer-ui): live tracking on v2 palette — no blue, dark mode follows"
```

### Task 4: Login screens

**Files:**
- Modify: `ShifterOnline/lib/screens/authscreen/signin.dart`, `verification.dart`, `complete_profile.dart` (colours only)
- Modify: `ShifterOnline/test/theme/legacy_colors_test.dart` (add the three paths)

- [ ] **Step 1: Add the three paths to `_swept`.** Run the guard and expect FAIL (signin about 61, complete_profile about 14, verification about 12).
- [ ] **Step 2: Sweep, then fix const errors** as in Task 3 step 4.
- [ ] **Step 3: Verify.** Run the guard and expect PASS. Run `flutter test` and expect all green, including `test/delivery_login_hero_test.dart`, `test/complete_profile_test.dart` and `test/phone_number_test.dart`. Run analyze and expect a count ≤ baseline.
- [ ] **Step 4: Commit**
```bash
git add -f ShifterOnline/lib/screens/authscreen/signin.dart ShifterOnline/lib/screens/authscreen/verification.dart ShifterOnline/lib/screens/authscreen/complete_profile.dart ShifterOnline/test/theme/legacy_colors_test.dart
git commit -m "feat(customer-ui): login / OTP / complete-profile on v2 palette"
```

### Task 5: Device check

- [ ] **Step 1: Build and install the debug APK** (same commands as Plan 4 Task 5).
- [ ] **Step 2: Self-check by screenshot:** log out → sign-in screen → OTP screen (do not submit) → back. Do it in light mode and in dark mode.
- [ ] **Step 3: Owner checks with a real booking** (DEV backend, as they normally test):
  1. finding-driver screen
  2. driver assigned → tracking panel: OTP card, driver card, call/chat/share, change drop, status chip (no blue)
  3. trip complete: rating, invoice, settlement
  4. the same tracking screen in dark mode

  The result is recorded in the ledger.
