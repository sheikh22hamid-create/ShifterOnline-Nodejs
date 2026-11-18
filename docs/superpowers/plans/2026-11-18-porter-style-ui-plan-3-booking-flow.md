# Porter-Style UI — Plan 3: Booking Flow (Drop search → Drop details → Select Vehicle → Review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the four booking screens to the approved Porter-style mockups and move the saved-places row from Home into drop search. Every booking feature must keep working.

**Architecture:** Add small presentational widgets that take data and callbacks:
- `RouteMarker`, `SavedPlacesRow`, `BookingTypeCard`, `OffersDetailsCard`, `ReviewVehicleCard`, `ReviewBottomBar`.
- A reworked `VehicleOptionCard`.

Then re-lay out the four screens around these widgets. All state, maths and API calls stay where they are today:
- `select_vehicle.dart` keeps `_appliedCoupon`, `_useReferralPoints`, `_gstDetails`, `_goodsTypeId`, `_scheduledFor`, `_lowFareWindow`, `_selectedRadiusKm` and `_bookSelected`/`_submitOrder`.
- `confirm_order_map.dart` keeps `_handleConfirmOrder` and the payment and receiver-pays state.
- Each new button calls the same handler the old one did.

**Tech Stack:** Flutter (Dart), GetX (`Get.to`, `Get.back(result:)`, `.tr`), flutter_test. Package `goParcel`. Font Gilroy.

**Spec:** `docs/superpowers/specs/2026-11-18-customer-app-porter-style-ui-design.md` (§5, §6.2–§6.5, §6.11, §7). Mockups: https://claude.ai/artifact/1da6CdHakdNLknLW959LfP (boards "Select Vehicle" and "Review Booking"; source `docs/design/porter-style-mockups/Vehicle.dc.html`, `Review.dc.html`).

## Global Constraints

- **UI only.**
  - No change to API calls, sockets, GetX controllers, validations, fare/payable maths or booking payloads (`_submitOrder` body untouched).
  - Every new tap calls the existing method.
- **Commits:** `ShifterOnline/` is gitignored, so commit with `git add -f <exact files>`. Auto-commit each finished task. Never push.
- **v2 tokens (from Plan 2):**
  - canvas `AppPalette.current.canvas`
  - cards white, radius 16, no border, `AppShadow.card`
  - primary button `AppPrimaryButton` (52 high, radius 12)
  - selected card = brand 1.5 border + `brandTint`
- **Route markers everywhere:**
  - pickup = green circle (`p.success`) with white `Icons.arrow_upward_rounded`
  - drop = red circle (`p.danger`) with white `Icons.arrow_downward_rounded`
  - stops = grey circle with the stop number
- **Colour and copy:** no white text on orange (`p.onBrand` is dark). No Porter logos, art, copy or blue.
- **Free Ride wording** is chance-based, never "first booking free".
- **Booking Guarantee line** only when amount > 0, using the existing `guaranteeLine(amount)` text.
- **Strings:** every new user-visible string uses `.tr` and gets an English key in `ShifterOnline/lib/Language/language_string.dart`, written as an escaped `\n`, never a raw newline.
- **Dark mode:** colours come only from `AppPalette.current`, with no hard-coded light colours on surfaces.
- **Tests:** `cd ShifterOnline && flutter test` stays green, and `flutter analyze` adds no new warnings over the current baseline of 15.

## Rulings (Claude's calls; owner may override at review)

- **No "+ add stop" on drop search.** Spec §6.2 shows one. Stops are still added on Select Vehicle (Add Stop / Edit Locations plus the stop-beyond-drop check). Adding stops before a vehicle is chosen would be a new flow.
- **Models / body-type picker stays inline** under the selected vehicle, not in a sheet. Spec §6.4 says "restyled as a sheet". Inline keeps the existing ON/OFF chain rule visible and avoids re-wiring.
- **Applied coupon / points / GST / goods are not summarised on Review.** `ConfirmOrderMap` does not receive them (spec §6.5 says omit in that case). The Porter "free loading time" line is also left out, because Shifter has no such data.
- **No strike-through price on vehicle rows.** The availability API returns no "was" price.
- **Review loses its map** (see Task 7). The approved mockup has none.

