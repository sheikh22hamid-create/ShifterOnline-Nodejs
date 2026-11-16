import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/home/widgets/pin_drop_marker.dart';
import 'package:goParcel/theme/app_tokens.dart';

Widget _host(Widget child, {bool reduceMotion = false}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: const Size(390, 844), disableAnimations: reduceMotion),
        child: Scaffold(body: Center(child: child)),
      ),
    );

void main() {
  testWidgets('drops in when motion is allowed', (tester) async {
    await tester.pumpWidget(_host(const PinDropMarker(color: Color(0xFFFF6B35))));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isTrue);
    await tester.pumpAndSettle();
  });

  testWidgets('no animation with reduce motion', (tester) async {
    await tester.pumpWidget(_host(const PinDropMarker(color: Color(0xFFFF6B35)), reduceMotion: true));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('no animation when animate is false', (tester) async {
    await tester.pumpWidget(_host(const PinDropMarker(color: Color(0xFFFF6B35), animate: false)));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('pin is painted in the given colour', (tester) async {
    await tester.pumpWidget(_host(const PinDropMarker(color: Color(0xFF16A34A), animate: false)));
    final paint = tester.widget<CustomPaint>(find.descendant(
        of: find.byType(PinDropMarker), matching: find.byKey(const ValueKey('pin-drop-paint'))));
    expect((paint.painter as PinDropPainter).color, const Color(0xFF16A34A));
  });

  test('appInputDecoration uses brand for the focused border', () {
    final d = appInputDecoration(label: 'House');
    expect((d.focusedBorder as OutlineInputBorder).borderSide.color, AppPalette.light.brand);
    expect((d.enabledBorder as OutlineInputBorder).borderRadius, BorderRadius.circular(12));
  });
}
