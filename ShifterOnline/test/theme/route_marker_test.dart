import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/widgets/route_marker.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

Color? _fill(WidgetTester tester) {
  final box = tester.widget<Container>(find.descendant(of: find.byType(RouteMarker), matching: find.byType(Container)).first);
  return (box.decoration as BoxDecoration).color;
}

void main() {
  testWidgets('pickup is a green circle with an up arrow', (tester) async {
    await tester.pumpWidget(_host(const RouteMarker.pickup()));
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(_fill(tester), AppPalette.current.success);
  });

  testWidgets('drop is a red circle with a down arrow', (tester) async {
    await tester.pumpWidget(_host(const RouteMarker.drop()));
    expect(find.byIcon(Icons.arrow_downward_rounded), findsOneWidget);
    expect(_fill(tester), AppPalette.current.danger);
  });

  testWidgets('stop shows its number', (tester) async {
    await tester.pumpWidget(_host(const RouteMarker.stop(2)));
    expect(find.text('2'), findsOneWidget);
    expect(_fill(tester), AppPalette.current.inkSubtle);
  });

  testWidgets('respects size', (tester) async {
    await tester.pumpWidget(_host(const RouteMarker.pickup(size: 28)));
    expect(tester.getSize(find.byType(RouteMarker)), const Size(28, 28));
  });
}
