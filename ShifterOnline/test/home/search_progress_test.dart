import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/search_progress.dart';

void main() {
  final t = DateTime(2026, 11, 19, 10);

  test('fraction uses the order window when both ends are known', () {
    expect(
        searchFraction(
            start: t,
            deadline: t.add(const Duration(minutes: 10)),
            screenOpenedAt: t.add(const Duration(minutes: 4)),
            now: t.add(const Duration(minutes: 5))),
        closeTo(0.5, 1e-9));
  });

  test('fraction falls back to time on screen over 5 minutes when no deadline', () {
    expect(
        searchFraction(screenOpenedAt: t, now: t.add(const Duration(seconds: 150))),
        closeTo(0.5, 1e-9));
    expect(
        searchFraction(start: t, screenOpenedAt: t, now: t.add(const Duration(seconds: 150))),
        closeTo(0.5, 1e-9));
  });

  test('fraction is clamped', () {
    expect(
        searchFraction(
            start: t,
            deadline: t.add(const Duration(minutes: 1)),
            screenOpenedAt: t,
            now: t.add(const Duration(minutes: 9))),
        1.0);
    final f = searchFraction(
        start: t.add(const Duration(minutes: 5)),
        deadline: t,
        screenOpenedAt: t,
        now: t.add(const Duration(seconds: 30)));
    expect(f, closeTo(0.1, 1e-9));
    expect(searchFraction(screenOpenedAt: t, now: t.subtract(const Duration(minutes: 1))), 0.0);
  });

  test('stages switch at 20/50/80%', () {
    expect(searchStage(0.19), 0);
    expect(searchStage(0.2), 1);
    expect(searchStage(0.49), 1);
    expect(searchStage(0.5), 2);
    expect(searchStage(0.8), 3);
    expect(searchStage(1.0), 3);
  });

  test('bar starts at 4%, rises fast, never passes 96%', () {
    expect(searchBar(0), closeTo(0.04, 1e-9));
    expect(searchBar(0.2), greaterThan(0.4));
    expect(searchBar(1), lessThanOrEqualTo(0.96));
    var prev = -1.0;
    for (var i = 0; i <= 10; i++) {
      final v = searchBar(i / 10);
      expect(v, greaterThanOrEqualTo(prev));
      expect(v, lessThanOrEqualTo(0.96));
      prev = v;
    }
  });

  test('messages are the four approved lines', () {
    expect(kSearchStageMessages.length, 4);
    expect(kSearchStageMessages[0], 'Sending your order to nearby drivers.');
    expect(kSearchStageMessages[3],
        'Still looking. Your order stays active, no need to book again.');
  });
}
