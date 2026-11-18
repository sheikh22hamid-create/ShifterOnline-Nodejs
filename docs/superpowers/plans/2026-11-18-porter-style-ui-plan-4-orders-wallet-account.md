# Porter-Style UI — Plan 4: Orders, Wallet, Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the three non-booking tabs (Orders, Wallet, Account) to the Porter look and keep every feature on them reachable.

**Architecture:** Add small presentational widgets that take data and callbacks:
- `AppGroupCard` / `AppMenuRow` (shared grouped-card rows)
- `OrderCard`
- `WalletBalanceCard` / `RewardPointsCard` / `TxnTypeChips`

Then re-lay out the three screens around them. Every row and button calls the handler the screen already has. One handler is new: the wallet chips' `_setTxnType`, a shortcut into the existing `filterTxnType` filter.

`orderlistBox(...)` keeps its signature because home.dart and StoreOrder.dart also call it. It now delegates to `OrderCard`.

**Tech Stack:** Flutter (Dart), GetX, Provider (`ColorNotifier`), flutter_test. Package `goParcel`. Font Gilroy.

**Spec:** `docs/superpowers/specs/2026-11-18-customer-app-porter-style-ui-design.md` (§5, §6.7, §6.8, §6.9, §6.11). Porter references: `docs/design/porter-reference-2026-11-18/orders.jpg`, `payments.jpg`, `account.jpg`.

**Scope:** spec §6.6 (finding driver / tracking / trip complete) and §6.10 (login) are Plan 5.

## Global Constraints

- **UI only.**
  - No change to API calls, order/wallet/profile logic, validations or business rules.
  - Every row calls the existing method or screen.
- **Commits:** `ShifterOnline/` is gitignored, so commit with `git add -f <exact files>`. Auto-commit each finished task. Never push.
- **v2 tokens:**
  - canvas `AppPalette.current.canvas`
  - cards white, radius 16, no border, `AppShadow.card`
  - primary button `AppPrimaryButton`
  - accent orange only for primary buttons and selected states
  - no white text on orange
- **Dark mode:** every new widget and every line this plan rewrites uses `AppPalette.current`, never `AppPalette.light` or hard-coded light hex.
- **Free Ride wording** is chance-based, never "first booking free".
- **Strings:** new user-visible strings use `.tr` and get an English key in `ShifterOnline/lib/Language/language_string.dart`.
- **Tests:** `cd ShifterOnline && flutter test` stays green, and `flutter analyze` (project-wide) shows no more warnings/errors than before the plan.

## Rulings (Claude's calls; owner may override at review)

- **Account header:** the existing orange `_buildOrangeHeader` (bell, settings, edit, avatar) stays. It matches the orange Home header the owner chose; only the sections below it become Porter grouped cards.
- **Rows left out because the feature does not exist:**
  - "Add GST Details" in the header and "Business/GST" in card 1: no profile-level GST screen exists. GST is entered per booking on Select Vehicle.
  - "Free Ride status": it lives inside Premium Plans (`FreeBookingStatusCard`) and the Home Free Ride strip, so no new screen is added.
- **"Refer business leads"** becomes a direct Account row to the existing `LeadReferralScreen`. Today it is only reachable from inside the Refer & Earn sheet, which keeps its own link.
- **Wallet's Add Money dialog** (quick amounts, 2.5% fee, ₹50,000 max text) is untouched. Only the page around it changes.
- **Orders tabs** stay Recent / Completed / Favorite chips. The selected chip changes from black to brand tint + brand border, so orange is used only for selected states.

## Review Focus

- **Order with no `total`, no `vehicleType`, or a long address at textScale 1.3 on 360dp:** card shows "#id" as the title, hides the amount, ellipsizes the addresses, and does not overflow. Tests in Task 2.
- **Cancelled / Pending orders in the Recent tab:** status chip colour unchanged and no Favourite / Book Again (`showActions: false`). Test in Task 2.
- **Wallet balance ₹1,00,000.00 and 0 points at textScale 1.3 on 360dp:** no overflow. Test in Task 3.
- **Wallet type chip combined with a date filter:** a chip only changes `filterTxnType`, keeps the dates, and the filter dialog opens showing the chip's type. Task 3 step 5 + device check in Task 5.
- **Dark mode on Account:** group cards and rows switch colours. Test in Task 1; device check in Task 5.

---

### Task 1: Shared grouped card + menu row

**Files:**
- Create: `ShifterOnline/lib/theme/widgets/app_group_card.dart`
- Test: `ShifterOnline/test/theme/app_group_card_test.dart`

