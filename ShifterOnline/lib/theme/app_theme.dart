import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_tokens.dart';

/// App-wide Material theme for the redesign. Every screen built from stock Material widgets (AppBar, buttons,
/// text fields, cards, dialogs, sheets, tabs, checkboxes, snackbars) picks this up without code changes.
/// Explicit colours a screen sets on a widget still win, so behaviour and special cases stay as they were.
ThemeData buildAppTheme() {
  final p = AppPalette.light;
  const bold = 'Gilroy_Bold';
  const medium = 'Gilroy_Medium';
  OutlineInputBorder border(Color c, double w) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: c, width: w));

  return ThemeData(
    fontFamily: 'Gilroy_Regular',
    useMaterial3: false,
    splashColor: Colors.transparent,
    hoverColor: Colors.transparent,
    highlightColor: Colors.transparent,
    primaryColor: p.brand,
    scaffoldBackgroundColor: p.canvas,
    dividerColor: p.divider,
    colorScheme: ColorScheme.light(
      primary: p.brand,
      onPrimary: p.onBrand,
      secondary: p.brand,
      onSecondary: p.onBrand,
      surface: p.surface,
      onSurface: p.ink,
      error: p.danger,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: p.surface,
      foregroundColor: p.ink,
      iconTheme: IconThemeData(color: p.ink),
      actionsIconTheme: IconThemeData(color: p.ink),
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: bold, fontSize: 18, color: p.ink),
      systemOverlayStyle: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.disabled) ? p.brand.withValues(alpha: 0.4) : p.brand),
        foregroundColor: WidgetStateProperty.all(p.onBrand),
        elevation: WidgetStateProperty.all(0),
        minimumSize: WidgetStateProperty.all(const Size(64, 48)),
        shape: WidgetStateProperty.all(RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        textStyle: WidgetStateProperty.all(const TextStyle(fontFamily: bold, fontSize: 15)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.ink,
        side: BorderSide(color: p.line),
        minimumSize: const Size(64, 44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontFamily: bold, fontSize: 14),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.brandText,
        textStyle: const TextStyle(fontFamily: bold, fontSize: 14),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: TextStyle(fontFamily: medium, fontSize: 14, color: p.inkSubtle),
      labelStyle: TextStyle(fontFamily: medium, fontSize: 13, color: p.inkMuted),
      border: border(p.line, 1),
      enabledBorder: border(p.line, 1),
      focusedBorder: border(p.brand, 1.5),
      errorBorder: border(p.danger, 1),
      focusedErrorBorder: border(p.danger, 1.5),
    ),
    cardTheme: CardThemeData(
      color: p.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: p.line)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      titleTextStyle: TextStyle(fontFamily: bold, fontSize: 18, color: p.ink),
      contentTextStyle: TextStyle(fontFamily: medium, fontSize: 14, color: p.inkMuted, height: 1.4),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.surface,
      modalBackgroundColor: p.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? p.brand : null),
      checkColor: WidgetStateProperty.all(p.onBrand),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? p.brand : p.inkSubtle),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? p.brand : null),
      trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.brand.withValues(alpha: 0.4) : null),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.brand),
    dividerTheme: DividerThemeData(color: p.divider, thickness: 1, space: 1),
    tabBarTheme: TabBarThemeData(
      indicatorColor: p.brand,
      labelColor: p.ink,
      unselectedLabelColor: p.inkSubtle,
      labelStyle: const TextStyle(fontFamily: bold, fontSize: 14),
      unselectedLabelStyle: const TextStyle(fontFamily: medium, fontSize: 14),
      indicator: UnderlineTabIndicator(borderSide: BorderSide(color: p.brand, width: 3)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.ink,
      contentTextStyle: const TextStyle(fontFamily: medium, fontSize: 14, color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(backgroundColor: p.brand, foregroundColor: p.onBrand),
    listTileTheme: ListTileThemeData(iconColor: p.ink, textColor: p.ink),
  );
}
