import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/vehicle_booking_animation.dart';
import 'package:goParcel/screens/home/widgets/finding_driver_widgets.dart';

Widget _app(Widget child, {bool reduce = true, double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
            size: Size(width, 844), disableAnimations: reduce, textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: child),
      ),
    );

void main() {
  test('vehicleArtFor maps each kind', () {
    expect(vehicleArtFor(BookedVehicleKind.bike), 'assets/v2/vehicle_bike.png');
    expect(vehicleArtFor(BookedVehicleKind.eLoader), 'assets/v2/vehicle_e_loader.png');
    expect(vehicleArtFor(BookedVehicleKind.threeWheeler), 'assets/v2/vehicle_three_wheeler.png');
    expect(vehicleArtFor(BookedVehicleKind.fourWheeler), 'assets/v2/vehicle_four_wheeler.png');
  });

  testWidgets('hero shows the 3D art when present, else the existing animation', (t) async {
    await t.pumpWidget(_app(FindingDriverHero(vehicleName: '3 Wheeler', onBack: () {}, onHome: () {})));
    await t.pump();
    await t.pump(const Duration(milliseconds: 50));
    expect(find.byType(VehicleBookingAnimation), findsOneWidget);
    expect(t.widget<VehicleBookingAnimation>(find.byType(VehicleBookingAnimation)).scenery, isFalse,
        reason: 'on the hero the vehicle drives on the orange road, not inside its own white card');
    expect(t.takeException(), isNull);
  });

  testWidgets('hero back and Go to Home call back', (t) async {
    var back = 0, home = 0;
    await t.pumpWidget(_app(FindingDriverHero(vehicleName: 'Bike', onBack: () => back++, onHome: () => home++)));
    await t.tap(find.bySemanticsLabel('Back'));
    await t.tap(find.text('Go to Home'));
    expect(back, 1);
    expect(home, 1);
  });

  testWidgets('with reduce motion, pumpAndSettle completes', (t) async {
    await t.pumpWidget(_app(Column(children: [
      FindingDriverHero(vehicleName: 'Bike', onBack: () {}, onHome: () {}),
      const SearchProgressCard(progress: 0.5, notified: true),
    ])));
    await t.pumpAndSettle();
    expect(find.byType(SearchProgressCard), findsOneWidget);
  });

  testWidgets('animations run when motion is allowed and stop cleanly on dispose', (t) async {
    await t.pumpWidget(_app(
        Column(children: [
          FindingDriverHero(vehicleName: 'Bike', onBack: () {}, onHome: () {}),
          const SearchProgressCard(progress: 0.3, notified: false),
        ]),
        reduce: false));
    await t.pump(const Duration(seconds: 1));
    expect(t.binding.hasScheduledFrame, isTrue);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('progress card fills to the given fraction and ticks notified', (t) async {
    await t.pumpWidget(_app(const SearchProgressCard(progress: 0.5, notified: false)));
    await t.pumpAndSettle();
    final fill = t.widget<FractionallySizedBox>(find.byKey(const Key('search-progress-fill')));
    expect(fill.widthFactor, 0.5);
    expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    expect(find.text('Order placed'), findsOneWidget);
    expect(find.text('Drivers notified'), findsOneWidget);
    expect(find.text('Driver accepts'), findsOneWidget);

    await t.pumpWidget(_app(const SearchProgressCard(progress: 0.5, notified: true)));
    await t.pumpAndSettle();
    expect(find.byIcon(Icons.check_rounded), findsNWidgets(2));
  });

  testWidgets('stage message swaps text', (t) async {
    await t.pumpWidget(_app(const StageMessage(text: 'A')));
    await t.pumpWidget(_app(const StageMessage(text: 'B')));
    await t.pumpAndSettle();
    expect(find.text('B'), findsOneWidget);
    expect(find.text('A'), findsNothing);
  });

  testWidgets('trip card hides missing fare and addresses, never shows null', (t) async {
    await t.pumpWidget(_app(const WaitingTripCard(vehicle: 'Bike', orderId: '1042', fare: null, pickup: '', drop: null)));
    expect(find.textContaining('₹'), findsNothing);
    expect(find.textContaining('null'), findsNothing);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsNothing);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsNothing);
    expect(find.textContaining('1042'), findsOneWidget);
  });

  testWidgets('trip card shows fare and both addresses', (t) async {
    await t.pumpWidget(_app(const WaitingTripCard(
        vehicle: 'Bike', orderId: '1042', fare: '₹249', pickup: 'Sector 5', drop: 'MG Road')));
    expect(find.text('Order #1042 · ₹249'), findsOneWidget);
    expect(find.text('Sector 5'), findsOneWidget);
    expect(find.text('MG Road'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsOneWidget);
  });

  testWidgets('no overflow at textScale 1.3 on 360dp', (t) async {
    t.view.physicalSize = const Size(360, 844);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final long = 'Plot 12, Very Long Industrial Area Road Name, Near The Big Landmark, City ' * 3;
    await t.pumpWidget(_app(
        SingleChildScrollView(
          child: Column(children: [
            FindingDriverHero(vehicleName: 'E Loader', onBack: () {}, onHome: () {}),
            const StageMessage(text: 'Drivers usually accept once they finish their current trip.'),
            const SearchProgressCard(progress: 0.7, notified: true),
            WaitingTripCard(vehicle: 'E Loader', orderId: '123456789', fare: '₹1,249', pickup: long, drop: long),
          ]),
        ),
        width: 360,
        textScale: 1.3));
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
  });
}
