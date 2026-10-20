# All Indian Languages - Customer App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The customer app (`ShifterOnline/`, Flutter + GetX) speaks all 23 languages on every screen, RTL for Urdu and Kashmiri, with a detector that fails when text or a translation is missing.

**Architecture:** Translations move from Dart const maps to one JSON per language in `assets/i18n/` loaded before `runApp` into GetX `Translations` (keys stay the English UI strings). `flutter_localizations` + a fallback delegate + a `Directionality` builder handle Material labels and RTL. A pure-Dart audit library (used by a tool and by tests) finds missing keys, placeholder mismatches and hardcoded literals. Hardcoded text is converted screen-group by screen-group, then all 22 non-English files are completed.

**Tech Stack:** Flutter 3 / GetX, `flutter_localizations`, `intl`, bundled Noto fonts, `flutter test`, connected Android device SM E156B for QA.

**Spec:** `docs/superpowers/specs/2026-10-20-indian-languages-design.md` (read it first; project 2 driver app and project 3 server messages are separate plans).

## Global Constraints

- 23 languages, codes (all `_IN`, except English `en_US`): as, bn, brx, doi, en, gu, hi, kn, ks, kok, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur. Language names shown in native script: English, हिंदी, অসমীয়া, বাংলা, बड़ो, डोगरी, ગુજરાતી, ಕನ್ನಡ, کٲشُر, कोंकणी, मैथिली, മലയാളം, ꯃꯅꯤꯄꯨꯔꯤ (Meitei Mayek), मराठी, नेपाली, ଓଡ଼ିଆ, ਪੰਜਾਬੀ, संस्कृतम्, ᱥᱟᱱᱛᱟᱲᱤ, सिन्धी, தமிழ், తెలుగు, اردو.
- Scripts: Santali Ol Chiki; Manipuri Meitei Mayek; Kashmiri Perso-Arabic (RTL); Sindhi Devanagari (LTR); Urdu RTL.
- Fare, wallet, OTP, phone number and order id digits stay Western 0-9 in every language. No change to booking, pricing, wallet, payment or any business logic.
- Saved language key stays `lan2` (language code); unknown saved values resolve to English.
- Translation placeholders use `@name` and must match the English key in every language. Glossary terms (Order, Driver, Wallet, Booking, Pickup, Drop, Refund) are translated identically everywhere (`assets/i18n/_glossary.json`).
- Work on branch `feature/indian-languages`; `ShifterOnline/` is gitignored, so `git add -f` exact files; commit per task; never push/deploy.
- Run Flutter commands from `ShifterOnline/`. Test command: `flutter test`.

## Review Focus

- A translation drops or renames an `@placeholder` (the screen would show a raw `@id`): detector fails the build.
- Key mismatch between code and JSON by punctuation/whitespace/quote style (`'Cancel Order'` vs `"Cancel Order "`): the audit normalises nothing, so any drift is reported.
- Text built by concatenation or `+` (`'Total: ' + x`) bypassing keys: the hardcoded-literal scan flags the literal half.
- Missing glyphs (boxes) for Ol Chiki, Meitei Mayek, Nastaliq and clipped/overflowing layouts on small screens in the longest languages.
- Language changed while a dialog or bottom sheet is open, and app restart: language applied before the first frame, no crash.

---

### Task 1: Language config for 23 languages

**Files:**
- Modify: `lib/Language/language_config.dart`
- Test: `test/language_test.dart`

**Interfaces:**
- Produces: `class AppLanguage { final String name; final Locale locale; final bool isRtl; final List<String> fontFamilyFallback; String get translationKey; }`; `const List<AppLanguage> appLanguages` (23 entries, English first, then the order in Global Constraints); `Locale resolveAppLocale(String?)`, `int appLanguageIndex(String?)`, `bool isRtlLocale(Locale)` (true for `ur`, `ks`); `const Locale fallbackAppLocale = Locale('en','US')`.