## Review Focus

- **Long Hindi/English text at textScale 1.3 on a 360dp phone:** booking-type card, offers rows, Review bottom bar and vehicle rows must not overflow. Tests in Tasks 4, 5, 6 and 7.
- **Saved place chosen from drop search:** must reach Select Vehicle exactly like the old Home row, including the `DropeAddress` storage write and the service-area check in `_startDropSelection`. The test in Task 2 checks `onSelect` gets the unchanged map; device check in Task 8.
- **Wallet balance below the fare on Review:** button label switches to "Add Money to Wallet" and opens Wallet, same as today. Test in Task 7.
- **No vehicles / no drivers available:** existing empty and no-drivers cards still show and the pinned button stays hidden. Task 4 step 3 keeps those branches; device check in Task 8.
- **Schedule booking:** the time picked on the top card is the time sent, because `_pickScheduleDateTime` and `_scheduledFor` are reused. Low Fare date and window pickers are still reachable before Proceed. Test in Task 5.

---

### Task 1: RouteMarker widget

**Files:**
- Create: `ShifterOnline/lib/theme/widgets/route_marker.dart`
- Test: `ShifterOnline/test/theme/route_marker_test.dart`

**Interfaces:**
- Produces:
  - `RouteMarker.pickup({double size = 24})`
  - `RouteMarker.drop({double size = 24})`
  - `RouteMarker.stop(int number, {double size = 24})`

  Each is a `StatelessWidget` that draws a circle of `size`.

- [ ] **Step 1: Write the failing tests**
  - `pickup is a green circle with an up arrow`: find `Icon` with `Icons.arrow_upward_rounded`. The `DecoratedBox`/`Container` decoration colour equals `AppPalette.current.success`.
  - `drop is a red circle with a down arrow`: `Icons.arrow_downward_rounded`, colour `AppPalette.current.danger`.
  - `stop shows its number`: `find.text('2')` for `RouteMarker.stop(2)`.
  - `respects size`: `tester.getSize(find.byType(RouteMarker)) == const Size(28, 28)` for `size: 28`.
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/theme/route_marker_test.dart`. It should fail because `route_marker.dart` does not exist.
- [ ] **Step 3: Implement.**
  - The icon is 0.65 × size and white.
  - The stop circle uses `p.inkSubtle` fill with a white `Gilroy_Bold` number at 0.5 × size.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Commit**
```bash
git add -f ShifterOnline/lib/theme/widgets/route_marker.dart ShifterOnline/test/theme/route_marker_test.dart
git commit -m "feat(customer-ui): shared pickup/drop/stop route markers"
```

### Task 2: Drop search in Porter layout, with saved places moved from Home

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/saved_places_row.dart`
- Modify: `ShifterOnline/lib/screens/home/widgets/place_list_tile.dart` (optional `onSave`)
- Modify: `ShifterOnline/lib/screens/home/location_search_screen.dart` (header + body layout, saved places, ❤ SAVE)
- Modify: `ShifterOnline/lib/screens/home/home.dart`. Remove from Home:
  - `_buildQuickLocations()` from the layout
  - `_savedLocations`, `_isLoadingSavedLocations`, `_loadSavedLocations`, `_selectSavedDropLocation`, `_addQuickLocation`, `_quickLocationTitle`, `_quickLocationIcon`, `_buildQuickLocations`, `_quickLocationCard` and their now-unused imports (`AddressList.dart`, `section_header.dart` only if unused)
  - the `_loadSavedLocations()` calls in init/refresh
- Modify: `ShifterOnline/lib/Language/language_string.dart`
- Test: `ShifterOnline/test/home/saved_places_row_test.dart`, `ShifterOnline/test/home/place_list_tile_test.dart`

**Interfaces:**
- Consumes: `RouteMarker` (Task 1).
- Produces: `SavedPlacesRow({required List<Map<String, dynamic>> places, required bool loading, required ValueChanged<Map<String, dynamic>> onSelect, required VoidCallback onAdd, required VoidCallback onManage})`.
  - Statics: `SavedPlacesRow.titleFor(Map) → String` (`office` → `Work`, missing → `Other`, else the `type` value) and `SavedPlacesRow.iconFor(Map) → String`: `assets/selecthome.png` / `assets/selectoffice.png` / `assets/selectothers.png`. These are the same rules as home.dart's `_quickLocationTitle/_quickLocationIcon`.
  - `PlaceListTile` gains `VoidCallback? onSave`. When set, it shows a trailing "❤ SAVE" text button: `Icons.favorite_border_rounded` + `'SAVE'.tr` in `p.brandText`.

