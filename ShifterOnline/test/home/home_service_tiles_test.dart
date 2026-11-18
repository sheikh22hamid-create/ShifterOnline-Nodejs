import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_service_tiles.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width - 32, child: child))),
      ),
    );

void main() {
  testWidgets('each tile calls its own callback', (tester) async {
    final hits = [0, 0, 0, 0];
    await tester.pumpWidget(_host(HomeServiceTiles(
      onBookNow: () => hits[0]++,
      onSchedule: () => hits[1]++,
      onLowFare: () => hits[2]++,
      onCustomise: () => hits[3]++,
    )));
    for (final l in ['Book Now', 'Schedule', 'Low Fare', 'Customise Order']) {
      await tester.tap(find.text(l));
      await tester.pumpAndSettle();
    }
    expect(hits, [1, 1, 1, 1]);
  });

  testWidgets('schedule tile hidden when disabled', (tester) async {
    await tester.pumpWidget(_host(HomeServiceTiles(
        onBookNow: () {}, onSchedule: () {}, onLowFare: () {}, onCustomise: () {}, scheduleEnabled: false)));
    expect(find.text('Schedule'), findsNothing);
    for (final l in ['Book Now', 'Low Fare', 'Customise Order']) {
      expect(find.text(l), findsOneWidget);
    }
  });

  testWidgets('labels stay on one line', (tester) async {
    await tester.pumpWidget(_host(
        HomeServiceTiles(onBookNow: () {}, onSchedule: () {}, onLowFare: () {}, onCustomise: () {})));
    for (final l in ['Book Now', 'Schedule', 'Low Fare', 'Customise Order']) {
      expect(tester.widget<Text>(find.text(l)).maxLines, 1);
    }
  });

  testWidgets('width 320, textScale 1.3 does not overflow; art placeholders show', (tester) async {
    await tester.pumpWidget(_host(
        HomeServiceTiles(onBookNow: () {}, onSchedule: () {}, onLowFare: () {}, onCustomise: () {}),
        width: 320,
        textScale: 1.3));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('T1'), findsOneWidget);
  });
}
