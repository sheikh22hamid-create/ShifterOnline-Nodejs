import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/vehicle_option_card.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: Center(child: SizedBox(width: width - 32, child: child))),
      ),
    );

BoxDecoration _deco(WidgetTester tester) => tester
    .widgetList<AnimatedContainer>(
        find.descendant(of: find.byType(VehicleOptionCard), matching: find.byType(AnimatedContainer)))
    .first
    .decoration as BoxDecoration;

const _slot = ValueKey('vehicle-image-slot');

VehicleOptionCard _card({
  String name = '3 Wheeler',
  bool selected = false,
  bool available = true,
  String? tag,
  String? unavailableText,
  VoidCallback? onTap,
}) =>
    VehicleOptionCard(
      name: name,
      meta: '500 kg · 4 mins',
      price: 'From ₹403',
      unavailableText: unavailableText,
      tag: tag,
      selected: selected,
      available: available,
      onTap: onTap ?? () {},
    );

void main() {
  testWidgets('unselected is a compact row', (tester) async {
    await tester.pumpWidget(_host(_card()));
    expect(tester.getSize(find.byType(VehicleOptionCard)).height, lessThan(90));
    expect(tester.getSize(find.byKey(_slot)), const Size(56, 56));
    expect(find.text('3 Wheeler'), findsOneWidget);
    expect(find.text('500 kg · 4 mins'), findsOneWidget);
    expect(find.text('From ₹403'), findsOneWidget);
    final border = _deco(tester).border as Border?;
    expect(border?.top.color == AppPalette.current.brand, isFalse);
  });

  testWidgets('selected is a large card with brand border and tint', (tester) async {
    await tester.pumpWidget(_host(_card(selected: true)));
    await tester.pumpAndSettle();
    expect(tester.getSize(find.byKey(_slot)).height, 96);
    final deco = _deco(tester);
    final border = deco.border as Border;
    expect(border.top.color, AppPalette.current.brand);
    expect(border.top.width, 1.5);
    expect(deco.color, AppPalette.current.brandTint);
  });

  testWidgets('unavailable shows reason instead of price, faded, still tappable', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(_card(available: false, unavailableText: 'No drivers nearby', onTap: () => taps++)));
    expect(tester.widget<Opacity>(find.byKey(const ValueKey('vehicle-card-opacity'))).opacity, 0.45);
    expect(find.text('No drivers nearby'), findsOneWidget);
    expect(find.text('From ₹403'), findsNothing);
    await tester.tap(find.text('3 Wheeler'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('tag chip shows', (tester) async {
    await tester.pumpWidget(_host(_card(tag: 'NEW')));
    expect(find.text('NEW'), findsOneWidget);
  });

  testWidgets('missing image shows the truck icon placeholder', (tester) async {
    await tester.pumpWidget(_host(_card()));
    expect(find.byIcon(Icons.local_shipping_outlined), findsOneWidget);
  });

  testWidgets('no overflow at textScale 1.3, 360dp, long name', (tester) async {
    await tester.pumpWidget(_host(
        _card(name: 'Tata Ace Gold Cargo Super Long Name', tag: 'NEW', selected: true),
        width: 360,
        textScale: 1.3));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
