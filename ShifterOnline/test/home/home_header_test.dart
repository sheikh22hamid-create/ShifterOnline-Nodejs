import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_header.dart';
import 'package:goParcel/services/wallet_balance_service.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1, bool reduceMotion = false}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: Size(width, 844),
          textScaler: TextScaler.linear(textScale),
          disableAnimations: reduceMotion,
        ),
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

  testWidgets('tapping the address calls onLocationTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(HomeHeader(
        address: 'Sector 18, Noida', onLocationTap: () => taps++, onNotificationTap: () {})));
    await tester.tap(find.text('Sector 18, Noida'));
    expect(taps, 1);
  });

  testWidgets('tapping notifications calls onNotificationTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(HomeHeader(address: 'x', onLocationTap: () {}, onNotificationTap: () => taps++)));
    await tester.tap(find.bySemanticsLabel('Notifications'));
    expect(taps, 1);
  });

  testWidgets('null address shows "Location"', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(address: null, onLocationTap: () {}, onNotificationTap: () {})));
    expect(find.text('Location'), findsOneWidget);
  });

  testWidgets('long address at width 320, textScale 1.3 does not overflow', (tester) async {
    await tester.pumpWidget(_host(
      HomeHeader(
        address: 'Plot 7, C Block, Sector 63, Noida, Gautam Buddha Nagar, Uttar Pradesh 201301, India',
        onLocationTap: () {},
        onNotificationTap: () {},
        walletBalance: 12450,
        onWalletTap: () {},
      ),
      width: 320,
      textScale: 1.3,
    ));
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduce motion: truck does not animate', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(address: 'x', onLocationTap: () {}, onNotificationTap: () {}),
        reduceMotion: true));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('wallet chip hidden when walletBalance is null; shown and tappable when set', (tester) async {
    await tester.pumpWidget(_host(HomeHeader(address: 'x', onLocationTap: () {}, onNotificationTap: () {})));
    expect(find.textContaining('₹'), findsNothing);

    var taps = 0;
    await tester.pumpWidget(_host(HomeHeader(
        address: 'x', onLocationTap: () {}, onNotificationTap: () {}, walletBalance: 240, onWalletTap: () => taps++)));
    expect(find.text('₹240'), findsOneWidget);
    await tester.tap(find.text('₹240'));
    expect(taps, 1);
  });
}