- [ ] **Step 1:** Extend `test/language_test.dart`: `appLanguages.length == 23`; every native name from Global Constraints present in order; `isRtlLocale` true only for ur and ks; `resolveAppLocale('sat').languageCode == 'sat'`, `resolveAppLocale('fr')` and `resolveAppLocale(null)` give `en_US`; language codes unique; `appLanguageIndex('xx') == 0`.
- [ ] **Step 2:** Run `flutter test test/language_test.dart` - Expected: FAIL (length 10).
- [ ] **Step 3:** Implement the list and `isRtl`/`fontFamilyFallback` (fallback family names `NotoSansOlChiki`, `NotoSansMeeteiMayek`, `NotoNaskhArabic`, declared in Task 4).
- [ ] **Step 4:** Run the test - Expected: PASS.
- [ ] **Step 5:** Commit `feat(i18n): 23-language config`.

### Task 2: JSON translation store

**Files:**
- Create: `tool/export_translations.dart` (one-off migration), `assets/i18n/<code>.json` for en + the 9 existing languages, `lib/Language/translation_loader.dart`
- Modify: `lib/Language/language_string.dart`, `lib/main.dart`, `pubspec.yaml` (assets `assets/i18n/`)
- Test: `test/translation_loader_test.dart`

**Interfaces:**
- Consumes: `appLanguages` (Task 1); current maps in `language_indian.dart` and the `en_US` map in `language_string.dart`.
- Produces: `Future<Map<String, Map<String, String>>> loadTranslations([AssetBundle? bundle])` returning `{ "hi_IN": {...}, ... }` for every `appLanguages` entry whose JSON exists; `class LocalString extends Translations { LocalString(Map<String, Map<String, String>> keys); }`. JSON is a flat object `{ "<English key>": "<translation>" }`; `en.json` maps every key to itself.

- [ ] **Step 1:** Write `test/translation_loader_test.dart`: loading the real bundle yields `en_US` plus the 9 existing locales; for each of the 9 existing languages every pre-migration key/value (captured by the export tool into `test/fixtures/legacy_translations.json`) is present and identical in the loaded map; en values equal their keys; a malformed or missing file throws a `FormatException`/`StateError` naming the language.
- [ ] **Step 2:** Run it - Expected: FAIL (no loader).
- [ ] **Step 3:** Implement `tool/export_translations.dart` (run once with `dart run`; it imports the old Dart maps and writes the JSON files + the legacy fixture), then `translation_loader.dart`, `LocalString(keys)`, and in `main()` await `loadTranslations()` before `runApp`, passing the result to `GetMaterialApp(translations: LocalString(loaded))`.
- [ ] **Step 4:** Run the test, then delete `language_indian.dart` and the inline `en_US` map; run `flutter test` - Expected: PASS.
- [ ] **Step 5:** Commit `refactor(i18n): translations as JSON assets`.

### Task 3: Audit library, tool and review sheet

**Files:**
- Create: `tool/i18n_audit_lib.dart`, `tool/i18n_audit.dart`, `tool/i18n_review_sheet.dart`
- Test: `test/i18n_audit_test.dart` (fixture-based)

**Interfaces:**
- Produces (pure Dart, no Flutter imports):
  - `Set<String> extractKeys(String dartSource)` - every literal key of `'...'.tr`, `"...".tr`, `'...'.trParams(`, `.trArgs(`, single or double quoted, with `\'` escapes resolved.
  - `List<String> placeholders(String text)` - the sorted `@name` tokens.
  - `List<Finding> findHardcodedLiterals(String dartSource, {Set<String> allow = const {}})` - literal text in `Text(`, `hintText:`, `labelText:`, `title:`, `label:`, `buttonLabel:`, `showToastMessage(`, `SnackBar(content: Text(` that is not followed by `.tr`/`.trParams`, ignoring strings with no letters, URLs, symbols-only and allow-listed brand strings; `class Finding { final String file; final int line; final String text; }`.
  - `AuditReport audit({required Map<String, Map<String, String>> languages, required Set<String> sourceKeys})` with `missingInLanguage`, `placeholderMismatch`, `emptyValues`, `unusedKeys`; `bool get isClean`.
- `tool/i18n_audit.dart` scans `lib/` + `assets/i18n/`, prints the report, exits 1 when not clean. `tool/i18n_review_sheet.dart` writes `build/i18n_review/<code>.csv` (key, English, translation, reviewed).