**Screen layout** (location_search_screen.dart `build`), top to bottom, for every `locationType`:
1. **Route card** (white, radius 16, `AppShadow.card`) replacing the header container. It contains:
   - a pickup row: `RouteMarker.pickup()`, `c_name · c_number` and the address, using today's text. Shown only when `!_isPickup && widget.pickupData != null`.
   - the search field row with `RouteMarker.drop()` (Drop), `RouteMarker.stop(stopIndex + 1)` (Stop) or `RouteMarker.pickup()` (Pickup/Address). Keep the TextField, clear button and mic button exactly, including listening colours.
   - a dotted vertical connector between the pickup and search rows.
2. **Action bar:** the two existing chips ("Select on map" → `_selectOnMap`, "Import from WhatsApp" → `_importFromWhatsApp`), unchanged.
3. The current-location `PlaceListTile` (unchanged handler `_useCurrentLocation`).
4. **`SavedPlacesRow`**, only when `_isDrop && !widget.locationOnly`. Its callbacks:
   - `onSelect: _selectSavedPlace`
   - `onAdd: _addSavedPlace`
   - `onManage: () async { await Get.to(() => const AddressListPage()); _loadSavedPlaces(); }`
5. **Recents / predictions / skeleton,** as today. Recent rows get `onSave: () => _saveRecentAsPlace(item)` when `!_isAddress && !widget.locationOnly`.

**New `_LocationSearchScreenState` members.** These are moved from home.dart, not rewritten:
- `_loadSavedPlaces()`: same body as home's `_loadSavedLocations` (same `Config.nodeAddressList` call).
- `_selectSavedPlace(Map<String, dynamic> place)`: copies the map, does `_storage.write('DropeAddress', [drop])`, then `Get.back(result: drop)`. Home's `_startDropSelection` then runs the service-area check and vehicle loading exactly as for a typed drop. The pickup-missing guard is not needed because drop search is only opened after `_ensureCurrentPickup`.
- `_addSavedPlace()`: home's `_addQuickLocation` body (login guard + `Get.to(LocationSearchScreen(locationType: "Address"))`), then `_loadSavedPlaces()`.
- `_saveRecentAsPlace(item)`: `Get.to(LocationConfirmMapScreen(locationType: 'Address', initialLat: item lat, initialLng: item lng, initialAddress: item['address'], initialPlaceName: item['name'] ?? item['address']))`. This is the existing save-address flow, prefilled. On a non-null result, call `_loadSavedPlaces()`. Apply the same login guard as `_addSavedPlace`.

- [ ] **Step 1: Write the failing tests**
  - `saved_places_row_test.dart`:
    - `titleFor maps office to Work and missing type to Other`
    - `shows one chip per place plus Add`: two places → `find.text('Home')`, `find.text('Work')`, `find.text('Add')`
    - `tapping a place passes the same map`: the captured map is `same()` as the input
    - `Add and Manage call their callbacks`
    - `loading shows skeletons, no chips`: `find.byType(AppSkeleton)` findsWidgets, `find.text('Add')` findsNothing
    - `no overflow at textScale 1.3 on 360dp`: `tester.takeException()` is null
  - `place_list_tile_test.dart`:
    - `SAVE shows only when onSave is set and calls it`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/saved_places_row_test.dart test/home/place_list_tile_test.dart`.
- [ ] **Step 3: Implement** `SavedPlacesRow` and `PlaceListTile.onSave`.
  - The row is a header ("Saved places" + "Manage" text button) over a horizontal list of chips: 40 high, radius 999, white, `AppShadow.card`, asset icon 18 + title.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Re-lay out `location_search_screen.dart`, move the members and strip home.dart** as listed above. Add the English keys `Saved places`, `Manage`, `Add`, `SAVE`.
- [ ] **Step 6: Verify.**
  - Run `cd ShifterOnline && flutter analyze lib/screens/home lib/theme` and expect no new warnings.
  - Run `flutter test` and expect all to pass.
  - Run `grep -n "_buildQuickLocations\|_selectSavedDropLocation" lib/screens/home/home.dart` and expect no output.
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/saved_places_row.dart ShifterOnline/lib/screens/home/widgets/place_list_tile.dart ShifterOnline/lib/screens/home/location_search_screen.dart ShifterOnline/lib/screens/home/home.dart ShifterOnline/lib/Language/language_string.dart ShifterOnline/test/home/saved_places_row_test.dart ShifterOnline/test/home/place_list_tile_test.dart
git commit -m "feat(customer-ui): Porter-style drop search; saved places move there from Home"
```

