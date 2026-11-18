import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/review_widgets.dart';
import 'package:goParcel/theme/widgets/app_buttons.dart';
import 'package:goParcel/theme/widgets/route_marker.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: Align(alignment: Alignment.bottomCenter, child: SizedBox(width: width, child: child))),
      ),
    );

ReviewBottomBar _bar({
  String payLabel = 'Pay with Cash',
  VoidCallback? onPayTap,
  VoidCallback? onViewBreakup,
  String buttonLabel = 'Book 3 Wheeler',
  bool processing = false,
  VoidCallback? onBook,
  bool enabled = true,
}) =>
    ReviewBottomBar(
      payLabel: payLabel,
      onPayTap: onPayTap ?? () {},
      total: '₹403.00',
      onViewBreakup: onViewBreakup ?? () {},
      buttonLabel: buttonLabel,
      processing: processing,
      onBook: enabled ? (onBook ?? () {}) : null,
    );

void main() {
  testWidgets('vehicle card shows name, time and View Address Details calls back', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(ReviewVehicleCard(
        vehicleName: '3 Wheeler', timeLabel: 'Now', onViewAddress: () => taps++)));
    expect(find.text('3 Wheeler'), findsOneWidget);
    expect(find.text('Now'), findsOneWidget);
    await tester.tap(find.text('View Address Details'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('bottom bar shows pay label, total, View Breakup and button', (tester) async {
    var pay = 0, breakup = 0, book = 0;
    await tester.pumpWidget(_host(_bar(
        onPayTap: () => pay++, onViewBreakup: () => breakup++, onBook: () => book++)));
    expect(find.text('₹403.00'), findsOneWidget);
    await tester.tap(find.text('Pay with Cash'));
    await tester.tap(find.text('View Breakup'));
    await tester.tap(find.text('Book 3 Wheeler'));
    await tester.pumpAndSettle();
    expect([pay, breakup, book], [1, 1, 1]);
  });

  testWidgets('bottom bar button disabled when onBook is null', (tester) async {
    await tester.pumpWidget(_host(_bar(enabled: false)));
    expect(tester.widget<AppPrimaryButton>(find.byType(AppPrimaryButton)).onPressed, isNull);
  });

  testWidgets('bottom bar shows a spinner when processing', (tester) async {
    await tester.pumpWidget(_host(_bar(processing: true)));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Book 3 Wheeler'), findsNothing);
  });

  testWidgets('insufficient wallet label', (tester) async {
    await tester.pumpWidget(_host(_bar(buttonLabel: 'Add Money to Wallet')));
    expect(find.text('Add Money to Wallet'), findsOneWidget);
  });

  testWidgets('address sheet lists pickup, 2 stops and drop in order with markers', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showAddressDetailsSheet(
              context,
              pickup: {'c_name': 'Rahul', 'c_number': '9800000010', 'address': 'Rajwada, Indore'},
              stops: [
                {'c_name': 'Stop A', 'c_number': '1', 'address': 'Palasia'},
                {'c_name': 'Stop B', 'c_number': '2', 'address': 'Bhawarkua'},
              ],
              drop: {'c_name': 'Amit', 'c_number': '9700000042', 'address': 'Vijay Nagar, Indore'},
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsOneWidget);
    expect(find.byType(RouteMarker), findsNWidgets(4));
    final ys = ['Rajwada, Indore', 'Palasia', 'Bhawarkua', 'Vijay Nagar, Indore']
        .map((t) => tester.getTopLeft(find.text(t)).dy)
        .toList();
    expect(ys, orderedEquals([...ys]..sort()));
    expect(find.text('Rahul · 9800000010'), findsOneWidget);
  });

  testWidgets('no overflow at textScale 1.3 on 360dp', (tester) async {
    await tester.pumpWidget(_host(
        Column(mainAxisSize: MainAxisSize.min, children: [
          ReviewVehicleCard(
              vehicleName: 'Tata Ace Gold Cargo Long Name', timeLabel: 'Wed, 30 Dec 2026 · 10:30 AM', onViewAddress: () {}),
          _bar(payLabel: 'Pay with Shifter Wallet · Receiver pays', buttonLabel: 'Book Tata Ace Gold Cargo Long Name'),
        ]),
        width: 360,
        textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
