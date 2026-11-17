import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/widgets/brand_illustration.dart';
import 'package:goParcel/theme/widgets/truck_road.dart';

Widget _host(Widget child, {bool reduceMotion = false}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: const Size(390, 844), disableAnimations: reduceMotion),
        child: Scaffold(body: Center(child: SizedBox(width: 300, child: child))),
      ),
    );

void main() {
  for (final kind in BrandIllustrationKind.values) {
    testWidgets('$kind renders at the requested height without errors', (tester) async {
      await tester.pumpWidget(_host(BrandIllustration(kind: kind, height: 120), reduceMotion: true));
      expect(tester.getSize(find.byType(BrandIllustration)).height, 120);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('delivery kind shows the moving truck', (tester) async {
    await tester.pumpWidget(_host(const BrandIllustration(kind: BrandIllustrationKind.delivery, height: 120)));
    expect(find.byType(TruckRoad), findsOneWidget);
  });

  testWidgets('truck is still with reduce motion', (tester) async {
    await tester.pumpWidget(_host(const BrandIllustration(kind: BrandIllustrationKind.delivery, height: 120),
        reduceMotion: true));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });
}
