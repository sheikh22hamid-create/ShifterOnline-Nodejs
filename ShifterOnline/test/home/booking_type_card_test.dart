import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/booking_type_card.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width - 32, child: child))),
      ),
    );

void main() {
  testWidgets('now shows "Now" and no Change', (tester) async {
    await tester.pumpWidget(_host(BookingTypeCard(bookingType: 1, radiusKm: 3, onRadiusTap: () {})));
    expect(find.text('Now'), findsOneWidget);
    expect(find.text('Change'), findsNothing);
  });

  testWidgets('schedule shows the label and Change calls onChangeSchedule', (tester) async {
    var changes = 0;
    await tester.pumpWidget(_host(BookingTypeCard(
      bookingType: 2,
      scheduleLabel: 'Fri, 20 Nov · 10:30 AM',
      onChangeSchedule: () => changes++,
      radiusKm: 3,
      onRadiusTap: () {},
    )));
    expect(find.text('Schedule'), findsOneWidget);
    expect(find.text('Fri, 20 Nov · 10:30 AM'), findsOneWidget);
    await tester.tap(find.text('Change'));
    await tester.pumpAndSettle();
    expect(changes, 1);
  });

  testWidgets('schedule with no time yet shows "Pick pickup date & time"', (tester) async {
    var changes = 0;
    await tester.pumpWidget(_host(BookingTypeCard(
        bookingType: 2, onChangeSchedule: () => changes++, radiusKm: 3, onRadiusTap: () {})));
    await tester.tap(find.text('Pick pickup date & time'));
    await tester.pumpAndSettle();
    expect(changes, 1);
  });

  testWidgets('low fare shows "Low Fare" and the lowFareChild, no Change', (tester) async {
    await tester.pumpWidget(_host(BookingTypeCard(
        bookingType: 3, radiusKm: 3, onRadiusTap: () {}, lowFareChild: const Text('low-fare-pickers'))));
    expect(find.text('Low Fare'), findsOneWidget);
    expect(find.text('low-fare-pickers'), findsOneWidget);
    expect(find.text('Change'), findsNothing);
  });

  testWidgets('radius row shows "Driver search area · 3 km" and tapping calls onRadiusTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(BookingTypeCard(bookingType: 1, radiusKm: 3, onRadiusTap: () => taps++)));
    await tester.tap(find.text('Driver search area · 3 km'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('no overflow at textScale 1.3 on 360dp', (tester) async {
    await tester.pumpWidget(_host(
        BookingTypeCard(
            bookingType: 2,
            scheduleLabel: 'Wed, 30 Dec 2026 · 10:30 AM',
            onChangeSchedule: () {},
            radiusKm: 12,
            onRadiusTap: () {}),
        width: 360,
        textScale: 1.3));
    expect(tester.takeException(), isNull);
  });

  test('low fare quote shows only for Low Fare, with a quote, after a delivery option is chosen', () {
    expect(BookingTypeCard.showLowFareQuote(bookingType: 3, hasQuote: true, modelChosen: true), isTrue);
    // Switching vehicle clears the model until the new quote is in: never show the old vehicle's price.
    expect(BookingTypeCard.showLowFareQuote(bookingType: 3, hasQuote: true, modelChosen: false), isFalse);
    expect(BookingTypeCard.showLowFareQuote(bookingType: 3, hasQuote: false, modelChosen: true), isFalse);
    expect(BookingTypeCard.showLowFareQuote(bookingType: 1, hasQuote: true, modelChosen: true), isFalse);
  });
}