**Interfaces:**
- Produces:
  - `AppGroupCard({String? title, required List<Widget> children})`: a white card (radius 16, `AppShadow.card`) with an optional bold title, and children separated by 1px `p.divider` indented 62.
  - `AppMenuRow({required IconData icon, required String title, String? subtitle, Widget? trailing, bool danger = false, required VoidCallback? onTap})`:
    - 56 min-height `PressableScale`
    - 36px rounded-square icon box (`p.brandTint` / `p.brandText`; `p.dangerTint` / `p.danger` when `danger`)
    - title bodyStrong 15, subtitle caption 13 `p.inkMuted`
    - trailing defaults to `Icons.chevron_right_rounded`

- [ ] **Step 1: Write the failing tests**
  - `group card shows title and a divider between rows, none after the last`: 3 rows → `find.byType(Divider)` findsNWidgets(2)
  - `row tap calls onTap; custom trailing replaces chevron`: pass a `Switch` → no chevron icon
  - `danger row uses danger colours`: the icon's colour == `AppPalette.current.danger`
  - `dark palette is used when dark mode is on`: `notifier.setIsDark = true` (global `notifier` from `lib/utils/colors.dart`, which `AppPalette.current` reads), then assert the card colour == `AppPalette.dark.surface`. Reset `notifier.setIsDark = false` in `addTearDown`.
  - `no overflow at textScale 1.3 on 360dp with long title and subtitle`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/theme/app_group_card_test.dart`. It should fail because the file does not exist.
- [ ] **Step 3: Implement both widgets.**
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Commit**
```bash
git add -f ShifterOnline/lib/theme/widgets/app_group_card.dart ShifterOnline/test/theme/app_group_card_test.dart
git commit -m "feat(customer-ui): shared grouped card and menu row"
```

### Task 2: Porter-style order card

**Files:**
- Create: `ShifterOnline/lib/screens/myorder/widgets/order_card.dart`
- Modify: `ShifterOnline/lib/screens/myorder/myorder.dart` (`orderlistBox` body delegates to `OrderCard`; tab chips; pass `amount` + `vehicleName` from `OrderHistory.total` / `vehicleType`)
- Test: `ShifterOnline/test/myorder/order_card_test.dart`

**Interfaces:**
- Consumes: `RouteMarker` (`lib/theme/widgets/route_marker.dart`).
- Produces:
  - `OrderCard({required String title, String? vehicleName, String? amount, required String status, required String date, required String pickup, required String drop, String? note, List<MapEntry<String, String>> details = const [], bool isFavorite = false, bool showActions = true, VoidCallback? onTap, VoidCallback? onFavorite, VoidCallback? onBookAgain})`
  - `orderlistBox(...)` gains optional `String? amount` and `String? vehicleName`. Every existing parameter keeps its name and meaning.

**Layout** (Porter `orders.jpg`), top to bottom inside a white card (radius 16, `AppShadow.card`; the whole card taps `onTap`):
1. **Header row:**
   - 44px `p.canvas` rounded box with `Icons.local_shipping_outlined`
   - `vehicleName ?? title` (bodyStrong 16), with `date` caption under it and `title` (`#id`) appended to the date when `vehicleName` is shown
   - right side: `amount` (bodyStrong 16), only when non-empty, then a chevron
2. **Inner box** (`p.canvas`, radius 12): pickup row with `RouteMarker.pickup(size: 20)` and drop row with `RouteMarker.drop(size: 20)`. Each address has maxLines 1, ellipsis.
3. `note` (flow message) caption, if non-empty.
4. `details` label/value rows, the same content as today.
5. **Footer row:**
   - status chip, using the same colour mapping as today's `orderlistBox` switch (Pending warning, Processing brand, On Route/Completed success, Cancelled danger, else muted)
   - when `showActions`: favourite `IconButton` (`Icons.favorite_rounded` in `p.danger` / `Icons.favorite_border_rounded`) → `onFavorite`, and an outlined "Book Again" button (1.5px brand border, `p.brandText`) → `onBookAgain`