### Task 3: Drop / pickup details form order and markers

**Files:**
- Modify: `ShifterOnline/lib/screens/home/location_confirm_map_screen.dart` (bottom form only, `build` around lines 515–720)

**Interfaces:**
- Consumes: `RouteMarker`.

- [ ] **Step 1: Restyle.**
  - **Address row:** replace the 36px tinted `location_on` circle with:
    - `RouteMarker.pickup(size: 32)` when `_isPickup`
    - `RouteMarker.drop(size: 32)` when `_isDrop`
    - `RouteMarker.stop(widget.stopIndex + 1, size: 32)` for a stop
    - the old circle unchanged for `Address` mode
  - **Field order when `!widget.locationOnly`** (spec §6.3):
    1. section heading
    2. name
    3. mobile (phone-book suffix stays)
    4. "Use my mobile number"
    5. WhatsApp opt-in
    6. House/Flat field
    7. Save as chips

    In `locationOnly` mode, only the address row and the House/Flat field show, as today.
  - **Unchanged:** controllers, `_toggleUseMyNumber`, `_sendWhatsapp`, `_confirmAndProceed`, the button.
- [ ] **Step 2: Verify.**
  - Run `cd ShifterOnline && flutter analyze lib/screens/home/location_confirm_map_screen.dart` and expect no new warnings.
  - Run `flutter test` and expect all to pass.
- [ ] **Step 3: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/location_confirm_map_screen.dart
git commit -m "feat(customer-ui): drop details — Porter field order and route markers"
```

### Task 4: Vertical vehicle list (selected = large card, others = compact rows)

**Files:**
- Modify: `ShifterOnline/lib/screens/home/widgets/vehicle_option_card.dart`
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (`build` list section ~1575–1590, `_vehicleCard`, `_loadingVehicles`)
- Test: `ShifterOnline/test/home/vehicle_option_card_test.dart` (rewrite the assertions on the old 128-wide card)

**Interfaces:**
- Produces: `VehicleOptionCard({required String name, String? imageUrl, String? meta, String? price, String? unavailableText, String? tag, required bool selected, required bool available, required VoidCallback onTap})`.
  - `meta` = "`<capacity> kg · <eta> mins`", built from parts that exist.
  - `price` = `_startingFare(option)`.
  - `unavailableText` = `_unavailableReason(option)`.

- [ ] **Step 1: Write the failing tests** (replace the old card tests).
  - `unselected is a compact row`: height < 90, image slot 56×56, shows name, meta and price, no brand border.
  - `selected is a large card with brand border and tint`: image slot 96 high, decoration border colour `p.brand` width 1.5, colour `p.brandTint`.
  - `unavailable shows reason instead of price, faded, still tappable`: `Opacity` key `vehicle-card-opacity` at 0.45, `find.text(reason)`, tap fires `onTap`.
  - `tag chip shows`: `tag: 'NEW'` → `find.text('NEW')`.
  - `missing image shows the truck icon placeholder`: `Icons.local_shipping_outlined`.
  - `no overflow at textScale 1.3, 360dp, long name`.
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/vehicle_option_card_test.dart`.
- [ ] **Step 3: Implement the card** as a full-width `AnimatedContainer` (180 ms):
  - Unselected: white, radius 16, `AppShadow.card`. Row: image 56 → name + tag (bold 16) / meta (13 `inkMuted`) → price (bold 16) or reason.
  - Selected: same row with image 96 high and a brand border/tint.
  - Image: `Image.network` with the existing errorBuilder → placeholder.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Wire select_vehicle.dart.**
  - Replace the 142-high horizontal `ListView.separated` (keep `key: _vehicleRowKey`) with a `Column` of `_vehicleCard`s separated by `SizedBox(height: 10)`.
  - `_vehicleCard` passes `meta`, `price` and `unavailableText`. The `onTap` bodies stay unchanged.
  - `_loadingVehicles()` becomes three 72-high `AppSkeleton`s plus the same "Finding vehicles near pickup..." caption.
  - Keep `_emptyState()`, `_noDriversAvailableCard()` and `_selectedVehicleSection()` (models, body type, fare) where they are, right under the list.
