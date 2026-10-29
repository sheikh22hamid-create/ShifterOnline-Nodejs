import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/services/low_fare_api_service.dart';

void main() {
  group('LowFareWindow', () {
    final base = LowFareWindow(date: DateTime(2026, 11, 3), from: const TimeOfDay(hour: 14, minute: 0), until: const TimeOfDay(hour: 16, minute: 30));

    test('sends date and times as plain zero-padded text', () {
      expect(base.toBody(), {'low_fare_date': '2026-11-03', 'low_fare_from': '14:00', 'low_fare_until': '16:30'});
      final early = LowFareWindow(date: DateTime(2026, 1, 5), from: const TimeOfDay(hour: 8, minute: 5), until: const TimeOfDay(hour: 9, minute: 0));
      expect(early.toBody(), {'low_fare_date': '2026-01-05', 'low_fare_from': '08:05', 'low_fare_until': '09:00'});
    });

    test('is incomplete until date, start and end are all chosen', () {
      expect(const LowFareWindow().isComplete, isFalse);
      expect(LowFareWindow(date: DateTime(2026, 11, 3), from: const TimeOfDay(hour: 9, minute: 0)).isComplete, isFalse);
      expect(base.isComplete, isTrue);
      expect(const LowFareWindow().problem(maxWindowHours: 12), 'Choose a date and a pickup time window first.');
    });

    test('catches a backwards or too-long window with the same words as the server', () {
      final backwards = LowFareWindow(date: DateTime(2026, 11, 3), from: const TimeOfDay(hour: 16, minute: 0), until: const TimeOfDay(hour: 14, minute: 0));
      expect(backwards.problem(maxWindowHours: 12), 'End time must be after the start time');
      final tooLong = LowFareWindow(date: DateTime(2026, 11, 3), from: const TimeOfDay(hour: 6, minute: 0), until: const TimeOfDay(hour: 19, minute: 0));
      expect(tooLong.problem(maxWindowHours: 12), 'The time window cannot be longer than 12 hours');
      expect(base.problem(maxWindowHours: 12), isNull);
    });
  });
}
