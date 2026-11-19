import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/finding_driver_widgets.dart';
import 'package:goParcel/screens/home/widgets/search_map.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

void main() {
  const a = LatLng(22.7300, 75.9000);
  const b = LatLng(22.7180, 75.8550);

  test('arc starts at pickup, ends at drop, and bows away from the straight line', () {
    final pts = arcBetween(a, b, segments: 40);
    expect(pts.length, 41);
    expect(pts.first, a);
    expect(pts.last, b);
    final mid = pts[20];
    final straight = LatLng((a.latitude + b.latitude) / 2, (a.longitude + b.longitude) / 2);
    final off = (mid.latitude - straight.latitude).abs() + (mid.longitude - straight.longitude).abs();
    expect(off, greaterThan(0.002), reason: 'a visible curve, like Porter');
  });

  test('arc between the same point is just that point', () {
    expect(arcBetween(a, a), [a]);
  });

  test('segment fills: three parts fill one after another', () {
    expect(segmentFills(0), [0, 0, 0]);
    expect(segmentFills(1 / 6), [closeTo(0.5, 1e-9), 0, 0]);
    expect(segmentFills(0.5), [1, closeTo(0.5, 1e-9), 0]);
    expect(segmentFills(0.96), [1, 1, closeTo(0.88, 1e-9)]);
  });

  testWidgets('searching card: title, message and three segments; late title', (t) async {
    Widget app(int stage) => MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: Scaffold(body: SearchingCard(bar: 0.5, stage: stage, message: 'Nearby drivers can see your order now.')),
          ),
        );
    await t.pumpWidget(app(1));
    await t.pumpAndSettle();
    expect(find.text('Searching for drivers nearby…'), findsOneWidget);
    expect(find.text('Nearby drivers can see your order now.'), findsOneWidget);
    expect(find.byKey(const Key('search-segment-0')), findsOneWidget);
    expect(find.byKey(const Key('search-segment-2')), findsOneWidget);
    expect(t.widget<FractionallySizedBox>(find.byKey(const Key('search-segment-1'))).widthFactor, closeTo(0.5, 1e-9));

    await t.pumpWidget(app(3));
    await t.pumpAndSettle();
    expect(find.text('Still searching for drivers nearby…'), findsOneWidget);
  });

  testWidgets('searching card animates when motion is allowed', (t) async {
    await t.pumpWidget(const MaterialApp(home: Scaffold(body: SearchingCard(bar: 0.3, stage: 0, message: 'x'))));
    await t.pump(const Duration(milliseconds: 500));
    expect(t.binding.hasScheduledFrame, isTrue);
    await t.pumpWidget(const SizedBox());
  });

  test('route pins are drawn once and shared (same future every call)', () {
    expect(identical(routePinIcons(), routePinIcons()), isTrue);
  });
}
