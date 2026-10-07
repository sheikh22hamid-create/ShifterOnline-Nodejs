import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/booking_guarantee.dart';

void main() {
  test('parseGuaranteeAmount handles numbers, strings and junk', () {
    expect(parseGuaranteeAmount(100), 100.0);
    expect(parseGuaranteeAmount('250.50'), 250.5);
    expect(parseGuaranteeAmount(null), 0.0);
    expect(parseGuaranteeAmount('abc'), 0.0);
    expect(parseGuaranteeAmount(-5), 0.0);
  });

  test('guaranteeLine is hidden at zero and formats whole rupees without decimals', () {
    expect(guaranteeLine(0), isNull);
    expect(guaranteeLine(100), 'If no driver is found, you get ₹100');
    expect(guaranteeLine(100.5), 'If no driver is found, you get ₹100.50');
  });

  test('noDriverMessage mentions the wallet credit only when something was paid', () {
    expect(noDriverMessage(0), 'No driver found. Please try again.');
    expect(noDriverMessage(500), 'No driver found. ₹500 has been added to your wallet.');
  });
}
