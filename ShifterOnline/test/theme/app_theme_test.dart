import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/app_theme.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/contrast.dart';
import 'package:goParcel/utils/colors.dart';

void main() {
  final theme = buildAppTheme();
  final p = AppPalette.light;

  test('elevated buttons are brand with dark text', () {
    final style = theme.elevatedButtonTheme.style!;
    expect(style.backgroundColor!.resolve({}), p.brand);
    expect(style.foregroundColor!.resolve({}), p.onBrand);
  });

  test('app bars are light surface with ink content', () {
    expect(theme.appBarTheme.backgroundColor, p.surface);
    expect(theme.appBarTheme.foregroundColor, p.ink);
    expect(theme.appBarTheme.elevation, 0);
  });

  test('focused inputs use the brand border', () {
    final border = theme.inputDecorationTheme.focusedBorder as OutlineInputBorder;
    expect(border.borderSide.color, p.brand);
    expect(border.borderRadius, BorderRadius.circular(12));
  });

  test('cards are flat with radius 16', () {
    final shape = theme.cardTheme.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(16));
    expect(theme.cardTheme.elevation, 0);
  });

  test('keeps the app font and no splash', () {
    expect(theme.textTheme.bodyMedium?.fontFamily, 'Gilroy_Regular');
    expect(theme.splashColor, Colors.transparent);
    expect(theme.useMaterial3, isFalse);
  });

  test('inputs are not force-filled (screens with dark text colours keep their own background)', () {
    expect(theme.inputDecorationTheme.filled, isFalse);
  });

  test('greaycolor follows dark mode', () {
    notifier.setIsDark = true;
    addTearDown(() => notifier.setIsDark = false);
    expect(greaycolor, AppPalette.dark.inkSubtle);
  });

  test('global colour variables follow the tokens', () {
    expect(greaycolor, p.inkSubtle);
    expect(contrastRatio(greaycolor, Colors.white), greaterThanOrEqualTo(4.5));
    final n = ColorNotifier();
    expect(n.text, p.ink);
    expect(n.bordecolor, p.line);
  });
}
