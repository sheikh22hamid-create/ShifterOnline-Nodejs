import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/vehicle_option_card.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: const Size(320, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: Center(child: SizedBox(height: 160, child: child))),
      ),
    );

BoxDecoration _deco(WidgetTester tester) => tester
    .widgetList<AnimatedContainer>(
        find.descendant(of: find.byType(VehicleOptionCard), matching: find.byType(AnimatedContainer)))
    .first
    .decoration as BoxDecoration;

void main() {
  testWidgets('tap calls onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(VehicleOptionCard(
        name: 'Tata Ace', caption: 'From ₹349', selected: false, available: true, onTap: () => taps++)));
    await tester.tap(find.text('Tata Ace'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('selected shows brand border and tint', (tester) async {
    await tester.pumpWidget(_host(VehicleOptionCard(
        name: 'Tata Ace', caption: 'From ₹349', selected: true, available: true, onTap: () {})));
    final d = _deco(tester);
    expect((d.border as Border).top.color, AppPalette.light.brand);
    expect(d.color, AppPalette.light.brandTint);
  });

  testWidgets('unavailable: faded, caption in danger colour, still tappable', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(VehicleOptionCard(
        name: '3 Wheeler', caption: 'No drivers nearby', selected: false, available: false, onTap: () => taps++)));
    expect(tester.widget<Opacity>(find.byKey(const ValueKey('vehicle-card-opacity'))).opacity, 0.45);
    expect(tester.widget<Text>(find.text('No drivers nearby')).style?.color, AppPalette.light.danger);
    await tester.tap(find.text('3 Wheeler'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('tag pill only when tag is set', (tester) async {
    await tester.pumpWidget(_host(VehicleOptionCard(
        name: 'Tata Ace', caption: 'x', selected: false, available: true, onTap: () {})));
    expect(find.text('POPULAR'), findsNothing);
    await tester.pumpWidget(_host(VehicleOptionCard(
        name: 'Tata Ace', caption: 'x', tag: 'POPULAR', selected: false, available: true, onTap: () {})));
    expect(find.text('POPULAR'), findsOneWidget);
  });

  testWidgets('textScale 1.3 long name does not overflow', (tester) async {
    await tester.pumpWidget(_host(
      VehicleOptionCard(
          name: 'Tata Ace Gold Plus Long Body', caption: 'Up to 750 kg · 4 min away', selected: true, available: true, onTap: () {}),
      textScale: 1.3,
    ));
    expect(tester.takeException(), isNull);
  });
}
