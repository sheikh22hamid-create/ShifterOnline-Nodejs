import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/radar_pulse.dart';

Widget _host(Widget child, {bool reduceMotion = false}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: const Size(390, 844), disableAnimations: reduceMotion),
        child: Scaffold(body: Center(child: child)),
      ),
    );

void main() {
  testWidgets('animates when motion is allowed', (tester) async {
    await tester.pumpWidget(_host(const RadarPulse(color: Color(0xFFFF6B35))));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isTrue);
  });

  testWidgets('static with reduce motion', (tester) async {
    await tester.pumpWidget(_host(const RadarPulse(color: Color(0xFFFF6B35)), reduceMotion: true));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('draws the requested number of rings', (tester) async {
    await tester.pumpWidget(_host(const RadarPulse(color: Color(0xFFFF6B35), rings: 4)));
    expect(find.byKey(const ValueKey('radar-ring')), findsNWidgets(4));
  });
}
