import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/offers_details_card.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width - 32, child: child))),
      ),
    );

OffersDetailsCard _card({
  String goodsValue = 'Household',
  VoidCallback? onGoodsTap,
  String couponLabel = 'Apply Coupon',
  bool couponActive = false,
  VoidCallback? onCouponTap,
  VoidCallback? onCouponClear,
  String? pointsLabel,
  bool pointsActive = false,
  VoidCallback? onPointsTap,
  Widget gstSection = const Text('GST'),
}) =>
    OffersDetailsCard(
      goodsValue: goodsValue,
      onGoodsTap: onGoodsTap ?? () {},
      couponLabel: couponLabel,
      couponActive: couponActive,
      onCouponTap: onCouponTap ?? () {},
      onCouponClear: onCouponClear,
      pointsLabel: pointsLabel,
      pointsActive: pointsActive,
      onPointsTap: onPointsTap,
      gstSection: gstSection,
    );

void main() {
  testWidgets('shows header and goods value', (tester) async {
    await tester.pumpWidget(_host(_card()));
    expect(find.text('Offers & Details'), findsOneWidget);
    expect(find.text('Goods type'), findsOneWidget);
    expect(find.text('Household'), findsOneWidget);
  });

  testWidgets('goods row tap calls onGoodsTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(_card(onGoodsTap: () => taps++)));
    await tester.tap(find.text('Goods type'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('coupon row shows label and clear only when active', (tester) async {
    var taps = 0, clears = 0;
    await tester.pumpWidget(_host(_card(onCouponTap: () => taps++, onCouponClear: () => clears++)));
    expect(find.byIcon(Icons.close_rounded), findsNothing);
    await tester.tap(find.text('Apply Coupon'));
    await tester.pumpAndSettle();
    expect(taps, 1);

    await tester.pumpWidget(_host(_card(
        couponLabel: 'Coupon SHIFT50 applied (50 off)',
        couponActive: true,
        onCouponTap: () => taps++,
        onCouponClear: () => clears++)));
    expect(find.text('Coupon SHIFT50 applied (50 off)'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();
    expect(clears, 1);
  });

  testWidgets('points row hidden when pointsLabel is null', (tester) async {
    await tester.pumpWidget(_host(_card()));
    expect(find.text('Reward Points'), findsNothing);
    expect(find.byIcon(Icons.stars_rounded), findsNothing);
  });

  testWidgets('points row shows checked state when active and calls onPointsTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(_card(
        pointsLabel: 'Use referral points · Save ₹12 (120 pts)', pointsActive: true, onPointsTap: () => taps++)));
    expect(find.text('Reward Points'), findsOneWidget);
    expect(find.byIcon(Icons.check_box_rounded), findsOneWidget);
    await tester.tap(find.text('Reward Points'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('gstSection child is rendered', (tester) async {
    await tester.pumpWidget(_host(_card(gstSection: const Text('GST-SECTION'))));
    expect(find.text('GST-SECTION'), findsOneWidget);
  });

  testWidgets('no overflow at textScale 1.3 on 360dp', (tester) async {
    await tester.pumpWidget(_host(
        _card(
            goodsValue: 'Electronics and home appliances',
            couponLabel: 'Coupon SHIFTERNEWYEAR applied (₹150 off)',
            couponActive: true,
            onCouponClear: () {},
            pointsLabel: 'Use referral points · Save ₹120 (1200 pts)',
            onPointsTap: () {}),
        width: 360,
        textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
