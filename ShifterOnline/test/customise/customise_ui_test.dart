import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/customise/customise_order_form.dart';
import 'package:goParcel/screens/customise/customise_ui.dart';
import 'package:goParcel/utils/colors.dart';
import 'package:provider/provider.dart';

Widget _host(Widget child, {double width = 360, double textScale = 1}) => ChangeNotifierProvider(
      create: (_) => ColorNotifier(),
      child: GetMaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: Size(width, 900), textScaler: TextScaler.linear(textScale)),
          child: child,
        ),
      ),
    );

void main() {
  test('every server status has plain words', () {
    expect(CustomiseStatus.of('open').label, 'Taking offers');
    expect(CustomiseStatus.of('scheduled').label, 'Starts soon');
    expect(CustomiseStatus.of('converted').label, 'Driver confirmed');
    expect(CustomiseStatus.of('expired').label, 'Expired');
    expect(CustomiseStatus.of('cancelled').label, 'Cancelled');
    expect(CustomiseStatus.of('weird').label, 'weird');
  });

  testWidgets('optional block is closed until tapped', (t) async {
    final c = TextEditingController();
    await t.pumpWidget(_host(Scaffold(
      body: CustomiseMore(title: 'At pickup', subtitle: 'Floor, helpers', children: [CustomiseField(label: 'Floor', controller: c)]),
    )));
    expect(find.text('Floor'), findsNothing);
    await t.tap(find.text('At pickup'));
    await t.pumpAndSettle();
    expect(find.text('Floor'), findsOneWidget);
  });

  testWidgets('form shows 3 numbered steps and the optional extras collapsed', (t) async {
    await t.pumpWidget(_host(const CustomiseOrderForm()));
    await t.pump();
    expect(find.text('Where'), findsOneWidget);
    expect(find.text('What are you moving?'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Your price'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Your price'), findsOneWidget);
    expect(find.text('Loading time (min)'), findsNothing, reason: 'handling fields stay folded');
    expect(find.text('Post order'), findsOneWidget);
  });

  testWidgets('typed price shows on the Post button', (t) async {
    await t.pumpWidget(_host(const CustomiseOrderForm()));
    await t.pump();
    await t.scrollUntilVisible(find.text('Price you want to pay'), 300, scrollable: find.byType(Scrollable).first);
    await t.enterText(find.widgetWithText(TextField, 'Price you want to pay'), '850');
    await t.pump();
    expect(find.text('₹850'), findsOneWidget);
  });

  testWidgets('form at 320 wide, text scale 1.3: no overflow', (t) async {
    await t.pumpWidget(_host(const CustomiseOrderForm(), width: 320, textScale: 1.3));
    await t.pump();
    expect(t.takeException(), isNull);
  });
}
