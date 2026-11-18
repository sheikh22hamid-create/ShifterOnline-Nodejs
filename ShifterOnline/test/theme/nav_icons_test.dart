import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/nav_icons.dart';
import 'package:goParcel/theme/widgets/app_bottom_nav.dart';

void main() {
  test('every nav icon (outline + filled) exists as an SVG under assets/v2', () {
    for (final path in [for (final i in NavIcons.all) ...[i.outline, i.filled]]) {
      expect(path, startsWith('assets/v2/nav_'));
      final file = File(path);
      expect(file.existsSync(), isTrue, reason: path);
      expect(file.readAsStringSync(), contains('viewBox="0 0 24 24"'), reason: path);
    }
    expect(NavIcons.all.length, 4);
  });

  testWidgets('nav renders all four icons, filled for the selected tab', (tester) async {
    final tabs = [
      for (final (i, label) in [(NavIcons.home, 'Home'), (NavIcons.orders, 'Orders'), (NavIcons.wallet, 'Wallet'), (NavIcons.account, 'Account')])
        AppNavTab(label: label, iconAsset: i.outline, selectedIconAsset: i.filled),
    ];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: const SizedBox.expand(),
        bottomNavigationBar: AppBottomNav(tabs: tabs, selectedIndex: 1, onTabSelected: (_) {}),
      ),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final assets = tester
        .widgetList<SvgPicture>(find.byType(SvgPicture))
        .map((w) => (w.bytesLoader as SvgAssetLoader).assetName)
        .toList();
    expect(assets, [NavIcons.home.outline, NavIcons.orders.filled, NavIcons.wallet.outline, NavIcons.account.outline]);
  });
}
