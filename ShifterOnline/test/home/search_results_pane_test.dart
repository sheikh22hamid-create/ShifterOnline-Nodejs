import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/saved_places_row.dart';
import 'package:goParcel/screens/home/widgets/search_results_pane.dart';

/// Drop search with the keyboard open on a 360×720 phone leaves ~120dp under the search card.
/// The current-location card, saved places and results must scroll together there, never overflow.
void main() {
  testWidgets('keyboard-height pane on 360dp at textScale 1.3 scrolls instead of overflowing', (tester) async {
    tester.view.physicalSize = const Size(360, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(size: Size(360, 720), textScaler: TextScaler.linear(1.3)),
        child: Scaffold(
          body: Column(
            children: [
              const SizedBox(height: 600), // app bar + route card + action bar + keyboard → ~120dp left
              Expanded(
                child: SearchResultsPane(
                  children: [
                    const SizedBox(height: 76, child: Text('Use Current Location')),
                    SavedPlacesRow(
                      places: const [
                        {'type': 'Home', 'address': 'Rajwada'},
                      ],
                      loading: false,
                      onSelect: (_) {},
                      onAdd: () {},
                      onManage: () {},
                    ),
                    for (var i = 0; i < 6; i++) SizedBox(height: 64, child: Text('Result $i')),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ));
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('Result 5'), 100, scrollable: find.descendant(of: find.byType(SearchResultsPane), matching: find.byType(Scrollable)).first);
    expect(find.text('Result 5'), findsOneWidget);
  });
}
