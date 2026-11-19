import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/finding_driver_widgets.dart';

Widget _app(Widget child, {bool reduce = false}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: reduce),
        child: Scaffold(body: child),
      ),
    );

void main() {
  testWidgets('booking confirmed overlay shows, then removes itself', (t) async {
    await t.pumpWidget(_app(const BookingConfirmedOverlay()));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Booking placed'), findsOneWidget);
    await t.pump(const Duration(seconds: 2));
    await t.pump(const Duration(milliseconds: 600));
    expect(find.text('Booking placed'), findsNothing);
  });

  testWidgets('booking confirmed overlay under reduce motion settles quickly', (t) async {
    await t.pumpWidget(_app(const BookingConfirmedOverlay(), reduce: true));
    await t.pump();
    expect(find.text('Booking placed'), findsOneWidget);
    await t.pumpAndSettle();
    await t.pump(const Duration(seconds: 1));
    await t.pumpAndSettle();
    expect(find.text('Booking placed'), findsNothing);
  });

  testWidgets('fare card: fare, saving only when real, and help', (t) async {
    var help = 0;
    await t.pumpWidget(_app(WaitingFareCard(fare: '₹154', saved: 0, onHelp: () => help++)));
    expect(find.text('₹154'), findsOneWidget);
    expect(find.textContaining('saved'), findsNothing);
    await t.tap(find.text('Need help?'));
    expect(help, 1);

    await t.pumpWidget(_app(WaitingFareCard(fare: '₹154', saved: 10, onHelp: () {})));
    expect(find.text('You saved ₹10 on this order'), findsOneWidget);
  });

  testWidgets('fare card without a fare shows only help', (t) async {
    await t.pumpWidget(_app(WaitingFareCard(fare: null, saved: 0, onHelp: () {})));
    expect(find.text('Total fare'), findsNothing);
    expect(find.text('Need help?'), findsOneWidget);
  });
}
