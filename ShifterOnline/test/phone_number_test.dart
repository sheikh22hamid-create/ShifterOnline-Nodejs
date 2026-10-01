import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/phone_number.dart';

void main() {
  group('normalizeIndianMobile', () {
    test('plain 10 digit number is unchanged', () {
      expect(normalizeIndianMobile('9770798272'), '9770798272');
    });

    test('strips spaces, dashes and brackets', () {
      expect(normalizeIndianMobile('98765-43210'), '9876543210');
      expect(normalizeIndianMobile('(98765) 43210'), '9876543210');
    });

    test('drops the +91 / 91 country code', () {
      expect(normalizeIndianMobile('+91 98765 43210'), '9876543210');
      expect(normalizeIndianMobile('919876543210'), '9876543210');
      expect(normalizeIndianMobile('0091 9876543210'), '9876543210');
    });

    test('drops a leading trunk 0', () {
      expect(normalizeIndianMobile('09876543210'), '9876543210');
    });

    test('keeps the last 10 digits of anything longer', () {
      expect(normalizeIndianMobile('+1 (555) 123 98765 43210'), '9876543210');
    });

    test('short or non-numeric input does not crash', () {
      expect(normalizeIndianMobile(null), '');
      expect(normalizeIndianMobile(''), '');
      expect(normalizeIndianMobile('abc'), '');
      expect(normalizeIndianMobile('12345'), '12345');
    });
  });
}
