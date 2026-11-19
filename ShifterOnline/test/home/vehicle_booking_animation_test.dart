import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/vehicle_booking_animation.dart';
import 'package:goParcel/theme/contrast.dart';

void main() {
  testWidgets('vehicle label is readable on the light waiting screen', (t) async {
    await t.pumpWidget(const MaterialApp(home: Scaffold(body: VehicleBookingAnimation(vehicleName: 'Bike', height: 120))));
    await t.pump(const Duration(milliseconds: 100));
    final text = t.widget<Text>(find.text('Bike'));
    final pill = t.widget<Container>(find.ancestor(of: find.text('Bike'), matching: find.byType(Container)).first);
    final bg = (pill.decoration as BoxDecoration).color!;
    expect(bg.a, 1.0, reason: 'pill must be opaque so the page behind does not change its contrast');
    expect(contrastRatio(text.style!.color!, bg), greaterThanOrEqualTo(4.5));
  });

  testWidgets('scenery off draws only the vehicle: no card, no shadow, no label', (t) async {
    await t.pumpWidget(const MaterialApp(
        home: Scaffold(body: Center(child: SizedBox(width: 220, height: 100, child: VehicleBookingAnimation(vehicleName: 'Bike', height: 100, showLabel: true, scenery: false))))));
    await t.pump(const Duration(milliseconds: 100));
    final boxes = t.widgetList<Container>(find.descendant(of: find.byType(VehicleBookingAnimation), matching: find.byType(Container)));
    expect(boxes.where((c) => c.decoration is BoxDecoration && (c.decoration as BoxDecoration).boxShadow != null), isEmpty);
    expect(find.text('Bike'), findsNothing);
    expect(find.descendant(of: find.byType(VehicleBookingAnimation), matching: find.byType(CustomPaint)), findsWidgets);
  });
}
