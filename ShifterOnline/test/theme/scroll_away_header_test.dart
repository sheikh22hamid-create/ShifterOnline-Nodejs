import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/widgets/scroll_away_header.dart';

/// Wallet on a small phone: ~375dp of cards/header/chips above the transaction list inside a ~420dp tab.
/// The header must scroll away so every transaction stays reachable, and nothing may overflow.
void main() {
  testWidgets('tall header scrolls away and the last list item is reachable on a small screen', (tester) async {
    tester.view.physicalSize = const Size(360, 420);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ScrollAwayHeader(
          header: const [
            SizedBox(height: 230, child: Text('Balance card')),
            SizedBox(height: 145, child: Text('History header + chips')),
          ],
          body: ListView.builder(
            itemCount: 20,
            itemBuilder: (_, i) => SizedBox(height: 64, child: Text('Txn $i')),
          ),
        ),
      ),
    ));
    expect(tester.takeException(), isNull);
    await tester.fling(find.text('Balance card'), const Offset(0, -2000), 3000);
    await tester.pumpAndSettle();
    expect(find.text('Balance card'), findsNothing);
    await tester.scrollUntilVisible(find.text('Txn 19'), 200, scrollable: find.byType(Scrollable).last);
    expect(find.text('Txn 19'), findsOneWidget);
  });
}
