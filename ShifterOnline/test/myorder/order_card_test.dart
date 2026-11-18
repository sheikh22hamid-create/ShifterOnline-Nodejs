import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/myorder/widgets/order_card.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width - 32, child: child))),
      ),
    );

const _longAddr = 'Plot 7, C Block, Sector 63, Noida, Gautam Buddha Nagar, Uttar Pradesh 201301, India';

OrderCard _card({
  String title = '#123',
  String? vehicleName = 'Tata Ace',
  String? amount = '₹403',
  String status = 'Completed',
  String pickup = 'Rajwada, Indore',
  String drop = 'Vijay Nagar, Indore',
  bool showActions = true,
  VoidCallback? onTap,
  VoidCallback? onFavorite,
  VoidCallback? onBookAgain,
}) =>
    OrderCard(
      title: title,
      vehicleName: vehicleName,
      amount: amount,
      status: status,
      date: 'Wed, 18 Nov, 2026',
      pickup: pickup,
      drop: drop,
      showActions: showActions,
      onTap: onTap ?? () {},
      onFavorite: onFavorite ?? () {},
      onBookAgain: onBookAgain ?? () {},
    );

void main() {
  testWidgets('shows vehicle, date, amount and both addresses', (tester) async {
    await tester.pumpWidget(_host(_card()));
    expect(find.text('Tata Ace'), findsOneWidget);
    expect(find.textContaining('Wed, 18 Nov, 2026'), findsOneWidget);
    expect(find.text('₹403'), findsOneWidget);
    expect(find.text('Rajwada, Indore'), findsOneWidget);
    expect(find.text('Vijay Nagar, Indore'), findsOneWidget);
  });

  testWidgets('missing vehicle and amount fall back to #id and hide the amount', (tester) async {
    await tester.pumpWidget(_host(_card(vehicleName: null, amount: '')));
    expect(find.text('#123'), findsOneWidget);
    expect(find.textContaining('₹'), findsNothing);
  });

  testWidgets('cancelled status chip uses danger colours', (tester) async {
    await tester.pumpWidget(_host(_card(status: 'Cancelled')));
    final chip = tester.widget<Text>(find.text('Cancelled'));
    expect(chip.style?.color, AppPalette.current.danger);
  });

  testWidgets('recent order (showActions false) has no favourite or Book Again', (tester) async {
    await tester.pumpWidget(_host(_card(status: 'Pending', showActions: false)));
    expect(find.text('Book Again'), findsNothing);
    expect(find.byIcon(Icons.favorite_border_rounded), findsNothing);
  });

  testWidgets('Book Again and favourite call back; card tap calls onTap', (tester) async {
    var book = 0, fav = 0, tap = 0;
    await tester.pumpWidget(_host(_card(onBookAgain: () => book++, onFavorite: () => fav++, onTap: () => tap++)));
    await tester.tap(find.text('Book Again'));
    await tester.tap(find.byIcon(Icons.favorite_border_rounded));
    await tester.tap(find.text('Tata Ace'));
    await tester.pumpAndSettle();
    expect([book, fav, tap], [1, 1, 1]);
  });

  testWidgets('pickup and drop markers are present', (tester) async {
    await tester.pumpWidget(_host(_card()));
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsOneWidget);
  });

  testWidgets('long addresses at textScale 1.3 on 360dp do not overflow', (tester) async {
    await tester.pumpWidget(
        _host(_card(pickup: _longAddr, drop: _longAddr, amount: '₹12,345.00'), width: 360, textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