- [ ] **Step 1:** Write fixture tests: `extractKeys` finds single/double-quoted and interpolation-free keys and ignores `.tr` on identifiers; `placeholders('Order #@id for @name') == ['@id','@name']`; `findHardcodedLiterals` flags `Text('Wallet')` and `showToastMessage('Failed')`, ignores `Text('Wallet'.tr)`, `Text('₹')`, `Text('https://x.y')`, `Text(variable)` and allow-listed `Text('Shifter')`; `audit` reports a language missing a key, a translation with `@id` renamed `@ID`, an empty value, and is clean for consistent data.
- [ ] **Step 2:** Run `flutter test test/i18n_audit_test.dart` - Expected: FAIL.
- [ ] **Step 3:** Implement the library, the two tools, and a debug-only startup check in `lib/Language/translation_loader.dart`: `List<String> languagesMissingKeys(Map<String, Map<String, String>> loaded)` (languages whose key set differs from `en_US`), logged once with `debugPrint` in debug builds (unit-tested with a small map).
- [ ] **Step 4:** Run the tests - Expected: PASS. Run `dart run tool/i18n_audit.dart` once and record the current counts in the commit message (expected to be NOT clean; the gate is enabled in Task 11).
- [ ] **Step 5:** Commit `feat(i18n): audit library, tool and review-sheet export`.

### Task 4: Material delegates, RTL and fonts

**Files:**
- Create: `lib/Language/fallback_material_delegate.dart`, `lib/Language/rtl_wrapper.dart`, `assets/fonts/NotoSansOlChiki-Regular.ttf`, `NotoSansMeeteiMayek-Regular.ttf`, `NotoNaskhArabic-Regular.ttf`
- Modify: `pubspec.yaml` (add `flutter_localizations` sdk dependency + font families), `lib/main.dart` (delegates, `supportedLocales: appLanguages` locales, `builder: rtlWrapper`, theme `fontFamilyFallback`)
- Test: `test/rtl_and_delegates_test.dart`

**Interfaces:**
- Consumes: `isRtlLocale`, `appLanguages` (Task 1).
- Produces: `class FallbackMaterialLocalizationsDelegate extends LocalizationsDelegate<MaterialLocalizations>` (+ Cupertino and Widgets equivalents) mapping unsupported locales to a supported one: brx/doi/kok/mai/sa/sd -> `hi`, ks -> `ur`, mni/sat -> `en`; `Widget rtlWrapper(BuildContext, Widget?)` wrapping the child in `Directionality(textDirection: isRtlLocale(Get.locale) ? rtl : ltr)`.

- [ ] **Step 1:** Write tests: for each of the 23 locales, pumping a `MaterialApp` with the delegates and `showDatePicker`/an `AlertDialog` throws no exception (covers sat, mni, ks, sd); `rtlWrapper` yields `TextDirection.rtl` for `ur`/`ks` and `ltr` for every other locale; a `TextField` for phone/OTP keeps `textDirection: ltr` under an RTL parent (use the existing widget or a small `LtrField` helper placed in `lib/widgets/`).
- [ ] **Step 2:** Run - Expected: FAIL.
- [ ] **Step 3:** Download the three Noto fonts (Google Fonts / notofonts GitHub releases) into `assets/fonts/`, declare them, implement the delegates and wrapper, wire `main.dart`.
- [ ] **Step 4:** Run - Expected: PASS; run `flutter test` fully.
- [ ] **Step 5:** Commit `feat(i18n): material fallbacks, RTL wrapper and script fonts`.

### Task 5: Language selection screen

**Files:**
- Modify: `lib/Language/language_screen.dart`
- Test: `test/language_screen_test.dart`

**Interfaces:**
- Consumes: `appLanguages`, `appLanguageIndex`, `Get.updateLocale`, storage key `lan2`.
- Produces: the screen lists all 23 names in native script (scrollable, selected one marked), selecting saves `lan2` and updates the locale immediately; `String selectedLanguageCode()` helper reading `lan2`.

