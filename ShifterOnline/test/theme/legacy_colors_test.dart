import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/legacy_color_map.dart';

/// Files the v2 restyle has swept: they must not regain hard-coded legacy colours.
const _swept = <String>[
  'lib/screens/home/waiting_screen.dart',
  'lib/screens/myorder/widgets/trip_complete_widgets.dart',
  'lib/screens/myorder/trackingway.dart',
  'lib/screens/authscreen/signin.dart',
  'lib/screens/authscreen/verification.dart',
  'lib/screens/authscreen/complete_profile.dart',
  'lib/screens/home/widgets/finding_driver_widgets.dart',
  'lib/screens/home/widgets/home_recent_places.dart',
];

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

  test('swept files never force the light palette (dark mode must follow the app switch)', () {
    for (final path in _swept) {
      final src = File(path).readAsStringSync();
      expect(src.contains('AppPalette.light'), isFalse, reason: path);
    }
  });

  test('light-only surfaces: white backgrounds and pure-black text are flagged; icons and overlays are not', () {
    const src = 'backgroundColor: Colors.white,\n'
        'decoration: BoxDecoration(\n  color: Colors.white,\n'
        'style: TextStyle(color: Colors.black)\n'
        'Icon(Icons.check, color: Colors.white)\n'
        'backgroundColor: Colors.black87, colorText: Colors.white\n'
        'BoxShadow(color: Colors.black.withValues(alpha: 0.1))';
    expect(lightOnlySurfaceViolations(src).length, 3);
  });

  test('swept files have no light-only surfaces (text follows dark mode, so backgrounds must too)', () {
    for (final path in _swept) {
      final v = lightOnlySurfaceViolations(File(path).readAsStringSync());
      expect(v, isEmpty, reason: '$path:\n${v.join('\n')}');
    }
  });

  test('dark-mode text check flags blue, black87 text, dark Material shades and AuthTokens; not shadows', () {
    const src = 'color: Colors.blue.shade50,\n'
        'style: TextStyle(color: Colors.black87),\n'
        'Text(x, style: TextStyle(color: Colors.red.shade800)),\n'
        'fillColor: AuthTokens.inputFill,\n'
        'BoxShadow(color: Colors.black87.withValues(alpha: 0.1)),\n'
        'barrierColor: Colors.black54,';
    expect(darkModeTextViolations(src).length, 4);
  });

  test('swept files pass the dark-mode text check', () {
    for (final path in _swept) {
      final v = darkModeTextViolations(File(path).readAsStringSync());
      expect(v, isEmpty, reason: '$path:\n${v.join('\n')}');
    }
  });
}
