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

  testWidgets('while the overlay shows, taps do not reach the screen below (no blind Back)', (t) async {
    var taps = 0;
    await t.pumpWidget(_app(Stack(children: [
      Positioned.fill(child: TextButton(onPressed: () => taps++, child: const Text('Back'))),
      const Positioned.fill(child: BookingConfirmedOverlay()),
    ])));
    await t.pump(const Duration(milliseconds: 300));
    await t.tapAt(t.getCenter(find.byType(TextButton)));
    expect(taps, 0);
    await t.pump(const Duration(seconds: 3));
    await t.tap(find.text('Back'));
    expect(taps, 1);
  });

  testWidgets('pinned cancel bar: always shown, calls back, spinner while cancelling', (t) async {
    var n = 0;
    await t.pumpWidget(_app(Align(alignment: Alignment.bottomCenter, child: CancelBookingBar(cancelling: false, onCancel: () => n++))));
    await t.tap(find.text('Cancel booking'));
    expect(n, 1);
    await t.pumpWidget(_app(Align(alignment: Alignment.bottomCenter, child: CancelBookingBar(cancelling: true, onCancel: () => n++))));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('Need help shows a spinner and ignores taps while the number loads', (t) async {
    var help = 0;
    await t.pumpWidget(_app(WaitingFareCard(fare: '₹154', saved: 0, helpBusy: true, onHelp: () => help++)));
    expect(find.byKey(const ValueKey('help-busy')), findsOneWidget);
    expect(find.text('Contact Support'), findsNothing);
    await t.tap(find.text('Need help?'));
    expect(help, 0);
  });

  testWidgets('trip card without a fare shows the order id alone (fare lives in the fare card)', (t) async {
    await t.pumpWidget(_app(const WaitingTripCard(vehicle: 'Tata Ace', orderId: '42')));
    expect(find.text('Order #42'), findsOneWidget);
  });
}