- [ ] **Step 6: Verify.** Run `cd ShifterOnline && flutter analyze lib/screens/home` (no new warnings) and `flutter test` (all pass).
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/vehicle_option_card.dart ShifterOnline/lib/screens/home/select_vehicle.dart ShifterOnline/test/home/vehicle_option_card_test.dart
git commit -m "feat(customer-ui): Porter-style vertical vehicle list"
```

### Task 5: Select Vehicle top card (route + booking type + search radius) and pinned Proceed bar

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/booking_type_card.dart`
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (`_routeSummary` markers, `build`, `_bottomCta`)
- Modify: `ShifterOnline/lib/Language/language_string.dart`
- Test: `ShifterOnline/test/home/booking_type_card_test.dart`

**Interfaces:**
- Consumes: `RouteMarker`.
- Produces: `BookingTypeCard({required int bookingType, String? scheduleLabel, VoidCallback? onChangeSchedule, required int radiusKm, required VoidCallback onRadiusTap, Widget? lowFareChild})`.
  - `bookingType` is 1 = Now, 2 = Schedule, 3 = Low Fare, the same values as `_currentBookingType`.
  - `lowFareChild` is shown under the type line when `bookingType == 3`.

- [ ] **Step 1: Write the failing tests**
  - `now shows "Now" and no Change`
  - `schedule shows the label and Change calls onChangeSchedule`: `scheduleLabel: 'Fri, 20 Nov · 10:30 AM'`
  - `schedule with no time yet shows "Pick pickup date & time"`: tapping it calls `onChangeSchedule`
  - `low fare shows "Low Fare" and the lowFareChild, no Change`
  - `radius row shows "Driver search area · 3 km" and tapping calls onRadiusTap`
  - `no overflow at textScale 1.3 on 360dp`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/booking_type_card_test.dart`.
- [ ] **Step 3: Implement `BookingTypeCard`.**
  - White card, radius 16, `AppShadow.card`.
  - Row 1: icon (`bolt` Now / `schedule` Schedule / `local_offer` Low Fare) + type label + (Schedule only) value + "Change" in `p.brandText`.
  - Divider.
  - Row 2: `Icons.radar_rounded` + "Driver search area · N km" + chevron, as a `PressableScale` onto `onRadiusTap`.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Wire select_vehicle.dart.**
  - **`_routeSummary`:** pickup/drop/stop dots become `RouteMarker`s. Swap, Add Stop and Edit Locations stay as today.
  - **Below the route card**, add a `BookingTypeCard`:
    - `bookingType: _currentBookingType`
    - `scheduleLabel` uses `_scheduledFor` with the same `DateFormat('EEE, d MMM yyyy · h:mm a')`
    - `onChangeSchedule: _pickScheduleDateTime`
    - `radiusKm: _selectedRadiusKm`
    - `onRadiusTap: _openSearchAreaSheet`
    - `lowFareChild`: the existing Low Fare banner, the date `BookingPickerField`, the from/until pickers and the explanatory text, moved out of `_bottomCta` unchanged.
  - **Remove** the "Available vehicles near pickup" row's radius pill (moved into the card). Keep the title "Available vehicles near pickup" and the "Based on drivers within N km" caption.
  - **Move** the Schedule picker and its "goes LIVE" text from `_bottomCta` into the card. The picker is represented by Change.
  - **`_bottomCta`** keeps only:
    - the guarantee banner (unchanged condition)
    - a row: price `_modelFare` + vehicle·model caption
    - `AppPrimaryButton(label: _booking ? 'Booking...' : 'Proceed with @v'.trParams({'v': _vehicleName(_selected!)}), onPressed: _booking ? null : _bookSelected)`. For Low Fare the label stays `'Book Next Day'`.
  - **Add keys:** `Now`, `Schedule`, `Low Fare`, `Change`, `Pick pickup date & time`, `Driver search area · @km km`, `Proceed with @v`.
- [ ] **Step 6: Verify.** Run `cd ShifterOnline && flutter analyze lib/screens/home` (no new warnings) and `flutter test` (all pass).
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/booking_type_card.dart ShifterOnline/lib/screens/home/select_vehicle.dart ShifterOnline/lib/Language/language_string.dart ShifterOnline/test/home/booking_type_card_test.dart
git commit -m "feat(customer-ui): Select Vehicle booking-type card and pinned Proceed bar"
```

