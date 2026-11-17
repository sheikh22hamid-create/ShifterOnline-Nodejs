import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/widgets/app_buttons.dart';
import 'package:goParcel/theme/widgets/app_card.dart';
import 'package:goParcel/theme/widgets/app_segmented.dart';
import 'package:goParcel/theme/widgets/app_skeleton.dart';
import 'package:goParcel/theme/widgets/section_header.dart';
import 'package:goParcel/utils/colors.dart' show notifier;

Widget _host(Widget child, {bool reduceMotion = false}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: const Size(390, 844), disableAnimations: reduceMotion),
        child: Scaffold(body: Center(child: child)),
      ),
    );

BoxDecoration _cardDecoration(WidgetTester tester) {
  final box = tester.widget<DecoratedBox>(
      find.descendant(of: find.byType(AppCard), matching: find.byType(DecoratedBox)).first);
  return box.decoration as BoxDecoration;
}

void main() {
  testWidgets('primary button: label colour is onBrand, tap fires once', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(AppPrimaryButton(label: 'Book', onPressed: () => taps++)));
    final text = tester.widget<Text>(find.text('Book'));
    expect(text.style?.color, const Color(0xFF1A0B04));
    await tester.tap(find.text('Book'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('primary button: null onPressed ignores taps', (tester) async {
    await tester.pumpWidget(_host(const AppPrimaryButton(label: 'Book', onPressed: null)));
    await tester.tap(find.text('Book'), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('primary button height is at least 44', (tester) async {
    await tester.pumpWidget(_host(AppPrimaryButton(label: 'Book', onPressed: () {})));
    expect(tester.getSize(find.byType(AppPrimaryButton)).height, greaterThanOrEqualTo(44));
  });

  testWidgets('primary button shows trailing text', (tester) async {
    await tester.pumpWidget(_host(AppPrimaryButton(label: 'Confirm', trailing: '₹349', onPressed: () {})));
    expect(find.text('₹349'), findsOneWidget);
  });

  testWidgets('segmented: tapping a segment reports its value', (tester) async {
    int? picked;
    await tester.pumpWidget(_host(SizedBox(
      width: 358,
      child: AppSegmented<int>(
        value: 1,
        onChanged: (v) => picked = v,
        segments: const [
          AppSegment(value: 1, label: 'Now', icon: Icons.bolt),
          AppSegment(value: 2, label: 'Schedule', icon: Icons.calendar_month),
          AppSegment(value: 3, label: 'Low Fare', icon: Icons.south),
        ],
      ),
    )));
    await tester.tap(find.text('Schedule'));
    await tester.pumpAndSettle();
    expect(picked, 2);
  });

  testWidgets('card selected shows brand border', (tester) async {
    await tester.pumpWidget(_host(const AppCard(selected: true, child: Text('x'))));
    final border = _cardDecoration(tester).border as Border;
    expect(border.top.color, AppPalette.light.brand);
  });

  testWidgets('card tap calls onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(AppCard(onTap: () => taps++, child: const Text('card'))));
    await tester.tap(find.text('card'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('skeleton does not animate with reduce motion', (tester) async {
    await tester.pumpWidget(_host(const AppSkeleton(width: 100, height: 20), reduceMotion: true));
    await tester.pump();
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('section header action calls onAction', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(SectionHeader(title: 'Vehicles', actionLabel: 'See all', onAction: () => taps++)));
    await tester.tap(find.text('See all'));
    expect(taps, 1);
  });

  testWidgets('components use dark palette when notifier is dark', (tester) async {
    notifier.setIsDark = true;
    addTearDown(() => notifier.setIsDark = false);
    await tester.pumpWidget(_host(const AppCard(child: Text('x'))));
    expect(_cardDecoration(tester).color, AppPalette.dark.surface);
  });
}
