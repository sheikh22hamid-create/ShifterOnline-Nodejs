import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/widgets/v2_art.dart';

void main() {
  test('vehicle names map to the right V1–V4 picture', () {
    expect(vehicleArtFor('Bike'), 'assets/v2/vehicle_bike.png');
    expect(vehicleArtFor('2 Wheeler'), 'assets/v2/vehicle_bike.png');
    expect(vehicleArtFor('E Loader'), 'assets/v2/vehicle_e_loader.png');
    expect(vehicleArtFor('e-rickshaw'), 'assets/v2/vehicle_e_loader.png');
    expect(vehicleArtFor('3 Wheeler'), 'assets/v2/vehicle_three_wheeler.png');
    expect(vehicleArtFor('Tata Ace'), 'assets/v2/vehicle_four_wheeler.png');
    expect(vehicleArtFor(null), 'assets/v2/vehicle_four_wheeler.png');
  });

  test('every v2 illustration slot has its file', () {
    for (final f in [
      'home_header', 'tile_book_now', 'tile_schedule', 'tile_low_fare', 'tile_customise', 'free_ride_icon',
      'empty_not_serviceable', 'empty_no_orders', 'empty_no_driver', 'wallet_icon',
      'vehicle_bike', 'vehicle_e_loader', 'vehicle_three_wheeler', 'vehicle_four_wheeler',
    ]) {
      expect(File('assets/v2/$f.png').existsSync(), isTrue, reason: f);
    }
  });

  testWidgets('a missing illustration falls back to its quiet placeholder, never an error', (t) async {
    await t.pumpWidget(const MaterialApp(home: V2Art(asset: 'assets/v2/does_not_exist.png', placeholderLabel: 'X9')));
    await t.pumpAndSettle();
    expect(find.text('X9'), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}