### Task 6: Offers & Details card

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/offers_details_card.dart`
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (`_selectedVehicleSection`: move the points row, coupon row, `GstDetailsSection` and goods pills out)
- Modify: `ShifterOnline/lib/Language/language_string.dart`
- Test: `ShifterOnline/test/home/offers_details_card_test.dart`

**Interfaces:**
- Produces: `OffersDetailsCard({required String goodsValue, required VoidCallback onGoodsTap, required String couponLabel, required bool couponActive, required VoidCallback onCouponTap, VoidCallback? onCouponClear, String? pointsLabel, bool pointsActive = false, VoidCallback? onPointsTap, required Widget gstSection})`.
  - The card has a "Offers & Details" header, then rows separated by 1px `p.divider`, in mockup order: Goods type → Apply Coupon → Reward Points (only when `pointsLabel != null`) → `gstSection`.

- [ ] **Step 1: Write the failing tests**
  - `shows header and goods value`: `goodsValue: 'Household'` → `find.text('Offers & Details')`, `find.text('Household')`
  - `goods row tap calls onGoodsTap`
  - `coupon row shows label and clear only when active`: tapping clear calls `onCouponClear`
  - `points row hidden when pointsLabel is null`
  - `points row shows checked state when active and calls onPointsTap`: `Icons.check_box_rounded`
  - `gstSection child is rendered`: pass `Text('GST')` and find it
  - `no overflow at textScale 1.3 on 360dp`
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/offers_details_card_test.dart`.
- [ ] **Step 3: Implement.**
  - Rows are 56 min-height `PressableScale`s with a leading 36 rounded-square icon (`Icons.inventory_2_outlined` goods, `Icons.local_offer_outlined` coupon, `Icons.stars_rounded` points), title, value in `p.brandText` (`p.inkMuted` for goods), and a chevron.
  - Coupon active shows a close `IconButton` instead of the chevron.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Wire select_vehicle.dart.**
  - Render `OffersDetailsCard` below `_selectedVehicleSection()` with `const SizedBox(height: 14)` above it. Show it only when the selected vehicle section shows, using the same condition.
  - **Goods:**
    - `goodsValue` is the selected goods name, or `'Other'` with the `_goodsOtherController` text if any, or `'Select'.tr`.
    - `onGoodsTap: _openGoodsSheet`. This new method shows an `AppSheet` via `showModalBottomSheet(isScrollControlled: true)` with a `StatefulBuilder`, containing the same `BookingChoicePill` Wrap and the same "Other" `TextField` with the same `onTap` bodies, calling both the sheet `setState` and the screen `setState`. A "Done" `AppPrimaryButton` pops the sheet.
  - **Coupon:**
    - `couponLabel`: today's `BookingOptionRow` title string
    - `onCouponTap`: today's `showCouponSheet` body
    - `onCouponClear: () => setState(() => _appliedCoupon = null)`
  - **Points:** `pointsLabel` is `'Use referral points · Save ₹X (N pts)'` only under today's condition `_referralDiscountEnabled && _referralPointsAvailable > 0 && _referralRedeemablePoints > 0`. `onPointsTap` toggles `_useReferralPoints`.
  - **GST:** `gstSection: GstDetailsSection(uid: _storage.read('Uid'), onChanged: (d) => setState(() => _gstDetails = d))`, the same widget.
  - **Keep** in `_selectedVehicleSection`: fare lines, coupon/points discount lines, payable amount, "View fare details".
  - **Add keys:** `Offers & Details`, `Goods type`, `Apply Coupon`, `Reward Points`, `Select`, `Done`.
