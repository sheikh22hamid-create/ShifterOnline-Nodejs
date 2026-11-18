import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/legacy_color_map.dart';

/// Files the v2 restyle has swept: they must not regain hard-coded legacy colours.
const _swept = <String>[];

void main() {
  test('map covers every colour the plan table names', () {
    expect(kLegacyHexToToken[0xFFFA4500], 'brand');
    expect(kLegacyHexToToken[0xFF2979FF], 'brandText');
    expect(kLegacyHexToToken[0xFFECFDF3], 'successTint');
    expect(kLegacyHexToToken[0xFF1A0B04], 'onBrand');
    expect(kLegacyGetterToToken['notifier.bordecolor'], 'line');
    expect(kLegacyGetterToToken['linercolor'], 'brand');
  });

  test('violations finds hex, notifier getters and linercolor; ignores WhatsApp green, alpha black, white', () {
    const src = 'Color(0xFF16A34A) Color(0xff25D366) Color(0x28000000) Color(0xFFFFFFFF) notifier.text linercolor';
    expect(legacyColorViolations(src).length, 3);
  });

  test('swept files contain no legacy colours', () {
    for (final path in _swept) {
      final violations = legacyColorViolations(File(path).readAsStringSync());
      expect(violations, isEmpty, reason: '$path:\n${violations.take(20).join('\n')}');
    }
  });
}
