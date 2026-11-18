import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/saved_places_row.dart';
import 'package:goParcel/theme/widgets/app_skeleton.dart';

Widget _host(Widget child, {double width = 390, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SizedBox(width: width, child: child)),
      ),
    );

final _home = <String, dynamic>{'type': 'Home', 'address': 'Rajwada, Indore', 'lat_map': '22.71', 'long_map': '75.85'};
final _office = <String, dynamic>{'type': 'Office', 'address': 'Vijay Nagar, Indore', 'lat_map': '22.75', 'long_map': '75.89'};

SavedPlacesRow _row({
  List<Map<String, dynamic>>? places,
  bool loading = false,
  ValueChanged<Map<String, dynamic>>? onSelect,
  VoidCallback? onAdd,
  VoidCallback? onManage,
}) =>
    SavedPlacesRow(
      places: places ?? [_home, _office],
      loading: loading,
      onSelect: onSelect ?? (_) {},
      onAdd: onAdd ?? () {},
      onManage: onManage ?? () {},
    );

void main() {
  test('titleFor maps office to Work and missing type to Other', () {
    expect(SavedPlacesRow.titleFor({'type': 'Office'}), 'Work');
    expect(SavedPlacesRow.titleFor({'type': 'Home'}), 'Home');
    expect(SavedPlacesRow.titleFor({}), 'Other');
    expect(SavedPlacesRow.iconFor({'type': 'home'}), 'assets/selecthome.png');
    expect(SavedPlacesRow.iconFor({'type': 'office'}), 'assets/selectoffice.png');
    expect(SavedPlacesRow.iconFor({'type': 'Gym'}), 'assets/selectothers.png');
  });

  testWidgets('shows one chip per place plus Add', (tester) async {
    await tester.pumpWidget(_host(_row()));
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Work'), findsOneWidget);
    expect(find.text('Add'), findsOneWidget);
    expect(find.text('Saved places'), findsOneWidget);
  });

  testWidgets('tapping a place passes the same map', (tester) async {
    Map<String, dynamic>? got;
    await tester.pumpWidget(_host(_row(onSelect: (m) => got = m)));
    await tester.tap(find.text('Work'));
    await tester.pumpAndSettle();
    expect(got, same(_office));
  });

  testWidgets('Add and Manage call their callbacks', (tester) async {
    var adds = 0, manages = 0;
    await tester.pumpWidget(_host(_row(onAdd: () => adds++, onManage: () => manages++)));
    await tester.tap(find.text('Add'));
    await tester.tap(find.text('Manage'));
    await tester.pumpAndSettle();
    expect(adds, 1);
    expect(manages, 1);
  });

  testWidgets('loading shows skeletons, no chips', (tester) async {
    await tester.pumpWidget(_host(_row(loading: true)));
    await tester.pump();
    expect(find.byType(AppSkeleton), findsWidgets);
    expect(find.text('Add'), findsNothing);
  });

  testWidgets('no overflow at textScale 1.3 on 360dp', (tester) async {
    await tester.pumpWidget(_host(_row(), width: 360, textScale: 1.3));
    expect(tester.takeException(), isNull);
  });
}
