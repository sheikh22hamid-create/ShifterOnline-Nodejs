import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/feature_intro_sheet.dart';
import 'package:goParcel/screens/home/widgets/home_service_tiles.dart';

Widget _host(Widget child, {double width = 360, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 900), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

void main() {
  test('every service has a title, tagline and 3 steps', () {
    for (final f in ServiceFeature.values) {
      final i = FeatureIntro.all[f]!;
      expect(i.title, isNotEmpty);
      expect(i.tagline, isNotEmpty);
      expect(i.steps, hasLength(3));
    }
  });

  testWidgets('sheet explains the service and Continue starts it', (t) async {
    var started = 0;
    await t.pumpWidget(MaterialApp(
      home: Builder(
        builder: (c) => Scaffold(
          body: TextButton(
            onPressed: () => showFeatureIntro(c, ServiceFeature.lowFare, onContinue: () => started++),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    expect(find.text('Low Fare'), findsOneWidget);
    expect(find.text('How it works'), findsOneWidget);
    expect(find.textContaining('Premium'), findsOneWidget);
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    expect(started, 1);
    expect(find.text('How it works'), findsNothing);
  });

  testWidgets('from ⓘ the sheet only explains: "Got it" closes it', (t) async {
    await t.pumpWidget(_host(const FeatureIntroSheet(feature: ServiceFeature.customise)));
    expect(find.text('Got it'), findsOneWidget);
    expect(find.text('Continue'), findsNothing);
  });

  testWidgets('sheet fits at 320 wide, text scale 1.3', (t) async {
    for (final f in ServiceFeature.values) {
      await t.pumpWidget(_host(FeatureIntroSheet(feature: f, onContinue: () {}), width: 320, textScale: 1.3));
      await t.pump();
      expect(t.takeException(), isNull, reason: f.name);
    }
  });

  testWidgets('tiles: ⓘ explains without starting the service', (t) async {
    ServiceFeature? info;
    var lowFare = 0;
    await t.pumpWidget(_host(HomeServiceTiles(
      onBookNow: () {},
      onSchedule: () {},
      onLowFare: () => lowFare++,
      onCustomise: () {},
      onInfo: (f) => info = f,
    )));
    expect(find.byIcon(Icons.info_outline_rounded), findsNWidgets(4));
    await t.tap(find.bySemanticsLabel('How it works: Low Fare'));
    expect(info, ServiceFeature.lowFare);
    expect(lowFare, 0);
  });

  testWidgets('tiles without onInfo show no ⓘ', (t) async {
    await t.pumpWidget(_host(HomeServiceTiles(onBookNow: () {}, onSchedule: () {}, onLowFare: () {}, onCustomise: () {})));
    expect(find.byIcon(Icons.info_outline_rounded), findsNothing);
  });
}
