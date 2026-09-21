# Scheduled Order Date/Time Picker (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer using `ShifterOnline` pick a real future date/time (today, up to 7 days ahead) when using "Schedule Booking", and have that value actually reach the order as `schedule_date_time` — today the button is hidden and, if enabled, sends no time at all.

**Architecture:** Pure frontend change plus one payload field. `home.dart` gets its existing (currently disabled) "Schedule Booking" entry point turned back on. `select_vehicle.dart` gains a small date/time-picking step, gated on `bookingType == 2`, whose result is validated (45 min–7 days from now) and sent as an ISO 8601 string in the existing `schedule_date_time` order-create field. No backend changes — `createOrderCore` already stores whatever is sent for `booking_type=2` (`orderController.js:270-272`).

**Tech Stack:** Flutter/Dart, `intl` package (already a dependency) for date formatting, `GetX` (`Get.dialog`/`showDatePicker`/`showTimePicker` from `flutter/material.dart`, already used elsewhere in this app — see `wallet_page.dart:519`).

**Spec:** `docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md`, §4 ("Phase A — Customer date/time picker").

## Global Constraints

- Picker must reject any picked time less than 45 minutes from now, or more than 7 days from now (spec §4).
- No backend change in this plan — `schedule_date_time` is already a functioning pass-through field in `createOrderCore` (`backend/src/controllers/orderController.js:270-272`); this plan only makes the frontend populate it.
- `booking_type=1` (instant) and `booking_type=3` (next-day) flows must not change — every change here is gated on `_currentBookingType == 2` / `bookingType == 2`.
- Send the value as ISO 8601 (`DateTime.toIso8601String()`), since that's what `Date.parse()` on the backend (`tripLifecycle.js:1300`, `scheduleMs = Date.parse(order.schedule_date_time)`) expects to parse unambiguously.

---

### Task 1: Add a pure date/time validation helper + its test

**Files:**
- Create: `ShifterOnline/lib/utils/schedule_time.dart`
- Test: `ShifterOnline/test/schedule_time_test.dart`

**Interfaces:**
- Produces: `ScheduleTimeValidation.validate(DateTime picked, {DateTime? now})` → returns `String?` (an error message, or `null` if valid). `now` is an optional override purely for testability (defaults to `DateTime.now()`). This is what Task 2's picker sheet calls before accepting a picked value.

- [ ] **Step 1: Write the failing test**

```dart
// ShifterOnline/test/schedule_time_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/schedule_time.dart';

void main() {
  final now = DateTime(2026, 9, 21, 12, 0, 0);

  test('rejects a time less than 45 minutes from now', () {
    final picked = now.add(const Duration(minutes: 30));
    expect(
      ScheduleTimeValidation.validate(picked, now: now),
      'Please pick a time at least 45 minutes from now.',
    );
  });

  test('accepts a time exactly 45 minutes from now', () {
    final picked = now.add(const Duration(minutes: 45));
    expect(ScheduleTimeValidation.validate(picked, now: now), isNull);
  });

  test('accepts a time up to 7 days from now', () {
    final picked = now.add(const Duration(days: 7));
    expect(ScheduleTimeValidation.validate(picked, now: now), isNull);
  });

  test('rejects a time more than 7 days from now', () {
    final picked = now.add(const Duration(days: 7, minutes: 1));
    expect(
      ScheduleTimeValidation.validate(picked, now: now),
      'Please pick a date within the next 7 days.',
    );
  });

  test('rejects a time in the past', () {
    final picked = now.subtract(const Duration(hours: 1));
    expect(
      ScheduleTimeValidation.validate(picked, now: now),
      'Please pick a time at least 45 minutes from now.',
    );
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `ShifterOnline/`): `flutter test test/schedule_time_test.dart`
Expected: FAIL — `package:goParcel/utils/schedule_time.dart` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```dart
// ShifterOnline/lib/utils/schedule_time.dart

/// Validation for the "Schedule Booking" date/time picker — kept as a pure
/// function (no BuildContext, no side effects) so it's unit-testable without
/// a widget harness. See docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md §4.
class ScheduleTimeValidation {
  static const minLead = Duration(minutes: 45);
  static const maxLead = Duration(days: 7);

