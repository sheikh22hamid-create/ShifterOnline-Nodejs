import 'package:flutter/material.dart';

import '../utils/colors.dart' show notifier;

/// Colour tokens for the redesigned customer app
/// (spec: docs/superpowers/specs/2026-11-16-customer-app-ui-redesign-design.md §5).
class AppPalette {
  const AppPalette._({
    required this.brand,
    required this.brandTint,
    required this.onBrand,
    required this.brandText,
    required this.canvas,
    required this.surface,
    required this.ink,
    required this.inkMuted,
    required this.inkSubtle,
    required this.line,
    required this.divider,
    required this.success,
    required this.successText,
    required this.successTint,
    required this.danger,
    required this.dangerTint,
    required this.warning,
    required this.warningTint,
    required this.navShadow,
  });

  final Color brand;
  final Color brandTint;
  /// Text and icons on [brand] — dark, never white (owner decision 2026-11-16).
  final Color onBrand;
  /// Orange-coloured text on [surface].
  final Color brandText;
  final Color canvas;
  final Color surface;
  final Color ink;
  final Color inkMuted;
  final Color inkSubtle;
  final Color line;
  final Color divider;
  final Color success;
  final Color successText;
  final Color successTint;
  final Color danger;
  final Color dangerTint;
  final Color warning;
  final Color warningTint;
  final Color navShadow;

  static const AppPalette light = AppPalette._(
    brand: Color(0xFFFF6B35),
    brandTint: Color(0xFFFFF0E8),
    onBrand: Color(0xFF1A0B04),
    brandText: Color(0xFFB83C0C),
    canvas: Color(0xFFF3F5F9),
    surface: Color(0xFFFFFFFF),
    ink: Color(0xFF15171C),
    inkMuted: Color(0xFF4B515E),
    inkSubtle: Color(0xFF636977),
    line: Color(0xFFE8E8E8),
    divider: Color(0xFFF0F0F0),
    success: Color(0xFF16A34A),
    successText: Color(0xFF15803D),
    successTint: Color(0xFFECFDF3),
    danger: Color(0xFFB42318),
    dangerTint: Color(0xFFFFF4F2),
    warning: Color(0xFF9A6700),
    warningTint: Color(0xFFFFFBEB),
    navShadow: Color(0x24783214),
  );

  static const AppPalette dark = AppPalette._(
    brand: Color(0xFFFF6B35),
    brandTint: Color(0xFF3A2216),
    onBrand: Color(0xFF1A0B04),
    brandText: Color(0xFFFF8A5C),
    canvas: Color(0xFF030303),
    surface: Color(0xFF252525),
    ink: Color(0xFFFFFFFF),
    inkMuted: Color(0xFFC9CDD4),
    inkSubtle: Color(0xFFA7ADB8),
    line: Color(0xFF414141),
    divider: Color(0xFF323233),
    success: Color(0xFF22C55E),
    successText: Color(0xFF4ADE80),
    successTint: Color(0xFF14261B),
    danger: Color(0xFFF97066),
    dangerTint: Color(0xFF2C1513),
    warning: Color(0xFFFBBF24),
    warningTint: Color(0xFF2A2210),
    navShadow: Color(0x66000000),
  );

  static AppPalette of(bool isDark) => isDark ? dark : light;

  /// Palette for the app's current theme (global [notifier] from utils/colors.dart).
  static AppPalette get current => of(notifier.getIsDark == true);
}

/// Soft card elevation (v2, Porter-style): no borders on main cards.
class AppShadow {
  static const List<BoxShadow> card = [
    BoxShadow(color: Color(0x0F101828), blurRadius: 8, offset: Offset(0, 2)),
  ];
}

class AppRadius {
  static const double chip = 8, input = 12, card = 16, hero = 20, sheet = 24;
}

class AppSpace {
  static const double xs = 4, s = 8, m = 12, l = 16, xl = 20, xxl = 24;
}

/// Text field look for the redesigned screens: rounded 12, thin line border, brand when focused.
InputDecoration appInputDecoration({String? label, String? hint, Widget? prefixIcon, Widget? suffixIcon}) {
  final p = AppPalette.current;
  OutlineInputBorder border(Color c, double w) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: c, width: w));
  return InputDecoration(
    labelText: label,
    hintText: hint,
    prefixIcon: prefixIcon,
    suffixIcon: suffixIcon,
    filled: true,
    fillColor: p.surface,
    labelStyle: AppText.caption(p.inkMuted).copyWith(fontSize: 13),
    hintStyle: AppText.body(p.inkSubtle).copyWith(fontSize: 14),
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    border: border(p.line, 1),
    enabledBorder: border(p.line, 1),
    focusedBorder: border(p.brand, 1.5),
    errorBorder: border(p.danger, 1),
    focusedErrorBorder: border(p.danger, 1.5),
  );
}

class AppText {
  static const String _regular = 'Gilroy_Regular';
  static const String _medium = 'Gilroy_Medium';
  static const String _bold = 'Gilroy_Bold';

  static TextStyle hero(Color c) => TextStyle(fontFamily: _bold, fontSize: 27, height: 1.2, color: c);
  static TextStyle title(Color c) => TextStyle(fontFamily: _bold, fontSize: 22, color: c);
  static TextStyle section(Color c) => TextStyle(fontFamily: _bold, fontSize: 17, color: c);
  static TextStyle body(Color c) => TextStyle(fontFamily: _medium, fontSize: 15, color: c);
  static TextStyle bodyStrong(Color c) => TextStyle(fontFamily: _bold, fontSize: 15, color: c);
  static TextStyle caption(Color c) => TextStyle(fontFamily: _medium, fontSize: 12, color: c);
  static TextStyle small(Color c) => TextStyle(fontFamily: _regular, fontSize: 12, color: c);
  static TextStyle navLabel(Color c, {required bool selected}) =>
      TextStyle(fontFamily: selected ? _bold : _medium, fontSize: 11, color: c);
}
