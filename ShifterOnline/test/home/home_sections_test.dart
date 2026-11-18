import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/home_option_tiles.dart';
import 'package:goParcel/screens/home/widgets/home_active_order_strip.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 900), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

void main() {
  testWidgets('active order strip: Track calls onTrack; message hidden when empty', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(HomeActiveOrderStrip(
        orderId: '48213', status: 'Driver on the way', message: '', onTrack: () => taps++)));
    expect(find.text('Order #48213'), findsOneWidget);
    expect(find.text('Driver on the way'), findsOneWidget);
    await tester.tap(find.text('Track'));
    await tester.pump(const Duration(milliseconds: 200)); // live dot repeats forever; don't settle
    expect(taps, 1);
    expect(find.byKey(const ValueKey('active-order-message')), findsNothing);
  });

  group('freeRideBannerCopy', () {
    test('locked: chance heading, referral line, progress', () {
      final c = freeRideBannerCopy(state: 'locked', message: '', referralsRequired: 2, referralsDone: 1);
      expect(c.heading, 'Your next booking could be free');
      expect(c.subtitle, 'Refer 1 more friend to unlock');
      expect(c.progress, 0.5);
    });
    test('locked with several left uses the plural line', () {
      final c = freeRideBannerCopy(state: 'locked', message: '', referralsRequired: 3, referralsDone: 0);
      expect(c.subtitle, 'Refer 3 more friends to unlock');
    });
    test('available: chance heading, no progress, never says first booking', () {
      final c = freeRideBannerCopy(state: 'available', message: '', referralsRequired: 0, referralsDone: 0);
      expect(c.heading, 'Your next booking could be free');
      expect(c.progress, isNull);
      expect('${c.heading} ${c.subtitle}'.toLowerCase(), isNot(contains('first booking')));
    });
    test('off: plain title with the server message or the fallback', () {
      expect(freeRideBannerCopy(state: 'offer_off', message: 'Not in your city', referralsRequired: 0, referralsDone: 0).subtitle,
          'Not in your city');
      expect(freeRideBannerCopy(state: 'offer_off', message: '', referralsRequired: 0, referralsDone: 0).subtitle,
          'Free Ride Chance is not available right now.');
    });
  });
}
