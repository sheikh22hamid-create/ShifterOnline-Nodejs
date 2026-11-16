import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/booking_option_widgets.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: child)));

BoxDecoration _decorationOf(WidgetTester t, Finder f) {
  final c = t.widget<AnimatedContainer>(find.descendant(of: f, matching: find.byType(AnimatedContainer)).first);
  return c.decoration as BoxDecoration;
}

void main() {
  final p = AppPalette.light;

  testWidgets('model tile shows title, fare, saver badge and toggles', (t) async {
    bool? toggled;
    await t.pumpWidget(_wrap(DeliveryModelTile(
      title: 'Super Saver',
      description: 'Cheapest',
      fare: '₹120',
      on: false,
      selected: false,
      nextDaySaver: true,
      onToggle: (v) => toggled = v,
    )));
    expect(find.text('Super Saver'), findsOneWidget);
    expect(find.text('Cheapest'), findsOneWidget);
    expect(find.text('₹120'), findsOneWidget);
    expect(find.text('Next Day Saver'), findsOneWidget);
    await t.tap(find.text('Super Saver'));
    expect(toggled, isTrue);
  });

  testWidgets('selected model tile uses the brand border and tint', (t) async {
    await t.pumpWidget(_wrap(DeliveryModelTile(
      title: 'Priority', fare: '₹200', on: true, selected: true, onToggle: (_) {},
    )));
    final d = _decorationOf(t, find.byType(DeliveryModelTile));
    expect(d.color, p.brandTint);
    expect((d.border as Border).top.color, p.brand);
  });

  testWidgets('option row taps and shows trailing close when active', (t) async {
    var taps = 0;
    var cleared = 0;
    await t.pumpWidget(_wrap(BookingOptionRow(
      icon: Icons.local_offer_outlined,
      title: 'Coupon SAVE10 applied',
      active: true,
      onTap: () => taps++,
      onClear: () => cleared++,
    )));
    await t.tap(find.text('Coupon SAVE10 applied'));
    await t.tap(find.byTooltip('Remove'));
    expect(taps, 1);
    expect(cleared, 1);
  });

  testWidgets('inactive option row shows a chevron, no remove button', (t) async {
    await t.pumpWidget(_wrap(BookingOptionRow(
      icon: Icons.local_offer_outlined, title: 'Apply coupon', active: false, onTap: () {},
    )));
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(find.byTooltip('Remove'), findsNothing);
  });

  testWidgets('picker field shows placeholder until a value is set, and taps', (t) async {
    var taps = 0;
    await t.pumpWidget(_wrap(BookingPickerField(
      icon: Icons.event_rounded, label: 'Pickup date', value: null, placeholder: 'Pick a date', onTap: () => taps++,
    )));
    expect(find.text('Pickup date'), findsOneWidget);
    expect(find.text('Pick a date'), findsOneWidget);
    await t.tap(find.text('Pick a date'));
    expect(taps, 1);
    expect(_decorationOf(t, find.byType(BookingPickerField)).color, p.surface);

    await t.pumpWidget(_wrap(BookingPickerField(
      icon: Icons.event_rounded, label: 'Pickup date', value: 'Tue, 17 Nov', placeholder: 'Pick a date', onTap: () {},
    )));
    await t.pump(const Duration(milliseconds: 300));
    expect(find.text('Tue, 17 Nov'), findsOneWidget);
    expect(find.text('Pick a date'), findsNothing);
    expect(_decorationOf(t, find.byType(BookingPickerField)).color, p.brandTint);
  });

  testWidgets('choice pill reports taps and marks selection', (t) async {
    var taps = 0;
    await t.pumpWidget(_wrap(BookingChoicePill(label: 'Furniture', selected: true, onTap: () => taps++)));
    await t.tap(find.text('Furniture'));
    expect(taps, 1);
    final d = _decorationOf(t, find.byType(BookingChoicePill));
    expect(d.color, p.brandTint);
  });
}
