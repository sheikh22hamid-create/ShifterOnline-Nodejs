import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/gstin_format.dart';

void main() {
  group('gstinProblem', () {
    test('accepts well-formed GSTINs (two publicly documented samples)', () {
      expect(gstinProblem('27AAPFU0939F1ZV'), isNull);
      expect(gstinProblem('07AAGFF2194N1Z1'), isNull);
    });

    test('cleans case, spaces and dashes before checking', () {
      expect(gstinProblem(' 27aapfu0939f1zv '), isNull);
      expect(gstinProblem('27-AAPFU-0939-F1ZV'), isNull);
      expect(normalizeGstin(' 27aa pfu-0939f1zv '), '27AAPFU0939F1ZV');
    });

    test('says what is wrong', () {
      expect(gstinProblem('27AAPFU0939F1Z'), contains('15 characters'));
      expect(gstinProblem('27AAPFU0939F1AV'), contains('format'));
      expect(gstinProblem('00AAPFU0939F1Z5'), contains('state code'));
      expect(gstinProblem('27AAPFU0939F1ZW'), contains('check digit'));
      expect(gstinProblem(''), isNotNull);
      expect(gstinProblem(null), isNotNull);
    });

    test('a number built with the algorithm validates (synthetic)', () {
      const first14 = '29AABCT1332L1Z';
      expect(gstinProblem(first14 + gstinCheckChar(first14)), isNull);
    });

    test('check char matches the known samples', () {
      expect(gstinCheckChar('27AAPFU0939F1Z'), 'V');
      expect(gstinCheckChar('07AAGFF2194N1Z'), '1');
    });
  });
}
