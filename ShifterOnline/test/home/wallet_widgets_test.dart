import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/wallet_widgets.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width - 32, child: child))),
      ),
    );

void main() {
  testWidgets('balance card shows formatted balance and Add Money calls back', (tester) async {
    var adds = 0;
    await tester.pumpWidget(_host(WalletBalanceCard(balance: 1250.5, onAddMoney: () => adds++)));
    expect(find.text('₹1250.50'), findsOneWidget);
    await tester.tap(find.text('Add Money'));
    await tester.pumpAndSettle();
    expect(adds, 1);
  });

  testWidgets('reward points card shows points and taps', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(RewardPointsCard(points: '120', onTap: () => taps++)));
    expect(find.text('Reward Points'), findsOneWidget);
    expect(find.text('120 points'), findsOneWidget);
    await tester.tap(find.text('Reward Points'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets("type chips report '' / 'credit' / 'debit'", (tester) async {
    final picked = <String>[];
    await tester.pumpWidget(_host(TxnTypeChips(selected: '', onSelected: picked.add)));
    await tester.tap(find.text('Credit'));
    await tester.tap(find.text('Debit'));
    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    expect(picked, ['credit', 'debit', '']);
  });

  testWidgets('selected chip has brand border', (tester) async {
    await tester.pumpWidget(_host(TxnTypeChips(selected: 'debit', onSelected: (_) {})));
    final box = tester.widget<Container>(
        find.ancestor(of: find.text('Debit'), matching: find.byType(Container)).first);
    final border = (box.decoration as BoxDecoration).border as Border;
    expect(border.top.color, AppPalette.current.brand);
    expect(border.top.width, 1.5);
  });

  testWidgets('large balance and 0 points at textScale 1.3 on 360dp do not overflow', (tester) async {
    await tester.pumpWidget(_host(
        Column(children: [
          WalletBalanceCard(balance: 100000, onAddMoney: () {}),
          RewardPointsCard(points: '0', onTap: () {}),
          TxnTypeChips(selected: '', onSelected: (_) {}),
        ]),
        width: 360,
        textScale: 1.3));
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing wallet art shows the W1 placeholder', (tester) async {
    await tester.pumpWidget(_host(WalletBalanceCard(balance: 0, onAddMoney: () {})));
    await tester.pumpAndSettle();
    expect(find.text('W1'), findsOneWidget);
  });

  testWidgets('type chips sit on one line and size to their label', (tester) async {
    await tester.pumpWidget(_host(TxnTypeChips(selected: '', onSelected: (_) {})));
    final all = tester.getRect(find.ancestor(of: find.text('All'), matching: find.byType(Container)).first);
    final credit = tester.getRect(find.ancestor(of: find.text('Credit'), matching: find.byType(Container)).first);
    final debit = tester.getRect(find.ancestor(of: find.text('Debit'), matching: find.byType(Container)).first);
    expect(credit.top, all.top);
    expect(debit.top, all.top);
    expect(all.width, lessThan(358 / 2));
  });
}
