import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_header.dart';
import 'package:goParcel/services/wallet_balance_service.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

void main() {
  group('parseWalletBalance', () {
    test('reads wallet_balance when Result is true', () {
      expect(parseWalletBalance({'Result': true, 'wallet_balance': '240.5'}), 240.5);
      expect(parseWalletBalance({'Result': 'true', 'wallet_balance': 10}), 10.0);
    });
    test('null when Result is false, response is null or balance is junk', () {
      expect(parseWalletBalance({'Result': 'false', 'wallet_balance': '240'}), isNull);
      expect(parseWalletBalance(null), isNull);
      expect(parseWalletBalance({'Result': true, 'wallet_balance': 'abc'}), isNull);
    });
  });

  test('header shows the confirmed pickup when there is one, else the GPS address', () {
    expect(HomeHeader.pickupLine(confirmedPickup: 'Sector 50', gpsAddress: 'Sector 18'), 'Sector 50');
    expect(HomeHeader.pickupLine(confirmedPickup: null, gpsAddress: 'Sector 18'), 'Sector 18');
  });

  testWidgets('header background is solid brand orange', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () {})));
    final boxes = tester.widgetList<DecoratedBox>(
        find.descendant(of: find.byType(HomeHeader), matching: find.byType(DecoratedBox)));
    expect(boxes.any((b) => (b.decoration as BoxDecoration).color == const Color(0xFFFF6B35)), isTrue);
  });

  testWidgets('title uses the dark onBrand colour', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () {})));
    final title = tester.widget<Text>(find.text('Move anything,\nanywhere'));
    expect(title.style?.color, const Color(0xFF1A0B04));
  });

  testWidgets('header asks for dark status-bar icons on orange', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () {})));
    final region = tester.widget<AnnotatedRegion<SystemUiOverlayStyle>>(
        find.descendant(of: find.byType(HomeHeader), matching: find.byType(AnnotatedRegion<SystemUiOverlayStyle>)));
    expect(region.value.statusBarIconBrightness, Brightness.dark);
  });

  testWidgets('missing H1 art shows its placeholder, no error', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () {})));
    await tester.pumpAndSettle();
    expect(find.text('H1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping notifications calls onNotificationTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () => taps++)));
    await tester.tap(find.bySemanticsLabel('Notifications'));
    expect(taps, 1);
  });

  testWidgets('width 320, textScale 1.3 with wallet does not overflow', (tester) async {
    await tester.pumpWidget(_host(
      HomeHeader(onNotificationTap: () {}, walletBalance: 12450, onWalletTap: () {}),
      width: 320,
      textScale: 1.3,
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('wallet chip hidden when walletBalance is null; shown and tappable when set', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () {})));
    expect(find.textContaining('₹'), findsNothing);

    var taps = 0;
    await tester.pumpWidget(_host(HomeHeader(onNotificationTap: () {}, walletBalance: 240, onWalletTap: () => taps++)));
    expect(find.text('₹240'), findsOneWidget);
    await tester.tap(find.text('₹240'));
    expect(taps, 1);
  });
}
