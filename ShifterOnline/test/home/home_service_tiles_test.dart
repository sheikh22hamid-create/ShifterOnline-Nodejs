import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_service_tiles.dart';
import 'package:goParcel/theme/widgets/v2_art.dart';

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

  for (final scale in [1.0, 1.3]) {
    testWidgets('labels are never cut off on a 360dp phone at textScale $scale', (tester) async {
      await tester.pumpWidget(_host(
          HomeServiceTiles(onBookNow: () {}, onSchedule: () {}, onLowFare: () {}, onCustomise: () {}),
          width: 360,
          textScale: scale));
      await tester.pumpAndSettle();
      for (final l in ['Book Now', 'Schedule', 'Low Fare', 'Customise Order']) {
        final para = tester.renderObject<RenderParagraph>(find.text(l));
        expect(para.didExceedMaxLines, isFalse, reason: l);
      }
    });
  }

  testWidgets('width 320, textScale 1.3 does not overflow; tile art shows', (tester) async {
    await tester.pumpWidget(_host(
        HomeServiceTiles(onBookNow: () {}, onSchedule: () {}, onLowFare: () {}, onCustomise: () {}),
        width: 320,
        textScale: 1.3));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byWidgetPredicate((w) => w is V2Art && w.asset == 'assets/v2/tile_book_now.png'), findsOneWidget);
  });
}
