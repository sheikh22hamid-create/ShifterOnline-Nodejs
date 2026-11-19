import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/finding_driver_widgets.dart';

Widget _app(Widget child, {bool reduce = true, double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
            size: Size(width, 844), disableAnimations: reduce, textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: child),
      ),
    );

void main() {
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
            const StageMessage(text: 'Drivers usually accept once they finish their current trip.'),
            const SearchingCard(bar: 0.7, stage: 3, message: 'Still looking. Your order stays active, no need to book again.'),
            WaitingTripCard(vehicle: 'E Loader', orderId: '123456789', fare: '₹1,249', pickup: long, drop: long),
          ]),
        ),
        width: 360,
        textScale: 1.3));
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
  });
}
