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

  group('admin-configured minimum lead time', () {
    test('uses the configured value in the check and the message (10 minutes)', () {
      expect(
        ScheduleTimeValidation.validate(now.add(const Duration(minutes: 5)), now: now, minLeadMinutes: 10),
        'Please pick a time at least 10 minutes from now.',
      );
      expect(
        ScheduleTimeValidation.validate(now.add(const Duration(minutes: 10)), now: now, minLeadMinutes: 10),
        isNull,
      );
    });

    test('a time that was fine for the default is refused when the admin raises it (25 minutes)', () {
      expect(
        ScheduleTimeValidation.validate(now.add(const Duration(minutes: 20)), now: now, minLeadMinutes: 25),
        'Please pick a time at least 25 minutes from now.',
      );
    });

    test('a lower minimum accepts what the old fixed 45 minutes refused (20 minutes)', () {
      expect(
        ScheduleTimeValidation.validate(now.add(const Duration(minutes: 30)), now: now, minLeadMinutes: 20),
        isNull,
      );
    });
  });
}
