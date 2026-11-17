import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/authscreen/widgets/profile_form_widgets.dart';

void main() {
  final indore = CityModel(id: '1', title: 'Indore');

  group('validateProfileForm', () {
    test('blank name and no city are both errors, empty email is fine', () {
      final e = validateProfileForm(name: '  ', email: '', city: null);
      expect(e.name, 'Please enter your full name');
      expect(e.city, 'Please select your city');
      expect(e.email, isNull);
      expect(e.ok, isFalse);
    });

    test('a malformed email is the only error', () {
      final e = validateProfileForm(name: 'Ravi', email: 'bad@', city: indore);
      expect(e.email, 'Enter a valid email address');
      expect(e.name, isNull);
      expect(e.city, isNull);
    });

    test('name + city with no email is valid', () {
      expect(validateProfileForm(name: 'Ravi', email: '', city: indore).ok, isTrue);
    });
  });

  testWidgets('CitySheet search narrows the list', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CitySheet(
          cityList: [indore, CityModel(id: '2', title: 'Bhopal')],
          isLoading: false,
          onSelect: (_) {},
        ),
      ),
    ));
    expect(find.text('Bhopal'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'ind');
    await tester.pump();

    expect(find.text('Indore'), findsOneWidget);
    expect(find.text('Bhopal'), findsNothing);
  });
}
