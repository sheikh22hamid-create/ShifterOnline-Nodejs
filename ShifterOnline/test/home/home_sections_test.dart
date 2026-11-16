import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/home_option_tiles.dart';
import 'package:goParcel/screens/home/widgets/home_active_order_strip.dart';
import 'package:goParcel/screens/home/widgets/home_more_grid.dart';
import 'package:goParcel/screens/home/widgets/home_vehicle_row.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 900), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

List<HomeMoreItem> _items(List<String> log) => [
      for (final label in ['Customise Order', 'Premium Plans', 'Refer & Earn', 'Favourite Drivers', 'Reward Points', 'Help & Support'])
        HomeMoreItem(
          label: label,
          icon: Icons.star_border,
          tint: const Color(0xFFFFF0E8),
          iconColor: const Color(0xFFD9480F),
          onTap: () => log.add(label),
        ),
    ];

void main() {
  testWidgets('vehicle row: empty list renders nothing; card tap calls onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(HomeVehicleRow(vehicles: const [], onTap: () => taps++)));
    expect(find.byType(Card), findsNothing);
    expect(find.text('Choose a vehicle'), findsNothing);

    await tester.pumpWidget(_host(HomeVehicleRow(
      vehicles: const [HomeVehicle(name: 'Tata Ace'), HomeVehicle(name: '3 Wheeler', subtitle: 'Cartons')],
      onTap: () => taps++,
    )));
    expect(find.text('Choose a vehicle'), findsOneWidget);
    await tester.tap(find.text('3 Wheeler'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('more grid: each tile calls its own onTap', (tester) async {
    final log = <String>[];
    await tester.pumpWidget(_host(HomeMoreGrid(items: _items(log))));
    await tester.tap(find.text('Premium Plans'));
    await tester.tap(find.text('Help & Support'));
    await tester.pumpAndSettle();
    expect(log, ['Premium Plans', 'Help & Support']);
  });

  testWidgets('more grid: width 320 textScale 1.3 no overflow', (tester) async {
    await tester.pumpWidget(_host(HomeMoreGrid(items: _items([])), width: 320, textScale: 1.3));
    expect(tester.takeException(), isNull);
  });

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
