import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/vehicle_booking_animation.dart';

void main() {
  group('bookedVehicleKindFor', () {
    test('maps the booked vehicle name to its own animation', () {
      expect(bookedVehicleKindFor('Bike'), BookedVehicleKind.bike);
      expect(bookedVehicleKindFor('2 Wheeler'), BookedVehicleKind.bike);
      expect(bookedVehicleKindFor('E loader'), BookedVehicleKind.eLoader);
      expect(bookedVehicleKindFor('E-Loader'), BookedVehicleKind.eLoader);
      expect(bookedVehicleKindFor('3 wheeler'), BookedVehicleKind.threeWheeler);
      expect(bookedVehicleKindFor('Three Wheeler'), BookedVehicleKind.threeWheeler);
      expect(bookedVehicleKindFor('4 wheeler'), BookedVehicleKind.fourWheeler);
    });

    test('anything unknown or empty falls back to the mini truck', () {
      expect(bookedVehicleKindFor('Mini Truck'), BookedVehicleKind.fourWheeler);
      expect(bookedVehicleKindFor(''), BookedVehicleKind.fourWheeler);
      expect(bookedVehicleKindFor(null), BookedVehicleKind.fourWheeler);
    });
  });

  testWidgets('animation builds, loops and shows the booked vehicle name', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: VehicleBookingAnimation(vehicleName: '3 wheeler')),
    ));
    expect(find.text('3 wheeler'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 800));
    await tester.pump(const Duration(milliseconds: 900)); // past one full loop, still fine
    expect(tester.takeException(), isNull);
  });
}
