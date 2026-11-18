import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/widgets/app_group_card.dart';
import 'package:goParcel/utils/colors.dart' show notifier;

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

BoxDecoration _cardDeco(WidgetTester tester) => tester
    .widget<Container>(find.descendant(of: find.byType(AppGroupCard), matching: find.byType(Container)).first)
    .decoration as BoxDecoration;

void main() {
  testWidgets('group card shows title and a divider between rows, none after the last', (tester) async {
    await tester.pumpWidget(_host(AppGroupCard(title: 'Drivers', children: [
      AppMenuRow(icon: Icons.favorite_rounded, title: 'Favourite Drivers', onTap: () {}),
      AppMenuRow(icon: Icons.block_rounded, title: 'Blocked Drivers', onTap: () {}),
      AppMenuRow(icon: Icons.person_rounded, title: 'Third', onTap: () {}),
    ])));
    expect(find.text('Drivers'), findsOneWidget);
    expect(find.byType(Divider), findsNWidgets(2));
  });

  testWidgets('row tap calls onTap; custom trailing replaces chevron', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(AppGroupCard(children: [
      AppMenuRow(
          icon: Icons.dark_mode_rounded,
          title: 'Dark Mode',
          trailing: Switch(value: false, onChanged: (_) {}),
          onTap: () => taps++),
    ])));
    expect(find.byIcon(Icons.chevron_right_rounded), findsNothing);
    await tester.tap(find.text('Dark Mode'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('danger row uses danger colours', (tester) async {
    await tester.pumpWidget(_host(AppGroupCard(children: [
      AppMenuRow(icon: Icons.delete_outline_rounded, title: 'Delete Account', danger: true, onTap: () {}),
    ])));
    expect(tester.widget<Icon>(find.byIcon(Icons.delete_outline_rounded)).color, AppPalette.current.danger);
  });

  testWidgets('dark palette is used when dark mode is on', (tester) async {
    notifier.setIsDark = true;
    addTearDown(() => notifier.setIsDark = false);
    await tester.pumpWidget(_host(AppGroupCard(children: [
      AppMenuRow(icon: Icons.language_rounded, title: 'Language', onTap: () {}),
    ])));
    expect(_cardDeco(tester).color, AppPalette.dark.surface);
  });

  testWidgets('no overflow at textScale 1.3 on 360dp with long title and subtitle', (tester) async {
    await tester.pumpWidget(_host(
        AppGroupCard(title: 'Help & Support', children: [
          AppMenuRow(
              icon: Icons.support_agent_rounded,
              title: 'Customer Care and support for every booking question',
              subtitle: 'Call +91 98765 43210 • 9 AM to 9 PM, all seven days of the week',
              onTap: () {}),
        ]),
        width: 360,
        textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