- [ ] **Step 1: Write the failing tests**
  - `shows vehicle, date, amount and both addresses`: vehicleName 'Tata Ace', amount '₹403', status 'Completed'
  - `missing vehicle and amount fall back to #id and hide the amount`: title '#123', vehicleName null, amount '' → `find.text('#123')`, no '₹'
  - `cancelled status chip uses danger colours`
  - `recent order (showActions false) has no favourite or Book Again`
  - `Book Again and favourite call back; card tap calls onTap`
  - `pickup and drop markers are present`: `Icons.arrow_upward_rounded` and `Icons.arrow_downward_rounded`
  - `long addresses at textScale 1.3 on 360dp do not overflow`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/myorder/order_card_test.dart`.
- [ ] **Step 3: Implement `OrderCard`.**
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Wire myorder.dart.**
  - `orderlistBox` returns `OrderCard`, mapping `discription` → `note`, `ordertype` → `status`, `pickupAddress`/`dropAddress`, `onAddFav` → `onFavorite`. It keeps `notifier = Provider.of(context, listen: true);`, which other code relies on.
  - The `MyOrder` list item passes:
    - `amount: (order.total ?? '').isEmpty ? null : '₹${order.total}'`
    - `vehicleName: order.vehicleType`
  - Selected tab chip: `p.brandTint` fill, `p.brand` 1.5 border, `p.brandText` bold label. Unselected stays as today.
- [ ] **Step 6: Verify.**
  - Run `cd ShifterOnline && flutter analyze` and expect no warnings or errors beyond the pre-plan count.
  - Run `flutter test` and expect all to pass.
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/myorder/widgets/order_card.dart ShifterOnline/lib/screens/myorder/myorder.dart ShifterOnline/test/myorder/order_card_test.dart ShifterOnline/lib/Language/language_string.dart
git commit -m "feat(customer-ui): Porter-style order cards"
```

### Task 3: Wallet (Payments) layout

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/wallet_widgets.dart`
- Modify: `ShifterOnline/lib/screens/home/wallet_page.dart` (`build` header + history header only)
- Modify: `ShifterOnline/lib/Language/language_string.dart`
- Test: `ShifterOnline/test/home/wallet_widgets_test.dart`

**Interfaces:**
- Consumes: `V2Art` (`lib/theme/widgets/v2_art.dart`), `AppPrimaryButton`.
- Produces:
  - `WalletBalanceCard({required double balance, required VoidCallback onAddMoney})`:
    - white card; "Shifter Wallet" caption, then `₹<balance 2dp>` title 32
    - `V2Art(asset: 'assets/v2/wallet_icon.png', placeholderLabel: 'W1', width: 56, height: 56)` on the right
    - full-width `AppPrimaryButton(label: 'Add Money'.tr)` below
  - `RewardPointsCard({required String points, required VoidCallback onTap})`: white card row with `Icons.toll_outlined` (`p.warning`), "Reward Points" + "@n points" caption, and a chevron.
  - `TxnTypeChips({required String selected, required ValueChanged<String> onSelected})`: three chips "All" (`''`), "Credit" (`'credit'`), "Debit" (`'debit'`). Selected = `p.brandTint` + 1.5 `p.brand` border.

- [ ] **Step 1: Write the failing tests**
  - `balance card shows formatted balance and Add Money calls back`: balance 1250.5 → `find.text('₹1250.50')`
  - `reward points card shows points and taps`: '120' → `find.text('120 points')`
  - `type chips report '' / 'credit' / 'debit'` and `selected chip has brand border`
  - `₹1,00,000.00-size balance and 0 points at textScale 1.3 on 360dp do not overflow`: balance 100000
  - `missing wallet art shows the W1 placeholder`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/wallet_widgets_test.dart`.
- [ ] **Step 3: Implement the three widgets.**
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Wire wallet_page.dart.**
  - **AppBar:** `backgroundColor: p.surface`, title `'Wallet'.tr`.
  - **Balance header Container:** replace it with a padded `Column` on `p.canvas` containing:
    - `WalletBalanceCard(balance: walletBalance, onAddMoney: _showAddMoneyDialog)`
    - 12 gap
    - `RewardPointsCard(points: walletPoints, onTap: () => Get.to(() => const ReferralPointsScreen()))`
  - **History header row:** keep the "Transaction History" title, the filter `IconButton` and the refresh `IconButton`. Add `TxnTypeChips(selected: filterTxnType, onSelected: _setTxnType)` under it.
  - **New `void _setTxnType(String type)`:** `setState(() => filterTxnType = type); _getWalletHistory();`. Dates are untouched, and the existing filter dialog already reads `filterTxnType` as its starting value.
  - **Unchanged:** the transaction list, the dialogs and the Razorpay handlers.
  - **Add keys:** `Wallet`, `Shifter Wallet`, `Reward Points`, `@n points`, `All`, `Credit`, `Debit` (only the missing ones).
