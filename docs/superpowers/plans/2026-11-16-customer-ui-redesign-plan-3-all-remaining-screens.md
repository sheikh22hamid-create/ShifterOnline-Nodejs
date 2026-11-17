# Customer UI Redesign — Plan 3: All Remaining Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring every remaining customer screen (≈60 files, ≈45k lines) into the new look without changing behaviour.

**Architecture:** Two layers. (1) A global `ThemeData` + aligned global colour variables restyle every screen at once — AppBars, buttons, inputs, cards, dialogs, sheets, checkboxes, tabs, snackbars — because almost all screens build on Material widgets and `utils/colors.dart` variables. (2) The screens customers use most get hand restyling in place (Orders, Wallet, Account, Login/OTP, Tracking, Trip complete), using Plan 1–2 tokens/components. Explicit per-widget colours that fight the theme (gradients, emoji, red/blue one-offs) are swept last.

**Tech Stack:** Flutter, GetX, Provider, `flutter_test`, adb for on-device screenshots (phone `RZCX624XRVK`).

**Spec:** `docs/superpowers/specs/2026-11-16-customer-app-ui-redesign-design.md` (§5 tokens, §6 items 7–12, §7). Owner request 2026-11-16: "saari screens redesign kar de".

## Global Constraints

Same as Plans 1–2: UI-only (no API/socket/state/timer/navigation/validation change; every handler expression kept — verify with the before/after handler diff `git show HEAD:<f> | grep -o "onTap: [^,]*\|onPressed: [^,]*\|onChanged: [^,]*"` vs working copy); no feature removed; brand `#FF6B35`, text on orange `#1A0B04`; Gilroy; no emojis/gradients/new Lottie; ≥44 px targets; `.tr`; dark via `notifier`/`AppPalette.current`; `git add -f` exact files; no push. Each task: analyzer no new issues in touched files, full `flutter test` green.

## Review Focus

1. Explicit `foregroundColor: Colors.white` on orange buttons stays white where a screen sets it — acceptable, but the theme must not turn any *text* white-on-white.
2. Changing `greaycolor` / `notifier.text` / `bordecolor` must keep contrast on dark surfaces (dark values unchanged).
3. Tracking screen (9k lines) — restyle only isolated builders; every socket-driven state section keeps its condition.
4. Auth screens — OTP/autofill fields and resend timers untouched.
5. Image replacements must not break `Image.asset` paths still referenced elsewhere.

---

### Task 1: Global theme + colour alignment
**Files:** Create `lib/theme/app_theme.dart` (`ThemeData buildAppTheme()`); modify `lib/main.dart:65-71` (use it, keep `useMaterial3: false`, transparent splash/highlight/hover, `fontFamily: 'Gilroy_Regular'`); modify `lib/utils/colors.dart` light values only: `greaycolor` → `#636977`, `ColorNotifier.text` light → `#15171C`, `bordecolor` light → `#E8E8E8`. Test `test/theme/app_theme_test.dart`.
Theme contents: scaffold bg canvas; colorScheme primary brand / onPrimary onBrand / secondary brand; AppBarTheme (surface bg, ink fg/icons, elevation 0, Gilroy_Bold 18 title, dark status icons); Elevated (brand bg, onBrand fg, elevation 0, radius 14, min height 48, Gilroy_Bold 15); Outlined (ink fg, line side, radius 12); Text (brandText, Gilroy_Bold); InputDecoration (filled surface, radius 12, line / brand focus / danger error); Card (surface, radius 16, elevation 0, line side); Dialog (surface, radius 20); BottomSheet (surface, top radius 24); Checkbox/Radio/Switch (brand, check onBrand); ProgressIndicator brand; Divider divider; TabBar (brand indicator, ink/inkSubtle labels, Gilroy_Bold/Medium); SnackBar (ink bg, floating, radius 12); FAB brand/onBrand; ListTile (ink icon/text).
- [ ] RED: tests assert elevated bg = brand & fg = onBrand, appBar bg = surface & fg = ink, focused input border = brand, card radius 16, `greaycolor == AppPalette.light.inkSubtle`, contrast(greaycolor, white) ≥ 4.5.
- [ ] GREEN, analyzer, full suite, commit `feat(customer-ui): global theme and aligned colour variables`.

### Task 2: Orders (`myorder/myorder.dart`, order list item builders it uses)
Top bar → `AppTopBar`-style title (no back when tab root), tabs restyled (TabBar theme + brand indicator), order cards → surface cards with status chip (tinted by status family), route dots (green pickup / orange drop), price bold, actions as pills; empty state → icon circle + text; loading → `AppSkeleton`. Keep every tab/filter/onTap and pagination/refresh.

### Task 3: Wallet (`home/wallet_page.dart`)
Header → brandTint band with ledger balance, quick-amount chips that only pre-fill the existing amount field, Add money → `AppPrimaryButton` (same handler), fee note; points row → card (same `ReferralPointsScreen` tap); transactions list → card rows with credit/debit tinted icons; filter (same sheet/handler). Keep Razorpay/withdraw logic untouched.

### Task 4: Account (`profile/myprofile.dart` + `_buildMenuItem` and section containers; `editprofile.dart`, `AddressList.dart`, `favorite_drivers.dart`, `blocked_drivers.dart` headers/lists)
Profile header card, Premium card (dark ink card with gold crown, same tap), quick grid, menu sections via a restyled `_buildMenuItem` (one change restyles all rows), log out / delete rows. Replace `assets/signin_hero_mascot.jpg` use with initials avatar fallback (same image path still used when the user has a photo).

### Task 5: Login / Signup / OTP (`authscreen/signin.dart`, `signup.dart`, `verification.dart`, `forgot_password.dart`)
Peach hero with brand mark + truck (reuse the Home header truck painter — extract `TruckRoad` to `lib/theme/widgets/truck_road.dart`), phone field (+91 prefix), city picker row, referral expander, primary button; OTP boxes (pinput styling only); replace AI images `delivery_mascot.jpg`, `delivery_van_footer.jpg`, `otp_illustration.jpg`, `profile_illustration.jpg` with the truck hero / icon circles. Keep controllers, validators, autofill, timers, API calls.

### Task 6: Tracking + Trip complete (`myorder/trackingway.dart` isolated builders; `customer_feedback_sheet.dart`; `customer_settlement_sheet.dart`)
In tracking: top bar, status header pill, OTP box, driver card (avatar, rating, plate chip, Call/Chat/Share buttons), payment & order-detail containers, "More options" rows → token styling; maps/markers/sockets untouched. Feedback sheet: success header, three rating rows, chips, comment field, Skip/Submit buttons. Settlement sheet: radio tiles for pay options (same handlers).

### Task 7: Sweep
Replace decorative `LinearGradient` fills (30) with solid token colours where they are backgrounds of cards/buttons/headers; strip emoji from user-facing strings in `lib/screens`; booking-flow deferred minors (search drop indicator orange, search-area chip `Flexible`, wallet row radio hidden when trailing link shown, `.tr` on payment labels).

### Task 8: Strings, build, device check
`en_US` keys for new literals (skip existing); `flutter build apk --debug`; install on `RZCX624XRVK`; navigate with `adb shell input tap` to Home, Orders, Wallet, Account, a search screen; screencap each and inspect; fix what's visibly broken; owner checklist for flows that need real orders.

## Self-review
Covers spec §6 items 7–12 and every remaining file via the global theme; booking-flow leftovers via Task 7. Tracking restricted to isolated builders (size/risk).
