import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/myorder/widgets/trip_complete_widgets.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  test('initials from a driver name', () {
    expect(nameInitials('Ramesh Kumar'), 'RK');
    expect(nameInitials('  ramesh  '), 'R');
    expect(nameInitials('A B C'), 'AB');
    expect(nameInitials(''), '');
  });

  testWidgets('header shows delivered title and the subtitle', (t) async {
    await t.pumpWidget(_wrap(const TripCompleteHeader(subtitle: 'Order #48213 · 2:45 PM')));
    await t.pump(const Duration(seconds: 2));
    expect(find.text('Delivered successfully'), findsOneWidget);
    expect(find.text('Order #48213 · 2:45 PM'), findsOneWidget);
  });

  testWidgets('tapping the 4th star rates 4', (t) async {
    int? rated;
    await t.pumpWidget(_wrap(RateTripCard(
      driverName: 'Ramesh Kumar',
      vehicleName: 'Tata Ace',
      onRate: (r) => rated = r,
    )));
    expect(find.text('RK'), findsOneWidget);
    expect(find.text('Ramesh Kumar · Tata Ace'), findsOneWidget);
    await t.tap(find.bySemanticsLabel('Rate 4 stars'));
    expect(rated, 4);
  });

  testWidgets('rate card without driver name falls back to Delivery Partner', (t) async {
    await t.pumpWidget(_wrap(RateTripCard(driverName: '', vehicleName: '', onRate: (_) {})));
    expect(find.text('Delivery Partner'), findsOneWidget);
  });
}
