import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/myorder/tracking_rules.dart';

void main() {
  test('cancelled order with no driver hides the rider card', () {
    expect(showRiderCard(status: 'Cancelled', riderId: ''), isFalse);
    expect(showRiderCard(status: 'cancel', riderId: '0'), isFalse);
    expect(showRiderCard(status: 'Cancelled', riderId: 'null'), isFalse);
  });

  test('cancelled order that had a driver keeps the driver card', () {
    expect(showRiderCard(status: 'Cancelled', riderId: '42'), isTrue);
  });

  test('active order without a driver still shows the searching card', () {
    expect(showRiderCard(status: 'Pending', riderId: ''), isTrue);
    expect(showRiderCard(status: 'Processing', riderId: '0'), isTrue);
  });

  test('feedback sheet auto-opens only once, but a tap always opens it', () {
    expect(canOpenFeedback(shownBefore: false, manual: false), isTrue);
    expect(canOpenFeedback(shownBefore: true, manual: false), isFalse);
    expect(canOpenFeedback(shownBefore: true, manual: true), isTrue);
  });

  test('order date from the server (UTC) is shown in the phone local time', () {
    const raw = '2026-11-16T15:05:33.000Z';
    final local = DateTime.parse(raw).toLocal();
    final hh = (local.hour % 12 == 0 ? 12 : local.hour % 12).toString().padLeft(2, '0');
    expect(formatOrderDate(raw), contains('$hh:${local.minute.toString().padLeft(2, '0')}'));
    expect(formatOrderDate(''), '');
    expect(formatOrderDate(null), '');
    expect(formatOrderDate('not a date'), 'not a date');
  });

  test('completed order with a driver shows the card', () {
    expect(showRiderCard(status: 'Completed', riderId: '7'), isTrue);
  });
}
