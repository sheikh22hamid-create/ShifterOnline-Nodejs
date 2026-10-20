# All Indian Languages - User App + Driver App (design)

Date: 2026-10-20. Status: draft for approval. Three projects, built one at a time: (1) customer app, (2) driver app, (3) server messages. This document fixes the shared decisions and specifies project 1 in full; projects 2 and 3 get their own plan after project 1 ships.

## Intent

Every screen of both apps must read in the language the user picked, not just a few labels. Today the customer app offers 10 languages with ~450-510 translated strings each while the code has far more user-facing text, and the driver app has ~650 hardcoded strings no language can reach. The user-visible promise: pick any of the 23 languages (22 scheduled + English), and everything a person sees is in it, consistently, after restart too.

## Goals

- 23 languages in the language screen, each shown by its own name in its native script: Hindi, English, Assamese, Bengali, Bodo, Dogri, Gujarati, Kannada, Kashmiri, Konkani, Maithili, Malayalam, Manipuri (Meitei), Marathi, Nepali, Odia, Punjabi, Sanskrit, Santali, Sindhi, Tamil, Telugu, Urdu.
- All user-facing text translated: buttons, menus, forms, validation errors, popups, booking, wallet, profile, settings, notifications, toasts, plus hardcoded text and missing keys fixed.
- Dynamic API messages, dates and applicable system messages follow the selected language (project 3 for server messages).
- Urdu and Kashmiri render right-to-left, mirrored where it matters.
- The choice survives an app restart. Long translations and every script render without overflow or missing glyphs on small screens.
- A detector so new text added later without translations is caught (a test that fails the build, plus a debug-time log).
- Every language tested on every screen of both apps (real device where possible).

## Non-goals / anti-goals

- No change to booking, pricing, wallet, payments or any business logic. Only text, fonts, direction and formatting move.
- Numbers that carry money or identity (fare, wallet, OTP, phone, order id) stay Western digits 0-9 in every language.
- Not claiming expert-grade translation for low-resource languages (see Translation provenance).
- Adding the 13 languages to the selector without translating the screens is a failure, however it demos.

## Decisions (agreed with the user, 2026-10-20)

- Scripts: Santali Ol Chiki; Manipuri Meitei Mayek; Kashmiri Perso-Arabic (RTL); Sindhi Devanagari (LTR); Dogri, Bodo, Konkani, Maithili, Sanskrit, Nepali Devanagari; Assamese and Odia in their own scripts; Urdu Nastaliq-style Arabic script (RTL). Fonts for scripts Android may lack (Ol Chiki, Meitei Mayek, Perso-Arabic for Kashmiri) are bundled (Noto families).
- Order: customer app, then driver app, then server messages.
- Translations are drafted by Claude, with a per-language review sheet for native speakers. Review before public launch is the product owner's responsibility.

## My calls (builder: flag any you disagree with)

1. Translation source of truth moves from the const Dart maps in `lib/Language/language_indian.dart` to one JSON file per language in `assets/i18n/<code>.json` (keys stay the English UI strings so every existing `.tr` keeps working). JSON is reviewable by non-developers, exportable to a sheet, and avoids huge Dart constants.
2. Strings with interpolation (`'Order #$id'`) become placeholder keys (`'Order #@id'.trParams({'id': id})`); placeholders must match across languages.
3. Flutter ships Material labels for only 13 of the 23 languages (as, bn, gu, hi, kn, ml, mr, ne, or, pa, ta, te, ur). For the others a fallback delegate supplies dialog/picker labels: Devanagari-script languages use Hindi, Kashmiri and Sindhi pickers use Urdu/Hindi respectively, Manipuri and Santali use English.
4. Language codes: as, bn, brx, doi, en, gu, hi, kn, ks, kok, mai, ml, mni, mr, ne, or, pa, sa, sat, sd, ta, te, ur (all `_IN`). The saved key `lan2` stays; unknown saved values still resolve to English.
5. QA uses the connected Android device (SM E156B) via adb screenshots plus automated tests; Windows/Chrome builds are not used for visual sign-off.

## Project 1 - customer app (Flutter, GetX)

