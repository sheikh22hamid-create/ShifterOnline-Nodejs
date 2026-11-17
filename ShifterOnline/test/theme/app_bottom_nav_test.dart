import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/widgets/app_bottom_nav.dart';

const _tabs = [
  AppNavTab(label: 'Home', iconAsset: 'assets/home.svg', selectedIconAsset: 'assets/home_file.svg'),
  AppNavTab(label: 'Orders', iconAsset: 'assets/package_box.svg', selectedIconAsset: 'assets/package_box_file.svg'),
  AppNavTab(label: 'Wallet', iconAsset: 'assets/fast_delivery.svg', selectedIconAsset: 'assets/fast_delivery_file.svg'),
  AppNavTab(label: 'Account', iconAsset: 'assets/user-circle.svg', selectedIconAsset: 'assets/user-circle_file.svg'),
];

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: const SizedBox.expand(), bottomNavigationBar: child),
      ),
    );

void main() {
  testWidgets('tapping each tab reports its index; Book now calls onBookTap', (tester) async {
    final picked = <int>[];
    var book = 0;
    await tester.pumpWidget(_host(AppBottomNav(
        tabs: _tabs, selectedIndex: 0, onTabSelected: picked.add, onBookTap: () => book++)));
    for (final label in ['Home', 'Orders', 'Wallet', 'Account']) {
      await tester.tap(find.text(label));
    }
    await tester.tap(find.text('Book now'));
    await tester.pump();
    expect(picked, [0, 1, 2, 3]);
    expect(book, 1);
  });

  testWidgets('selected tab label is bold', (tester) async {
    await tester.pumpWidget(_host(AppBottomNav(
        tabs: _tabs, selectedIndex: 2, onTabSelected: (_) {}, onBookTap: () {})));
    expect(tester.widget<Text>(find.text('Wallet')).style?.fontFamily, 'Gilroy_Bold');
    expect(tester.widget<Text>(find.text('Home')).style?.fontFamily, 'Gilroy_Medium');
  });

  testWidgets('no overflow at width 320, textScale 1.3', (tester) async {
    await tester.pumpWidget(_host(
        AppBottomNav(tabs: _tabs, selectedIndex: 0, onTabSelected: (_) {}, onBookTap: () {}),
        width: 320,
        textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
