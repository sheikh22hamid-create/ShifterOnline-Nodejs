import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/authscreen/complete_profile.dart';
import 'package:goParcel/screens/authscreen/widgets/profile_form_widgets.dart';

Future<List<CityModel>> _cities() async => [CityModel(id: '1', title: 'Indore')];

Widget _app(CompleteProfile screen) => GetMaterialApp(home: screen);

Future<void> _fillValidForm(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('cp-name')), 'Ravi');
  await tester.tap(find.byType(CitySelector));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Indore'));
  await tester.pumpAndSettle();
}

Finder get _cta => find.byKey(const Key('cp-submit'));

void main() {
  testWidgets('shows the number being signed up', (tester) async {
    await tester.pumpWidget(_app(CompleteProfile(
        mobile: '9876543210', loadCities: _cities, submit: (_) async => null)));
    await tester.pumpAndSettle();

    expect(find.textContaining('+91 9876543210'), findsOneWidget);
  });

  testWidgets('empty form shows name and city errors and does not submit',
      (tester) async {
    var calls = 0;
    await tester.pumpWidget(_app(CompleteProfile(
        mobile: '9876543210',
        loadCities: _cities,
        submit: (_) async {
          calls++;
          return null;
        })));
    await tester.pumpAndSettle();

    await tester.ensureVisible(_cta);
    await tester.tap(_cta);
    await tester.pump();

    expect(find.text('Please enter your full name'), findsOneWidget);
    expect(find.text('Please select your city'), findsOneWidget);
    expect(calls, 0);
  });

  testWidgets('double tap on Create Account sends one request with the form',
      (tester) async {
    final gate = Completer<String?>();
    final sent = <Map<String, String>>[];
    await tester.pumpWidget(_app(CompleteProfile(
        mobile: '9876543210',
        loadCities: _cities,
        submit: (form) {
          sent.add(form);
          return gate.future;
        })));
    await tester.pumpAndSettle();
    await _fillValidForm(tester);

    await tester.ensureVisible(_cta);
    await tester.tap(_cta);
    await tester.pump();
    await tester.tap(_cta, warnIfMissed: false);
    await tester.pump();

    expect(sent, [
      {'name': 'Ravi', 'email': '', 'city_id': '1', 'referral': ''}
    ]);
    // On success the spinner stays up (real flow has already navigated Home).
    gate.complete(null);
    await tester.pump();
  });

  testWidgets('back arrow and system back both return to Sign In',
      (tester) async {
    var exits = 0;
    await tester.pumpWidget(_app(CompleteProfile(
      mobile: '9876543210',
      loadCities: _cities,
      submit: (_) async => null,
      onExit: () => exits++,
    )));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.arrow_back_rounded));
    await tester.pump();
    expect(exits, 1);

    // Profile Details is often the only route (Sign In was opened via offAll).
    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(exits, 2);
    expect(find.byType(CompleteProfile), findsOneWidget);
  });

  testWidgets('expired OTP sends the user back to verify again', (tester) async {
    var expired = 0;
    await tester.pumpWidget(_app(CompleteProfile(
      mobile: '9876543210',
      loadCities: _cities,
      submit: (_) async => 'Please verify OTP for this mobile number first.',
      onSessionExpired: () => expired++,
    )));
    await tester.pumpAndSettle();
    await _fillValidForm(tester);

    await tester.ensureVisible(_cta);
    await tester.tap(_cta);
    await tester.pumpAndSettle();

    expect(expired, 1);
  });
}
