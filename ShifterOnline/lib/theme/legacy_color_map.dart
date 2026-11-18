/// v2 restyle sweep (Plan 5): every legacy hard-coded colour / colour getter → the AppPalette token
/// that replaces it. One source of truth for the sweep script and the guard test.
library;

/// ARGB literal → `AppPalette` field name.
const Map<int, String> kLegacyHexToToken = {
  // brand orange (old #FA4500 / #FF6D00 too)
  0xFFFF6B35: 'brand', 0xFFFA4500: 'brand', 0xFFFF6D00: 'brand',
  0xFFB83C0C: 'brandText',
  0xFFFFF7F2: 'brandTint', 0xFFFFF3E8: 'brandTint', 0xFFFFE3D3: 'brandTint',
  // ink
  0xFF15171C: 'ink', 0xFF111827: 'ink', 0xFF1F2937: 'ink',
  0xFF636977: 'inkMuted', 0xFF6B7280: 'inkMuted', 0xFF4B5563: 'inkMuted',
  0xFF94A3B8: 'inkSubtle', 0xFF9CA3AF: 'inkSubtle',
  // surfaces / lines
  0xFFF8FAFC: 'canvas', 0xFFF3F4F6: 'canvas', 0xFFF9FAFB: 'canvas', 0xFFFAFAFA: 'canvas',
  0xFFE5E7EB: 'line', 0xFFD1D5DB: 'line', 0xFFCFD6DC: 'line', 0xFFE2E8F0: 'line',
  // success
  0xFF16A34A: 'success', 0xFF059669: 'success', 0xFF1B7F47: 'success',
  0xFF15803D: 'successText', 0xFF065F46: 'successText', 0xFF166534: 'successText',
  0xFFECFDF3: 'successTint', 0xFFECFDF5: 'successTint', 0xFFF0FDF4: 'successTint',
  0xFFDCFCE7: 'successTint', 0xFFBBE5C8: 'successTint', 0xFFA7F3D0: 'successTint',
  // danger
  0xFFB42318: 'danger',
  0xFFFFF4F2: 'dangerTint', 0xFFF8CFC7: 'dangerTint',
  // warning
  0xFFE08A00: 'warning', 0xFFFFC107: 'warning', 0xFFFFC857: 'warning', 0xFFFFC96E: 'warning',
  0xFFFFFBEB: 'warningTint', 0xFFFFF4E5: 'warningTint', 0xFFFFE082: 'warningTint', 0xFFFFCC80: 'warningTint',
  // blue is not allowed (spec §2) → brand family
  0xFF2979FF: 'brandText', 0xFF4C8DFF: 'brandText', 0xFF0D47A1: 'brandText',
  0xFFEBF3FF: 'brandTint', 0xFFF2F7FF: 'brandTint', 0xFFD3E3FF: 'brandTint',
  // text on orange
  0xFF1A0B04: 'onBrand',
};

/// Legacy colour globals / ColorNotifier getters → `AppPalette` field name.
const Map<String, String> kLegacyGetterToToken = {
  'linercolor': 'brand',
  'litelinercolor': 'brandTint',
  'notifier.appBlueColor': 'brand',
  'notifier.darklinercolor': 'brandText',
  'notifier.text': 'ink',
  'notifier.getBgColor': 'surface',
  'notifier.getContainer': 'surface',
  'notifier.lightBgColor': 'canvas',
  'notifier.getimag': 'canvas',
  'notifier.lightThemColor': 'canvas',
  'notifier.getlightContainer': 'canvas',
  'notifier.bordecolor': 'line',
};

/// Literals that stay as they are (brand colours of other apps).
const Set<int> kAllowedLiteralColors = {0xFF25D366};

final RegExp _hex = RegExp(r'Color\(0x([0-9A-Fa-f]{8})\)');
final RegExp _getter = RegExp(r'\b(' +
    kLegacyGetterToToken.keys.map((k) => RegExp.escape(k)).join('|') +
    r')\b');

/// Every legacy colour left in [source], as "line N: match". Allowed: [kAllowedLiteralColors],
/// any-alpha black (0x..000000) and any-alpha white (0x..FFFFFF).
List<String> legacyColorViolations(String source) {
  final out = <String>[];
  final lines = source.split('\n');
  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];
    for (final m in _hex.allMatches(line)) {
      final value = int.parse(m.group(1)!, radix: 16);
      final rgb = value & 0xFFFFFF;
      if (kAllowedLiteralColors.contains(value) || rgb == 0x000000 || rgb == 0xFFFFFF) continue;
      out.add('line ${i + 1}: ${m.group(0)}');
    }
    for (final m in _getter.allMatches(line)) {
      out.add('line ${i + 1}: ${m.group(0)}');
    }
  }
  return out;
}

final RegExp _whiteBg = RegExp(r'backgroundColor:\s*Colors\.white\b(?![0-9.])');
final RegExp _whiteBoxColor = RegExp(r'^\s*color:\s*Colors\.white,\s*$');
final RegExp _pureBlack = RegExp(r'Colors\.black\b(?![0-9.])');

/// Once text reads `AppPalette.current.ink` (light in dark mode), a hard-coded white background or pure-black
/// text becomes unreadable in dark mode. Flags `backgroundColor: Colors.white`, a `BoxDecoration(` whose
/// colour is `Colors.white`, and plain `Colors.black` (not black87/black12/withOpacity shadows).
List<String> lightOnlySurfaceViolations(String source) {
  final out = <String>[];
  final lines = source.split('\n');
  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];
    if (_whiteBg.hasMatch(line) ||
        (_whiteBoxColor.hasMatch(line) && i > 0 && lines[i - 1].contains('BoxDecoration(')) ||
        (_pureBlack.hasMatch(line) && !line.toLowerCase().contains('shadow'))) {
      out.add('line ${i + 1}: ${line.trim()}');
    }
  }
  return out;
}
