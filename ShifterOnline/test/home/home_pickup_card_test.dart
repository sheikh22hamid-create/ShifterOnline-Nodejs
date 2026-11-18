import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_pickup_card.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: Center(child: SizedBox(width: width - 32, child: child))),
      ),
    );

const _long = 'Plot 7, C Block, Sector 63, Noida, Gautam Buddha Nagar, Uttar Pradesh 201301';

void main() {
  testWidgets('tap calls onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(HomePickupCard(address: 'Rajwada, Indore', onTap: () => taps++)));
    await tester.tap(find.text('Rajwada, Indore'));
    await tester.pumpAndSettle();
    expect(taps, 1);
    expect(find.text('Pick up from'), findsOneWidget);
  });

  testWidgets('null address shows Location', (tester) async {
    await tester.pumpWidget(_host(HomePickupCard(address: null, onTap: () {})));
    expect(find.text('Location'), findsOneWidget);
  });

  testWidgets('long address stays on one line with ellipsis', (tester) async {
    await tester.pumpWidget(_host(HomePickupCard(address: _long, onTap: () {})));
    final t = tester.widget<Text>(find.text(_long));
    expect(t.maxLines, 1);
    expect(t.overflow, TextOverflow.ellipsis);
  });

  testWidgets('width 320, textScale 1.3 does not overflow', (tester) async {
    await tester.pumpWidget(_host(HomePickupCard(address: _long, onTap: () {}), width: 320, textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