- [ ] **Step 1:** Widget test: pumps the screen with the real translations; all 23 native names visible after scrolling (find by text); tapping "ગુજરાતી" writes `lan2 == 'gu'` and `Get.locale.languageCode == 'gu'`; reopening the screen preselects it; tapping Urdu flips the surrounding `Directionality` to rtl.
- [ ] **Step 2:** Run - Expected: FAIL.
- [ ] **Step 3:** Update the screen to build from `appLanguages` (no hard-coded 10), with a fixed-height tile and ellipsis-safe native names.
- [ ] **Step 4:** Run - Expected: PASS.
- [ ] **Step 5:** Commit `feat(i18n): language screen lists all 23 languages`.

### Tasks 6a-6d: Hardcoded text to keys (one task per area)

For each area: run `dart run tool/i18n_audit.dart` scoped to the area's folders, convert every finding to `'English text'.tr` (or `trParams` with `@name` for interpolations such as `'Order #$id'` -> `'Order #@id'.trParams({'id': '$id'})`), add each new key to `assets/i18n/en.json` (key == value), and keep behaviour identical (keys stay the same English strings the user saw before). Do not translate server-provided data (names, addresses, vehicle names). Each task ends with the area's findings at zero, `flutter analyze` clean for touched files, and `flutter test` green.

- **6a:** `lib/screens/authscreen/`, `lib/screens/splash*`, onboarding, `lib/screens/profile/`, settings, language-related screens.
- **6b:** `lib/screens/home/` (booking, schedule, next day, stops, vehicle selection, waiting screen, receiver pays, drop OTP, popups).
- **6c:** `lib/screens/myorder/`, wallet, payments, tracking, notifications, referral, premium, help/support.
- **6d:** `lib/utils/`, `lib/Api/` toast and error messages, shared widgets and dialogs, validators, notification text builders, any remaining folder.

Per-task steps: (1) add a fixture-style test in `test/i18n_audit_test.dart` only when a new literal pattern was discovered; (2) run the scoped audit - Expected: findings listed; (3) convert; (4) rerun - Expected: 0 findings in scope; (5) commit `refactor(i18n): <area> text uses translation keys`.

### Task 7: Complete the 9 existing languages

**Files:** `assets/i18n/{hi,mr,gu,bn,ta,te,kn,ml,pa}.json`, `assets/i18n/_glossary.json`

- [ ] **Step 1:** `dart run tool/i18n_audit.dart` - Expected: lists every key missing per language (new keys from 6a-6d plus old gaps).
- [ ] **Step 2:** Write `_glossary.json` (the 7 glossary terms in all 23 languages), then translate every missing key in each of the 9 languages in batches, keeping `@placeholders` exact and using the glossary.
- [ ] **Step 3:** Re-run the audit - Expected: no missing/placeholder/empty findings for these 9 languages.
- [ ] **Step 4:** Commit `feat(i18n): complete translations for the existing 9 languages`.

### Task 8: Add the 13 new languages

**Files:** `assets/i18n/{as,or,ne,brx,doi,kok,mai,sa,sd,mni,sat,ks,ur}.json`, `assets/i18n/_review.json`

- [ ] **Step 1:** Create each JSON with every key of `en.json` translated (batches: 8a Devanagari group `ne, brx, doi, kok, mai, sa, sd`; 8b `as, or, mni, sat`; 8c `ur, ks`), following the Global Constraints scripts and the glossary, `@placeholders` exact, Western digits.
- [ ] **Step 2:** `_review.json`: `{ "<code>": { "reviewed": false, "confidence": "high|needs-native-review" } }` per the spec's provenance list.
- [ ] **Step 3:** Run the audit - Expected: all 23 files have identical key sets and placeholders, no empty values.
- [ ] **Step 4:** Commit one commit per batch (`feat(i18n): add <languages>`).

### Task 9: Dates and numbers

**Files:**
- Create: `lib/Language/locale_format.dart`
- Modify: the 11 files using `DateFormat` (found with `grep -rl DateFormat lib`)
- Test: `test/locale_format_test.dart`