- [ ] **Step 6: Verify.**
  - Run `cd ShifterOnline && flutter analyze lib/screens/home` (no new warnings) and `flutter test` (all pass).
  - Run `grep -n "'goods_type_id'\|use_referral_points\|gst_number\|cou_id" lib/screens/home/select_vehicle.dart`: the payload lines must be unchanged from before the task (compare with `git diff`).
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/offers_details_card.dart ShifterOnline/lib/screens/home/select_vehicle.dart ShifterOnline/lib/Language/language_string.dart ShifterOnline/test/home/offers_details_card_test.dart
git commit -m "feat(customer-ui): Offers & Details card on Select Vehicle"
```

### Task 7: Review Booking screen

**Files:**
- Create: `ShifterOnline/lib/screens/home/widgets/review_widgets.dart` (`ReviewVehicleCard`, `ReviewBottomBar`, `showAddressDetailsSheet`)
- Modify: `ShifterOnline/lib/screens/home/confirm_order_map.dart`
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart:984-993` (pass display-only args)
- Modify: `ShifterOnline/lib/Language/language_string.dart`
- Test: `ShifterOnline/test/home/review_widgets_test.dart`

**Interfaces:**
- Consumes: `RouteMarker`; `guaranteeLine(double)` from `lib/utils/booking_guarantee.dart`.
- Produces:
  - **New optional `ConfirmOrderMap` params** (display only; defaults keep today's call sites compiling):
    - `String? vehicleName`
    - `String? vehicleImageUrl`
    - `String? timeLabel`
    - `Map<String, dynamic>? pickupData`
    - `Map<String, dynamic>? dropData`
    - `double guaranteeAmount = 0`
  - `ReviewVehicleCard({required String vehicleName, String? imageUrl, String? timeLabel, required VoidCallback onViewAddress})`.
  - `ReviewBottomBar({required String payLabel, required VoidCallback onPayTap, required String total, required VoidCallback onViewBreakup, required String buttonLabel, required bool processing, VoidCallback? onBook})`. `onBook == null` means disabled.
  - `showAddressDetailsSheet(BuildContext, {Map<String, dynamic>? pickup, List<Map<String, dynamic>> stops, Map<String, dynamic>? drop})`: a sheet listing pickup / each stop / drop with `RouteMarker`, `c_name · c_number` and the address.

- [ ] **Step 1: Write the failing tests**
  - `vehicle card shows name, time and View Address Details calls back`
  - `bottom bar shows pay label, total, View Breakup and button`: tapping each calls its callback
  - `bottom bar button disabled when onBook is null`: `AppPrimaryButton.onPressed == null`
  - `bottom bar shows a spinner when processing`
  - `insufficient wallet label`: pass `buttonLabel: 'Add Money to Wallet'` and find it
  - `address sheet lists pickup, 2 stops and drop in order with markers`: 1 up, 1 down and 2 numbered markers, in vertical order
  - `no overflow at textScale 1.3 on 360dp` for the bar and the card
- [ ] **Step 2: Run, expect FAIL.** Run `cd ShifterOnline && flutter test test/home/review_widgets_test.dart`.
- [ ] **Step 3: Implement the widgets.**
  - The bar is white, has a top shadow, includes the safe-area bottom inset, and contains:
    - row 1: `payLabel ▾` (tap `onPayTap`) on the left, and `total` with "View Breakup" underneath on the right
    - row 2: a full-width `AppPrimaryButton`
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Re-lay out `confirm_order_map.dart`.**
  - **Remove the map:** remove the GoogleMap section and the collapse handle together with `_initMap/_addMarkers/_getDirections/_addPolyLine/_setCameraBounds`, their fields, and imports left unused. **Ruling:** the approved Review mockup has no map, and "View Address Details" replaces the route view. This removes only the display-only directions fetch; booking calls are untouched.
  - **Body:** a `ListView` on `p.canvas` with these white cards, in order:
    1. `ReviewVehicleCard`, shown when `vehicleName != null`. `onViewAddress` opens `showAddressDetailsSheet(pickup: widget.pickupData, stops: widget.stops, drop: widget.dropData)`.
    2. The **Payment method** card, wrapped in a `GlobalKey _paymentKey`. It holds today's COD / Wallet (with Add Money) / Receiver-pays cards and the loading/empty states, unchanged.
    3. The **Booking Guarantee** `AppInfoBanner` (success tone, `Icons.verified_user_outlined`), only when `guaranteeLine(widget.guaranteeAmount) != null`.
    4. `BookingGuidelines`, unchanged.
    5. The terms line.
  - **Bottom:** `ReviewBottomBar`:
    - `payLabel`: `'Pay with Cash'` / `'Pay with Shifter Wallet'`, plus `' · Receiver pays'` when receiver pays is active
    - `onPayTap: () => Scrollable.ensureVisible(_paymentKey.currentContext!)`
    - `total: '${widget.currency}${widget.deliveryFees.toStringAsFixed(2)}'`
    - `onViewBreakup: widget.onViewBreakup`
    - `buttonLabel`: `'Add Money to Wallet'` when wallet is selected and insufficient. Otherwise `'Book @v'.trParams({'v': vehicleName})` when `vehicleName != null`, else `'Confirm & Place Order'`.
    - `onBook`: the same expression the old `ElevatedButton.onPressed` used, verbatim.
  - **Title:** `AppTopBar(title: 'Review Booking'.tr)`.
  - **select_vehicle.dart `_bookSelected`:** also pass:
    - `vehicleName: _vehicleName(selected)`
    - `vehicleImageUrl`: the same resolved image as `_vehicleCard`
    - `timeLabel`: `'Now'.tr`, or the scheduled `DateFormat` string, or the Low Fare date
    - `pickupData: _pickupData`, `dropData: _dropData`
    - `guaranteeAmount: _guaranteeAmount`

    These are the existing `late Map<String, dynamic>` state fields (select_vehicle.dart:73-74).
  - **Add keys:** `Review Booking`, `View Address Details`, `Pay with Cash`, `Pay with Shifter Wallet`, `Receiver pays`, `Book @v`, `View Breakup`, `Address details`.
- [ ] **Step 6: Verify.**
  - Run `cd ShifterOnline && flutter analyze lib/screens/home` (no new warnings) and `flutter test` (all pass).
  - Run `git diff HEAD -- ShifterOnline/lib/screens/home/confirm_order_map.dart | grep "_handleConfirmOrder"`: the method body must be unchanged.
- [ ] **Step 7: Commit**
```bash
git add -f ShifterOnline/lib/screens/home/widgets/review_widgets.dart ShifterOnline/lib/screens/home/confirm_order_map.dart ShifterOnline/lib/screens/home/select_vehicle.dart ShifterOnline/lib/Language/language_string.dart ShifterOnline/test/home/review_widgets_test.dart
git commit -m "feat(customer-ui): Porter-style Review Booking with pinned pay bar"
```

### Task 8: Device check on the owner's phone

- [ ] **Step 1: Build and install.**
```bash
cd ShifterOnline && flutter build apk --debug
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" install -r build/app/outputs/flutter-apk/app-debug.apk
```
  Expected: `Success`. The debug-signed app is already installed, so no uninstall is needed.
- [ ] **Step 2: Owner walks the checklist** and the result is recorded in the ledger:
  1. Book Now → drop search shows the route card, saved places, recents with ❤ SAVE, voice, map and WhatsApp import.
  2. A saved place reaches Select Vehicle.
  3. Drop details field order and WhatsApp opt-in.
  4. Vertical vehicle list; selecting shows models/body type; no-drivers state.
  5. Booking-type card: Schedule Change re-picks the time; Low Fare pickers; radius sheet.
  6. Offers & Details: goods sheet, coupon apply/clear, points, GST.
  7. Add Stop + stop-beyond-drop warning still works.
  8. Review: View Address Details, payment cards incl. Receiver pays + wallet Add Money, guarantee line, View Breakup, Book → order placed.
  9. Home no longer shows the saved-places row.
