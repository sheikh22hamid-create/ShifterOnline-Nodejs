import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/theme/app_tokens.dart';
import 'package:goParcel/theme/widgets/app_info_banner.dart';
import 'package:goParcel/theme/widgets/app_radio_tile.dart';
import 'package:goParcel/theme/widgets/app_segmented.dart';
import 'package:goParcel/theme/widgets/app_sheet.dart';
import 'package:goParcel/theme/widgets/app_top_bar.dart';
import 'package:goParcel/utils/colors.dart' show notifier;

Widget _host(Widget child, {double width = 390, double textScale = 1, PreferredSizeWidget? appBar}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: Size(width, 844), textScaler: TextScaler.linear(textScale)),
        child: Scaffold(
          appBar: appBar,
          body: SingleChildScrollView(child: SizedBox(width: width, child: child)),
        ),
      ),
    );

BoxDecoration _decorationIn(WidgetTester tester, Type type) => tester
    .widgetList<Container>(find.descendant(of: find.byType(type), matching: find.byType(Container)))
    .map((c) => c.decoration)
    .whereType<BoxDecoration>()
    .first;

void main() {
  testWidgets('top bar back calls onBack', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(const SizedBox(), appBar: AppTopBar(title: 'Select vehicle', onBack: () => taps++)));
    await tester.tap(find.bySemanticsLabel('Back'));
    expect(taps, 1);
    expect(find.text('Select vehicle'), findsOneWidget);
  });

  testWidgets('sheet shows handle only when showHandle', (tester) async {
    await tester.pumpWidget(_host(const AppSheet(child: Text('body'))));
    expect(find.byKey(const ValueKey('app-sheet-handle')), findsOneWidget);
    await tester.pumpWidget(_host(const AppSheet(showHandle: false, child: Text('body'))));
    expect(find.byKey(const ValueKey('app-sheet-handle')), findsNothing);
  });

  testWidgets('sheet uses dark surface in dark mode', (tester) async {
    notifier.setIsDark = true;
    addTearDown(() => notifier.setIsDark = false);
    await tester.pumpWidget(_host(const AppSheet(child: Text('body'))));
    expect(_decorationIn(tester, AppSheet).color, AppPalette.dark.surface);
  });

  testWidgets('radio tile: tap calls onTap; selected has brand border', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(AppRadioTile(
        icon: Icons.payments_outlined, title: 'Cash on delivery', selected: true, onTap: () => taps++)));
    await tester.tap(find.text('Cash on delivery'));
    expect(taps, 1);
    expect((_decorationIn(tester, AppRadioTile).border as Border).top.color, AppPalette.light.brand);
  });

  testWidgets('radio tile: disabled ignores taps', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(AppRadioTile(
        icon: Icons.account_balance_wallet_outlined,
        title: 'Shifter Wallet',
        selected: false,
        enabled: false,
        onTap: () => taps++)));
    await tester.tap(find.text('Shifter Wallet'), warnIfMissed: false);
    expect(taps, 0);
  });

  testWidgets('radio tile: long text at width 320, textScale 1.3 does not overflow', (tester) async {
    await tester.pumpWidget(_host(
      AppRadioTile(
        icon: Icons.person_outline,
        title: 'प्राप्तकर्ता भुगतान करेगा और आपको कमीशन मिलेगा',
        subtitle: 'Receiver gets a WhatsApp link to pay (no app needed). Commission applies whether cash or online.',
        badge: 'EARN COMMISSION',
        selected: false,
        onTap: () {},
      ),
      width: 320,
      textScale: 1.3,
    ));
    expect(tester.takeException(), isNull);
  });

  testWidgets('banner: action calls onAction; no button without action', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(AppInfoBanner(
        tone: AppBannerTone.warning, icon: Icons.lock_outline, text: 'Locked', actionLabel: 'Refer now', onAction: () => taps++)));
    await tester.tap(find.text('Refer now'));
    expect(taps, 1);
    await tester.pumpWidget(_host(const AppInfoBanner(tone: AppBannerTone.info, icon: Icons.info_outline, text: 'Info')));
    expect(find.byType(TextButton), findsNothing);
  });

  testWidgets('banner tones use their palette tint', (tester) async {
    await tester.pumpWidget(_host(const AppInfoBanner(tone: AppBannerTone.success, icon: Icons.verified, text: 'ok')));
    expect(_decorationIn(tester, AppInfoBanner).color, AppPalette.light.successTint);
    await tester.pumpWidget(_host(const AppInfoBanner(tone: AppBannerTone.danger, icon: Icons.error_outline, text: 'bad')));
    expect(_decorationIn(tester, AppInfoBanner).color, AppPalette.light.dangerTint);
  });

  testWidgets('segmented labels may wrap to two lines instead of truncating', (tester) async {
    await tester.pumpWidget(_host(
      AppSegmented<int>(
        value: 1,
        onChanged: (_) {},
        segments: const [
          AppSegment(value: 1, label: 'Now', icon: Icons.bolt),
          AppSegment(value: 2, label: 'Schedule', icon: Icons.calendar_month),
          AppSegment(value: 3, label: 'Low Fare', icon: Icons.south),
        ],
      ),
      width: 320,
      textScale: 1.3,
    ));
    expect(tester.widget<Text>(find.text('Low Fare')).maxLines, 2);
    expect(tester.takeException(), isNull);
  });
}
