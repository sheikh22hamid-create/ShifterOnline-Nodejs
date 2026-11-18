import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/place_list_tile.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SizedBox(width: width, child: child)),
      ),
    );

List<TextSpan> _spans(WidgetTester tester) {
  final rich = tester.widget<RichText>(find.descendant(
      of: find.byKey(const ValueKey('place-title')), matching: find.byType(RichText)));
  final leaves = <TextSpan>[];
  rich.text.visitChildren((span) {
    if (span is TextSpan && span.text != null) leaves.add(span);
    return true;
  });
  return leaves;
}

void main() {
  testWidgets('tap calls onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(PlaceListTile(
        title: 'Sector 63, Noida', icon: Icons.place_outlined, onTap: () => taps++)));
    await tester.tap(find.byType(PlaceListTile));
    expect(taps, 1);
  });

  testWidgets('highlight renders the matching part in brandText', (tester) async {
    await tester.pumpWidget(_host(PlaceListTile(
        title: 'Sector 63, Noida', highlight: 'sector 6', icon: Icons.place_outlined, onTap: () {})));
    final spans = _spans(tester);
    final match = spans.firstWhere((s) => s.text == 'Sector 6');
    expect(match.style?.color, AppPalette.light.brandText);
  });

  testWidgets('no highlight when the substring is absent', (tester) async {
    await tester.pumpWidget(_host(PlaceListTile(
        title: 'Okhla Phase 2', highlight: 'sector', icon: Icons.place_outlined, onTap: () {})));
    final spans = _spans(tester);
    expect(spans.where((s) => s.style?.color == AppPalette.light.brandText), isEmpty);
  });

  testWidgets('long address at width 320, textScale 1.3 does not overflow', (tester) async {
    await tester.pumpWidget(_host(
      PlaceListTile(
        title: 'Plot 7, C Block, Sector 63, Noida, Gautam Buddha Nagar',
        subtitle: 'Uttar Pradesh 201301, India, near Fortis Hospital and Metro Station',
        icon: Icons.history,
        trailingText: '12.4 km',
        onTap: () {},
      ),
      width: 320,
      textScale: 1.3,
    ));
    expect(tester.takeException(), isNull);
  });

  testWidgets('SAVE shows only when onSave is set and calls it', (tester) async {
    await tester.pumpWidget(_host(PlaceListTile(title: 'Rajwada', icon: Icons.history_rounded, onTap: () {})));
    expect(find.text('SAVE'), findsNothing);
    var saves = 0, taps = 0;
    await tester.pumpWidget(_host(PlaceListTile(
        title: 'Rajwada', icon: Icons.history_rounded, onTap: () => taps++, onSave: () => saves++)));
    expect(find.text('SAVE'), findsOneWidget);
    expect(find.byIcon(Icons.favorite_border_rounded), findsOneWidget);
    await tester.tap(find.text('SAVE'));
    await tester.pumpAndSettle();
    expect(saves, 1);
    expect(taps, 0);
  });
}
