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

  test('completed order with a driver shows the card', () {
    expect(showRiderCard(status: 'Completed', riderId: '7'), isTrue);
  });
}