  static String? validate(DateTime picked, {DateTime? now}) {
    final effectiveNow = now ?? DateTime.now();
    final lead = picked.difference(effectiveNow);
    if (lead < minLead) {
      return 'Please pick a time at least 45 minutes from now.';
    }
    if (lead > maxLead) {
      return 'Please pick a date within the next 7 days.';
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/schedule_time_test.dart`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add ShifterOnline/lib/utils/schedule_time.dart ShifterOnline/test/schedule_time_test.dart
git commit -m "feat: add schedule-time validation helper for scheduled bookings"
```

---

### Task 2: Re-enable the "Schedule Booking" entry point in `home.dart`

**Files:**
- Modify: `ShifterOnline/lib/screens/home/home.dart:76` (the `_scheduleBookingEnabled` flag)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this only flips existing, already-wired code
  (`_handleScheduleBookingTap` at `home.dart:918-929`, the "Schedule"
  card at `home.dart:840-916`) back to visible/tappable. Task 3 is what
  actually adds the date/time step to the flow this unlocks.

- [ ] **Step 1: Flip the flag**

In `ShifterOnline/lib/screens/home/home.dart`, change:

```dart
  static const bool _scheduleBookingEnabled = false;
```

to:

```dart
  static const bool _scheduleBookingEnabled = true;
```

Also delete the now-stale comment above it (lines 72-75, "Temporary flag
to hide the 'Schedule Booking'... Flip back to true to restore it") since
it's no longer temporary.

- [ ] **Step 2: Manual check — card is visible**

Run the app (`flutter run`), open the home screen, confirm the "Schedule"
card now renders next to the instant-booking card (previously hidden).
Tapping it should proceed exactly as before this plan (straight to
vehicle selection, `_selectedBookingType = 2`, no date/time step yet —
that's Task 3).

- [ ] **Step 3: Commit**

```bash
git add ShifterOnline/lib/screens/home/home.dart
git commit -m "feat: re-enable Schedule Booking entry point on home screen"
```

---

### Task 3: Add the date/time picker step to `select_vehicle.dart`

**Files:**
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart`

**Interfaces:**
- Consumes: `ScheduleTimeValidation.validate` from Task 1
  (`package:goParcel/utils/schedule_time.dart`).
- Produces: `_scheduledFor` (nullable `DateTime` instance field on
  `_SelectVehicleScreenState`) — read by the order-create call this same
  task adds, and available to any later Phase-B driver-facing display
  logic that might read the order back (out of scope here, but this is
  the field name Phase B's plan should assume the order-create payload's
  `schedule_date_time` came from).

- [ ] **Step 1: Add the import and the state field**

At the top of `ShifterOnline/lib/screens/home/select_vehicle.dart`, add:

```dart
import 'package:intl/intl.dart';

import '../../utils/schedule_time.dart';
```

In `_SelectVehicleScreenState`, alongside the other state fields (near
`int _selectedRadiusKm = 4;` at line 56), add:

```dart
  DateTime? _scheduledFor;
```

- [ ] **Step 2: Add the picker method**

Add this method to `_SelectVehicleScreenState` (near
`_handleScheduleBookingTap`'s sibling helpers — any private method is
fine, e.g. right after `initState`):

```dart
  Future<void> _pickScheduleDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _scheduledFor ?? now.add(const Duration(hours: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 7)),
    );
    if (date == null || !mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_scheduledFor ?? now.add(const Duration(hours: 1))),
    );
    if (time == null || !mounted) return;

    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    final error = ScheduleTimeValidation.validate(picked);
    if (error != null) {
      ApiWrapper.showToastMessage(error);
      return;
    }
    setState(() => _scheduledFor = picked);
  }
```

- [ ] **Step 3: Show the picker row when `bookingType == 2`, and require it before booking**

Find where the vehicle-selection screen lays out its fare/booking
summary (the `Column` built in the widget housing the "Book" button —
same area that already renders `_selectedRadiusKm`-driven text, e.g.
around `select_vehicle.dart:960` where `'Based on drivers within
$_selectedRadiusKm km'` is shown). Immediately above the booking button,
add:

```dart
          if (_currentBookingType == 2) ...[
            InkWell(
              onTap: _pickScheduleDateTime,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  border: Border.all(color: linercolor),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(Icons.schedule_rounded, color: linercolor, size: 18),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _scheduledFor == null
                            ? 'Pick pickup date & time'
                            : DateFormat('EEE, d MMM · h:mm a').format(_scheduledFor!),
                        style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 13),
                      ),
                    ),
                    Icon(Icons.chevron_right, color: greaycolor, size: 18),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
```

- [ ] **Step 4: Block booking until a valid time is picked**

Find the method that handles the "Book" button tap (the one that builds
and sends the `Config.nodeOrderCreate` request — `select_vehicle.dart`
around line 652). At its top, before any existing validation, add:

```dart
    if (_currentBookingType == 2 && _scheduledFor == null) {
      ApiWrapper.showToastMessage('Please pick a pickup date & time first.');
      return;
    }
```

- [ ] **Step 5: Send the value in the order-create payload**

In the same method, in the `ApiWrapper.dataPostNode(Config.nodeOrderCreate, {...})`
call body (`select_vehicle.dart:652-668`), add one entry:

```dart
      if (_currentBookingType == 2) 'schedule_date_time': _scheduledFor!.toIso8601String(),
```

(Add it as a new line inside the existing map literal — e.g. right
after the `'booking_type': _currentBookingType,` line — using Dart's
map-entry `if` syntax so it's simply omitted for other booking types.)

- [ ] **Step 6: Manual smoke test**

Run the app, tap "Schedule" on the home screen, pick a vehicle, confirm:
- The date/time row appears and is tappable.
- Picking a time 10 minutes out shows the "at least 45 minutes" toast
  and does not set `_scheduledFor`.
- Picking a valid time (e.g. 2 hours out) shows the formatted date/time
  in the row.
- Tapping "Book" without picking a time shows the "pick a date & time
  first" toast and does not submit.
- Tapping "Book" after picking a valid time submits successfully (watch
  the network request in a proxy/logging tool, or temporarily log the
  request body, to confirm `schedule_date_time` is present and
  ISO-8601-formatted, and `booking_type` is `2`).
- Separately, place one instant (booking_type 1) order end-to-end to
  confirm it's unaffected (no date/time row appears, no
  `schedule_date_time` sent).

- [ ] **Step 7: Commit**

```bash
git add ShifterOnline/lib/screens/home/select_vehicle.dart
git commit -m "feat: collect and send pickup date/time for scheduled bookings"
```

---

## Self-Review Notes

- **Spec coverage:** §4's picker range (today..+7 days), the 45-minute
  minimum lead (tied to §3's 30+15 minute mechanic), and sending the
  existing `schedule_date_time` field are all covered (Tasks 1-3). §4
  explicitly says no backend change is needed for this phase alone —
  none is included.
- **Placeholder scan:** no TBD/TODO; every step has real code.
- **Type consistency:** `_scheduledFor` (Task 3) is the only new shared
  name; used consistently in Steps 1-5 of Task 3.
