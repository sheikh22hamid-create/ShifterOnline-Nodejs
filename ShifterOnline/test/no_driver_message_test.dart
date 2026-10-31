import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/booking_guarantee.dart';

void main() {
  group('noDriverMessage', () {
    test('last model selected -> increase search radius', () {
      expect(noDriverMessage(0, lastModel: true), 'No driver found. Please increase search radius.');
    });
    test('earlier model selected -> increase models and search radius', () {
      expect(noDriverMessage(0, lastModel: false),
          'No driver found. Please increase the models and increase search radius.');
    });
    test('unknown keeps the original message', () {
      expect(noDriverMessage(0), 'No driver found. Please try again.');
    });
    test('guarantee compensation message is unchanged either way', () {
      expect(noDriverMessage(50, lastModel: true), 'No driver found. ₹50 has been added to your wallet.');
      expect(noDriverMessage(50, lastModel: false), 'No driver found. ₹50 has been added to your wallet.');
    });
  });
}
