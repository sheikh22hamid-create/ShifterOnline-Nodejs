import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/myorder/fare_history_section.dart';

void main() {
  test('signed money shows + for increase, - for decrease', () {
    expect(signedFareMoney('₹', 30), '+₹30');
    expect(signedFareMoney('₹', -30), '-₹30');
    expect(signedFareMoney('₹', 12.5), '+₹12.50');
    expect(fareMoney('₹', 200), '₹200');
  });

  test('parseList keeps server order and skips junk', () {
    final list = FareHistoryEntry.parseList([
      {'kind': 'original', 'reason': 'Original booking fare', 'amount_diff': 0, 'new_total': 200},
      {'kind': 'stop_added', 'reason': 'Additional stop 1', 'amount_diff': '30.0', 'new_total': '230.0'},
      'junk',
      {'kind': 'drop_change', 'reason': 'x', 'new_total': 'bad'},
    ]);
    expect(list.map((e) => e.newTotal), [200, 230]);
    expect(FareHistoryEntry.parseList(null), isEmpty);
  });

  testWidgets('renders the example chain in order with current fare', (tester) async {
    await tester.pumpWidget(GetMaterialApp(
      home: Scaffold(
        body: FareHistorySection(
          rawEntries: [
            {'kind': 'original', 'reason': 'Original booking fare', 'amount_diff': 0, 'new_total': 200},
            {'kind': 'stop_added', 'reason': 'Additional stop 1', 'amount_diff': 30, 'new_total': 230},
            {'kind': 'drop_change', 'reason': 'Drop location changed to MG Road', 'amount_diff': 50, 'new_total': 280},
            {'kind': 'stop_added', 'reason': 'Additional stop 2', 'amount_diff': 20, 'new_total': 300},
          ],
          currency: '₹',
          currentFare: 300,
          textColor: Colors.black,
          mutedColor: Colors.grey,
        ),
      ),
    ));
    expect(find.text('₹200'), findsOneWidget);
    expect(find.text('+₹30'), findsOneWidget);
    expect(find.text('₹230'), findsOneWidget);
    expect(find.text('+₹50'), findsOneWidget);
    expect(find.text('₹280'), findsOneWidget);
    expect(find.text('+₹20'), findsOneWidget);
    expect(find.text('Additional Stop 1'), findsOneWidget);
    expect(find.text('Additional Stop 2'), findsOneWidget);
    expect(find.text('MG Road'), findsOneWidget);
    expect(find.text('Current Final Fare'), findsOneWidget);
    expect(find.text('₹300'), findsNWidgets(2)); // last "Updated Fare" and "Current Final Fare"
    final y = (String t) => tester.getTopLeft(find.text(t)).dy;
    expect(y('₹200') < y('+₹30') && y('+₹30') < y('+₹50') && y('+₹50') < y('+₹20'), isTrue);
  });

  testWidgets('decrease is shown with minus; no history renders nothing', (tester) async {
    await tester.pumpWidget(GetMaterialApp(
      home: Scaffold(
        body: Column(children: [
          FareHistorySection(
            rawEntries: [
              {'kind': 'original', 'reason': 'o', 'amount_diff': 0, 'new_total': 280},
              {'kind': 'pickup_change', 'reason': 'Pickup location changed to A', 'amount_diff': -30, 'new_total': 250},
            ],
            currency: '₹', currentFare: 250, textColor: Colors.black, mutedColor: Colors.grey,
          ),
          const FareHistorySection(rawEntries: [], currency: '₹', currentFare: 1, textColor: Colors.black, mutedColor: Colors.grey),
        ]),
      ),
    ));
    expect(find.text('-₹30'), findsOneWidget);
    expect(find.text('Fare History'), findsOneWidget);
  });
}
