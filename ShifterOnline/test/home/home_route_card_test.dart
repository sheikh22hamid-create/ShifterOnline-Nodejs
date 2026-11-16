import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_route_card.dart';
import 'package:goParcel/theme/app_tokens.dart';

class _Calls {
  final log = <String>[];
  VoidCallback cb(String name) => () => log.add(name);
}

Widget _host(Widget child,
        {double width = 390, double textScale = 1, TextDirection dir = TextDirection.ltr}) =>
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 900), textScaler: TextScaler.linear(textScale)),
        child: Directionality(
          textDirection: dir,
          child: Scaffold(
            body: SingleChildScrollView(
              child: Padding(padding: const EdgeInsets.all(16), child: child),
            ),
          ),
        ),
      ),
    );

HomeRouteCard _card(
  _Calls c, {
  String? pickup = 'Sector 18, Noida',
  String? drop,
  List<String> stops = const [],
  bool canAddStop = true,
  int bookingType = 1,
  bool scheduleEnabled = true,
}) =>
    HomeRouteCard(
      pickupAddress: pickup,
      dropAddress: drop,
      stops: stops,
      canAddStop: canAddStop,
      bookingType: bookingType,
      scheduleEnabled: scheduleEnabled,
      onPickupTap: c.cb('pickup'),
      onDropTap: c.cb('drop'),
      onStopTap: (i) => c.log.add('stop$i'),
      onStopDelete: (i) => c.log.add('delete$i'),
      onAddStop: c.cb('add'),
      onNow: c.cb('now'),
      onSchedule: c.cb('schedule'),
      onLowFare: c.cb('lowfare'),
      onChooseVehicle: c.cb('vehicle'),
    );

void main() {
  testWidgets('null pickup shows detecting text, null drop shows placeholder and no Choose vehicle', (tester) async {
    await tester.pumpWidget(_host(_card(_Calls(), pickup: null)));
    expect(find.text('Detecting current location...'), findsOneWidget);
    expect(find.text('Where is it going?'), findsOneWidget);
    expect(find.text('Choose vehicle'), findsNothing);
  });

  testWidgets('drop set shows Choose vehicle and tapping it calls onChooseVehicle', (tester) async {
    final c = _Calls();
    await tester.pumpWidget(_host(_card(c, drop: 'Sector 63, Noida')));
    await tester.tap(find.text('Choose vehicle'));
    await tester.pumpAndSettle();
    expect(c.log, ['vehicle']);
  });

  testWidgets('each row calls its own callback', (tester) async {
    final c = _Calls();
    await tester.pumpWidget(_host(_card(c, drop: 'Sector 63', stops: const ['Stop A', 'Stop B'])));
    await tester.tap(find.text('Sector 18, Noida'));
    await tester.tap(find.text('Sector 63'));
    await tester.tap(find.text('Stop B'));
    await tester.tap(find.bySemanticsLabel('Remove stop 1'));
    await tester.tap(find.bySemanticsLabel('Add a stop'));
    await tester.pumpAndSettle();
    expect(c.log, ['pickup', 'drop', 'stop1', 'delete0', 'add']);
  });

  testWidgets('canAddStop false hides + Stop', (tester) async {
    await tester.pumpWidget(_host(_card(_Calls(), canAddStop: false)));
    expect(find.bySemanticsLabel('Add a stop'), findsNothing);
  });

  testWidgets('scheduleEnabled false hides Schedule segment', (tester) async {
    await tester.pumpWidget(_host(_card(_Calls(), scheduleEnabled: false)));
    expect(find.text('Schedule'), findsNothing);
    expect(find.text('Now'), findsOneWidget);
    expect(find.text('Low Fare'), findsOneWidget);
  });

  testWidgets('segments call onNow / onSchedule / onLowFare', (tester) async {
    final c = _Calls();
    await tester.pumpWidget(_host(_card(c)));
    await tester.tap(find.text('Now'));
    await tester.tap(find.text('Schedule'));
    await tester.tap(find.text('Low Fare'));
    await tester.pumpAndSettle();
    expect(c.log, ['now', 'schedule', 'lowfare']);
  });

  testWidgets('selected segment follows bookingType', (tester) async {
    await tester.pumpWidget(_host(_card(_Calls(), bookingType: 3)));
    final selected = tester.widgetList<AnimatedContainer>(find.ancestor(
        of: find.text('Low Fare'), matching: find.byType(AnimatedContainer)));
    final deco = selected.first.decoration as BoxDecoration;
    expect((deco.border as Border).top.color, AppPalette.light.brand);
  });

  testWidgets('RTL, width 320, textScale 1.3 with 3 stops does not overflow', (tester) async {
    await tester.pumpWidget(_host(
      _card(_Calls(),
          pickup: 'Plot 7, C Block, Sector 63, Noida, Uttar Pradesh 201301',
          drop: 'Gaur City Mall, Greater Noida West, Uttar Pradesh',
          stops: const ['Okhla Phase 2, New Delhi', 'Sector 62, Noida', 'Sector 50, Noida']),
      width: 320,
      textScale: 1.3,
      dir: TextDirection.rtl,
    ));
    expect(tester.takeException(), isNull);
  });
}