### Architecture
- `lib/Language/language_config.dart` lists the 23 `AppLanguage`s (native name, locale, `isRtl`, `fontFamily` fallback chain).
- `assets/i18n/*.json` hold the translations; `LocalString` loads them once at startup (before `runApp`) into the GetX `Translations` map. A missing key falls back to English.
- `GetMaterialApp` gets `flutter_localizations` delegates, a fallback delegate for unsupported Material locales, and a `builder` that wraps the app in `Directionality` from the locale (`ur`, `ks` = RTL). Icons with direction (back arrows, chevrons) mirror in RTL; `EdgeInsets.only(left/right)` on shared widgets are converted to directional variants where RTL shows a visible defect.
- Fonts: the existing Latin font stays first; per-script Noto fallbacks (bundled for Ol Chiki, Meitei Mayek, Arabic/Nastaliq) are added to the theme's `fontFamilyFallback`.
- Dates and relative times use `intl` with the selected locale where intl supports it, else the nearest supported locale; digits stay Western.
- Selected language is saved in `lan2` (already persisted), applied before the first frame so the splash is already in the right language.

### Coverage work
- Inventory every user-facing string in `lib/` (Text, hintText/labelText/title/label, toasts, dialogs, validators, notification builders, enum-to-label maps), convert hardcoded ones to `.tr` / `trParams`, and add the keys.
- Fill the translation gaps of the 9 existing languages and add the 13 new ones, so all 23 files have identical key sets.

### Missing-translation detector
- `tool/i18n_audit.dart` + `test/i18n_coverage_test.dart`: (a) every `.tr` / `trParams` key found in source exists in all 23 JSON files; (b) all 23 files have the same keys and the same `@placeholders` per key; (c) no `Text('literal')` / toast literal outside an allow-list (brand names, URLs, symbols); (d) no empty values. A failing case names the key, file and language. In debug builds a missing key logs once.
- `tool/i18n_review_sheet.dart` exports a CSV per language (key, English, current translation) for native reviewers.

### Tests
- Unit: language config (23 entries, native names, RTL flags, code resolution, persistence key).
- Detector tests above (they run in CI as part of `flutter test`).
- Widget: language screen lists 23 names and switching changes visible text immediately and after rebuild; key screens render without overflow in the longest-translation languages (a stress pass using the longest value per key).
- Device QA (SM E156B): install the build, for every language walk all screens (login, home, booking flow, schedule, next day, wallet, profile, settings, orders, tracking, notifications, popups) and capture adb screenshots; log defects per language; fix; repeat until clean. Screens that need server states (assigned driver, payments) are covered as far as the dev backend allows and the remainder is listed.

## Project 2 - driver app (native Android/Java), outline
Move the ~650 hardcoded Java/XML literals to `strings.xml`, add `values-<code>` for all 22 non-English languages (including `values-b+sat`, `values-b+mni`, `values-b+brx`, `values-b+doi`, `values-b+kok`, `values-b+mai`, `values-b+ks`, `values-b+sa`, `values-b+sd` where Android has no short code), a locale manager that applies and persists the choice, RTL (`supportsRtl`, `start/end` attributes), bundled fonts, a lint/test that fails on hardcoded text or untranslated keys, and device QA. Detailed plan after project 1.

## Project 3 - server messages, outline
A client-side dictionary (exact and number-pattern templates) for the English `ResponseMsg` strings the backend sends, applied centrally in the API wrapper of both apps, so no backend, pricing or wallet logic changes. Unknown messages stay English. Detailed plan after project 2.

## Translation provenance
All translations are machine-drafted by Claude and recorded with a `reviewed` flag per language in `assets/i18n/_review.json`. Higher confidence: Hindi, Bengali, Gujarati, Marathi, Tamil, Telugu, Kannada, Malayalam, Punjabi, Urdu, Nepali, Odia, Assamese. Needs native-speaker review before launch: Bodo, Dogri, Kashmiri, Konkani, Maithili, Manipuri, Sanskrit, Santali, Sindhi. A consistent glossary (Order, Driver, Wallet, Booking, Pickup, Drop, Refund) is applied across languages so review is easy.

## Edge cases (must be tested)
- Interpolated strings keep their placeholders in every language; a translation that drops one fails the detector.
- Switching language while a dialog/bottom sheet is open updates it after close without a crash.
- RTL: the language screen, login, home, booking form, wallet and a popup are mirrored and readable; text fields caret/hint align right; phone/OTP fields stay LTR.
- Unsupported Material locales (e.g. Santali) never throw "no MaterialLocalizations" errors.
- Saved legacy values (old international language codes) resolve to English.
- Very long Dravidian/Indic translations on a 5-inch / small-width screen do not overflow buttons or app bars.
