import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/contrast.dart';

void main() {
  test('light palette values match the spec', () {
    final p = AppPalette.of(false);
    expect(p.brand, const Color(0xFFFF6B35));
    expect(p.onBrand, const Color(0xFF1A0B04));
    expect(p.brandText, const Color(0xFFB83C0C));
    expect(p.canvas, const Color(0xFFF3F5F9));
    expect(p.surface, const Color(0xFFFFFFFF));
    expect(p.ink, const Color(0xFF15171C));
    expect(p.brandTint, const Color(0xFFFFF0E8));
  });

  test('text pairs pass WCAG AA 4.5:1 in light and dark', () {
    for (final dark in [false, true]) {
      final p = AppPalette.of(dark);
      expect(contrastRatio(p.onBrand, p.brand), greaterThanOrEqualTo(4.5), reason: 'onBrand dark=$dark');
      expect(contrastRatio(p.ink, p.surface), greaterThanOrEqualTo(4.5), reason: 'ink dark=$dark');
      expect(contrastRatio(p.inkMuted, p.surface), greaterThanOrEqualTo(4.5), reason: 'inkMuted dark=$dark');
      expect(contrastRatio(p.brandText, p.surface), greaterThanOrEqualTo(4.5), reason: 'brandText dark=$dark');
    }
  });

  test('card shadow is a soft 8px blur', () {
    expect(AppShadow.card.single.blurRadius, 8);
    expect(AppShadow.card.single.offset, const Offset(0, 2));
  });

  test('dark palette differs from light on surfaces and ink', () {
    expect(AppPalette.of(true).surface, isNot(AppPalette.of(false).surface));
    expect(AppPalette.of(true).ink, isNot(AppPalette.of(false).ink));
  });

  test('contrastRatio black on white is 21', () {
    expect(contrastRatio(Colors.black, Colors.white), closeTo(21, 0.01));
  });
}
