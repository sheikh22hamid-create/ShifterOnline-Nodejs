import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/home_recent_places.dart';

Widget _host(Widget child, {double width = 360, double textScale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 800), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: width, child: child))),
      ),
    );

final _recents = [
  {'name': 'Vijay Nagar', 'address': 'Vijay Nagar, Indore, MP', 'lat': 22.75, 'lng': 75.89},
  {'name': 'Palasia', 'address': 'Palasia Square, Indore', 'lat': 22.72, 'lng': 75.88},
  {'name': 'Broken', 'address': '', 'lat': 1, 'lng': 2},
  {'name': 'Rajwada', 'address': 'Rajwada, Indore', 'lat': 22.71, 'lng': 75.85},
  {'name': 'Bhawarkua', 'address': 'Bhawarkua, Indore', 'lat': 22.69, 'lng': 75.86},
];
final _saved = [
  {'type': 'Home', 'address': 'Home addr', 'lat_map': '22.7', 'long_map': '75.8'},
  {'type': 'Office', 'address': 'Office addr', 'lat_map': '22.6', 'long_map': '75.7'},
];

void main() {
  testWidgets('nothing saved or recent: the card is hidden', (t) async {
    await t.pumpWidget(_host(HomeRecentPlaces(
        saved: const [], recents: const [], onSaved: (_) {}, onRecent: (_) {}, onSeeAll: () {})));
    expect(find.text('Where to?'), findsNothing);
  });

  testWidgets('shows saved chips (Office as Work) and the 3 newest usable recents', (t) async {
    await t.pumpWidget(_host(HomeRecentPlaces(
        saved: _saved, recents: _recents, onSaved: (_) {}, onRecent: (_) {}, onSeeAll: () {})));
    expect(find.text('Where to?'), findsOneWidget);
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Work'), findsOneWidget);
    expect(find.text('Home addr'), findsOneWidget, reason: 'area hint tells same-type places apart');
    expect(find.text('Vijay Nagar'), findsOneWidget);
    expect(find.text('Palasia'), findsOneWidget);
    expect(find.text('Rajwada'), findsOneWidget);
    expect(find.text('Broken'), findsNothing, reason: 'no address');
    expect(find.text('Bhawarkua'), findsNothing, reason: 'only 3');
  });

  testWidgets('taps go to the right callbacks', (t) async {
    Map<String, dynamic>? saved, recent;
    var all = 0;
    await t.pumpWidget(_host(HomeRecentPlaces(
        saved: _saved,
        recents: _recents,
        onSaved: (p) => saved = p,
        onRecent: (p) => recent = p,
        onSeeAll: () => all++)));
    await t.ensureVisible(find.text('Work'));
    await t.pumpAndSettle();
    await t.tap(find.text('Work'));
    await t.pumpAndSettle();
    expect(saved?['type'], 'Office');
    await t.tap(find.text('Palasia'));
    expect(recent?['name'], 'Palasia');
    await t.tap(find.text('Search'));
    expect(all, 1);
  });

  testWidgets('width 320, text scale 1.3: no overflow', (t) async {
    await t.pumpWidget(_host(
        HomeRecentPlaces(saved: _saved, recents: _recents, onSaved: (_) {}, onRecent: (_) {}, onSeeAll: () {}),
        width: 320,
        textScale: 1.3));
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
  });

  test('area hint is the first part of the landmark or address', () {
    expect(HomeRecentPlaces.savedArea({'address': 'Vijay Nagar, Indore, MP'}), 'Vijay Nagar');
    expect(HomeRecentPlaces.savedArea({'landmark': 'Near C21 Mall', 'address': 'Scheme 54, Indore'}), 'Near C21 Mall');
    expect(HomeRecentPlaces.savedArea({'address': null}), '');
  });
}