- [ ] **Step 6: Verify.** Run `cd ShifterOnline && flutter analyze` (no new warnings/errors) and `flutter test` (all pass).
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/wallet_widgets.dart ShifterOnline/lib/screens/home/wallet_page.dart ShifterOnline/lib/Language/language_string.dart ShifterOnline/test/home/wallet_widgets_test.dart
git commit -m "feat(customer-ui): Porter-style Wallet — balance card, reward points card, type chips"
```

### Task 4: Account as Porter grouped cards

**Files:**
- Modify: `ShifterOnline/lib/screens/profile/myprofile.dart` (`build` body below the header; settings-sheet handlers extracted)
- Modify: `ShifterOnline/lib/Language/language_string.dart`

**Interfaces:**
- Consumes: `AppGroupCard`, `AppMenuRow` (Task 1).
- Produces (private, in `_MyProfileState`):
  - `Future<void> _setDarkMode(bool value)`: the body of today's settings-sheet switch `onChanged`.
  - `void _askDeleteAccount()`: today's Delete tile `deleteAndLogoutBottomsheet(...)` call, without the `Navigator.pop`.

  The settings sheet calls both (the sheet keeps its `Navigator.pop` before `_askDeleteAccount()`).

**Layout:** `build` order, on `p.canvas`, replacing `AppPalette.light.canvas`. Each group is an `AppGroupCard` with 16 side margins and 14 between cards. Each row calls the handler named here; these are the handlers today's rows/sheet already call.
1. `_buildOrangeHeader(...)`, unchanged.
2. `_buildCompleteProfileCard(...)`, unchanged, under today's condition.
3. **Group "Saved Addresses":** Saved Addresses → `Get.to(() => const AddressListPage())`.
4. **Group "Benefits":**
   - Premium Plans: title/subtitle from `premiumData` exactly as in `_buildQuickAccessSection` → `PremiumPlansScreen`
   - Reward Points → `ReferralPointsScreen`
5. **Group "Refer":**
   - Refer & Earn → `referAndEarn`
   - Refer business leads → `Get.to(() => const LeadReferralScreen())`
   - Share Shifter Online → `share`
6. **Group "Drivers":**
   - Favourite Drivers: subtitle from `favDriversData` as today → `FavoriteDriversScreen`
   - Blocked Drivers → `BlockedDriversScreen`
7. **Group "Preferences":**
   - Language → `LanguageScreen`
   - Dark Mode: trailing `Switch(value: notifier.isDark, activeColor: p.brand, onChanged: _setDarkMode)`; row `onTap: () => _setDarkMode(!notifier.isDark)`
8. **Group "Help & Support":** Customer Care, FAQ, Privacy Policy, Terms of Use, with the same `onTap`s as in `_buildHelpAndLegalSection`.
9. `_buildLogoutCard()`, unchanged.
10. **Group without title:** Delete Account (`danger: true`) → `_askDeleteAccount`.
11. The app version caption (`"Version ${appVersion ?? '1.0.0'}"`), centred.

**Remove:** `_buildQuickAccessSection`, `_buildHelpAndLegalSection` and `_buildMoreSection` (their rows now live in the groups), and any helper or import that becomes unused. Keep `_buildMenuItem` only if something still uses it.

- [ ] **Step 1: Restructure** as above. Add keys: `Saved Addresses`, `Benefits`, `Refer`, `Refer business leads`, `Drivers`, `Preferences`, `Help & Support`.
- [ ] **Step 2: Feature check.** Run `cd ShifterOnline && grep -c "PremiumPlansScreen\|ReferralPointsScreen\|LeadReferralScreen\|FavoriteDriversScreen\|BlockedDriversScreen\|LanguageScreen\|AddressListPage\|referAndEarn\|_askDeleteAccount\|_handleLogout\|Faq()" lib/screens/profile/myprofile.dart`. Every name must still be referenced. List any missing and restore it.
- [ ] **Step 3: Verify.** Run `cd ShifterOnline && flutter analyze` (no new warnings/errors) and `flutter test` (all pass). **Ruling:** there is no screen-level widget test because `MyProfile` fetches overview/live data in `initState`. Task 1 covers the rows; Task 5 is the device check.
- [ ] **Step 4: Commit**
```bash
git add -f ShifterOnline/lib/screens/profile/myprofile.dart ShifterOnline/lib/Language/language_string.dart
git commit -m "feat(customer-ui): Account as Porter grouped cards (every row kept)"
```

### Task 5: Device check

- [ ] **Step 1: Build and install.**
```bash
cd ShifterOnline && flutter build apk --debug
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r build/app/outputs/flutter-apk/app-debug.apk
```
  Expected: `Success`.
- [ ] **Step 2: Owner checks** and the result is recorded in the ledger:
  1. **Orders:** cards in each tab, Favourite + Book Again on Completed, tap opens tracking.
  2. **Wallet:** Add Money dialog (quick amounts, 2.5% fee, ₹50,000 max), Reward Points card, All/Credit/Debit chips together with the date filter, refresh.
  3. **Account:** every row opens its screen, the dark mode switch works (and Account turns dark), Delete asks for confirmation, Log out.