**Interfaces:**
- Produces: `String formatDate(DateTime d, {String pattern = 'dd MMM yyyy'})`, `String formatTime(DateTime d)`, `String formatWeekday(DateTime d)` using the active locale mapped to the nearest `intl`-supported locale (unsupported -> `hi` for Devanagari languages, `ur` for ks, else `en`) with `intl` digits forced to Western (`NumberFormat` / `DateFormat` with `latn`); `String localeForIntl(Locale)`.

- [ ] **Step 1:** Tests: `localeForIntl` mapping for all 23 locales; `formatDate(DateTime(2026,10,20))` contains `2026` and `20` in Western digits for hi, ur, bn, ta and `sat`; month name differs from English for hi/ta; no exception for any of the 23 locales (initialize with `initializeDateFormatting`).
- [ ] **Step 2:** Run - Expected: FAIL.
- [ ] **Step 3:** Implement, call `initializeDateFormatting()` at startup, and switch the 11 call sites to the helpers (same patterns, so output shape is unchanged in English).
- [ ] **Step 4:** Run `flutter test` - Expected: PASS (English output of every converted call site unchanged).
- [ ] **Step 5:** Commit `feat(i18n): locale-aware dates with Western digits`.

### Task 10: RTL layout fixes and small-screen stress

**Files:** touched screens/widgets as findings dictate; `test/i18n_stress_test.dart`

- [ ] **Step 1:** Write `test/i18n_stress_test.dart`: for `ur`, `ks` and the three longest languages by average length, pump the language screen, login, home, wallet and one popup at 320x640 with `textScaleFactor 1.3` and fail on any `RenderFlex overflowed` / exception (use `tester.takeException()`).
- [ ] **Step 2:** Run - Expected: FAIL on real overflows or direction defects.
- [ ] **Step 3:** Fix: `EdgeInsets.only(left/right)` -> `EdgeInsetsDirectional`, `Alignment.centerLeft` -> `AlignmentDirectional`, mirrored back/chevron icons (`matchTextDirection: true` or `Transform` flip), wrap long labels with `Flexible`/`Expanded` + ellipsis, scale-down for button text.
- [ ] **Step 4:** Run `flutter test` - Expected: PASS.
- [ ] **Step 5:** Commit `fix(i18n): RTL mirroring and overflow fixes`.

### Task 11: Enable the coverage gate

**Files:** `test/i18n_coverage_test.dart`, `tool/i18n_allowlist.txt`

- [ ] **Step 1:** Write `test/i18n_coverage_test.dart` that runs the audit over the real `lib/` and `assets/i18n/` and fails with a readable list on any missing key, placeholder mismatch, empty value or hardcoded literal outside `tool/i18n_allowlist.txt`.
- [ ] **Step 2:** Run - Expected: PASS (fix any remaining finding first; the allow-list may contain only brand names, URLs and symbols, each with a comment).
- [ ] **Step 3:** Prove the gate: temporarily add `Text('Untranslated')` to a screen and a key missing in `sat.json`; Expected: the test FAILS naming the file/line and language; revert.
- [ ] **Step 4:** Run `flutter test` fully - Expected: all green.
- [ ] **Step 5:** Commit `test(i18n): enforce translation coverage`.

### Task 12: Device QA and release build

**Files:** `docs/superpowers/qa/2026-10-20-indian-languages-customer-qa.md`

- [ ] **Step 1:** `flutter build apk --release`, install on SM E156B (`adb install -r`), for each of the 23 languages open every screen reachable on the dev backend (language screen, login/OTP screens, home, vehicle selection, booking steps, schedule, next day, wallet, profile, settings, orders, notifications, popups) and capture `adb exec-out screencap` per screen.
- [ ] **Step 2:** Inspect each screenshot for English leftovers, boxes/missing glyphs, clipping, wrong direction; record every defect per language in the QA file (screen, language, defect, status).
- [ ] **Step 3:** Fix defects (keys, fonts, layout), rebuild, re-check the affected screens; repeat until the QA file has zero open defects, listing separately the screens the dev backend could not reach.
- [ ] **Step 4:** Verify persistence: choose a language, force-stop the app, reopen - the splash and home are in that language.
- [ ] **Step 5:** Commit `docs(i18n): customer app QA record`; bump version only when the user asks for the APK.
